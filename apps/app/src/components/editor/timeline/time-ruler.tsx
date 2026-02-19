import { useMemo, useCallback } from "react"
import type { TimelineContext } from "./types"

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

interface TimeRulerProps {
  ctx: TimelineContext
}

export function TimeRuler({ ctx }: TimeRulerProps) {
  const { durationMs, msToPercent } = ctx

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

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const timeMs = pct * durationMs
      ctx.videoSync.seek(timeMs)
    },
    [ctx, durationMs]
  )

  return (
    <div
      className="relative h-6 cursor-pointer select-none"
      onClick={handleClick}
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
    </div>
  )
}
