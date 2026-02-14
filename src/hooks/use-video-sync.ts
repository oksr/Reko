import { useRef, useCallback, useEffect } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { sequenceTimeToSourceTime, sourceTimeToSequenceTime, getSequenceDuration } from "@/lib/sequence"

interface VideoSyncOptions {
  onTimeUpdate?: (timeMs: number) => void
}

export function useVideoSync(options: VideoSyncOptions = {}) {
  const videosRef = useRef<HTMLVideoElement[]>([])
  const rafRef = useRef<number>(0)
  const playingRef = useRef(false)
  const onTimeUpdateRef = useRef(options.onTimeUpdate)
  onTimeUpdateRef.current = options.onTimeUpdate

  // Track which clip is currently playing for smooth within-clip playback
  const clipRef = useRef<{ index: number; seqStart: number } | null>(null)

  const register = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return
    if (!videosRef.current.includes(video)) {
      videosRef.current.push(video)
    }
  }, [])

  const unregister = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return
    videosRef.current = videosRef.current.filter((v) => v !== video)
  }, [])

  const stopLoop = useCallback(() => {
    playingRef.current = false
    cancelAnimationFrame(rafRef.current)
    videosRef.current.forEach((v) => v.pause())
  }, [])

  /** Seek all videos to the source time corresponding to a sequence time */
  const seek = useCallback((seqTimeMs: number) => {
    const sequence = useEditorStore.getState().project?.sequence
    if (!sequence) {
      // Fallback for no sequence: direct seek
      const timeSec = seqTimeMs / 1000
      videosRef.current.forEach((v) => { v.currentTime = timeSec })
      onTimeUpdateRef.current?.(seqTimeMs)
      return
    }

    const mapping = sequenceTimeToSourceTime(seqTimeMs, sequence.clips, sequence.transitions)
    if (mapping) {
      videosRef.current.forEach((v) => { v.currentTime = mapping.sourceTime / 1000 })
      clipRef.current = {
        index: mapping.clipIndex,
        seqStart: sourceTimeToSequenceTime(
          sequence.clips[mapping.clipIndex].sourceStart,
          mapping.clipIndex, sequence.clips, sequence.transitions
        ),
      }
    }
    onTimeUpdateRef.current?.(seqTimeMs)
  }, [])

  const play = useCallback(async () => {
    const state = useEditorStore.getState()
    const sequence = state.project?.sequence
    if (!sequence || sequence.clips.length === 0) return

    // Resolve current clip from sequence time
    const seqTime = state.currentTime
    const mapping = sequenceTimeToSourceTime(seqTime, sequence.clips, sequence.transitions)
    if (!mapping) return

    const clip = sequence.clips[mapping.clipIndex]
    clipRef.current = {
      index: mapping.clipIndex,
      seqStart: sourceTimeToSequenceTime(
        clip.sourceStart, mapping.clipIndex, sequence.clips, sequence.transitions
      ),
    }

    // Seek to correct source position and set speed
    videosRef.current.forEach((v) => {
      v.currentTime = mapping.sourceTime / 1000
      v.playbackRate = clip.speed
    })

    playingRef.current = true
    await Promise.all(videosRef.current.map((v) => v.play().catch(() => {})))

    const tick = () => {
      if (!playingRef.current) return
      const primary = videosRef.current[0]
      if (!primary || !clipRef.current) return

      const sequence = useEditorStore.getState().project?.sequence
      if (!sequence) return

      const ci = clipRef.current
      const clip = sequence.clips[ci.index]
      if (!clip) return

      const sourceTimeMs = primary.currentTime * 1000
      const seqDuration = getSequenceDuration(sequence.clips, sequence.transitions)
      const outPoint = useEditorStore.getState().project?.timeline.out_point ?? Infinity

      // Compute current sequence time from source position within clip
      const timeInClipMs = (sourceTimeMs - clip.sourceStart) / clip.speed
      const currentSeqTime = ci.seqStart + timeInClipMs

      // Check end conditions
      if (currentSeqTime >= outPoint || currentSeqTime >= seqDuration) {
        onTimeUpdateRef.current?.(Math.min(outPoint, seqDuration))
        stopLoop()
        useEditorStore.getState().setIsPlaying(false)
        return
      }

      // Check if video reached end of current clip
      if (sourceTimeMs >= clip.sourceEnd) {
        const nextIndex = ci.index + 1
        if (nextIndex >= sequence.clips.length) {
          onTimeUpdateRef.current?.(seqDuration)
          stopLoop()
          useEditorStore.getState().setIsPlaying(false)
          return
        }
        // Transition to next clip
        const nextClip = sequence.clips[nextIndex]
        clipRef.current = {
          index: nextIndex,
          seqStart: sourceTimeToSequenceTime(
            nextClip.sourceStart, nextIndex, sequence.clips, sequence.transitions
          ),
        }
        videosRef.current.forEach((v) => {
          v.currentTime = nextClip.sourceStart / 1000
          v.playbackRate = nextClip.speed
        })
      }

      // Video ended naturally (source file shorter than expected)
      if (primary.ended) {
        onTimeUpdateRef.current?.(currentSeqTime)
        stopLoop()
        useEditorStore.getState().setIsPlaying(false)
        return
      }

      onTimeUpdateRef.current?.(currentSeqTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopLoop])

  const pause = useCallback(() => {
    stopLoop()
  }, [stopLoop])

  /** Returns current sequence time (not source time) */
  const getCurrentTime = useCallback((): number => {
    const primary = videosRef.current[0]
    if (!primary) return 0

    const sequence = useEditorStore.getState().project?.sequence
    if (!sequence || !clipRef.current) return primary.currentTime * 1000

    const clip = sequence.clips[clipRef.current.index]
    if (!clip) return primary.currentTime * 1000

    const sourceTimeMs = primary.currentTime * 1000
    const timeInClipMs = (sourceTimeMs - clip.sourceStart) / clip.speed
    return clipRef.current.seqStart + timeInClipMs
  }, [])

  // Cleanup
  useEffect(() => {
    return () => {
      playingRef.current = false
      cancelAnimationFrame(rafRef.current)
      videosRef.current.forEach((v) => v.pause())
      videosRef.current = []
    }
  }, [])

  return { register, unregister, play, pause, seek, getCurrentTime }
}
