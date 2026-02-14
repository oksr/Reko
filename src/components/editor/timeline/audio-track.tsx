import { useRef, useEffect, useCallback } from "react"
import { useAudioWaveform } from "@/hooks/use-audio-waveform"
import type { TimelineContext } from "./types"

interface AudioTrackProps {
  ctx: TimelineContext
  audioPath: string
  type: "mic" | "system"
}

export function AudioTrack({ ctx, audioPath, type }: AudioTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { peaks, loading } = useAudioWaveform(audioPath, 800)

  const { inPoint, outPoint, durationMs: _durationMs, msToPercent } = ctx
  const inPct = msToPercent(inPoint) / 100
  const outPct = msToPercent(outPoint) / 100

  // Render waveform to canvas
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !peaks) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr

    const c = canvas.getContext("2d")!
    c.scale(dpr, dpr)
    c.clearRect(0, 0, rect.width, rect.height)

    const barWidth = rect.width / peaks.length
    const midY = rect.height / 2
    const maxAmp = rect.height / 2 - 2

    const activeColor = type === "mic" ? "rgba(217, 175, 80, 0.7)" : "rgba(148, 163, 184, 0.5)"
    const dimColor = type === "mic" ? "rgba(217, 175, 80, 0.2)" : "rgba(148, 163, 184, 0.15)"

    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth
      const pctPos = i / peaks.length
      const isDimmed = pctPos < inPct || pctPos > outPct

      c.fillStyle = isDimmed ? dimColor : activeColor
      const h = peaks[i] * maxAmp
      const bw = Math.max(1, barWidth - 1)
      c.beginPath()
      c.roundRect(x, midY - h, bw, h * 2, 1)
      c.fill()
    }
  }, [peaks, inPct, outPct, type])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      ctx.videoSync.seek(pct * ctx.durationMs)
    },
    [ctx]
  )

  return (
    <div ref={containerRef} className="relative h-8 rounded-md cursor-pointer" onClick={handleClick}>
      {loading ? (
        <div className="w-full h-full bg-muted/30 rounded-md animate-pulse" />
      ) : peaks ? (
        <canvas ref={canvasRef} className="w-full h-full" />
      ) : null}
    </div>
  )
}
