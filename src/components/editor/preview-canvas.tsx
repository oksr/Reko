import { useRef, useEffect, useState, useCallback, useMemo } from "react"
import { assetUrl } from "@/lib/asset-url"
import { interpolateZoomAtSequenceTime } from "@/lib/zoom-interpolation"
import { useEditorStore, pauseUndo, resumeUndo } from "@/stores/editor-store"
import { useMouseEvents } from "@/hooks/use-mouse-events"
import type { useVideoSync } from "@/hooks/use-video-sync"

interface PreviewCanvasProps {
  videoSync: ReturnType<typeof useVideoSync>
}

export function PreviewCanvas({ videoSync }: PreviewCanvasProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const screenRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const [videoAspect, setVideoAspect] = useState<number | null>(null)

  // Capture ref values at setup time for correct cleanup
  useEffect(() => {
    const screen = screenRef.current
    const camera = cameraRef.current
    if (screen) videoSync.register(screen)
    if (camera) videoSync.register(camera)
    return () => {
      if (screen) videoSync.unregister(screen)
      if (camera) videoSync.unregister(camera)
    }
  }, [videoSync, project])

  const clampClips = useEditorStore((s) => s.clampClipsToVideoDuration)
  const handleLoadedMetadata = useCallback(() => {
    const v = screenRef.current
    if (!v) return
    if (v.videoWidth && v.videoHeight) {
      setVideoAspect(v.videoWidth / v.videoHeight)
    }
    if (v.duration && isFinite(v.duration)) {
      // Clamp clips outside undo tracking — this is a data correction, not a user edit
      pauseUndo()
      clampClips(v.duration * 1000)
      resumeUndo()
    }
  }, [clampClips])

  const { cursorPos, getClicksInRange } = useMouseEvents()

  // Click ripple animation duration in ms
  const CLICK_RIPPLE_DURATION = 500

  // Find active click events (clicks that should be animating right now)
  const activeClicks = useMemo(() => {
    if (!project?.effects.cursor.clickHighlight?.enabled) return []
    return getClicksInRange(currentTime - CLICK_RIPPLE_DURATION, currentTime)
  }, [currentTime, getClicksInRange, project?.effects.cursor.clickHighlight?.enabled])

  if (!project) return null

  const { effects, tracks } = project
  const { background, cameraBubble, frame, cursor } = effects
  const clickHighlight = cursor.clickHighlight
  const zoomState = interpolateZoomAtSequenceTime(
    currentTime,
    project.sequence.clips,
    project.sequence.transitions
  )

  const hasImageBg = (background.type === "image" || background.type === "wallpaper" || background.type === "custom") && background.imageUrl

  const bgStyle: React.CSSProperties =
    background.type === "gradient" || background.type === "preset"
      ? {
          background: `linear-gradient(${background.gradientAngle}deg, ${background.gradientFrom}, ${background.gradientTo})`,
        }
      : hasImageBg
        ? {} // handled by <img> element below
        : { backgroundColor: background.color }

  // Multi-layer shadow for realistic depth
  const multiLayerShadow = frame.shadow
    ? [
        `0 4px 6px rgba(0,0,0,${frame.shadowIntensity * 0.3})`,
        `0 12px 24px rgba(0,0,0,${frame.shadowIntensity * 0.5})`,
        `0 24px 48px rgba(0,0,0,${frame.shadowIntensity * 0.6})`,
      ].join(", ")
    : "none"

  const cameraPosMap = {
    "bottom-right": { bottom: "4%", right: "4%" },
    "bottom-left": { bottom: "4%", left: "4%" },
    "top-right": { top: "4%", right: "4%" },
    "top-left": { top: "4%", left: "4%" },
  } as const

  const cameraPos = cameraPosMap[cameraBubble.position]

  // Use the video's native aspect ratio so the frame wraps the content tightly.
  // max-width/max-height: 100% ensures it fits within the padded area without overflow.

  return (
    <div
      className="relative w-full aspect-video overflow-hidden ring-1 ring-white/5"
      style={{
        ...bgStyle,
        borderRadius: 8,
        transition: "background 200ms ease",
      }}
    >
      {/* Background image */}
      {hasImageBg && (
        <img
          src={assetUrl(background.imageUrl ?? "")}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            filter: background.imageBlur > 0 ? `blur(${background.imageBlur}px)` : undefined,
            transform: background.imageBlur > 0 ? "scale(1.05)" : undefined, // prevent blur edge artifacts
          }}
          alt=""
          draggable={false}
        />
      )}

      {/* Screen recording */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          padding: `${background.padding}%`,
          transition: "padding 200ms ease",
        }}
      >
        {/* Frame wrapper — sized to match video aspect ratio */}
        <div
          className="relative overflow-hidden"
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            aspectRatio: videoAspect ? `${videoAspect}` : "16 / 9",
            borderRadius: frame.borderRadius,
            boxShadow: multiLayerShadow,
            transition: "border-radius 200ms ease, box-shadow 200ms ease",
          }}
        >
          {/* Zoom container — transforms both video and cursor together */}
          <div
            className="relative w-full h-full"
            style={{
              transform: `scale(${zoomState.scale}) translate(${(0.5 - zoomState.x) * 100 / zoomState.scale}%, ${(0.5 - zoomState.y) * 100 / zoomState.scale}%)`,
              transformOrigin: "center center",
              transition: "transform 150ms ease-out",
            }}
          >
            <video
              ref={screenRef}
              src={assetUrl(tracks.screen)}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={handleLoadedMetadata}
            />

            {/* Cursor effect overlay — inside zoom container so it follows zoom */}
            {cursor.enabled && cursorPos && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${cursorPos.x * 100}%`,
                  top: `${cursorPos.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  width: cursor.size * 2,
                  height: cursor.size * 2,
                  borderRadius: "50%",
                  background:
                    cursor.type === "highlight"
                      ? `radial-gradient(circle, ${cursor.color}${Math.round(cursor.opacity * 255).toString(16).padStart(2, "0")} 0%, transparent 70%)`
                      : undefined,
                  boxShadow:
                    cursor.type === "spotlight"
                      ? `0 0 0 9999px rgba(0,0,0,${cursor.opacity})`
                      : undefined,
                  transition: "left 16ms linear, top 16ms linear",
                }}
              />
            )}

            {/* Click ripple effects */}
            {clickHighlight?.enabled && activeClicks.map((click) => {
              const progress = Math.min(1, (currentTime - click.timeMs) / CLICK_RIPPLE_DURATION)
              const scale = 0.3 + progress * 0.7
              const opacity = clickHighlight.opacity * (1 - progress)
              return (
                <div
                  key={`${click.timeMs}-${click.x}-${click.y}`}
                  className="absolute pointer-events-none"
                  style={{
                    left: `${click.x * 100}%`,
                    top: `${click.y * 100}%`,
                    transform: `translate(-50%, -50%) scale(${scale})`,
                    width: clickHighlight.size * 2,
                    height: clickHighlight.size * 2,
                    borderRadius: "50%",
                    border: `2px solid ${clickHighlight.color}`,
                    opacity,
                    background: `radial-gradient(circle, ${clickHighlight.color}${Math.round(opacity * 80).toString(16).padStart(2, "0")} 0%, transparent 70%)`,
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* Camera bubble */}
      {cameraBubble.visible && tracks.camera && (
        <video
          ref={cameraRef}
          src={assetUrl(tracks.camera)}
          className="absolute object-cover"
          style={{
            ...cameraPos,
            width: `${cameraBubble.size}%`,
            aspectRatio: "1",
            borderRadius: cameraBubble.shape === "circle" ? "50%" : "16px",
            border: `${cameraBubble.borderWidth}px solid ${cameraBubble.borderColor}`,
            boxShadow: "0 2px 4px rgba(0,0,0,0.1), 0 8px 16px rgba(0,0,0,0.2)",
            transition: "all 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          muted
          playsInline
          preload="auto"
        />
      )}

    </div>
  )
}
