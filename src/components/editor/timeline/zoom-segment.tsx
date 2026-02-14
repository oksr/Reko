import { useCallback, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { Mouse, Lock } from "lucide-react"
import { ZoomPopover } from "./zoom-popover"
import type { ZoomKeyframe } from "@/types/editor"
import type { TimelineContext } from "./types"

interface ZoomSegmentProps {
  segment: ZoomKeyframe
  index: number
  ctx: TimelineContext
  isSelected: boolean
  onSelect: (index: number) => void
}

export function ZoomSegment({ segment, index, ctx, isSelected, onSelect }: ZoomSegmentProps) {
  const { durationMs, msToPercent, containerRef } = ctx
  const moveZoomKeyframe = useEditorStore((s) => s.moveZoomKeyframe)
  const updateZoomKeyframe = useEditorStore((s) => s.updateZoomKeyframe)
  const [popoverOpen, setPopoverOpen] = useState(false)

  const leftPct = msToPercent(segment.timeMs)
  const widthPct = msToPercent(segment.timeMs + segment.durationMs) - leftPct
  const isAuto = segment.x !== 0.5 || segment.y !== 0.5

  // Drag to move the whole segment
  const handleBodyDrag = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const startX = e.clientX
      const startTimeMs = segment.timeMs

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dtMs = (dx / rect.width) * durationMs
        const newTime = Math.max(0, Math.min(durationMs - segment.durationMs, Math.round(startTimeMs + dtMs)))
        moveZoomKeyframe(index, newTime)
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, segment, index, moveZoomKeyframe]
  )

  // Drag to resize from edge
  const handleEdgeDrag = useCallback(
    (e: React.MouseEvent, edge: "left" | "right") => {
      e.stopPropagation()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const MIN_DURATION = 200

      const onMove = (ev: MouseEvent) => {
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
        const timeMs = Math.round(pct * durationMs)

        if (edge === "left") {
          const maxStart = segment.timeMs + segment.durationMs - MIN_DURATION
          const newStart = Math.max(0, Math.min(timeMs, maxStart))
          const newDuration = segment.timeMs + segment.durationMs - newStart
          moveZoomKeyframe(index, newStart)
          updateZoomKeyframe(index, { durationMs: newDuration })
        } else {
          const minEnd = segment.timeMs + MIN_DURATION
          const newEnd = Math.max(minEnd, Math.min(timeMs, durationMs))
          updateZoomKeyframe(index, { durationMs: newEnd - segment.timeMs })
        }
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, segment, index, moveZoomKeyframe, updateZoomKeyframe]
  )

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(index)
    setPopoverOpen(true)
  }

  return (
    <ZoomPopover
      segment={segment}
      index={index}
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
