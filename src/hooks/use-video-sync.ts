import { useRef, useCallback, useEffect } from "react"
import { useEditorStore } from "@/stores/editor-store"

interface VideoSyncOptions {
  onTimeUpdate?: (timeMs: number) => void
}

export function useVideoSync(options: VideoSyncOptions = {}) {
  const videosRef = useRef<HTMLVideoElement[]>([])
  const rafRef = useRef<number>(0)
  const playingRef = useRef(false)
  // Use ref for callback to avoid stale closure in RAF loop
  const onTimeUpdateRef = useRef(options.onTimeUpdate)
  onTimeUpdateRef.current = options.onTimeUpdate

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

  const play = useCallback(async () => {
    playingRef.current = true
    const promises = videosRef.current.map((v) => v.play().catch(() => {}))
    await Promise.all(promises)

    const tick = () => {
      if (!playingRef.current) return

      const primary = videosRef.current[0]
      if (!primary) return

      const timeMs = primary.currentTime * 1000
      const project = useEditorStore.getState().project
      const outPoint = project?.timeline.out_point ?? Infinity

      // Reached or passed the out-point
      if (timeMs >= outPoint) {
        onTimeUpdateRef.current?.(outPoint)
        stopLoop()
        useEditorStore.getState().setIsPlaying(false)
        return
      }

      // Video ended naturally before out-point (duration mismatch).
      // Seek to the video's actual end so the last frame is shown,
      // then stop — the tiny gap vs out_point is imperceptible.
      if (primary.ended) {
        const endMs = primary.duration * 1000
        onTimeUpdateRef.current?.(endMs)
        stopLoop()
        useEditorStore.getState().setIsPlaying(false)
        return
      }

      onTimeUpdateRef.current?.(timeMs)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopLoop])

  // Expose pause as stopping our own loop (not dependent on video.paused)
  const pause = useCallback(() => {
    stopLoop()
  }, [stopLoop])

  const seek = useCallback((timeMs: number) => {
    const timeSec = timeMs / 1000
    videosRef.current.forEach((v) => {
      v.currentTime = timeSec
    })
    onTimeUpdateRef.current?.(timeMs)
  }, [])

  const getCurrentTime = useCallback((): number => {
    const primary = videosRef.current[0]
    return primary ? primary.currentTime * 1000 : 0
  }, [])

  // Cleanup pauses videos and clears array
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
