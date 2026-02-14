import { useState, useEffect, useCallback } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { assetUrl } from "@/lib/asset-url"
import type { MouseEvent as MouseLogEvent } from "@/types/editor"

/**
 * Loads mouse_events.jsonl and provides the cursor position at the current time.
 * Uses binary search for efficient lookup during playback.
 */
export function useMouseEvents() {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const [events, setEvents] = useState<MouseLogEvent[]>([])

  // Load events from JSONL file
  useEffect(() => {
    if (!project?.tracks.mouse_events) {
      setEvents([])
      return
    }

    const url = assetUrl(project.tracks.mouse_events)
    fetch(url)
      .then((r) => r.text())
      .then((text) => {
        const parsed = text
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try { return JSON.parse(line) as MouseLogEvent }
            catch { return null }
          })
          .filter(Boolean) as MouseLogEvent[]
        setEvents(parsed)
      })
      .catch(() => setEvents([]))
  }, [project?.tracks.mouse_events])

  // Binary search for cursor position at current time
  const getCursorAt = useCallback(
    (timeMs: number): { x: number; y: number } | null => {
      if (events.length === 0) return null

      // Binary search for the last event at or before timeMs
      let lo = 0
      let hi = events.length - 1
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (events[mid].timeMs <= timeMs) {
          lo = mid
        } else {
          hi = mid - 1
        }
      }

      if (events[lo].timeMs > timeMs) return null
      return { x: events[lo].x, y: events[lo].y }
    },
    [events]
  )

  const cursorPos = getCursorAt(currentTime)

  return { cursorPos, events, getCursorAt }
}
