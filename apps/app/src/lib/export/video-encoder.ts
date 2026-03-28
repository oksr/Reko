export interface EncoderConfig {
  width: number
  height: number
  bitrate: number
  fps: number
}

const FLUSH_TIMEOUT_MS = 30_000

export class VideoEncoderWrapper {
  private encoder: VideoEncoder | null = null
  private chunks: Array<{ chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }> = []
  private encoderError: Error | null = null

  async init(config: EncoderConfig): Promise<void> {
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        this.chunks.push({ chunk, meta })
      },
      error: (e) => {
        console.error("VideoEncoder error:", e)
        this.encoderError = e instanceof Error ? e : new Error(String(e))
      },
    })

    this.encoder.configure({
      codec: "avc1.640028",
      width: config.width,
      height: config.height,
      bitrate: config.bitrate,
      framerate: config.fps,
      hardwareAcceleration: "prefer-hardware",
    })
  }

  encode(frame: VideoFrame, keyFrame = false): void {
    if (!this.encoder) throw new Error("Encoder not initialized")
    if (this.encoderError) {
      frame.close()
      throw this.encoderError
    }
    this.encoder.encode(frame, { keyFrame })
    frame.close()
  }

  async flush(): Promise<Array<{ chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }>> {
    if (!this.encoder) return []
    if (this.encoderError) throw this.encoderError

    const flushPromise = this.encoder.flush()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Video encoder flush timed out after 30s")), FLUSH_TIMEOUT_MS)
    )
    await Promise.race([flushPromise, timeoutPromise])
    return this.chunks
  }

  destroy(): void {
    try { this.encoder?.close() } catch { /* encoder may already be closed */ }
    this.encoder = null
    this.chunks = []
    this.encoderError = null
  }
}
