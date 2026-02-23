import { useRef, useEffect } from "react"
import { usePreviewRenderer } from "@/hooks/use-preview-renderer"
import { useEditorStore } from "@/stores/editor-store"
import { useAssetUrl } from "@/lib/asset-url"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const micRef = useRef<HTMLAudioElement>(null)
  const systemAudioRef = useRef<HTMLAudioElement>(null)
  const { dims } = usePreviewRenderer(canvasRef, screenVideoRef, cameraVideoRef)

  const project = useEditorStore((s) => s.project)
  const assetUrl = useAssetUrl()
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

  // Play/pause audio and video
  useEffect(() => {
    const screenVideo = screenVideoRef.current
    const cameraVideo = cameraVideoRef.current

    if (isPlaying && project?.sequence) {
      const mapping = sequenceTimeToSourceTime(
        useEditorStore.getState().currentTime,
        project.sequence.clips,
        project.sequence.transitions
      )
      if (mapping) {
        const clip = project.sequence.clips[mapping.clipIndex]

        // Don't re-seek here — the video is already positioned by the scrub seek
        // effect. Re-seeking immediately before play() causes an AbortError in
        // WKWebView when playbackClock's first RAF tick has already advanced
        // currentTime, making the seek target slightly different from the video's
        // current position and leaving the video paused.
        const allMedia = [screenVideo, cameraVideo, micRef.current, systemAudioRef.current].filter(Boolean) as HTMLMediaElement[]
        allMedia.forEach((m) => {
          m.playbackRate = clip.speed
        })
        allMedia.forEach((m) =>
          m.play().catch((e) => console.warn("[preview] play failed:", e))
        )
      }
    } else {
      ;[screenVideo, cameraVideo, micRef.current, systemAudioRef.current]
        .filter(Boolean)
        .forEach((m) => (m as HTMLMediaElement).pause())
    }
  }, [isPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic audio drift correction during playback
  useEffect(() => {
    if (!isPlaying || !project?.sequence) return
    const interval = setInterval(() => {
      const screenVideo = screenVideoRef.current
      if (!screenVideo) return
      const videoTime = screenVideo.currentTime
      for (const audio of [micRef.current, systemAudioRef.current]) {
        if (audio && Math.abs(audio.currentTime - videoTime) > 0.15) {
          audio.currentTime = videoTime
        }
      }
    }, 500)
    return () => clearInterval(interval)
  }, [isPlaying, project?.sequence])

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
        width={dims?.width ?? 1920}
        height={dims?.height ?? 1080}
        className="w-full h-full"
      />
      {/* Hidden video elements as texture sources */}
      <video
        ref={screenVideoRef}
        src={assetUrl(project.tracks.screen)}
        muted
        playsInline
        preload="auto"
        className="hidden"
        data-testid="screen-video"
      />
      {project.tracks.camera && (
        <video
          ref={cameraVideoRef}
          src={assetUrl(project.tracks.camera)}
          muted
          playsInline
          preload="auto"
          className="hidden"
          data-testid="camera-video"
        />
      )}
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
