import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Timeline } from "@/components/editor/timeline"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}))

// Mock AudioContext for AudioTrack
global.AudioContext = class {
  decodeAudioData = vi.fn().mockResolvedValue({
    numberOfChannels: 1,
    length: 1000,
    sampleRate: 44100,
    getChannelData: () => new Float32Array(1000),
  })
} as any

global.fetch = vi.fn().mockResolvedValue({
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
}) as any

const MOCK_PROJECT: EditorProject = {
  id: "t", name: "T", created_at: 0,
  tracks: { screen: "/s.mov", mic: "/m.wav", system_audio: null, camera: "/c.mov", mouse_events: null },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: true, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: false, shadowIntensity: 0 },
    cursor: { enabled: false, type: "highlight", size: 40, color: "#ffcc00", opacity: 0.6 },
    zoomKeyframes: [],
  },
}

const mockVideoSync = {
  register: vi.fn(), unregister: vi.fn(), play: vi.fn(),
  pause: vi.fn(), seek: vi.fn(), getCurrentTime: vi.fn(() => 0),
}

describe("Timeline", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
  })

  it("renders clip track with duration label", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("Clip")).toBeTruthy()
  })

  it("renders time ruler", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("0:00")).toBeTruthy()
  })

  it("renders empty zoom track with hint text", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("Click or drag to add zoom on cursor")).toBeTruthy()
  })

  it("renders zoom segments when keyframes exist", () => {
    useEditorStore.getState().addZoomKeyframe({
      timeMs: 1000, x: 0.5, y: 0.5, scale: 2.0, easing: "ease-in-out", durationMs: 500,
    })
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("2.0x")).toBeTruthy()
  })
})
