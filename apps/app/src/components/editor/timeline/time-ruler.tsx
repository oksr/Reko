import { useMemo, useCallback, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { TimelineContext } from "./types"

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

function formatTimeMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  const centis = Math.floor((ms % 1000) / 10)
  return `${m}:${sec.toString().padStart(2, "0")}:${centis.toString().padStart(2, "0")}`
}

interface TimeRulerProps {
  ctx: TimelineContext
}

export function TimeRuler({ ctx }: TimeRulerProps) {
  const { durationMs, msToPercent } = ctx
  const setHoverTime = useEditorStore((s) => s.setHoverTime)
  const [hoverPct, setHoverPct] = useState<number | null>(null)

  const marks = useMemo(() => {
    const stepMs = durationMs <= 10000 ? 1000
      : durationMs <= 30000 ? 5000
      : durationMs <= 120000 ? 10000
      : 30000
    const result: { ms: number; pct: number; label: string; isMajor: boolean }[] = []
    const subStep = stepMs / 4
    for (let ms = 0; ms <= durationMs; ms += subStep) {
      const isMajor = ms % stepMs === 0
      result.push({ ms, pct: msToPercent(ms), label: formatTime(ms), isMajor })
    }
    return result
  }, [durationMs, msToPercent])

  const getPctFromEvent = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ctx.containerRef.current) return null
      const rect = ctx.containerRef.current.getBoundingClientRect()
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    },
    [ctx.containerRef]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const pct = getPctFromEvent(e)
      if (pct === null) return
      ctx.videoSync.seek(pct * durationMs)
    },
    [ctx, durationMs, getPctFromEvent]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const pct = getPctFromEvent(e)
      if (pct === null) return
      setHoverPct(pct)
      setHoverTime(pct * durationMs)
    },
    [getPctFromEvent, durationMs, setHoverTime]
  )

  const handleMouseLeave = useCallback(() => {
    setHoverPct(null)
    setHoverTime(null)
  }, [setHoverTime])

  const hoverMs = hoverPct !== null ? hoverPct * durationMs : null

  return (
    <div
      className="relative h-6 cursor-pointer select-none"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {marks.map((m) =>
        m.isMajor ? (
          <span
            key={m.ms}
            className="absolute -translate-x-1/2 text-[10px] text-muted-foreground/70 top-0"
            style={{ left: `${m.pct}%` }}
          >
            {m.label}
          </span>
        ) : (
          <span
            key={m.ms}
            className="absolute top-2 w-1 h-1 rounded-full bg-muted-foreground/30 -translate-x-1/2"
            style={{ left: `${m.pct}%` }}
          />
        )
      )}

      {/* Ghost hover handle + tooltip */}
      {hoverPct !== null && hoverMs !== null && (
        <div
          className="absolute top-0 z-30 -translate-x-1/2 pointer-events-none"
          style={{ left: `${hoverPct * 100}%` }}
        >
          {/* Tooltip */}
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow-md whitespace-nowrap">
            {formatTimeMs(hoverMs)}
          </div>
          {/* Pin handle */}
          <div className="w-2.5 h-2.5 rounded-full bg-white/60 border border-white/80 mt-0.5" />
        </div>
      )}
    </div>
  )
}
