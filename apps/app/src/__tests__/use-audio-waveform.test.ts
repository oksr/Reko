import { describe, it, expect, vi, beforeEach } from "vitest"
import { waitFor } from "@testing-library/react"
import { useAudioWaveform } from "@/hooks/use-audio-waveform"
import { renderHookWithPlatform } from "./render-with-platform"
import { createMockPlatform } from "./mock-platform"

// Mock fetch + AudioContext
const mockDecodeAudioData = vi.fn()
const mockGetChannelData = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()

  // Mock AudioContext as a proper class
  global.AudioContext = class {
    decodeAudioData = mockDecodeAudioData
  } as any

  // Mock fetch
  global.fetch = vi.fn().mockResolvedValue({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  }) as any
})

describe("useAudioWaveform", () => {
  it("returns loading state initially", () => {
    mockDecodeAudioData.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHookWithPlatform(() => useAudioWaveform("/path/to/audio.wav", 500))
    expect(result.current.loading).toBe(true)
    expect(result.current.peaks).toBeNull()
  })

  it("returns null peaks when path is null", () => {
    const { result } = renderHookWithPlatform(() => useAudioWaveform(null, 500))
    expect(result.current.loading).toBe(false)
    expect(result.current.peaks).toBeNull()
  })

  it("extracts peaks from decoded audio", async () => {
    const samples = new Float32Array(1000)
    // Create a simple pattern: alternating high/low
    for (let i = 0; i < 1000; i++) samples[i] = i % 2 === 0 ? 0.8 : -0.5

    mockGetChannelData.mockReturnValue(samples)
    mockDecodeAudioData.mockResolvedValue({
      numberOfChannels: 1,
      length: 1000,
      sampleRate: 44100,
      getChannelData: mockGetChannelData,
    })

    const platform = createMockPlatform()
    vi.mocked(platform.filesystem.assetUrl).mockImplementation((p) => `asset://localhost/${p}`)

    const { result } = renderHookWithPlatform(() => useAudioWaveform("/path/audio.wav", 100), platform)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.peaks).not.toBeNull()
    expect(result.current.peaks!.length).toBe(100) // matches requested width
    // Each peak should be a positive number (max absolute value in bucket)
    result.current.peaks!.forEach((p) => {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    })
  })
})
