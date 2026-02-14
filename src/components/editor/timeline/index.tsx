import { useRef, useMemo } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { useVideoSync } from "@/hooks/use-video-sync"
import { TimeRuler } from "./time-ruler"
import { PlayheadPin } from "./playhead-pin"
import { ClipTrack } from "./clip-track"
import { ZoomTrack } from "./zoom-track"
import { AudioTrack } from "./audio-track"
import type { TimelineContext } from "./types"

interface TimelineProps {
  videoSync: ReturnType<typeof useVideoSync>
}

export function Timeline({ videoSync }: TimelineProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const containerRef = useRef<HTMLDivElement>(null)

  const ctx: TimelineContext | null = useMemo(() => {
    if (!project) return null
    const { duration_ms, in_point, out_point } = project.timeline
    return {
      durationMs: duration_ms,
      inPoint: in_point,
      outPoint: out_point,
      currentTime,
      videoSync,
      msToPercent: (ms: number) => (ms / duration_ms) * 100,
      containerRef,
    }
  }, [project, currentTime, videoSync])

  if (!project || !ctx) return null

  const audioPath = project.tracks.mic ?? project.tracks.system_audio
  const audioType = project.tracks.mic ? "mic" : "system"

  return (
    <div className="space-y-1.5 select-none">
      <div ref={containerRef} className="relative">
        {/* Time ruler + Playhead pin */}
        <TimeRuler ctx={ctx} />
        <PlayheadPin ctx={ctx} />

        {/* Tracks */}
        <div className="space-y-1 mt-1">
          <ClipTrack ctx={ctx} />
          <ZoomTrack ctx={ctx} />
          {audioPath && <AudioTrack ctx={ctx} audioPath={audioPath} type={audioType} />}
        </div>
      </div>
    </div>
  )
}
