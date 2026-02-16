import { useCallback, useMemo, useRef } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { sourceTimeToSequenceTime, sequenceTimeToSourceTime } from "@/lib/sequence"
import { ZoomSegment } from "./zoom-segment"
import type { TimelineContext } from "./types"

interface ZoomTrackProps {
  ctx: TimelineContext
}

/** A zoom keyframe mapped to sequence time, with its clip origin */
export interface SequenceZoomKf {
  clipIndex: number
  kfIndex: number
  seqTimeMs: number
  clipRelativeTimeMs: number
  scale: number
  x: number
  y: number
  easing: "spring" | "ease-out" | "linear"
}

/** A visual zoom region computed from keyframe pairs */
export interface ZoomRegion {
  startMs: number       // sequence time
  endMs: number         // sequence time
  peakScale: number     // highest scale in region
  /** First zoomed keyframe — used for editing via popover */
  primaryClipIndex: number
  primaryKfIndex: number
  primaryClipRelativeTimeMs: number
  /** All keyframes in this region */
  keyframes: SequenceZoomKf[]
}

/**
 * Group keyframes into visual zoom regions for timeline display.
 * A region spans from the 1x anchor before a zoomed keyframe to the 1x anchor after.
 */
function computeZoomRegions(kfs: SequenceZoomKf[]): ZoomRegion[] {
  if (kfs.length === 0) return []

  const sorted = [...kfs].sort((a, b) => a.seqTimeMs - b.seqTimeMs)
  const regions: ZoomRegion[] = []

  let buf: SequenceZoomKf[] = []
  let hasZoomed = false

  const flushRegion = () => {
    if (buf.length === 0 || !hasZoomed) {
      buf = []
      hasZoomed = false
      return
    }
    const peak = Math.max(...buf.map((k) => k.scale))
    const primary = buf.find((k) => k.scale > 1.01)!
    regions.push({
      startMs: buf[0].seqTimeMs,
      endMs: buf[buf.length - 1].seqTimeMs,
      peakScale: peak,
      primaryClipIndex: primary.clipIndex,
      primaryKfIndex: primary.kfIndex,
      primaryClipRelativeTimeMs: primary.clipRelativeTimeMs,
      keyframes: buf,
    })
    buf = []
    hasZoomed = false
  }

  for (const seg of sorted) {
    const isZoomed = seg.scale > 1.01

    if (isZoomed) {
      hasZoomed = true
      buf.push(seg)
    } else {
      // 1x keyframe
      if (hasZoomed) {
        // End anchor — include it and flush
        buf.push(seg)
        flushRegion()
      } else {
        // Could be start anchor of next region — keep as start of next buffer
        buf = [seg]
      }
    }
  }

  // Trailing zoomed keyframes without end anchor
  if (hasZoomed && buf.length > 0) {
    const peak = Math.max(...buf.map((k) => k.scale))
    const primary = buf.find((k) => k.scale > 1.01)!
    const last = buf[buf.length - 1]
    regions.push({
      startMs: buf[0].seqTimeMs,
      endMs: last.seqTimeMs + 500,
      peakScale: peak,
      primaryClipIndex: primary.clipIndex,
      primaryKfIndex: primary.kfIndex,
      primaryClipRelativeTimeMs: primary.clipRelativeTimeMs,
      keyframes: buf,
    })
  }

  return regions
}

export function ZoomTrack({ ctx }: ZoomTrackProps) {
  const sequence = useEditorStore((s) => s.project?.sequence)
  const selectedZoomIndex = useEditorStore((s) => s.selectedZoomIndex)
  const setSelectedZoomIndex = useEditorStore((s) => s.setSelectedZoomIndex)
  const addZoomKeyframeToClip = useEditorStore((s) => s.addZoomKeyframeToClip)
  const dragStartRef = useRef<{ x: number; timeMs: number } | null>(null)

  // Flatten all clip keyframes into sequence-time list
  const allKfs: SequenceZoomKf[] = useMemo(() => {
    if (!sequence) return []
    const result: SequenceZoomKf[] = []
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
          scale: kf.scale,
          x: kf.x,
          y: kf.y,
          easing: kf.easing,
        })
      }
    }
    return result.sort((a, b) => a.seqTimeMs - b.seqTimeMs)
  }, [sequence])

  // Compute visual regions
  const regions = useMemo(() => computeZoomRegions(allKfs), [allKfs])

  // Check if a time range overlaps any existing region
  const isOverlapping = (startMs: number, endMs: number): boolean => {
    return regions.some((r) => startMs < r.endMs && endMs > r.startMs)
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

      // Determine region span
      let spanStart: number
      let spanEnd: number
      if (dx < 5) {
        // Click: 1-second region centered on click
        spanStart = Math.max(0, endTimeMs - 500)
        spanEnd = endTimeMs + 500
      } else {
        // Drag: span the dragged range
        spanStart = Math.min(startTimeMs, endTimeMs)
        spanEnd = Math.max(startTimeMs, endTimeMs)
        if (spanEnd - spanStart < 400) spanEnd = spanStart + 400
      }

      if (isOverlapping(spanStart, spanEnd)) return

      // Find which clip this falls into
      const mapping = sequenceTimeToSourceTime(spanStart, sequence.clips, sequence.transitions)
      if (!mapping) return

      const clip = sequence.clips[mapping.clipIndex]
      const clipSeqStart = sourceTimeToSequenceTime(
        clip.sourceStart, mapping.clipIndex, sequence.clips, sequence.transitions
      )
      const clipRelStart = Math.max(0, Math.round(spanStart - clipSeqStart))
      const clipRelMid = Math.round((spanStart + spanEnd) / 2 - clipSeqStart)
      const clipRelEnd = Math.round(spanEnd - clipSeqStart)

      // Create a zoom triplet: [1x anchor] → [zoomed] → [1x anchor]
      addZoomKeyframeToClip(mapping.clipIndex, {
        timeMs: clipRelStart,
        x: 0.5, y: 0.5, scale: 1.0, easing: "linear",
      })
      addZoomKeyframeToClip(mapping.clipIndex, {
        timeMs: clipRelMid,
        x: 0.5, y: 0.5, scale: 1.5, easing: "spring",
      })
      addZoomKeyframeToClip(mapping.clipIndex, {
        timeMs: clipRelEnd,
        x: 0.5, y: 0.5, scale: 1.0, easing: "ease-out",
      })
    },
    [ctx, sequence, regions, addZoomKeyframeToClip]
  )

  const isEmpty = regions.length === 0

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
        regions.map((region, i) => (
          <ZoomSegment
            key={`${region.primaryClipIndex}-${region.startMs}`}
            region={region}
            index={i}
            ctx={ctx}
            isSelected={selectedZoomIndex === i}
            onSelect={setSelectedZoomIndex}
          />
        ))
      )}
    </div>
  )
}
