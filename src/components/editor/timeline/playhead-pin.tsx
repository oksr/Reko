import { useCallback, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { TimelineContext } from "./types"

interface PlayheadPinProps {
  ctx: TimelineContext
}

export function PlayheadPin({ ctx }: PlayheadPinProps) {
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const [dragging, setDragging] = useState(false)
  const pct = ctx.msToPercent(ctx.currentTime)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      setDragging(true)

      const onMove = (ev: MouseEvent) => {
        const p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
        const timeMs = p * ctx.durationMs
        ctx.videoSync.seek(timeMs)
        setCurrentTime(timeMs)
      }

      const onUp = () => {
        setDragging(false)
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [ctx, setCurrentTime]
  )

  return (
    <>
      {/* Pin handle on the ruler */}
      <div
        className="absolute top-0 z-20 -translate-x-1/2 cursor-grab active:cursor-grabbing"
        style={{ left: `${pct}%` }}
        onMouseDown={handleMouseDown}
      >
        <div
          className={`w-3 h-3 rounded-full border-2 ${
            dragging ? "bg-primary border-primary" : "bg-primary/90 border-primary hover:bg-primary"
          }`}
        />
      </div>
      {/* Vertical line through tracks */}
      <div
        className="absolute top-6 bottom-0 w-[1.5px] bg-primary/80 z-10 pointer-events-none"
        style={{ left: `${pct}%`, boxShadow: "0 0 4px rgba(var(--primary), 0.3)" }}
      />
    </>
  )
}
