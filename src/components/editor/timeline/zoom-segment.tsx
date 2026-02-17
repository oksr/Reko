import { useCallback, useState } from "react"
import { useEditorStore, pauseUndo, resumeUndo } from "@/stores/editor-store"
import { ZoomPopover } from "./zoom-popover"
import type { SequenceZoomEvent } from "./zoom-track"
import type { TimelineContext } from "./types"

interface ZoomSegmentProps {
  seqEvent: SequenceZoomEvent
  ctx: TimelineContext
  isSelected: boolean
  onSelect: () => void
}

export function ZoomSegment({ seqEvent, ctx, isSelected, onSelect }: ZoomSegmentProps) {
  const { msToPercent, containerRef, durationMs } = ctx
  const updateZoomEvent = useEditorStore((s) => s.updateZoomEvent)
  const removeZoomEvent = useEditorStore((s) => s.removeZoomEvent)
  const [popoverOpen, setPopoverOpen] = useState(false)

  const { clipIndex, event } = seqEvent
  const leftPct = msToPercent(seqEvent.seqStartMs)
  const widthPct = msToPercent(seqEvent.seqEndMs) - leftPct

  // Drag to move
  const handleBodyDrag = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const startX = e.clientX
      const origTimeMs = event.timeMs
      pauseUndo()

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dtMs = (dx / rect.width) * durationMs
        const newTimeMs = Math.max(0, Math.round(origTimeMs + dtMs))
        updateZoomEvent(clipIndex, event.id, { timeMs: newTimeMs })
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        resumeUndo()
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, clipIndex, event, updateZoomEvent]
  )

  // Drag left edge to resize start
  const handleLeftResize = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const startX = e.clientX
      const origTimeMs = event.timeMs
      const origDurationMs = event.durationMs
      pauseUndo()

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dtMs = (dx / rect.width) * durationMs
        const newTimeMs = Math.max(0, Math.round(origTimeMs + dtMs))
        const newDuration = Math.max(200, origDurationMs - (newTimeMs - origTimeMs))
        updateZoomEvent(clipIndex, event.id, { timeMs: newTimeMs, durationMs: newDuration })
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        resumeUndo()
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, clipIndex, event, updateZoomEvent]
  )

  // Drag right edge to resize end
  const handleRightResize = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const startX = e.clientX
      const origDurationMs = event.durationMs
      pauseUndo()

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dtMs = (dx / rect.width) * durationMs
        const newDuration = Math.max(200, Math.round(origDurationMs + dtMs))
        updateZoomEvent(clipIndex, event.id, { durationMs: newDuration })
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        resumeUndo()
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, clipIndex, event, updateZoomEvent]
  )

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect()
    setPopoverOpen(true)
  }

  const handleDelete = useCallback(() => {
    removeZoomEvent(clipIndex, event.id)
  }, [clipIndex, event.id, removeZoomEvent])

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
      seqEvent={seqEvent}
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
      onDelete={handleDelete}
    >
      <div
        className={`absolute top-0 bottom-0 rounded-md cursor-grab active:cursor-grabbing transition-shadow group ${
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
        {/* Left resize handle */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20 rounded-l-md"
          onMouseDown={handleLeftResize}
        />
        {/* Right resize handle */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20 rounded-r-md"
          onMouseDown={handleRightResize}
        />
        {/* Label */}
        <div className="flex items-center justify-center h-full text-white/90 pointer-events-none overflow-hidden px-2">
          <span className="text-[10px] font-semibold">{event.scale.toFixed(1)}x</span>
        </div>
      </div>
    </ZoomPopover>
  )
}
