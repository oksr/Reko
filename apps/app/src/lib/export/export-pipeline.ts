import {
  WebGLCompositor,
  outputSize,
  type RenderParams,
} from "@/lib/webgl-compositor"
import { screenRect } from "@/lib/webgl-compositor/layout"
import { VideoEncoderWrapper } from "./video-encoder"
import { Mp4Muxer } from "./muxer"
import type { EditorProject, ExportConfig, ExportProgress, MouseEvent as MouseLogEvent } from "@/types/editor"
import { sequenceTimeToSourceTime, getSequenceDuration } from "@/lib/sequence"
import { interpolateZoomEvents } from "@/lib/zoom-interpolation"
import { CURSOR_ICON_ASSETS, SYSTEM_CURSOR_ASSETS } from "@/assets/cursors"
import type { CursorIcon, SystemCursorType } from "@/types/editor"

const MAX_FRAME_DELTA_MS = 100
const SCALE_BLUR = 2
const PAN_BLUR = 0.8
const CURSOR_BLUR = 3.0

const CLICK_RIPPLE_DURATION_MS = 500

/** Load mouse events from JSONL file. */
async function loadMouseEvents(url: string): Promise<MouseLogEvent[]> {
  try {
    const resp = await fetch(url)
    const text = await resp.text()
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as MouseLogEvent }
        catch { return null }
      })
      .filter(Boolean) as MouseLogEvent[]
  } catch {
    return []
  }
}

/** Binary search for cursor position at a given time. */
function getCursorAt(events: MouseLogEvent[], timeMs: number): { x: number; y: number; cursor?: SystemCursorType } | null {
  if (events.length === 0) return null
  let lo = 0
  let hi = events.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (events[mid].timeMs <= timeMs) lo = mid
    else hi = mid - 1
  }
  if (events[lo].timeMs > timeMs) return null
  const evt = events[lo]
  return { x: evt.x, y: evt.y, cursor: evt.cursor }
}

/** Find click events in a time range. */
function getClicksInRange(events: MouseLogEvent[], startMs: number, endMs: number): Array<{ timeMs: number; x: number; y: number }> {
  if (events.length === 0) return []
  let lo = 0
  let hi = events.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (events[mid].timeMs < startMs) lo = mid + 1
    else hi = mid
  }
  const clicks: Array<{ timeMs: number; x: number; y: number }> = []
  for (let i = lo; i < events.length && events[i].timeMs <= endMs; i++) {
    if (events[i].type === "click" || events[i].type === "rightClick") {
      clicks.push({ timeMs: events[i].timeMs, x: events[i].x, y: events[i].y })
    }
  }
  return clicks
}

export interface ExportCallbacks {
  onProgress: (progress: ExportProgress) => void
  onComplete: (mp4Data: ArrayBuffer) => void
  onError: (error: string) => void
}

/** Load a <video> element and wait for metadata. */
function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    video.onloadedmetadata = () => resolve(video)
    video.onerror = () => reject(new Error(`Failed to load video: ${url}`))
    video.src = url
  })
}

/** Seek a video element and wait for the frame to be ready. */
function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - timeSec) < 0.001) {
      resolve()
      return
    }
    video.onseeked = () => {
      video.onseeked = null
      resolve()
    }
    video.currentTime = timeSec
  })
}

export class ExportPipeline {
  private cancelled = false
  private compositor: WebGLCompositor | null = null
  private encoder: VideoEncoderWrapper | null = null
  private muxer: Mp4Muxer | null = null
  private video: HTMLVideoElement | null = null
  private cameraVideo: HTMLVideoElement | null = null
  private assetUrl: (path: string) => string

  constructor(assetUrl: (path: string) => string) {
    this.assetUrl = assetUrl
  }

