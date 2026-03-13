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
  const lastSentWatchTimeRef = useRef(0)
  const hasSentFinalRef = useRef(false)

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

    const getCurrentTotal = () => {
      let totalMs = totalWatchTimeRef.current
      if (watchStartRef.current) {
        totalMs += Date.now() - watchStartRef.current
      }
      return totalMs
    }

    const sendFinalAnalytics = () => {
      if (hasSentFinalRef.current) return

      const totalMs = getCurrentTotal()
      const delta = totalMs - lastSentWatchTimeRef.current

      if (delta > 1000) {
        const completion = durationMs > 0 ? Math.min(totalMs / durationMs, 1) : 0
        trackView(videoId, delta, completion * 100)
        lastSentWatchTimeRef.current = totalMs
        hasSentFinalRef.current = true
      }
    }

    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)

    // Send on page unload
    const onBeforeUnload = () => sendFinalAnalytics()
    window.addEventListener("beforeunload", onBeforeUnload)

    // Send delta periodically (every 30s) for long videos
    const interval = setInterval(() => {
      if (!video.paused) {
        const totalMs = getCurrentTotal()
        const delta = totalMs - lastSentWatchTimeRef.current

        if (delta > 1000) {
          const completion = durationMs > 0 ? Math.min(totalMs / durationMs, 1) : 0
          trackView(videoId, delta, completion * 100)
          lastSentWatchTimeRef.current = totalMs
        }
      }
    }, 30_000)

    return () => {
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      window.removeEventListener("beforeunload", onBeforeUnload)
      clearInterval(interval)
      sendFinalAnalytics()
    }
  }, [videoId, durationMs]) // eslint-disable-line react-hooks/exhaustive-deps
}
