import { useRef, useEffect } from "react"
import { usePreviewRenderer } from "@/hooks/use-preview-renderer"
import { useEditorStore } from "@/stores/editor-store"
import { assetUrl } from "@/lib/asset-url"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const micRef = useRef<HTMLAudioElement>(null)
  const systemAudioRef = useRef<HTMLAudioElement>(null)
  const { dims } = usePreviewRenderer(canvasRef)

  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)

  // Sync audio on seek (when not playing) — map sequence time -> source time
  useEffect(() => {
    if (isPlaying || !project?.sequence) return
    const mapping = sequenceTimeToSourceTime(
      currentTime,
      project.sequence.clips,
      project.sequence.transitions
    )
    if (mapping) {
      const sourceTimeSec = mapping.sourceTime / 1000
      if (micRef.current) micRef.current.currentTime = sourceTimeSec
      if (systemAudioRef.current) systemAudioRef.current.currentTime = sourceTimeSec
    }
  }, [currentTime, isPlaying, project?.sequence])

  // Play/pause audio
  useEffect(() => {
    const audios = [micRef.current, systemAudioRef.current].filter(
      Boolean
    ) as HTMLAudioElement[]
    if (isPlaying && project?.sequence) {
      const mapping = sequenceTimeToSourceTime(
        useEditorStore.getState().currentTime,
        project.sequence.clips,
        project.sequence.transitions
      )
      if (mapping) {
        const clip = project.sequence.clips[mapping.clipIndex]
        const sourceTimeSec = mapping.sourceTime / 1000
        audios.forEach((a) => {
          a.currentTime = sourceTimeSec
          a.playbackRate = clip.speed
          a.play().catch(() => {})
        })
      }
    } else {
      audios.forEach((a) => a.pause())
    }
  }, [isPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null

  return (
    <div
      className="relative w-full overflow-hidden ring-1 ring-white/5 select-none"
      style={{
        borderRadius: 8,
        aspectRatio: dims ? `${dims.width} / ${dims.height}` : "16 / 9",
      }}
    >
      <canvas
        ref={canvasRef}
        width={dims?.width ?? 1280}
        height={dims?.height ?? 720}
        className="w-full h-full"
      />
      {/* Hidden audio elements for preview playback */}
      {project.tracks.mic && (
        <audio
          ref={micRef}
          src={assetUrl(project.tracks.mic)}
          preload="auto"
        />
      )}
      {project.tracks.system_audio && (
        <audio
          ref={systemAudioRef}
          src={assetUrl(project.tracks.system_audio)}
          preload="auto"
        />
      )}
    </div>
  )
}
