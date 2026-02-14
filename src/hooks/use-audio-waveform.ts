import { useState, useEffect, useRef } from "react"
import { assetUrl } from "@/lib/asset-url"
import type { Clip } from "@/types/editor"

interface WaveformResult {
  peaks: number[] | null
  loading: boolean
}

/**
 * Rearrange raw waveform peaks to match the sequence clip order.
 * Extracts the peak range for each clip and concatenates them.
 */
export function rearrangeWaveform(
  allPeaks: number[],
  durationMs: number,
  clips: Clip[]
): number[] {
  const msPerPeak = durationMs / allPeaks.length
  const result: number[] = []
  for (const clip of clips) {
    const startIdx = Math.floor(clip.sourceStart / msPerPeak)
    const endIdx = Math.floor(clip.sourceEnd / msPerPeak)
    result.push(...allPeaks.slice(startIdx, endIdx))
  }
  return result
}

/**
 * Decode an audio file and extract peak amplitudes for waveform rendering.
 * @param audioPath - Absolute path to audio file, or null if not available
 * @param width - Number of peak samples to extract (typically timeline pixel width)
 */
export function useAudioWaveform(audioPath: string | null, width: number): WaveformResult {
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!audioPath || width <= 0) {
      setPeaks(null)
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)

    const decode = async () => {
      try {
        const url = assetUrl(audioPath)
        const response = await fetch(url, { signal: controller.signal })
        const arrayBuffer = await response.arrayBuffer()

        const audioCtx = new AudioContext()
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

        if (controller.signal.aborted) return

        // Extract peaks from first channel
        const channelData = audioBuffer.getChannelData(0)
        const samplesPerBucket = Math.floor(channelData.length / width)
        const result: number[] = []

        for (let i = 0; i < width; i++) {
          const start = i * samplesPerBucket
          const end = Math.min(start + samplesPerBucket, channelData.length)
          let max = 0
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j])
            if (abs > max) max = abs
          }
          result.push(max)
        }

        if (!controller.signal.aborted) {
          setPeaks(result)
          setLoading(false)
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          console.error("Waveform decode failed:", e)
          setPeaks(null)
          setLoading(false)
        }
      }
    }

    decode()

    return () => {
      controller.abort()
    }
  }, [audioPath, width])

  return { peaks, loading }
}
