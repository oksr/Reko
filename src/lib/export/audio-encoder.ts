/**
 * Audio decoding, mixing, and encoding utilities for the WebGL export pipeline.
 * Uses Web Audio API for decoding and WebCodecs AudioEncoder for encoding.
 */

/**
 * Decode an audio file and return trimmed PCM samples.
 * Uses Web Audio API for decoding (supports WAV, M4A, MP3, etc.)
 */
export async function decodeAudio(
  url: string,
  startMs: number,
  endMs: number,
  sampleRate: number = 44100
): Promise<{ samples: Float32Array; channels: number; sampleRate: number }> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()

  const audioCtx = new OfflineAudioContext(2, 1, sampleRate)
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

  const startSample = Math.floor((startMs / 1000) * audioBuffer.sampleRate)
  const endSample = Math.min(
    Math.floor((endMs / 1000) * audioBuffer.sampleRate),
    audioBuffer.length
  )
  const length = Math.max(0, endSample - startSample)
  const channels = audioBuffer.numberOfChannels

  // Interleave channels
  const samples = new Float32Array(length * channels)
  for (let ch = 0; ch < channels; ch++) {
    const channelData = audioBuffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      samples[i * channels + ch] = channelData[startSample + i] ?? 0
    }
  }

  return { samples, channels, sampleRate: audioBuffer.sampleRate }
}

/**
 * Mix multiple audio tracks (additive mixing with clipping).
 * All tracks must have the same channel layout (interleaved).
 */
export function mixAudioTracks(
  tracks: Float32Array[],
  _channels: number
): Float32Array {
  if (tracks.length === 0) return new Float32Array(0)
  if (tracks.length === 1) return tracks[0]

  const maxLen = Math.max(...tracks.map((t) => t.length))
  const mixed = new Float32Array(maxLen)

  for (const track of tracks) {
    for (let i = 0; i < track.length; i++) {
      mixed[i] += track[i]
    }
  }

  // Clip to [-1, 1]
  for (let i = 0; i < mixed.length; i++) {
    mixed[i] = Math.max(-1, Math.min(1, mixed[i]))
  }

  return mixed
}

/**
 * Encode PCM audio samples and mux them into an MP4 file.
 * Uses WebCodecs AudioEncoder with Opus codec (widely supported in browsers).
 *
 * @param addAudioChunk - Callback to add encoded chunks to the muxer
 * @param samples - Interleaved PCM float32 samples
 * @param channels - Number of audio channels
 * @param sampleRate - Sample rate in Hz
 */
export async function encodePcmAudio(
  addAudioChunk: (
    chunk: EncodedAudioChunk,
    meta?: EncodedAudioChunkMetadata
  ) => void,
  samples: Float32Array,
  channels: number,
  sampleRate: number
): Promise<void> {
  if (samples.length === 0) return

  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      addAudioChunk(chunk, meta ?? undefined)
    },
    error: (e) => {
      throw new Error(`AudioEncoder error: ${e.message}`)
    },
  })

  // Use Opus codec — natively supported in WebCodecs and mp4-muxer
  encoder.configure({
    codec: "opus",
    numberOfChannels: channels,
    sampleRate: sampleRate,
    bitrate: 128_000,
  })

  // Feed audio data in chunks (~20ms frames for Opus)
  const samplesPerFrame = Math.floor(sampleRate * 0.02) // 20ms
  const framesPerChunk = samplesPerFrame * channels
  const totalSamples = samples.length
  let offset = 0
  let timestampUs = 0
  const frameDurationUs = Math.floor((samplesPerFrame / sampleRate) * 1_000_000)

  while (offset < totalSamples) {
    const end = Math.min(offset + framesPerChunk, totalSamples)
    const frameData = samples.slice(offset, end)

    const audioData = new AudioData({
      format: "f32-planar" as AudioSampleFormat,
      sampleRate: sampleRate,
      numberOfFrames: Math.floor(frameData.length / channels),
      numberOfChannels: channels,
      timestamp: timestampUs,
      data: deinterleave(frameData, channels),
    })

    encoder.encode(audioData)
    audioData.close()

    timestampUs += frameDurationUs
    offset = end
  }

  await encoder.flush()
  encoder.close()
}

/**
 * Convert interleaved samples to planar format expected by AudioData.
 * AudioData with "f32-planar" expects all samples for channel 0 first,
 * then all samples for channel 1, etc.
 */
function deinterleave(
  interleaved: Float32Array,
  channels: number
): Float32Array {
  if (channels === 1) return interleaved

  const framesCount = Math.floor(interleaved.length / channels)
  const planar = new Float32Array(framesCount * channels)

  for (let ch = 0; ch < channels; ch++) {
    for (let i = 0; i < framesCount; i++) {
      planar[ch * framesCount + i] = interleaved[i * channels + ch]
    }
  }

  return planar
}

export interface AudioTrackSource {
  url: string
  startMs: number
  endMs: number
}

/**
 * High-level function: decode, mix, and encode audio tracks into muxer chunks.
 * Designed to be called from the export pipeline after video encoding completes.
 */
export async function encodeAndMuxAudio(
  addAudioChunk: (
    chunk: EncodedAudioChunk,
    meta?: EncodedAudioChunkMetadata
  ) => void,
  tracks: AudioTrackSource[],
  sampleRate: number = 44100
): Promise<void> {
  if (tracks.length === 0) return

  // Decode all audio tracks in parallel
  const decoded = await Promise.all(
    tracks.map((t) => decodeAudio(t.url, t.startMs, t.endMs, sampleRate))
  )

  // Use the channel count from the first track (typically 1 for mic, 2 for system)
  const channels = Math.max(...decoded.map((d) => d.channels), 1)

  // Normalize all tracks to the same channel count before mixing
  const normalizedSamples = decoded.map((d) => {
    if (d.channels === channels) return d.samples
    // Upmix mono to stereo by duplicating
    if (d.channels === 1 && channels === 2) {
      const frames = d.samples.length
      const stereo = new Float32Array(frames * 2)
      for (let i = 0; i < frames; i++) {
        stereo[i * 2] = d.samples[i]
        stereo[i * 2 + 1] = d.samples[i]
      }
      return stereo
    }
    // Downmix stereo to mono by averaging
    if (d.channels === 2 && channels === 1) {
      const frames = Math.floor(d.samples.length / 2)
      const mono = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        mono[i] = (d.samples[i * 2] + d.samples[i * 2 + 1]) / 2
      }
      return mono
    }
    return d.samples
  })

  // Mix all tracks together
  const mixed = mixAudioTracks(normalizedSamples, channels)

  // Encode and send to muxer
  const effectiveSampleRate = decoded[0]?.sampleRate ?? sampleRate
  await encodePcmAudio(addAudioChunk, mixed, channels, effectiveSampleRate)
}
