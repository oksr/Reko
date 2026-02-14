import { useCallback, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { TimelineContext } from "./types"

interface ClipTrackProps {
  ctx: TimelineContext
}

function formatDuration(ms: number): string {
  const s = ms / 1000
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s * 10) / 10}s`
}

export function ClipTrack({ ctx }: ClipTrackProps) {
  const { durationMs, inPoint, outPoint, msToPercent, containerRef, videoSync } = ctx
  const [dragging, setDragging] = useState<"in" | "out" | null>(null)

  const inPct = msToPercent(inPoint)
  const outPct = msToPercent(outPoint)
  const clipDuration = outPoint - inPoint

  const handleTrimDrag = useCallback(
    (e: React.MouseEvent, type: "in" | "out") => {
      e.stopPropagation()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      setDragging(type)

      const onMove = (ev: MouseEvent) => {
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
        const timeMs = Math.round(pct * durationMs)
        const state = useEditorStore.getState()

        if (type === "in") {
          const clamped = Math.max(0, Math.min(timeMs, state.project!.timeline.out_point - 500))
          state.setInPoint(clamped)
          videoSync.seek(clamped)
          state.setCurrentTime(clamped)
        } else {
          const clamped = Math.min(durationMs, Math.max(timeMs, state.project!.timeline.in_point + 500))
          state.setOutPoint(clamped)
          videoSync.seek(clamped)
          state.setCurrentTime(clamped)
        }
      }

      const onUp = () => {
        setDragging(null)
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, videoSync]
  )

  return (
    <div className="relative h-10">
      {/* Dimmed region before in-point */}
      {inPct > 0 && (
        <div
          className="absolute top-0 bottom-0 left-0 rounded-l-md overflow-hidden"
          style={{ width: `${inPct}%` }}
        >
          <div className="w-full h-full bg-amber-700/20 rounded-l-md" />
        </div>
      )}

      {/* Active clip bar */}
      <div
        className="absolute top-0 bottom-0 rounded-md"
        style={{
          left: `${inPct}%`,
          width: `${outPct - inPct}%`,
          background: "linear-gradient(to bottom, #d4a054, #c4903e)",
        }}
      >
        {/* Label */}
        <div className="flex flex-col items-center justify-center h-full text-black/70 pointer-events-none">
          <span className="text-[10px] font-medium leading-tight">Clip</span>
          <span className="text-[11px] font-semibold leading-tight">
            {formatDuration(clipDuration)} &middot; 1x
          </span>
        </div>

        {/* In-point trim handle */}
        <div
          className={`absolute top-0 bottom-0 left-0 w-2 cursor-col-resize rounded-l-md transition-colors ${
            dragging === "in" ? "bg-amber-900/60" : "bg-amber-900/30 hover:bg-amber-900/50"
          }`}
          onMouseDown={(e) => handleTrimDrag(e, "in")}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-3 bg-amber-900/40 rounded-full" />
        </div>

        {/* Out-point trim handle */}
        <div
          className={`absolute top-0 bottom-0 right-0 w-2 cursor-col-resize rounded-r-md transition-colors ${
            dragging === "out" ? "bg-amber-900/60" : "bg-amber-900/30 hover:bg-amber-900/50"
          }`}
          onMouseDown={(e) => handleTrimDrag(e, "out")}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-3 bg-amber-900/40 rounded-full" />
        </div>
      </div>

      {/* Dimmed region after out-point */}
      {outPct < 100 && (
        <div
          className="absolute top-0 bottom-0 right-0 rounded-r-md overflow-hidden"
          style={{ width: `${100 - outPct}%` }}
        >
          <div className="w-full h-full bg-amber-700/20 rounded-r-md" />
        </div>
      )}
    </div>
  )
}
