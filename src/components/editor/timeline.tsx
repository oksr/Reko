import { useRef, useCallback, useState, useMemo } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { useVideoSync } from "@/hooks/use-video-sync"

interface TimelineProps {
  videoSync: ReturnType<typeof useVideoSync>
}

function formatRulerTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

export function Timeline({ videoSync }: TimelineProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<"in" | "out" | null>(null)

  // Time ruler markers
  const rulerMarks = useMemo(() => {
    if (!project) return []
    const duration = project.timeline.duration_ms
    // Aim for ~8-12 markers
    const stepMs = duration <= 10000 ? 1000
      : duration <= 30000 ? 5000
      : duration <= 120000 ? 10000
      : 30000
    const marks: { ms: number; pct: number; label: string }[] = []
    for (let ms = 0; ms <= duration; ms += stepMs) {
      marks.push({ ms, pct: (ms / duration) * 100, label: formatRulerTime(ms) })
    }
    return marks
  }, [project])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!project || !trackRef.current || dragging) return
      const rect = trackRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = Math.max(0, Math.min(1, x / rect.width))
      const timeMs = pct * project.timeline.duration_ms
      videoSync.seek(timeMs)
      setCurrentTime(timeMs)
    },
    [project, videoSync, setCurrentTime, dragging]
  )

  // Trim drag with scrub preview
  const handleTrimDrag = useCallback(
    (e: React.MouseEvent, type: "in" | "out") => {
      e.stopPropagation()
      if (!project || !trackRef.current) return

      const rect = trackRef.current.getBoundingClientRect()

      const onMouseMove = (ev: MouseEvent) => {
        const x = ev.clientX - rect.left
        const pct = Math.max(0, Math.min(1, x / rect.width))
        const timeMs = Math.round(pct * project.timeline.duration_ms)

        if (type === "in") {
          const clamped = Math.min(timeMs, project.timeline.out_point - 500)
          const value = Math.max(0, clamped)
          useEditorStore.getState().setInPoint(value)
          // Scrub preview during trim drag
          videoSync.seek(value)
          useEditorStore.getState().setCurrentTime(value)
        } else {
          const clamped = Math.max(timeMs, project.timeline.in_point + 500)
          const value = Math.min(project.timeline.duration_ms, clamped)
          useEditorStore.getState().setOutPoint(value)
          videoSync.seek(value)
          useEditorStore.getState().setCurrentTime(value)
        }
      }

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseup", onMouseUp)
        setDragging(null)
      }

      setDragging(type)
      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    },
    [project, videoSync]
  )

  if (!project) return null

  const { duration_ms, in_point, out_point } = project.timeline
  const playheadPct = (currentTime / duration_ms) * 100
  const inPct = (in_point / duration_ms) * 100
  const outPct = (out_point / duration_ms) * 100

  return (
    <div className="space-y-1 select-none">
      {/* Time ruler */}
      <div className="relative h-4 text-[9px] text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
        {rulerMarks.map((m) => (
          <span key={m.ms} className="absolute -translate-x-1/2" style={{ left: `${m.pct}%` }}>
            {m.label}
          </span>
        ))}
      </div>

      {/* Track area */}
      <div
        ref={trackRef}
        className="relative h-16 bg-muted rounded cursor-pointer"
        onClick={handleClick}
      >
        {/* Dimmed regions outside trim range */}
        {inPct > 0 && (
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/40 rounded-l z-[1]"
            style={{ width: `${inPct}%` }}
          />
        )}
        {outPct < 100 && (
          <div
            className="absolute top-0 bottom-0 right-0 bg-black/40 rounded-r z-[1]"
            style={{ width: `${100 - outPct}%` }}
          />
        )}

        {/* Active region highlight */}
        <div
          className="absolute top-0 bottom-0 bg-primary/10 rounded"
          style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
        />

        {/* Screen track */}
        <div
          className="absolute top-1 h-6 bg-blue-400/40 rounded mx-1"
          style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
        >
          <span className="text-[10px] px-1 text-blue-200 leading-6">Screen</span>
        </div>

        {/* Camera track (if present) */}
        {project.tracks.camera && (
          <div
            className="absolute top-8 h-5 bg-green-400/40 rounded mx-1"
            style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
          >
            <span className="text-[10px] px-1 text-green-200 leading-5">Camera</span>
          </div>
        )}

        {/* Audio track indicator */}
        {project.tracks.mic && (
          <div
            className="absolute bottom-1 h-3 bg-yellow-400/30 rounded mx-1"
            style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
          />
        )}

        {/* Trim handles with wider hit area (visible 4px, hit 16px) */}
        <div
          className="absolute top-0 bottom-0 w-4 z-[2] cursor-col-resize flex justify-center"
          style={{ left: `calc(${inPct}% - 8px)` }}
          title="In point"
          onMouseDown={(e) => handleTrimDrag(e, "in")}
        >
          <div className={`w-1 h-full rounded-l ${dragging === "in" ? "bg-primary" : "bg-primary/80 hover:bg-primary"}`} />
        </div>
        <div
          className="absolute top-0 bottom-0 w-4 z-[2] cursor-col-resize flex justify-center"
          style={{ left: `calc(${outPct}% - 8px)` }}
          title="Out point"
          onMouseDown={(e) => handleTrimDrag(e, "out")}
        >
          <div className={`w-1 h-full rounded-r ${dragging === "out" ? "bg-primary" : "bg-primary/80 hover:bg-primary"}`} />
        </div>

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="w-2.5 h-2.5 bg-red-500 rounded-full -translate-x-1/2 -top-1 absolute" />
        </div>
      </div>
    </div>
  )
}
