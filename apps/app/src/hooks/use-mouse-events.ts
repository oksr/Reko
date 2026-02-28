import { useState, useEffect, useCallback } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { useAssetUrl } from "@/lib/asset-url"
import type { MouseEvent as MouseLogEvent, SystemCursorType } from "@/types/editor"

/**
 * Loads mouse_events.jsonl and provides the cursor position at the current time.
 * Uses binary search for efficient lookup during playback.
 */
export function useMouseEvents() {
  const project = useEditorStore((s) => s.project)
  const assetUrl = useAssetUrl()
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
    (timeMs: number): { x: number; y: number; cursor?: SystemCursorType } | null => {
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
      const evt = events[lo]
      return { x: evt.x, y: evt.y, cursor: evt.cursor }
    },
    [events]
  )

  const cursorPos = getCursorAt(currentTime)

  // Find click events near the current time (within the ripple animation window)
  const getClicksInRange = useCallback(
    (startMs: number, endMs: number): Array<{ timeMs: number; x: number; y: number }> => {
      if (events.length === 0) return []

      // Binary search for first event >= startMs
      let lo = 0
      let hi = events.length - 1
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (events[mid].timeMs < startMs) {
          lo = mid + 1
        } else {
          hi = mid
        }
      }

      const clicks: Array<{ timeMs: number; x: number; y: number }> = []
      for (let i = lo; i < events.length && events[i].timeMs <= endMs; i++) {
        if (events[i].type === "click" || events[i].type === "rightClick") {
          clicks.push({ timeMs: events[i].timeMs, x: events[i].x, y: events[i].y })
        }
      }
      return clicks
    },
    [events]
  )

  return { cursorPos, events, getCursorAt, getClicksInRange }
}
