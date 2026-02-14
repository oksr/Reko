import { useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { Clip } from "@/types/editor"
import type { TimelineContext } from "./types"

interface ClipBlockProps {
  clip: Clip
  index: number
  leftPercent: number
  widthPercent: number
  ctx: TimelineContext
}

export function ClipBlock({ clip, index, leftPercent, widthPercent, ctx }: ClipBlockProps) {
  const selectedClipIndex = useEditorStore((s) => s.selectedClipIndex)
  const setSelectedClipIndex = useEditorStore((s) => s.setSelectedClipIndex)
  const activeTool = useEditorStore((s) => s.activeTool)
  const trimClipStart = useEditorStore((s) => s.trimClipStart)
  const trimClipEnd = useEditorStore((s) => s.trimClipEnd)
  const isSelected = selectedClipIndex === index

  // Visual trim offset (percentage) — applied during drag only
  const [trimDelta, setTrimDelta] = useState<{ edge: "left" | "right"; pct: number } | null>(null)

  const clipDuration = (clip.sourceEnd - clip.sourceStart) / clip.speed

  const formatDuration = (ms: number) => {
    const s = ms / 1000
    return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s * 10) / 10}s`
  }

  const handleTrimStart = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const origSourceStart = clip.sourceStart
    const speed = clip.speed

    const onMove = (me: MouseEvent) => {
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const dxPct = ((me.clientX - startX) / rect.width) * 100
      // Clamp: can't trim past the right edge minus minimum
      const maxPct = widthPercent - ctx.msToPercent(500 / speed)
      const clampedPct = Math.max(0, Math.min(maxPct, dxPct))
      setTrimDelta({ edge: "left", pct: clampedPct })
    }
    const onUp = (me: MouseEvent) => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      // Swallow the click that follows mouseup so razor doesn't fire
      document.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true })
      // Commit: convert visual delta to source time
      if (ctx.containerRef.current) {
        const rect = ctx.containerRef.current.getBoundingClientRect()
        const dx = me.clientX - startX
        const dtSeq = (dx / rect.width) * ctx.durationMs
        const newStart = Math.round(origSourceStart + dtSeq * speed)
        trimClipStart(index, Math.max(0, Math.min(clip.sourceEnd - 500, newStart)))
      }
      setTrimDelta(null)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  const handleTrimEnd = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const origSourceEnd = clip.sourceEnd
    const speed = clip.speed

    const onMove = (me: MouseEvent) => {
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const dxPct = ((me.clientX - startX) / rect.width) * 100
      // Clamp: can't shrink past minimum
      const minPct = ctx.msToPercent(500 / speed) - widthPercent
      const clampedPct = Math.max(minPct, Math.min(0, dxPct))
      setTrimDelta({ edge: "right", pct: clampedPct })
    }
    const onUp = (me: MouseEvent) => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      // Swallow the click that follows mouseup so razor doesn't fire
      document.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true })
      if (ctx.containerRef.current) {
        const rect = ctx.containerRef.current.getBoundingClientRect()
        const dx = me.clientX - startX
        const dtSeq = (dx / rect.width) * ctx.durationMs
        const newEnd = Math.round(origSourceEnd + dtSeq * speed)
        trimClipEnd(index, Math.max(clip.sourceStart + 500, newEnd))
      }
      setTrimDelta(null)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  // Apply visual trim delta
  let visLeft = leftPercent
  let visWidth = widthPercent
  if (trimDelta) {
    if (trimDelta.edge === "left") {
      visLeft = leftPercent + trimDelta.pct
      visWidth = widthPercent - trimDelta.pct
    } else {
      visWidth = widthPercent + trimDelta.pct
    }
  }

  const visDuration = trimDelta
    ? (trimDelta.edge === "left"
        ? clipDuration - (trimDelta.pct / 100) * ctx.durationMs
        : clipDuration + (trimDelta.pct / 100) * ctx.durationMs)
    : clipDuration

  return (
    <div
      data-testid="clip-block"
      className={`absolute top-0 bottom-0 rounded-md cursor-pointer transition-none ${
        isSelected
          ? "ring-2 ring-amber-300"
          : "hover:brightness-110"
      }`}
      style={{
        left: `${visLeft}%`,
        width: `${Math.max(0, visWidth)}%`,
        minWidth: "2px",
        background: "linear-gradient(to bottom, #d4a054, #c4903e)",
      }}
      onClick={(e) => {
        if (activeTool === "razor") return
        e.stopPropagation()
        setSelectedClipIndex(index)
      }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("clip-index", String(index))
        e.dataTransfer.effectAllowed = "move"
      }}
    >
      {/* Clip label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[10px] font-medium leading-tight text-black/70">Clip</span>
        <span className="text-[11px] font-semibold leading-tight text-black/70">
          {formatDuration(Math.max(0, visDuration))}{clip.speed !== 1 && ` · ${clip.speed}x`}
        </span>
      </div>

      {/* Trim handles */}
      <div
        draggable={false}
        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize rounded-l-md bg-amber-900/30 hover:bg-amber-900/50 transition-colors"
        onMouseDown={handleTrimStart}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-3 bg-amber-900/40 rounded-full" />
      </div>
      <div
        draggable={false}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize rounded-r-md bg-amber-900/30 hover:bg-amber-900/50 transition-colors"
        onMouseDown={handleTrimEnd}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-3 bg-amber-900/40 rounded-full" />
      </div>
    </div>
  )
}
