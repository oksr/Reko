import { Muxer, ArrayBufferTarget } from "mp4-muxer"

export interface AudioConfig {
  codec: "aac" | "opus"
  sampleRate: number
  numberOfChannels: number
}

export interface MuxerConfig {
  width: number
  height: number
  fps: number
  audio?: AudioConfig
}

export class Mp4Muxer {
  private muxer: Muxer<ArrayBufferTarget> | null = null
  private target: ArrayBufferTarget | null = null

  init(config: MuxerConfig): void {
    this.target = new ArrayBufferTarget()
    this.muxer = new Muxer({
      target: this.target,
      video: {
        codec: "avc",
        width: config.width,
        height: config.height,
      },
      audio: config.audio
        ? {
            codec: config.audio.codec,
            sampleRate: config.audio.sampleRate,
            numberOfChannels: config.audio.numberOfChannels,
          }
        : undefined,
      fastStart: "in-memory",
    })
  }

  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    if (!this.muxer) throw new Error("Muxer not initialized")
    this.muxer.addVideoChunk(chunk, meta)
  }

  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void {
    if (!this.muxer) throw new Error("Muxer not initialized")
    this.muxer.addAudioChunk(chunk, meta)
  }

  finalize(): ArrayBuffer {
    if (!this.muxer || !this.target) throw new Error("Muxer not initialized")
    this.muxer.finalize()
    return this.target.buffer
  }

  destroy(): void {
    this.muxer = null
    this.target = null
  }
}
