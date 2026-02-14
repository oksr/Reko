import { useCallback, useRef } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { ZoomSegment } from "./zoom-segment"
import type { TimelineContext } from "./types"

interface ZoomTrackProps {
  ctx: TimelineContext
}

export function ZoomTrack({ ctx }: ZoomTrackProps) {
  const project = useEditorStore((s) => s.project)
  const selectedZoomIndex = useEditorStore((s) => s.selectedZoomIndex)
  const setSelectedZoomIndex = useEditorStore((s) => s.setSelectedZoomIndex)
  const addZoomKeyframe = useEditorStore((s) => s.addZoomKeyframe)
  const removeZoomKeyframe = useEditorStore((s) => s.removeZoomKeyframe)
  const dragStartRef = useRef<{ x: number; timeMs: number } | null>(null)

  const keyframes = project?.effects.zoomKeyframes ?? []

  // Check if a time range overlaps any existing segment
  const isOverlapping = (timeMs: number, durationMs: number): boolean => {
    const end = timeMs + durationMs
    return keyframes.some((kf) => {
      const kfEnd = kf.timeMs + kf.durationMs
      return timeMs < kfEnd && end > kf.timeMs
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
      if (!ctx.containerRef.current || !dragStartRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const endPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const endTimeMs = Math.round(endPct * ctx.durationMs)
      const startTimeMs = dragStartRef.current.timeMs

      const dx = Math.abs(e.clientX - dragStartRef.current.x)
      dragStartRef.current = null

      // Click (< 5px drag): create default segment
      if (dx < 5) {
        const defaultDuration = 500
        const newStart = Math.max(0, endTimeMs - defaultDuration / 2)
        if (!isOverlapping(newStart, defaultDuration)) {
          addZoomKeyframe({
            timeMs: newStart,
            durationMs: defaultDuration,
            x: 0.5,
            y: 0.5,
            scale: 1.5,
            easing: "ease-in-out",
          })
        }
        return
      }

      // Drag: create segment spanning the dragged range
      const segStart = Math.min(startTimeMs, endTimeMs)
      const segEnd = Math.max(startTimeMs, endTimeMs)
      const duration = Math.max(200, segEnd - segStart)
      if (!isOverlapping(segStart, duration)) {
        addZoomKeyframe({
          timeMs: segStart,
          durationMs: duration,
          x: 0.5,
          y: 0.5,
          scale: 1.5,
          easing: "ease-in-out",
        })
      }
    },
    [ctx, keyframes, addZoomKeyframe]
  )

  // Delete selected segment on Delete/Backspace
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedZoomIndex !== null) {
        const kf = keyframes[selectedZoomIndex]
        if (kf) {
          removeZoomKeyframe(kf.timeMs)
          setSelectedZoomIndex(null)
        }
      }
    },
    [selectedZoomIndex, keyframes, removeZoomKeyframe, setSelectedZoomIndex]
  )

  const isEmpty = keyframes.length === 0

  return (
    <div
      className={`relative h-9 rounded-md ${
        isEmpty ? "bg-indigo-950/40 border border-dashed border-indigo-500/30" : "bg-indigo-950/20"
      }`}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {isEmpty ? (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-indigo-400/60">Click or drag to add zoom on cursor</span>
        </div>
      ) : (
        keyframes.map((kf, i) => (
          <ZoomSegment
            key={`${kf.timeMs}-${i}`}
            segment={kf}
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
