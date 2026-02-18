import { useRef, useCallback, useEffect, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { sequenceTimeToSourceTime } from "@/lib/sequence"
import { interpolateZoomEvents } from "@/lib/zoom-interpolation"
import { useMouseEvents } from "@/hooks/use-mouse-events"
import { WebGLCompositor, type RenderParams } from "@/lib/webgl-compositor"

interface PreviewDimensions {
  width: number
  height: number
}

const CLICK_RIPPLE_DURATION_MS = 500
const OUTPUT_WIDTH = 1920
const OUTPUT_HEIGHT = 1080

export function usePreviewRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  screenVideoRef: React.RefObject<HTMLVideoElement | null>,
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>
) {
  const project = useEditorStore((s) => s.project)
  const effects = useEditorStore((s) => s.project?.effects)
  const currentTime = useEditorStore((s) => s.currentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)

  const compositorRef = useRef<WebGLCompositor | null>(null)
  const effectsRef = useRef(effects)
  effectsRef.current = effects
  const rafRef = useRef<number>(0)
  const [dims, setDims] = useState<PreviewDimensions | null>(null)

  const { getCursorAt, getClicksInRange } = useMouseEvents()

  // Initialize compositor when canvas is available and project loads
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !project) return

    try {
      const compositor = new WebGLCompositor(canvas)
      compositor.configure(OUTPUT_WIDTH, OUTPUT_HEIGHT)
      compositorRef.current = compositor
      setDims({ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT })
    } catch (e) {
      console.error("WebGL compositor init failed:", e)
    }

    return () => {
      compositorRef.current?.destroy()
      compositorRef.current = null
    }
  }, [project?.id, canvasRef]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load background image when background config changes
  useEffect(() => {
    const compositor = compositorRef.current
    if (!compositor || !effects) return

    const bg = effects.background
    if ((bg.type === "image" || bg.type === "wallpaper" || bg.type === "custom") && bg.imageUrl) {
      compositor.loadBackgroundImage(bg.imageUrl, bg.imageBlur).catch(() => {})
    }
  }, [effects?.background.type, effects?.background.imageUrl, effects?.background.imageBlur])

  // Map sequence time -> source time + zoom info for the active clip
  const mapTime = useCallback(
    (seqTimeMs: number) => {
      const sequence = useEditorStore.getState().project?.sequence
      if (!sequence || sequence.clips.length === 0) {
        return { sourceTimeMs: seqTimeMs, zoomEvents: [] as import("@/types/editor").ZoomEvent[], clipRelativeTime: seqTimeMs }
      }
      const mapping = sequenceTimeToSourceTime(
        seqTimeMs,
        sequence.clips,
        sequence.transitions
      )
      if (!mapping) {
        return { sourceTimeMs: seqTimeMs, zoomEvents: [] as import("@/types/editor").ZoomEvent[], clipRelativeTime: seqTimeMs }
      }
      const clip = sequence.clips[mapping.clipIndex]
      return {
        sourceTimeMs: mapping.sourceTime,
        zoomEvents: clip.zoomEvents ?? [],
        clipRelativeTime: mapping.sourceTime - clip.sourceStart,
      }
    },
    []
  )

  // Render a single composited frame
  const renderFrame = useCallback(
    (seqTimeMs: number) => {
      const compositor = compositorRef.current
      const screenVideo = screenVideoRef.current
      const eff = effectsRef.current
      if (!compositor || !screenVideo || !eff) return

      const { sourceTimeMs, zoomEvents, clipRelativeTime } = mapTime(seqTimeMs)

      // Upload screen video frame as texture
      if (screenVideo.readyState >= 2) {
        compositor.uploadScreen(screenVideo)
      }

      // Upload camera video frame if available
      const cameraVideo = cameraVideoRef.current
      if (cameraVideo && cameraVideo.readyState >= 2) {
        compositor.uploadCamera(cameraVideo)
      }

      // Compute zoom interpolation
      const zoom = interpolateZoomEvents(zoomEvents, clipRelativeTime)

      // Get cursor position (using source time for mouse events)
      const cursorPos = getCursorAt(sourceTimeMs)

      // Get active click ripple
      const clicks = getClicksInRange(sourceTimeMs - CLICK_RIPPLE_DURATION_MS, sourceTimeMs)
      let clickParam: RenderParams["click"] = null
      if (clicks.length > 0) {
        const lastClick = clicks[clicks.length - 1]
        const elapsed = sourceTimeMs - lastClick.timeMs
        if (elapsed >= 0 && elapsed < CLICK_RIPPLE_DURATION_MS) {
          clickParam = {
            x: lastClick.x,
            y: lastClick.y,
            progress: elapsed / CLICK_RIPPLE_DURATION_MS,
          }
        }
      }

      // Render composited frame
      const params: RenderParams = {
        effects: eff,
        screenWidth: screenVideo.videoWidth || 1920,
        screenHeight: screenVideo.videoHeight || 1080,
        zoom,
        cursor: cursorPos,
        click: clickParam,
      }
      compositor.render(params)
    },
    [screenVideoRef, cameraVideoRef, mapTime, getCursorAt, getClicksInRange]
  )

  // Seek video elements when scrubbing (not playing)
  useEffect(() => {
    if (isPlaying) return
    const { sourceTimeMs } = mapTime(currentTime)
    const sourceTimeSec = sourceTimeMs / 1000

    const screenVideo = screenVideoRef.current
    if (screenVideo) {
      screenVideo.currentTime = sourceTimeSec
    }
    const cameraVideo = cameraVideoRef.current
    if (cameraVideo) {
      cameraVideo.currentTime = sourceTimeSec
    }

    // Render after a short delay to let the video element seek
    const timer = setTimeout(() => renderFrame(currentTime), 50)
    return () => clearTimeout(timer)
  }, [currentTime, isPlaying, mapTime, renderFrame, screenVideoRef, cameraVideoRef])

  // Re-render when effects change
  useEffect(() => {
    renderFrame(useEditorStore.getState().currentTime)
  }, [effects, renderFrame])

  // Playback loop: render every frame via RAF
  useEffect(() => {
    if (!isPlaying) return
    let running = true
    const tick = () => {
      if (!running) return
      renderFrame(useEditorStore.getState().currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying, renderFrame])

  return { dims }
}
