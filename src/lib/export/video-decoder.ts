import {
  createFile,
  DataStream,
  Endianness,
  type ISOFile,
  type Movie,
  type Sample,
  MP4BoxBuffer,
} from "mp4box"

export class VideoDecoderWrapper {
  private file: ISOFile | null = null
  private decoder: VideoDecoder | null = null
  private samples: Sample[] = []
  private frameQueue: VideoFrame[] = []
  private resolveFrame: ((frame: VideoFrame) => void) | null = null
  private configured = false

  async init(
    url: string,
  ): Promise<{ width: number; height: number; durationMs: number }> {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()

    return new Promise((resolve, reject) => {
      const file = createFile()
      this.file = file

      file.onReady = (info: Movie) => {
        const videoTrack = info.tracks.find((t) => t.type === "video")
        if (!videoTrack) {
          reject(new Error("No video track found"))
          return
        }

        const decoder = new VideoDecoder({
          output: (frame: VideoFrame) => {
            if (this.resolveFrame) {
              const cb = this.resolveFrame
              this.resolveFrame = null
              cb(frame)
            } else {
              this.frameQueue.push(frame)
            }
          },
          error: (e: DOMException) => {
            console.error("VideoDecoder error:", e)
          },
        })

        const config: VideoDecoderConfig = {
          codec: videoTrack.codec,
          codedWidth: videoTrack.video?.width ?? videoTrack.track_width,
          codedHeight: videoTrack.video?.height ?? videoTrack.track_height,
          description: this.getDescription(file, videoTrack.id),
        }
        decoder.configure(config)
        this.decoder = decoder
        this.configured = true

        file.setExtractionOptions(videoTrack.id, null, {
          nbSamples: Infinity,
        })
        file.onSamples = (
          _id: number,
          _user: unknown,
          samples: Sample[],
        ) => {
          this.samples.push(...samples)
        }
        file.start()

        resolve({
          width: videoTrack.video?.width ?? videoTrack.track_width,
          height: videoTrack.video?.height ?? videoTrack.track_height,
          durationMs: (videoTrack.duration / videoTrack.timescale) * 1000,
        })
      }

      file.onError = (_module: string, message: string) =>
        reject(new Error(message))

      const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0)
      file.appendBuffer(mp4Buffer)
      file.flush()
    })
  }

  async decodeNext(): Promise<VideoFrame | null> {
    if (!this.decoder || !this.configured) return null

    if (this.frameQueue.length > 0) {
      return this.frameQueue.shift()!
    }

    if (this.samples.length === 0) {
      await this.decoder.flush()
      return this.frameQueue.shift() ?? null
    }

    const sample = this.samples.shift()!
    const chunk = new EncodedVideoChunk({
      type: sample.is_sync ? "key" : "delta",
      timestamp: (sample.cts / sample.timescale) * 1_000_000,
      duration: (sample.duration / sample.timescale) * 1_000_000,
      data: sample.data!,
    })
    this.decoder.decode(chunk)

    return new Promise((resolve) => {
      if (this.frameQueue.length > 0) {
        resolve(this.frameQueue.shift()!)
      } else {
        this.resolveFrame = resolve
      }
    })
  }

  get totalFrames(): number {
    return this.samples.length
  }

  destroy(): void {
    this.decoder?.close()
    this.decoder = null
    this.file = null
    this.frameQueue.forEach((f) => f.close())
    this.frameQueue = []
  }

  private getDescription(
    file: ISOFile,
    trackId: number,
  ): Uint8Array | undefined {
    const trak = file.getTrackById(trackId)
    if (!trak) return undefined

    const stsd = trak.mdia?.minf?.stbl?.stsd
    if (!stsd?.entries?.length) return undefined

    const entry = stsd.entries[0]
    // @ts-expect-error - avcC/hvcC exist on VisualSampleEntry but not on base SampleEntry type
    const avcC = entry.avcC ?? entry.hvcC
    if (!avcC) return undefined

    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN)
    avcC.write(stream)
    return new Uint8Array(stream.buffer, 8)
  }
}
