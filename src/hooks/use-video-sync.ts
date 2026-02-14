import { useRef, useCallback, useEffect } from "react"
import { useEditorStore } from "@/stores/editor-store"

interface VideoSyncOptions {
  onTimeUpdate?: (timeMs: number) => void
}

export function useVideoSync(options: VideoSyncOptions = {}) {
  const videosRef = useRef<HTMLVideoElement[]>([])
  const rafRef = useRef<number>(0)
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

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    videosRef.current.forEach((v) => v.pause())
  }, [])

  const play = useCallback(async () => {
    const promises = videosRef.current.map((v) => v.play().catch(() => {}))
    await Promise.all(promises)

    const tick = () => {
      const primary = videosRef.current[0]
      if (!primary) return

      const timeMs = primary.currentTime * 1000
      const project = useEditorStore.getState().project

      // Stop playback at out-point or when video naturally ends
      const outPoint = project?.timeline.out_point ?? Infinity
      if (primary.paused || primary.ended || timeMs >= outPoint) {
        // Snap to out-point when video ends — the video element's native
        // duration can be slightly shorter than the recorded duration_ms,
        // so report out-point to keep the playhead at 100%.
        const finalTime = (primary.ended || primary.paused) ? outPoint : timeMs
        onTimeUpdateRef.current?.(finalTime)
        pause()
        useEditorStore.getState().setIsPlaying(false)
        return
      }

      onTimeUpdateRef.current?.(timeMs)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [pause])

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
      cancelAnimationFrame(rafRef.current)
      videosRef.current.forEach((v) => v.pause())
      videosRef.current = []
    }
  }, [])

  return { register, unregister, play, pause, seek, getCurrentTime }
}
