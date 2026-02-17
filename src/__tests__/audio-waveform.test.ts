import { describe, it, expect } from "vitest"
import { rearrangeWaveform } from "@/hooks/use-audio-waveform"
import type { Clip } from "@/types/editor"

const makeClip = (sourceStart: number, sourceEnd: number): Clip => ({
  id: `clip-${sourceStart}`,
  sourceStart,
  sourceEnd,
  speed: 1,
  zoomEvents: [],
})

describe("rearrangeWaveform", () => {
  it("returns all peaks for a single full-length clip", () => {
    const peaks = [0.1, 0.2, 0.3, 0.4, 0.5]
    const clips = [makeClip(0, 5000)]
    const result = rearrangeWaveform(peaks, 5000, clips)
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
  })

  it("rearranges peaks to match clip order", () => {
    // 10 peaks over 10000ms = 1 peak per 1000ms
    const peaks = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    // Two clips: second half first, then first half
    const clips = [makeClip(5000, 10000), makeClip(0, 5000)]
    const result = rearrangeWaveform(peaks, 10000, clips)
    expect(result).toEqual([0.5, 0.6, 0.7, 0.8, 0.9, 0.0, 0.1, 0.2, 0.3, 0.4])
  })

  it("handles trimmed clips (subset of peaks)", () => {
    const peaks = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    // Single clip from 2000-7000ms
    const clips = [makeClip(2000, 7000)]
    const result = rearrangeWaveform(peaks, 10000, clips)
    expect(result).toEqual([0.2, 0.3, 0.4, 0.5, 0.6])
  })
})
