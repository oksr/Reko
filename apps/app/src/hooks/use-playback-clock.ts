import { useRef, useCallback, useEffect } from "react"
import { useEditorStore } from "@/stores/editor-store"
import {
  sequenceTimeToSourceTime,
  getSequenceDuration,
} from "@/lib/sequence"

interface PlaybackClockOptions {
  onTimeUpdate?: (timeMs: number) => void
}

export function usePlaybackClock(options: PlaybackClockOptions = {}) {
  const rafRef = useRef<number>(0)
  const lastWallRef = useRef<number>(0)
  const playingRef = useRef(false)
  const onTimeUpdateRef = useRef(options.onTimeUpdate)
  onTimeUpdateRef.current = options.onTimeUpdate

  const stopLoop = useCallback(() => {
    playingRef.current = false
    cancelAnimationFrame(rafRef.current)
  }, [])

  const play = useCallback(async () => {
    const state = useEditorStore.getState()
    const sequence = state.project?.sequence
    if (!sequence || sequence.clips.length === 0) return

    playingRef.current = true
    lastWallRef.current = performance.now()

    const tick = () => {
      if (!playingRef.current) return

      const now = performance.now()
      const wallDelta = now - lastWallRef.current
      lastWallRef.current = now

      const state = useEditorStore.getState()
      const sequence = state.project?.sequence
      if (!sequence) { stopLoop(); return }

      // Get current clip speed
      const mapping = sequenceTimeToSourceTime(
        state.currentTime, sequence.clips, sequence.transitions
      )
      const speed = mapping ? sequence.clips[mapping.clipIndex].speed : 1

      // Advance by wall-clock delta * clip speed
      const newTime = state.currentTime + wallDelta * speed
      const seqDuration = getSequenceDuration(sequence.clips, sequence.transitions)

      if (newTime >= seqDuration) {
        // End of sequence
        state.setCurrentTime(seqDuration)
        state.setIsPlaying(false)
        onTimeUpdateRef.current?.(seqDuration)
        stopLoop()
        return
      }

      state.setCurrentTime(newTime)
      onTimeUpdateRef.current?.(newTime)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [stopLoop])

  const pause = useCallback(() => {
    stopLoop()
  }, [stopLoop])

  const seek = useCallback((seqTimeMs: number) => {
    useEditorStore.getState().setCurrentTime(seqTimeMs)
    onTimeUpdateRef.current?.(seqTimeMs)
  }, [])

  // Cleanup
  useEffect(() => {
    return () => {
      playingRef.current = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return { play, pause, seek }
}
