import { useCallback, useMemo, useRef } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { sourceTimeToSequenceTime, sequenceTimeToSourceTime } from "@/lib/sequence"
import { ZoomSegment } from "./zoom-segment"
import type { TimelineContext } from "./types"

interface ZoomTrackProps {
  ctx: TimelineContext
}

/** A zoom keyframe mapped to sequence time, with its clip origin */
export interface SequenceZoomSegment {
  clipIndex: number
  kfIndex: number
  seqTimeMs: number
  clipRelativeTimeMs: number
  durationMs: number | undefined
  scale: number
  x: number
  y: number
  easing: "spring" | "ease-out" | "linear"
}

export function ZoomTrack({ ctx }: ZoomTrackProps) {
  const sequence = useEditorStore((s) => s.project?.sequence)
  const selectedZoomIndex = useEditorStore((s) => s.selectedZoomIndex)
  const setSelectedZoomIndex = useEditorStore((s) => s.setSelectedZoomIndex)
  const addZoomKeyframeToClip = useEditorStore((s) => s.addZoomKeyframeToClip)
  const dragStartRef = useRef<{ x: number; timeMs: number } | null>(null)

  // Flatten all clip keyframes into sequence-time segments
  const segments: SequenceZoomSegment[] = useMemo(() => {
    if (!sequence) return []
    const result: SequenceZoomSegment[] = []
    for (let ci = 0; ci < sequence.clips.length; ci++) {
      const clip = sequence.clips[ci]
      const clipSeqStart = sourceTimeToSequenceTime(
        clip.sourceStart, ci, sequence.clips, sequence.transitions
      )
      for (let ki = 0; ki < clip.zoomKeyframes.length; ki++) {
        const kf = clip.zoomKeyframes[ki]
        result.push({
          clipIndex: ci,
          kfIndex: ki,
          seqTimeMs: clipSeqStart + kf.timeMs,
          clipRelativeTimeMs: kf.timeMs,
          durationMs: kf.durationMs,
          scale: kf.scale,
          x: kf.x,
          y: kf.y,
          easing: kf.easing,
        })
      }
    }
    return result.sort((a, b) => a.seqTimeMs - b.seqTimeMs)
  }, [sequence])

  // Check if a time range overlaps any existing segment
  const isOverlapping = (timeMs: number, durationMs: number): boolean => {
    const end = timeMs + durationMs
    return segments.some((seg) => {
      const segEnd = seg.seqTimeMs + (seg.durationMs ?? 0)
      return timeMs < segEnd && end > seg.seqTimeMs
    })
  }

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

      // Determine segment start and duration
      let segStart: number
      let segDuration: number
      if (dx < 5) {
        // Click: default 500ms segment
        segDuration = 500
        segStart = Math.max(0, endTimeMs - segDuration / 2)
      } else {
        // Drag: span the dragged range
        segStart = Math.min(startTimeMs, endTimeMs)
        segDuration = Math.max(200, Math.abs(endTimeMs - startTimeMs))
      }

      if (isOverlapping(segStart, segDuration)) return

      // Find which clip this falls into
      const mapping = sequenceTimeToSourceTime(segStart, sequence.clips, sequence.transitions)
      if (!mapping) return

      const clip = sequence.clips[mapping.clipIndex]
      const clipSeqStart = sourceTimeToSequenceTime(
        clip.sourceStart, mapping.clipIndex, sequence.clips, sequence.transitions
      )
      const clipRelativeTime = segStart - clipSeqStart

      addZoomKeyframeToClip(mapping.clipIndex, {
        timeMs: Math.round(clipRelativeTime),
        durationMs: segDuration,
        x: 0.5,
        y: 0.5,
        scale: 1.5,
        easing: "ease-out",
      })
    },
    [ctx, sequence, segments, addZoomKeyframeToClip]
  )

  const isEmpty = segments.length === 0

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
        segments.map((seg, i) => (
          <ZoomSegment
            key={`${seg.clipIndex}-${seg.kfIndex}`}
            segment={{
              timeMs: seg.seqTimeMs,
              durationMs: seg.durationMs,
              scale: seg.scale,
              x: seg.x,
              y: seg.y,
              easing: seg.easing,
            }}
            index={i}
            clipIndex={seg.clipIndex}
            kfIndex={seg.kfIndex}
            clipRelativeTimeMs={seg.clipRelativeTimeMs}
            ctx={ctx}
            isSelected={selectedZoomIndex === i}
            onSelect={setSelectedZoomIndex}
          />
        ))
      )}
    </div>
  )
}
