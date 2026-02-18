import {
  WebGLCompositor,
  outputSize,
  type RenderParams,
} from "@/lib/webgl-compositor"
import { VideoDecoderWrapper } from "./video-decoder"
import { VideoEncoderWrapper } from "./video-encoder"
import { Mp4Muxer } from "./muxer"
import { assetUrl } from "@/lib/asset-url"
import type { EditorProject, ExportConfig, ExportProgress } from "@/types/editor"
import { sequenceTimeToSourceTime, getSequenceDuration } from "@/lib/sequence"
import { interpolateZoomEvents } from "@/lib/zoom-interpolation"

export interface ExportCallbacks {
  onProgress: (progress: ExportProgress) => void
  onComplete: (mp4Data: ArrayBuffer) => void
  onError: (error: string) => void
}

export class ExportPipeline {
  private cancelled = false
  private compositor: WebGLCompositor | null = null
  private decoder: VideoDecoderWrapper | null = null
  private encoder: VideoEncoderWrapper | null = null
  private muxer: Mp4Muxer | null = null

  async run(
    project: EditorProject,
    exportConfig: ExportConfig,
    callbacks: ExportCallbacks
  ): Promise<void> {
    const startTime = performance.now()
    const fps = 30

    try {
      // 1. Compute output dimensions
      this.decoder = new VideoDecoderWrapper()
      const videoInfo = await this.decoder.init(assetUrl(project.tracks.screen))
      const size = outputSize(
        exportConfig.resolution,
        videoInfo.width,
        videoInfo.height
      )

      // 2. Init compositor on offscreen canvas
      const canvas = new OffscreenCanvas(size.width, size.height)
      this.compositor = new WebGLCompositor(
        canvas as unknown as HTMLCanvasElement
      )
      this.compositor.configure(size.width, size.height)

      // Load background image
      if (project.effects.background.imageUrl) {
        await this.compositor.loadBackgroundImage(
          assetUrl(project.effects.background.imageUrl),
          project.effects.background.imageBlur ?? 0
        )
      }

      // 3. Init encoder + muxer
      this.encoder = new VideoEncoderWrapper()
      await this.encoder.init({
        width: size.width,
        height: size.height,
        bitrate: exportConfig.bitrate,
        fps,
      })

      this.muxer = new Mp4Muxer()
      this.muxer.init({ width: size.width, height: size.height, fps })

      // 4. Iterate through sequence frames
      const sequence = project.sequence
      const seqDurationMs = getSequenceDuration(
        sequence.clips,
        sequence.transitions
      )
      const frameIntervalMs = 1000 / fps
      const totalFrames = Math.ceil(seqDurationMs / frameIntervalMs)
      let framesRendered = 0

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

        // Decode frame at source time
        const frame = await this.decoder.decodeNext()
        if (!frame) continue

        // Upload frame as screen texture
        this.compositor.uploadScreen(frame)
        frame.close()

        // Compute zoom state
        let zoom = { x: 0.5, y: 0.5, scale: 1 }
        if (clip.zoomEvents?.length) {
          const clipRelativeTime = mapping.sourceTime - clip.sourceStart
          zoom = interpolateZoomEvents(clip.zoomEvents, clipRelativeTime)
        }

        // Render composited frame
        const renderParams: RenderParams = {
          effects: project.effects,
          screenWidth: videoInfo.width,
          screenHeight: videoInfo.height,
          zoom,
          cursor: null,
          click: null,
        }
        this.compositor.render(renderParams)

        // Capture and encode
        const outputFrame = new VideoFrame(canvas, {
          timestamp: seqTimeMs * 1000,
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

      // 5. Flush encoder and mux
      callbacks.onProgress({
        framesRendered,
        totalFrames,
        percentage: 99,
        elapsedMs: performance.now() - startTime,
        estimatedRemainingMs: 1000,
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
    this.decoder?.destroy()
    this.encoder?.destroy()
    this.muxer?.destroy()
  }
}
