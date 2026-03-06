import { useRef, useState, useEffect, useCallback } from "react"
import {
  Play,
  Pause,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  Volume1,
  Download,
} from "lucide-react"
import { useVideoAnalytics } from "@/hooks/use-video-analytics"

interface VideoPlayerProps {
  videoUrl: string
  videoId: string
  durationMs: number
  allowDownload: boolean
  title: string
}

export function VideoPlayer({
  videoUrl,
  videoId,
  durationMs,
  allowDownload,
  title,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hoverProgress, setHoverProgress] = useState<number | null>(null)
  const [isSeeking, setIsSeeking] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useVideoAnalytics(videoId, videoRef, durationMs)

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play()
      setHasStarted(true)
    } else {
      video.pause()
    }
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setIsMuted(video.muted)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      container.requestFullscreen()
    }
  }, [])

  const getProgressFromEvent = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
      const bar = progressRef.current
      if (!bar) return 0
      const rect = bar.getBoundingClientRect()
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    },
    []
  )

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const video = videoRef.current
      if (!video || !duration) return
      video.currentTime = getProgressFromEvent(e) * duration
    },
    [duration, getProgressFromEvent]
  )

  const handleProgressHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setHoverProgress(getProgressFromEvent(e))
    },
    [getProgressFromEvent]
  )

  const handleProgressMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setIsSeeking(true)
      handleSeek(e)
      const onMouseMove = (ev: MouseEvent) => {
        const video = videoRef.current
        if (!video || !duration) return
        video.currentTime = getProgressFromEvent(ev) * duration
      }
      const onMouseUp = () => {
        setIsSeeking(false)
        document.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseup", onMouseUp)
      }
      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    },
    [duration, handleSeek, getProgressFromEvent]
  )

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const video = videoRef.current
      if (!video) return
      const val = parseFloat(e.target.value)
      video.volume = val
      setVolume(val)
      if (val === 0) {
        video.muted = true
        setIsMuted(true)
      } else if (video.muted) {
        video.muted = false
        setIsMuted(false)
      }
    },
    []
  )

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true)
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    hideTimeoutRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !isSeeking) {
        setShowControls(false)
      }
    }, 3000)
  }, [isSeeking])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => {
      setIsPlaying(false)
      setShowControls(true)
    }
    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onLoadedMetadata = () => setDuration(video.duration)
    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)
    video.addEventListener("timeupdate", onTimeUpdate)
    video.addEventListener("loadedmetadata", onLoadedMetadata)
    return () => {
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      video.removeEventListener("timeupdate", onTimeUpdate)
      video.removeEventListener("loadedmetadata", onLoadedMetadata)
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault()
          togglePlay()
          break
        case "f":
          toggleFullscreen()
          break
        case "m":
          toggleMute()
          break
        case "ArrowLeft":
          if (videoRef.current) videoRef.current.currentTime -= 5
          break
        case "ArrowRight":
          if (videoRef.current) videoRef.current.currentTime += 5
          break
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [togglePlay, toggleFullscreen, toggleMute])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const VolumeIcon =
    isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden cursor-pointer aspect-video isolate shadow-[0_0_0_0.5px_rgba(255,255,255,0.08),0_20px_60px_-10px_rgba(0,0,0,0.7)] ${isFullscreen ? "rounded-none !shadow-none" : "rounded-2xl"}`}
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => {
        if (isPlaying) setShowControls(false)
        setHoverProgress(null)
      }}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full h-full object-contain"
        onClick={togglePlay}
        preload="metadata"
        playsInline
      />

      {/* Center play — only before first play */}
      {!hasStarted && !isPlaying && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/35"
          onClick={togglePlay}
        >
          <button
            aria-label="Play video"
            className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-white/12 backdrop-blur-[20px] backdrop-saturate-150 shadow-[0_0_0_0.5px_rgba(255,255,255,0.15),0_8px_32px_rgba(0,0,0,0.4)] transition-[transform,background] duration-200 ease-[var(--ease-out-quint)] hover:scale-105 hover:bg-white/18 active:scale-95"
          >
            <Play
              className="w-7 h-7 text-white ml-0.5"
              fill="currentColor"
              strokeWidth={0}
            />
          </button>
        </div>
      )}

      {/* Controls */}
      <div
        className={`absolute bottom-0 left-0 right-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out-cubic)] ${
          showControls
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-1 pointer-events-none"
        }`}
      >
        {/* Gradient */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

        <div className="relative px-5 pb-4 pt-20">
          {/* Progress bar */}
          <div
            ref={progressRef}
            className="progress-bar group/progress relative h-[5px] rounded-full mb-3.5 cursor-pointer bg-white/12 hover:h-1.5 transition-[height] duration-150"
            onClick={handleSeek}
            onMouseMove={handleProgressHover}
            onMouseLeave={() => setHoverProgress(null)}
            onMouseDown={handleProgressMouseDown}
          >
            {/* Hover fill */}
            {hoverProgress !== null && (
              <div
                className="absolute top-0 left-0 h-full rounded-full pointer-events-none bg-white/10"
                style={{ width: `${hoverProgress * 100}%` }}
              />
            )}
            {/* Played */}
            <div
              className="absolute top-0 left-0 h-full bg-white rounded-full"
              style={{ width: `${progress}%` }}
            >
              {/* Thumb */}
              <div className="progress-thumb absolute right-0 top-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_2px_8px_rgba(0,0,0,0.4)] opacity-0 scale-50 -translate-y-1/2 transition-[opacity,transform] duration-150 ease-out" />
            </div>

            {/* Hover tooltip */}
            {hoverProgress !== null && duration > 0 && (
              <div
                className="absolute -top-8 -translate-x-1/2 pointer-events-none text-[11px] font-medium tabular-nums text-white/90 bg-black/85 backdrop-blur-sm px-2 py-0.5 rounded-md shadow-border"
                style={{ left: `${hoverProgress * 100}%` }}
              >
                {formatTime(hoverProgress * duration)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Play/pause */}
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="w-9 h-9 flex items-center justify-center text-white/90 hover:text-white transition-colors duration-150"
            >
              {isPlaying ? (
                <Pause className="w-[18px] h-[18px]" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="w-[18px] h-[18px]" fill="currentColor" strokeWidth={0} />
              )}
            </button>

            {/* Volume */}
            <div className="flex items-center group/vol">
              <button
                onClick={toggleMute}
                aria-label={isMuted || volume === 0 ? "Unmute" : "Mute"}
                className="w-9 h-9 flex items-center justify-center text-white/60 hover:text-white/90 transition-colors duration-150"
              >
                <VolumeIcon className="w-[18px] h-[18px]" />
              </button>
              <div className="w-0 overflow-hidden group-hover/vol:w-[72px] transition-[width] duration-200 ease-[var(--ease-out-quint)]">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-[72px]"
                />
              </div>
            </div>

            {/* Time */}
            <span className="text-white/40 text-xs tabular-nums tracking-wide ml-0.5 select-none">
              {formatTime(currentTime)}
              <span className="text-white/20 mx-[5px]">/</span>
              {formatTime(duration)}
            </span>

            <div className="flex-1" />

            {/* Download */}
            {allowDownload && (
              <a
                href={videoUrl}
                download={`${title}.mp4`}
                className="w-9 h-9 flex items-center justify-center text-white/40 hover:text-white/90 transition-colors duration-150"
                aria-label="Download video"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="w-[18px] h-[18px]" />
              </a>
            )}

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              aria-label="Toggle fullscreen"
              className="w-9 h-9 flex items-center justify-center text-white/40 hover:text-white/90 transition-colors duration-150"
            >
              {isFullscreen ? (
                <Minimize className="w-[18px] h-[18px]" />
              ) : (
                <Maximize className="w-[18px] h-[18px]" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}
