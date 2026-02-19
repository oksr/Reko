import { useRef, useEffect, useState, useCallback } from "react"
import { usePreviewRenderer } from "@/hooks/use-preview-renderer"
import { useEditorStore } from "@/stores/editor-store"
import { useAssetUrl } from "@/lib/asset-url"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

/**
 * Compute the time-scale ratio for an audio element relative to the video.
 * Older recordings have a bug where system_audio.wav is ~2x the video duration
 * because non-interleaved audio was misinterpreted. The ratio lets us scale
 * seek positions so audio stays in sync.
 */
function computeTimeScale(
  audio: HTMLMediaElement | null,
  video: HTMLMediaElement | null
): number {
  if (
    !audio ||
    !video ||
    !isFinite(audio.duration) ||
    !isFinite(video.duration) ||
    video.duration < 0.1
  )
    return 1
  const ratio = audio.duration / video.duration
  // If audio is roughly 2x video, scale by that ratio (known recording bug)
  if (ratio > 1.5) return ratio
  return 1
}

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

  // Time-scale ratios for audio files (1.0 for correct recordings, ~2.0 for buggy ones)
  const [micScale, setMicScale] = useState(1)
  const [sysScale, setSysScale] = useState(1)

  // Recompute scales when media durations are available
  useEffect(() => {
    const video = screenVideoRef.current
    const mic = micRef.current
    const sys = systemAudioRef.current

    const update = () => {
      setMicScale(computeTimeScale(mic, video))
      setSysScale(computeTimeScale(sys, video))
    }

    const elements = [video, mic, sys].filter(Boolean) as HTMLMediaElement[]
    elements.forEach((el) => el.addEventListener("loadedmetadata", update))
    update()
    return () => {
      elements.forEach((el) => el.removeEventListener("loadedmetadata", update))
    }
  }, [project?.tracks.screen, project?.tracks.mic, project?.tracks.system_audio])

  /** Map a video source time to the corresponding audio file position */
  const audioTime = useCallback(
    (sourceTimeSec: number, scale: number) => sourceTimeSec * scale,
    []
  )

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
      if (micRef.current)
        micRef.current.currentTime = audioTime(sourceTimeSec, micScale)
      if (systemAudioRef.current)
        systemAudioRef.current.currentTime = audioTime(sourceTimeSec, sysScale)
    }
  }, [currentTime, isPlaying, project?.sequence, micScale, sysScale, audioTime])

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
        const sourceTimeSec = mapping.sourceTime / 1000

        // Set video elements to source time
        const videos = [screenVideo, cameraVideo].filter(
          Boolean
        ) as HTMLMediaElement[]
        videos.forEach((m) => {
          m.currentTime = sourceTimeSec
          m.playbackRate = clip.speed
        })

        // Set audio elements with time-scale applied
        if (micRef.current) {
          micRef.current.currentTime = audioTime(sourceTimeSec, micScale)
          micRef.current.playbackRate = clip.speed * micScale
        }
        if (systemAudioRef.current) {
          systemAudioRef.current.currentTime = audioTime(sourceTimeSec, sysScale)
          systemAudioRef.current.playbackRate = clip.speed * sysScale
        }

        // Start playback
        const allMedia = [
          ...videos,
          micRef.current,
          systemAudioRef.current,
        ].filter(Boolean) as HTMLMediaElement[]
        allMedia.forEach((m) =>
          m.play().catch((e) => console.warn("[preview] play failed:", e))
        )
      }
    } else {
      ;[screenVideo, cameraVideo, micRef.current, systemAudioRef.current]
        .filter(Boolean)
        .forEach((m) => (m as HTMLMediaElement).pause())
    }
  }, [isPlaying, micScale, sysScale, audioTime]) // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic audio drift correction during playback (with time-scale)
  useEffect(() => {
    if (!isPlaying || !project?.sequence) return
    const interval = setInterval(() => {
      const screenVideo = screenVideoRef.current
      if (!screenVideo) return
      const videoTime = screenVideo.currentTime

      if (micRef.current) {
        const expected = audioTime(videoTime, micScale)
        if (Math.abs(micRef.current.currentTime - expected) > 0.15) {
          micRef.current.currentTime = expected
        }
      }
      if (systemAudioRef.current) {
        const expected = audioTime(videoTime, sysScale)
        if (Math.abs(systemAudioRef.current.currentTime - expected) > 0.15) {
          systemAudioRef.current.currentTime = expected
        }
      }
    }, 500)
    return () => clearInterval(interval)
  }, [isPlaying, project?.sequence, micScale, sysScale, audioTime])

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
