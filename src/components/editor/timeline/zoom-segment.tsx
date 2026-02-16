import { useCallback, useState } from "react"
import { useEditorStore, pauseUndo, resumeUndo } from "@/stores/editor-store"
import { Mouse, Lock } from "lucide-react"
import { ZoomPopover } from "./zoom-popover"
import type { ZoomRegion } from "./zoom-track"
import type { TimelineContext } from "./types"

interface ZoomSegmentProps {
  region: ZoomRegion
  index: number
  ctx: TimelineContext
  isSelected: boolean
  onSelect: (index: number) => void
}

export function ZoomSegment({ region, index, ctx, isSelected, onSelect }: ZoomSegmentProps) {
  const { msToPercent, containerRef, durationMs } = ctx
  const updateClipZoomKeyframe = useEditorStore((s) => s.updateClipZoomKeyframe)
  const removeZoomKeyframeFromClip = useEditorStore((s) => s.removeZoomKeyframeFromClip)
  const [popoverOpen, setPopoverOpen] = useState(false)

  const leftPct = msToPercent(region.startMs)
  const widthPct = msToPercent(region.endMs) - leftPct
  const isAuto = region.keyframes.some((k) => k.x !== 0.5 || k.y !== 0.5)

  // Drag to move all keyframes in the region
  const handleBodyDrag = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const startX = e.clientX
      const origStartMs = region.startMs
      pauseUndo()

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dtMs = (dx / rect.width) * durationMs
        const newStartMs = Math.max(0, Math.round(origStartMs + dtMs))
        const delta = newStartMs - origStartMs

        // Move all keyframes in the region by delta
        for (const kf of region.keyframes) {
          updateClipZoomKeyframe(kf.clipIndex, kf.kfIndex, {
            timeMs: Math.max(0, kf.clipRelativeTimeMs + delta),
          })
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
    [containerRef, durationMs, region, updateClipZoomKeyframe]
  )

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(index)
    setPopoverOpen(true)
  }

  const handleDelete = useCallback(() => {
    // Delete all keyframes in the region (in reverse order to preserve indices)
    const sorted = [...region.keyframes].sort((a, b) => b.kfIndex - a.kfIndex)
    for (const kf of sorted) {
      removeZoomKeyframeFromClip(kf.clipIndex, kf.clipRelativeTimeMs)
    }
  }, [region, removeZoomKeyframeFromClip])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && isSelected) {
        handleDelete()
      }
    },
    [isSelected, handleDelete]
  )

  return (
    <ZoomPopover
      region={region}
      index={index}
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
      onDelete={handleDelete}
    >
      <div
        className={`absolute top-0 bottom-0 rounded-md cursor-grab active:cursor-grabbing transition-shadow ${
          isSelected
            ? "ring-2 ring-primary shadow-lg shadow-primary/20"
            : "hover:ring-1 hover:ring-primary/50"
        }`}
        style={{
          left: `${leftPct}%`,
          width: `${Math.max(widthPct, 0.5)}%`,
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
            <span>{region.peakScale.toFixed(1)}x</span>
            {isAuto ? <Mouse className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
          </div>
        </div>
      </div>
    </ZoomPopover>
  )
}
