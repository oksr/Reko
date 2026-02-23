import { useRef, useCallback, useEffect, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { sequenceTimeToSourceTime } from "@/lib/sequence"
import { interpolateZoomEvents } from "@/lib/zoom-interpolation"
import { useMouseEvents } from "@/hooks/use-mouse-events"
import { WebGLCompositor, type RenderParams } from "@/lib/webgl-compositor"
import { screenRect } from "@/lib/webgl-compositor/layout"
import { useAssetUrl } from "@/lib/asset-url"

interface PreviewDimensions {
  width: number
  height: number
}

const CLICK_RIPPLE_DURATION_MS = 500
const OUTPUT_WIDTH = 1920
const OUTPUT_HEIGHT = 1080

const MAX_FRAME_DELTA_MS = 100   // if gap > 100ms (scrub/seek), reset blur
const SCALE_BLUR = 2             // radial intensity per unit of dScale/frame
const PAN_BLUR = 0.8             // linear blur per unit canvas UV of pan/frame
const CURSOR_BLUR = 3.0          // cursor trail length multiplier

export function usePreviewRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  screenVideoRef: React.RefObject<HTMLVideoElement | null>,
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>
) {
  const project = useEditorStore((s) => s.project)
  const effects = useEditorStore((s) => s.project?.effects)
  const assetUrl = useAssetUrl()
  const currentTime = useEditorStore((s) => s.currentTime)
  const hoverTime = useEditorStore((s) => s.hoverTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)

  const compositorRef = useRef<WebGLCompositor | null>(null)
  const effectsRef = useRef(effects)
  effectsRef.current = effects
  const rafRef = useRef<number>(0)
  const [dims, setDims] = useState<PreviewDimensions | null>(null)

  const prevSeqTimeRef = useRef<number>(-1)
  const prevZoomRef = useRef<{ x: number; y: number; scale: number }>({ x: 0.5, y: 0.5, scale: 1 })
  const prevCursorRef = useRef<{ x: number; y: number } | null>(null)
  const smoothCenterRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 })

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

      // Get cursor position (using source time for mouse events)
      const cursorPos = getCursorAt(sourceTimeMs)

      // Compute zoom interpolation — pass cursor so viewport follows it while zoomed
      const rawZoom = interpolateZoomEvents(zoomEvents, clipRelativeTime, cursorPos)

      // Smooth the pan center with exponential decay so the viewport eases toward
      // the cursor rather than snapping. Only applies during continuous playback;
      // scrubbing/seeking snaps directly to avoid lag on manual seeks.
      const dt0 = seqTimeMs - prevSeqTimeRef.current
      const isPlaying0 = dt0 > 0 && dt0 <= MAX_FRAME_DELTA_MS
      if (isPlaying0) {
        const alpha = 1 - Math.exp(-dt0 / 120) // 120ms time-constant
        smoothCenterRef.current = {
          x: smoothCenterRef.current.x + (rawZoom.x - smoothCenterRef.current.x) * alpha,
          y: smoothCenterRef.current.y + (rawZoom.y - smoothCenterRef.current.y) * alpha,
        }
      } else {
        smoothCenterRef.current = { x: rawZoom.x, y: rawZoom.y }
      }
      const zoom = { ...rawZoom, x: smoothCenterRef.current.x, y: smoothCenterRef.current.y }

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

      // Compute motion blur velocities from frame-to-frame zoom/cursor deltas
      let motionBlurParam: RenderParams["motionBlur"] = null
      let cursorVelocity: { dx: number; dy: number } | null = null

      const dt = seqTimeMs - prevSeqTimeRef.current
      const inPlayback = dt > 0 && dt <= MAX_FRAME_DELTA_MS

      if (inPlayback) {
        const prevZoom = prevZoomRef.current

        // Compute base screen rect to convert video UV → canvas UV pan distances.
        const sr = screenRect(
          OUTPUT_WIDTH, OUTPUT_HEIGHT,
          screenVideo.videoWidth || OUTPUT_WIDTH,
          screenVideo.videoHeight || OUTPUT_HEIGHT,
          eff.background.padding
        )

        // Pan: zoom center delta in video UV → canvas UV motion blur
        const panDx = -(zoom.x - prevZoom.x) * sr.w * zoom.scale * PAN_BLUR
        const panDy = -(zoom.y - prevZoom.y) * sr.h * zoom.scale * PAN_BLUR

        // Radial: scale change → zoom blur (capped to avoid extreme blur mid-spring)
        // Zoom-out (dScale < 0) uses a lower cap — outward radial blur is more noticeable
        const dScale = zoom.scale - prevZoom.scale
        const cap = dScale < 0 ? 0.06 : 0.15
        const intensity = Math.min(Math.abs(dScale) * SCALE_BLUR, cap) * Math.sign(dScale)

        if (Math.abs(panDx) > 0.0005 || Math.abs(panDy) > 0.0005 || Math.abs(intensity) > 0.001) {
          motionBlurParam = { dx: panDx, dy: panDy, intensity }
        }

        // Cursor trail — velocity in canvas UV space (zoomed rect maps cursor UV → canvas UV)
        if (cursorPos && prevCursorRef.current) {
          const zoomedW = sr.w * zoom.scale
          const zoomedH = sr.h * zoom.scale
          const cdx = (cursorPos.x - prevCursorRef.current.x) * zoomedW * CURSOR_BLUR
          const cdy = (cursorPos.y - prevCursorRef.current.y) * zoomedH * CURSOR_BLUR
          if (Math.abs(cdx) > 0.001 || Math.abs(cdy) > 0.001) {
            cursorVelocity = { dx: cdx, dy: cdy }
          }
        }
      }

      // Update refs for next frame
      prevSeqTimeRef.current = seqTimeMs
      prevZoomRef.current = zoom
      prevCursorRef.current = cursorPos ?? null

      // Render composited frame
      const params: RenderParams = {
        effects: eff,
        screenWidth: screenVideo.videoWidth || 1920,
        screenHeight: screenVideo.videoHeight || 1080,
        zoom,
        cursor: cursorPos,
        click: clickParam,
        motionBlur: motionBlurParam,
        cursorVelocity,
      }
      compositor.render(params)
    },
    [screenVideoRef, cameraVideoRef, mapTime, getCursorAt, getClicksInRange]
  )

  // Load background image when background config changes.
  // Must be defined after renderFrame since it calls renderFrame after async load.
  useEffect(() => {
    const compositor = compositorRef.current
    if (!compositor || !effects) return

    const bg = effects.background
    if ((bg.type === "image" || bg.type === "wallpaper" || bg.type === "custom") && bg.imageUrl) {
      compositor.loadBackgroundImage(assetUrl(bg.imageUrl), bg.imageBlur)
        .then(() => {
          // Re-render after async load completes so the image is visible immediately
          renderFrame(useEditorStore.getState().currentTime)
        })
        .catch(() => {})
    }
  }, [effects?.background.type, effects?.background.imageUrl, effects?.background.imageBlur, renderFrame])

  // Seek video elements when scrubbing (not playing) or hovering
  useEffect(() => {
    if (isPlaying) return
    const seekTime = hoverTime ?? currentTime
    const { sourceTimeMs } = mapTime(seekTime)
    const sourceTimeSec = sourceTimeMs / 1000

    const screenVideo = screenVideoRef.current
    const cameraVideo = cameraVideoRef.current

    if (cameraVideo) {
      cameraVideo.currentTime = sourceTimeSec
    }

    if (!screenVideo) return

    let cancelled = false
    let rvcHandle: number | undefined
    let fallbackTimer: ReturnType<typeof setTimeout>

    const doRender = () => {
      if (cancelled) return
      cancelled = true // prevent double-render from fallback + rVFC race
      clearTimeout(fallbackTimer)
      renderFrame(seekTime)
    }

    if ("requestVideoFrameCallback" in screenVideo) {
      // requestVideoFrameCallback fires after WebKit has updated the video's
      // internal texture buffer — the only guarantee that texImage2D will see
      // the new frame. seeked + readyState >= 2 is NOT sufficient in WKWebView.
      rvcHandle = (screenVideo as any).requestVideoFrameCallback(doRender)
    } else {
      // Older Safari fallback: seeked event + one rAF to let the compositor tick
      const onSeeked = () => {
        if (cancelled) return
        requestAnimationFrame(doRender)
      }
      screenVideo.addEventListener("seeked", onSeeked, { once: true })
    }

    screenVideo.currentTime = sourceTimeSec

    // Hard fallback: render after 500ms if neither rVFC nor seeked fires
    // (e.g. video is already exactly at the target position)
    fallbackTimer = setTimeout(doRender, 500)

    return () => {
      cancelled = true
      if (rvcHandle !== undefined) {
        (screenVideo as any).cancelVideoFrameCallback?.(rvcHandle)
      }
      clearTimeout(fallbackTimer)
    }
  }, [currentTime, hoverTime, isPlaying, mapTime, renderFrame, screenVideoRef, cameraVideoRef])

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
