import { useEffect, useRef } from "react"
import { trackView } from "@/lib/api"

/**
 * Tracks video view analytics. Sends a beacon when the user leaves
 * the page or periodically during playback.
 */
export function useVideoAnalytics(
  videoId: string,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  durationMs: number
) {
  const watchStartRef = useRef<number | null>(null)
  const totalWatchTimeRef = useRef(0)
  const hasSentRef = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlay = () => {
      watchStartRef.current = Date.now()
    }

    const onPause = () => {
      if (watchStartRef.current) {
        totalWatchTimeRef.current += Date.now() - watchStartRef.current
        watchStartRef.current = null
      }
    }

    const sendAnalytics = () => {
      if (hasSentRef.current) return

      // Include current play session if still playing
      let totalMs = totalWatchTimeRef.current
      if (watchStartRef.current) {
        totalMs += Date.now() - watchStartRef.current
      }

      if (totalMs > 1000) {
        // Only track views > 1 second
        const completion = durationMs > 0 ? Math.min(totalMs / durationMs, 1) : 0
        trackView(videoId, totalMs, completion * 100)
        hasSentRef.current = true
      }
    }

    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)

    // Send on page unload
    const onBeforeUnload = () => sendAnalytics()
    window.addEventListener("beforeunload", onBeforeUnload)

    // Also send periodically (every 30s) for long videos
    const interval = setInterval(() => {
      if (!video.paused && totalWatchTimeRef.current > 0) {
        // Reset and send periodically for long sessions
        const totalMs = totalWatchTimeRef.current + (watchStartRef.current ? Date.now() - watchStartRef.current : 0)
        const completion = durationMs > 0 ? Math.min(totalMs / durationMs, 1) : 0
        trackView(videoId, totalMs, completion * 100)
      }
    }, 30_000)

    return () => {
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      window.removeEventListener("beforeunload", onBeforeUnload)
      clearInterval(interval)
      sendAnalytics()
    }
  }, [videoId, durationMs]) // eslint-disable-line react-hooks/exhaustive-deps
}
