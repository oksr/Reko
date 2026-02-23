import { useRef, useMemo, useCallback } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { getSequenceDuration } from "@/lib/sequence"
import type { useVideoSync } from "@/hooks/use-video-sync"
import { TimeRuler } from "./time-ruler"
import { PlayheadPin } from "./playhead-pin"
import { SequenceTrack } from "./sequence-track"
import { ZoomTrack } from "./zoom-track"
import { OverlayTrack } from "./overlay-track"
import { TimelineToolbar } from "./timeline-toolbar"
import { AudioTrack } from "./audio-track"
import type { TimelineContext } from "./types"

interface TimelineProps {
  videoSync: ReturnType<typeof useVideoSync>
}

export function Timeline({ videoSync }: TimelineProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const hoverTime = useEditorStore((s) => s.hoverTime)
  const containerRef = useRef<HTMLDivElement>(null)
  const frozenDurationRef = useRef<number | null>(null)

  const freezeDuration = useCallback(() => {
    if (!project) return
    frozenDurationRef.current = getSequenceDuration(
      project.sequence.clips,
      project.sequence.transitions
    )
  }, [project])

  const unfreezeDuration = useCallback(() => {
    frozenDurationRef.current = null
  }, [])

  const ctx: TimelineContext | null = useMemo(() => {
    if (!project) return null
    const { in_point, out_point } = project.timeline
    const seqDuration = getSequenceDuration(project.sequence.clips, project.sequence.transitions)
    const durationMs = frozenDurationRef.current
      ?? (seqDuration > 0 ? seqDuration : project.timeline.duration_ms)
    return {
      durationMs,
      videoDurationMs: project.timeline.duration_ms,
      inPoint: in_point,
      outPoint: out_point,
      currentTime,
      videoSync,
      msToPercent: (ms: number) => (ms / durationMs) * 100,
      containerRef,
      freezeDuration,
      unfreezeDuration,
    }
  }, [project, currentTime, videoSync, freezeDuration, unfreezeDuration])

  if (!project || !ctx) return null

  const audioPath = project.tracks.mic ?? project.tracks.system_audio
  const audioType = project.tracks.mic ? "mic" : "system"

  return (
    <div className="space-y-1.5 select-none">
      <TimelineToolbar />
      <div ref={containerRef} className="relative">
        {/* Time ruler + Playhead pin */}
        <TimeRuler ctx={ctx} />
        <PlayheadPin ctx={ctx} />

        {/* Ghost hover line */}
        {hoverTime !== null && (
          <div
            className="absolute top-6 bottom-0 w-px bg-white/30 z-10 pointer-events-none"
            style={{ left: `${ctx.msToPercent(hoverTime)}%` }}
          />
        )}

        {/* Tracks */}
        <div className="space-y-1 mt-1">
          {project.sequence.overlayTracks.map((track, i) => (
            <OverlayTrack key={track.id} track={track} trackIndex={i} ctx={ctx} />
          ))}
          <SequenceTrack ctx={ctx} />
          <ZoomTrack ctx={ctx} />
          {audioPath && <AudioTrack ctx={ctx} audioPath={audioPath} type={audioType} />}
        </div>
      </div>
    </div>
  )
}
