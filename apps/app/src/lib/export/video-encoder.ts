export interface EncoderConfig {
  width: number
  height: number
  bitrate: number
  fps: number
}

export class VideoEncoderWrapper {
  private encoder: VideoEncoder | null = null
  private chunks: Array<{ chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }> = []

  async init(config: EncoderConfig): Promise<void> {
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        this.chunks.push({ chunk, meta })
      },
      error: (e) => {
        console.error("VideoEncoder error:", e)
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
    this.encoder.encode(frame, { keyFrame })
    frame.close()
  }

  async flush(): Promise<Array<{ chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }>> {
    if (!this.encoder) return []
    await this.encoder.flush()
    return this.chunks
  }

  destroy(): void {
    this.encoder?.close()
    this.encoder = null
    this.chunks = []
  }
}
