import { useCallback, useMemo, useRef } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { sourceTimeToSequenceTime, sequenceTimeToSourceTime } from "@/lib/sequence"
import { ZoomSegment } from "./zoom-segment"
import type { TimelineContext } from "./types"
import type { ZoomEvent } from "@/types/editor"

interface ZoomTrackProps {
  ctx: TimelineContext
}

/** A zoom event mapped to sequence time, with its clip origin */
export interface SequenceZoomEvent {
  clipIndex: number
  event: ZoomEvent
  seqStartMs: number  // sequence-time start of this event
  seqEndMs: number    // sequence-time end of this event
}

export function ZoomTrack({ ctx }: ZoomTrackProps) {
  const sequence = useEditorStore((s) => s.project?.sequence)
  const selectedZoomEventId = useEditorStore((s) => s.selectedZoomEventId)
  const setSelectedZoomEventId = useEditorStore((s) => s.setSelectedZoomEventId)
  const addZoomEvent = useEditorStore((s) => s.addZoomEvent)
  const dragStartRef = useRef<{ x: number; timeMs: number } | null>(null)

  // Flatten all clip zoom events into sequence-time list
  const allEvents: SequenceZoomEvent[] = useMemo(() => {
    if (!sequence) return []
    const result: SequenceZoomEvent[] = []
    for (let ci = 0; ci < sequence.clips.length; ci++) {
      const clip = sequence.clips[ci]
      const clipSeqStart = sourceTimeToSequenceTime(
        clip.sourceStart, ci, sequence.clips, sequence.transitions
      )
      for (const evt of clip.zoomEvents) {
        result.push({
          clipIndex: ci,
          event: evt,
          seqStartMs: clipSeqStart + evt.timeMs,
          seqEndMs: clipSeqStart + evt.timeMs + evt.durationMs,
        })
      }
    }
    return result.sort((a, b) => a.seqStartMs - b.seqStartMs)
  }, [sequence])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const timeMs = Math.round(pct * ctx.durationMs)
      dragStartRef.current = { x: e.clientX, timeMs }
    },
    [ctx]
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ctx.containerRef.current || !dragStartRef.current || !sequence) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const endPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const endTimeMs = Math.round(endPct * ctx.durationMs)
      const startTimeMs = dragStartRef.current.timeMs

      const dx = Math.abs(e.clientX - dragStartRef.current.x)
      dragStartRef.current = null

      // Determine event span
      let spanStart: number
      let durationMs: number
      if (dx < 5) {
        // Click: 1.5-second event
        spanStart = Math.max(0, endTimeMs - 300)
        durationMs = 1500
      } else {
        // Drag: span the dragged range
        spanStart = Math.min(startTimeMs, endTimeMs)
        const spanEnd = Math.max(startTimeMs, endTimeMs)
        durationMs = Math.max(400, spanEnd - spanStart)
      }

      // Find which clip this falls into
      const mapping = sequenceTimeToSourceTime(spanStart, sequence.clips, sequence.transitions)
      if (!mapping) return

      const clip = sequence.clips[mapping.clipIndex]
      const clipSeqStart = sourceTimeToSequenceTime(
        clip.sourceStart, mapping.clipIndex, sequence.clips, sequence.transitions
      )
      const clipRelStart = Math.max(0, Math.round(spanStart - clipSeqStart))

      const newEvent: ZoomEvent = {
        id: crypto.randomUUID(),
        timeMs: clipRelStart,
        durationMs,
        x: 0.5,
        y: 0.5,
        scale: 2.0,
      }

      addZoomEvent(mapping.clipIndex, newEvent)
    },
    [ctx, sequence, addZoomEvent]
  )

  const isEmpty = allEvents.length === 0

  return (
    <div
      className={`relative h-9 rounded-md overflow-hidden ${
        isEmpty ? "bg-indigo-950/40 border border-dashed border-indigo-500/30" : "bg-indigo-950/20"
      }`}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      tabIndex={0}
    >
      {isEmpty ? (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-indigo-400/60">Click or drag to add zoom</span>
        </div>
      ) : (
        allEvents.map((seqEvt) => (
          <ZoomSegment
            key={seqEvt.event.id}
            seqEvent={seqEvt}
            ctx={ctx}
            isSelected={selectedZoomEventId === seqEvt.event.id}
            onSelect={() => setSelectedZoomEventId(seqEvt.event.id)}
          />
        ))
      )}
    </div>
  )
}
