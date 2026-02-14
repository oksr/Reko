import { useCallback, useState } from "react"
import { useEditorStore, pauseUndo, resumeUndo } from "@/stores/editor-store"
import { sequenceTimeToSourceTime, sourceTimeToSequenceTime } from "@/lib/sequence"
import { Mouse, Lock } from "lucide-react"
import { ZoomPopover } from "./zoom-popover"
import type { ZoomKeyframe } from "@/types/editor"
import type { TimelineContext } from "./types"

interface ZoomSegmentProps {
  segment: ZoomKeyframe
  index: number
  clipIndex: number
  kfIndex: number
  /** The original clip-relative timeMs of this keyframe */
  clipRelativeTimeMs: number
  ctx: TimelineContext
  isSelected: boolean
  onSelect: (index: number) => void
}

export function ZoomSegment({ segment, index, clipIndex, kfIndex, clipRelativeTimeMs, ctx, isSelected, onSelect }: ZoomSegmentProps) {
  const { durationMs, msToPercent, containerRef } = ctx
  const updateClipZoomKeyframe = useEditorStore((s) => s.updateClipZoomKeyframe)
  const removeZoomKeyframeFromClip = useEditorStore((s) => s.removeZoomKeyframeFromClip)
  const addZoomKeyframeToClip = useEditorStore((s) => s.addZoomKeyframeToClip)
  const [popoverOpen, setPopoverOpen] = useState(false)

  const leftPct = msToPercent(segment.timeMs)
  const widthPct = msToPercent(segment.timeMs + segment.durationMs) - leftPct
  const isAuto = segment.x !== 0.5 || segment.y !== 0.5

  // Drag to move the whole segment
  const handleBodyDrag = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const startX = e.clientX
      const origSeqTimeMs = segment.timeMs
      const segDuration = segment.durationMs
      // Snapshot the current kf data for cross-clip moves
      const kfData = { scale: segment.scale, x: segment.x, y: segment.y, easing: segment.easing }
      let lastClipIndex = clipIndex
      let lastKfIndex = kfIndex
      pauseUndo()

      const onMove = (ev: MouseEvent) => {
        const sequence = useEditorStore.getState().project?.sequence
        if (!sequence) return

        const dx = ev.clientX - startX
        const dtMs = (dx / rect.width) * durationMs
        // Clamp to timeline bounds
        const newSeqTime = Math.max(0, Math.min(durationMs - segDuration, Math.round(origSeqTimeMs + dtMs)))

        // Find which clip this sequence time falls into
        const mapping = sequenceTimeToSourceTime(newSeqTime, sequence.clips, sequence.transitions)
        if (!mapping) return

        const targetClip = sequence.clips[mapping.clipIndex]
        const clipSeqStart = sourceTimeToSequenceTime(
          targetClip.sourceStart, mapping.clipIndex, sequence.clips, sequence.transitions
        )
        const newClipRelTime = Math.max(0, Math.round(newSeqTime - clipSeqStart))

        if (mapping.clipIndex === lastClipIndex) {
          // Same clip — just update position
          updateClipZoomKeyframe(lastClipIndex, lastKfIndex, { timeMs: newClipRelTime })
        } else {
          // Cross-clip: remove from old, add to new
          const oldClip = sequence.clips[lastClipIndex]
          if (oldClip && lastKfIndex < oldClip.zoomKeyframes.length) {
            removeZoomKeyframeFromClip(lastClipIndex, oldClip.zoomKeyframes[lastKfIndex].timeMs)
          }
          addZoomKeyframeToClip(mapping.clipIndex, {
            timeMs: newClipRelTime,
            durationMs: segDuration,
            ...kfData,
          })
          lastClipIndex = mapping.clipIndex
          // New keyframe index: find it in the updated clip
          const updatedSeq = useEditorStore.getState().project?.sequence
          if (updatedSeq) {
            const newClip = updatedSeq.clips[mapping.clipIndex]
            lastKfIndex = newClip.zoomKeyframes.findIndex((k) => k.timeMs === newClipRelTime)
            if (lastKfIndex === -1) lastKfIndex = 0
          }
        }
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        resumeUndo()
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, segment, clipIndex, kfIndex, clipRelativeTimeMs, updateClipZoomKeyframe, removeZoomKeyframeFromClip, addZoomKeyframeToClip]
  )

  // Drag to resize from edge
  const handleEdgeDrag = useCallback(
    (e: React.MouseEvent, edge: "left" | "right") => {
      e.stopPropagation()
      e.preventDefault()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const MIN_DURATION = 200
      const seqStartMs = segment.timeMs
      const origClipTime = clipRelativeTimeMs
      pauseUndo()

      const onMove = (ev: MouseEvent) => {
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
        const seqTimeMs = Math.round(pct * durationMs)

        if (edge === "left") {
          const maxStart = seqStartMs + segment.durationMs - MIN_DURATION
          const newSeqStart = Math.max(0, Math.min(seqTimeMs, maxStart))
          const delta = newSeqStart - seqStartMs
          updateClipZoomKeyframe(clipIndex, kfIndex, {
            timeMs: Math.max(0, origClipTime + delta),
            durationMs: Math.max(MIN_DURATION, segment.durationMs - delta),
          })
        } else {
          const minEnd = seqStartMs + MIN_DURATION
          const maxEnd = durationMs
          const newEnd = Math.max(minEnd, Math.min(seqTimeMs, maxEnd))
          updateClipZoomKeyframe(clipIndex, kfIndex, { durationMs: newEnd - seqStartMs })
        }
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        resumeUndo()
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, segment, clipRelativeTimeMs, clipIndex, kfIndex, updateClipZoomKeyframe]
  )

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(index)
    setPopoverOpen(true)
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && isSelected) {
        removeZoomKeyframeFromClip(clipIndex, clipRelativeTimeMs)
      }
    },
    [isSelected, clipIndex, clipRelativeTimeMs, removeZoomKeyframeFromClip]
  )

  return (
    <ZoomPopover
      segment={segment}
      index={index}
      clipIndex={clipIndex}
      kfIndex={kfIndex}
      clipRelativeTimeMs={clipRelativeTimeMs}
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
    >
      <div
        className={`absolute top-0 bottom-0 rounded-md cursor-grab active:cursor-grabbing transition-shadow ${
          isSelected
            ? "ring-2 ring-primary shadow-lg shadow-primary/20"
            : "hover:ring-1 hover:ring-primary/50"
        }`}
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          background: "linear-gradient(to bottom, #7c5df5, #6344e0)",
        }}
        onMouseDown={handleBodyDrag}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* Labels */}
        <div className="flex flex-col items-center justify-center h-full text-white/90 pointer-events-none overflow-hidden px-1">
          <span className="text-[9px] font-medium leading-tight opacity-70">Zoom</span>
          <div className="flex items-center gap-1 text-[10px] font-semibold leading-tight">
            <span>{segment.scale.toFixed(1)}x</span>
            {isAuto ? <Mouse className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
          </div>
        </div>

        {/* Left resize handle */}
        <div
          className="absolute top-0 bottom-0 left-0 w-1.5 cursor-col-resize rounded-l-md hover:bg-white/20"
          onMouseDown={(e) => handleEdgeDrag(e, "left")}
          onClick={(e) => e.stopPropagation()}
        />

        {/* Right resize handle */}
        <div
          className="absolute top-0 bottom-0 right-0 w-1.5 cursor-col-resize rounded-r-md hover:bg-white/20"
          onMouseDown={(e) => handleEdgeDrag(e, "right")}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </ZoomPopover>
  )
}
