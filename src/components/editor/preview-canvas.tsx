import { useRef, useEffect } from "react"
import { assetUrl } from "@/lib/asset-url"
import { useEditorStore } from "@/stores/editor-store"
import type { useVideoSync } from "@/hooks/use-video-sync"

interface PreviewCanvasProps {
  videoSync: ReturnType<typeof useVideoSync>
}

export function PreviewCanvas({ videoSync }: PreviewCanvasProps) {
  const project = useEditorStore((s) => s.project)
  const screenRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)

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

  if (!project) return null

  const { effects, tracks } = project
  const { background, cameraBubble, frame } = effects

  const bgStyle: React.CSSProperties =
    background.type === "gradient" || background.type === "preset"
      ? {
          background: `linear-gradient(${background.gradientAngle}deg, ${background.gradientFrom}, ${background.gradientTo})`,
        }
      : { backgroundColor: background.color }

  // Multi-layer shadow for realistic depth
  const multiLayerShadow = frame.shadow
    ? [
        `0 4px 6px rgba(0,0,0,${frame.shadowIntensity * 0.1})`,
        `0 12px 24px rgba(0,0,0,${frame.shadowIntensity * 0.15})`,
        `0 24px 48px rgba(0,0,0,${frame.shadowIntensity * 0.2})`,
      ].join(", ")
    : "none"

  const cameraPosMap = {
    "bottom-right": { bottom: "4%", right: "4%" },
    "bottom-left": { bottom: "4%", left: "4%" },
    "top-right": { top: "4%", right: "4%" },
    "top-left": { top: "4%", left: "4%" },
  } as const

  const cameraPos = cameraPosMap[cameraBubble.position]

  return (
    <div
      className="relative w-full aspect-video overflow-hidden ring-1 ring-white/5"
      style={{
        ...bgStyle,
        borderRadius: 8,
        transition: "background 200ms ease",
      }}
    >
      {/* Screen recording */}
      <div
        className="absolute inset-0"
        style={{
          padding: `${background.padding}%`,
          transition: "padding 200ms ease",
        }}
      >
        <video
          ref={screenRef}
          src={assetUrl(tracks.screen)}
          className="w-full h-full object-contain"
          style={{
            borderRadius: frame.borderRadius,
            boxShadow: multiLayerShadow,
            transition: "border-radius 200ms ease, box-shadow 200ms ease",
          }}
          muted
          playsInline
          preload="auto"
          onError={() => console.error("Failed to load screen video:", tracks.screen)}
        />
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
          onError={() => console.error("Failed to load camera video:", tracks.camera)}
        />
      )}
    </div>
  )
}