  async run(
    project: EditorProject,
    exportConfig: ExportConfig,
    callbacks: ExportCallbacks
  ): Promise<void> {
    const startTime = performance.now()
    const fps = 60

    try {
      // 1. Load screen video
      const videoUrl = this.assetUrl(project.tracks.screen)
      this.video = await loadVideo(videoUrl)
      const videoWidth = this.video.videoWidth
      const videoHeight = this.video.videoHeight

      // Load camera video if available
      if (project.tracks.camera) {
        try {
          this.cameraVideo = await loadVideo(this.assetUrl(project.tracks.camera))
        } catch (e) {
          console.warn("[export-pipeline] camera video failed to load:", e)
        }
      }

      // Load mouse events for cursor/click rendering
      let mouseEvents: MouseLogEvent[] = []
      if (project.tracks.mouse_events) {
        mouseEvents = await loadMouseEvents(this.assetUrl(project.tracks.mouse_events))
      }

      const size = outputSize(exportConfig.resolution, videoWidth, videoHeight)

      // 2. Init compositor on offscreen canvas
      const canvas = new OffscreenCanvas(size.width, size.height)
      this.compositor = new WebGLCompositor(
        canvas as unknown as HTMLCanvasElement
      )
      this.compositor.configure(size.width, size.height)

      // Load background image
      if (project.effects.background.imageUrl) {
        await this.compositor.loadBackgroundImage(
          this.assetUrl(project.effects.background.imageUrl),
          project.effects.background.imageBlur ?? 0
        )
      }

      // Load cursor icon if cursor effects are enabled
      if (project.effects.cursor.enabled && project.effects.cursor.icon) {
        const iconUrl = CURSOR_ICON_ASSETS[project.effects.cursor.icon as CursorIcon]
        if (iconUrl) {
          await this.compositor.loadCursorIcon(iconUrl)
        }
        // Pre-load system cursor textures (pointer, ibeam)
        const urls: Partial<Record<string, string>> = {}
        for (const [type, url] of Object.entries(SYSTEM_CURSOR_ASSETS)) {
          if (url) {
            urls[type] = url
            await this.compositor.loadSystemCursorIcon(url)
          }
        }
        this.compositor.setSystemCursorUrls(urls)
      }

      // 3. Compute sequence info
      const sequence = project.sequence
      const seqDurationMs = getSequenceDuration(
        sequence.clips,
        sequence.transitions
      )

      // 4. Init encoder + muxer (video only — audio muxed natively via Rust/ffmpeg)
      this.encoder = new VideoEncoderWrapper()
      await this.encoder.init({
        width: size.width,
        height: size.height,
        bitrate: exportConfig.bitrate,
        fps,
      })

      this.muxer = new Mp4Muxer()
      this.muxer.init({ width: size.width, height: size.height, fps })

      // 5. Iterate through sequence frames
      const frameIntervalMs = 1000 / fps
      const totalFrames = Math.ceil(seqDurationMs / frameIntervalMs)
      let framesRendered = 0

      // Motion blur tracking state
      let prevSeqTimeMs = -1
      let prevZoom = { x: 0.5, y: 0.5, scale: 1 as number }
      let prevCursorPos: { x: number; y: number } | null = null
      let smoothCenter = { x: 0.5, y: 0.5 }

      for (
        let seqTimeMs = 0;
        seqTimeMs < seqDurationMs;
        seqTimeMs += frameIntervalMs
      ) {
        if (this.cancelled) break

        const mapping = sequenceTimeToSourceTime(
          seqTimeMs,
          sequence.clips,
          sequence.transitions
        )
        if (!mapping) continue

        const clip = sequence.clips[mapping.clipIndex]
        const sourceTimeSec = mapping.sourceTime / 1000

        // Seek screen video to source time
        await seekVideo(this.video, sourceTimeSec)
        this.compositor.uploadScreen(this.video)

        // Seek and upload camera if available
        if (this.cameraVideo) {
          await seekVideo(this.cameraVideo, sourceTimeSec)
          this.compositor.uploadCamera(this.cameraVideo)
        }

        // Compute cursor position and active click ripple
        const sourceTimeMs = mapping.sourceTime
        const cursorPos = getCursorAt(mouseEvents, sourceTimeMs)

        // Compute zoom state — pass cursor so viewport follows it while zoomed
        let rawZoom = { x: 0.5, y: 0.5, scale: 1 }
        if (clip.zoomEvents?.length) {
          const clipRelativeTime = mapping.sourceTime - clip.sourceStart
          rawZoom = interpolateZoomEvents(clip.zoomEvents, clipRelativeTime, cursorPos)
        }

        // Smooth pan center with exponential decay (same 120ms time-constant as preview)
        const dtFrame = frameIntervalMs
        const alpha = 1 - Math.exp(-dtFrame / 120)
        smoothCenter = {
          x: smoothCenter.x + (rawZoom.x - smoothCenter.x) * alpha,
          y: smoothCenter.y + (rawZoom.y - smoothCenter.y) * alpha,
        }
        const zoom = { ...rawZoom, x: smoothCenter.x, y: smoothCenter.y }
        let clickParam: RenderParams["click"] = null
        const clicks = getClicksInRange(mouseEvents, sourceTimeMs - CLICK_RIPPLE_DURATION_MS, sourceTimeMs)
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
        let cursorVelocity: RenderParams["cursorVelocity"] = null

        const dt = seqTimeMs - prevSeqTimeMs
        const inPlayback = dt > 0 && dt <= MAX_FRAME_DELTA_MS

        if (inPlayback) {
          const sr = screenRect(
            size.width, size.height,
            videoWidth, videoHeight,
            project.effects.background.padding
          )

          const panDx = -(zoom.x - prevZoom.x) * sr.w * zoom.scale * PAN_BLUR
          const panDy = -(zoom.y - prevZoom.y) * sr.h * zoom.scale * PAN_BLUR
          const dScale = zoom.scale - prevZoom.scale
          const cap = dScale < 0 ? 0.06 : 0.15
          const intensity = Math.min(Math.abs(dScale) * SCALE_BLUR, cap) * Math.sign(dScale)

          if (Math.abs(panDx) > 0.0005 || Math.abs(panDy) > 0.0005 || Math.abs(intensity) > 0.001) {
            motionBlurParam = { dx: panDx, dy: panDy, intensity }
          }

          if (cursorPos && prevCursorPos) {
            const zoomedW = sr.w * zoom.scale
            const zoomedH = sr.h * zoom.scale
            const cdx = (cursorPos.x - prevCursorPos.x) * zoomedW * CURSOR_BLUR
            const cdy = (cursorPos.y - prevCursorPos.y) * zoomedH * CURSOR_BLUR
            if (Math.abs(cdx) > 0.001 || Math.abs(cdy) > 0.001) {
              cursorVelocity = { dx: cdx, dy: cdy }
            }
          }
        }

        prevSeqTimeMs = seqTimeMs
        prevZoom = zoom
        prevCursorPos = cursorPos

        // Render composited frame
        const renderParams: RenderParams = {
          effects: project.effects,
          screenWidth: videoWidth,
          screenHeight: videoHeight,
          zoom,
          cursor: cursorPos,
          cursorType: cursorPos?.cursor,
          click: clickParam,
          motionBlur: motionBlurParam,
          cursorVelocity,
        }
        this.compositor.render(renderParams)

        // Capture and encode
        const frameDurationUs = Math.round(frameIntervalMs * 1000)
        const outputFrame = new VideoFrame(canvas, {
          timestamp: seqTimeMs * 1000,
          duration: frameDurationUs,
        })
        const isKeyFrame = framesRendered % (fps * 2) === 0
        this.encoder.encode(outputFrame, isKeyFrame)

        framesRendered++
        const elapsed = performance.now() - startTime
        callbacks.onProgress({
          framesRendered,
          totalFrames,
          percentage: (framesRendered / totalFrames) * 100,
          elapsedMs: elapsed,
          estimatedRemainingMs:
            totalFrames > 0
              ? (elapsed / framesRendered) * (totalFrames - framesRendered)
              : null,
          phase: "compositing",
        })
      }

      if (this.cancelled) {
        callbacks.onProgress({
          framesRendered,
          totalFrames,
          percentage: 0,
          elapsedMs: 0,
          estimatedRemainingMs: null,
          phase: "cancelled",
        })
        return
      }

      // 6. Flush video encoder and mux
      callbacks.onProgress({
        framesRendered,
        totalFrames,
        percentage: 99,
        elapsedMs: performance.now() - startTime,
        estimatedRemainingMs: 2000,
        phase: "finalizing",
      })

      const chunks = await this.encoder.flush()
      for (const { chunk, meta } of chunks) {
        this.muxer.addVideoChunk(chunk, meta)
      }

      const mp4Data = this.muxer.finalize()
      callbacks.onProgress({
        framesRendered,
        totalFrames,
        percentage: 100,
        elapsedMs: performance.now() - startTime,
        estimatedRemainingMs: 0,
        phase: "done",
      })
      callbacks.onComplete(mp4Data)
    } catch (e) {
      console.error("[export-pipeline] CAUGHT ERROR:", e)
      callbacks.onError(String(e))
    } finally {
      this.cleanup()
    }
  }

  cancel(): void {
    this.cancelled = true
  }

  private cleanup(): void {
    this.compositor?.destroy()
    this.encoder?.destroy()
    this.muxer?.destroy()
    if (this.video) {
      this.video.src = ""
      this.video = null
    }
    if (this.cameraVideo) {
      this.cameraVideo.src = ""
      this.cameraVideo = null
    }
  }
}
