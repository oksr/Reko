import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Timeline } from "@/components/editor/timeline"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}))

const MOCK_PROJECT: EditorProject = {
  id: "t", name: "T", created_at: 0,
  tracks: { screen: "/s.mov", mic: "/m.wav", system_audio: null, camera: "/c.mov" },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: true, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: false, shadowIntensity: 0 },
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

  it("renders screen track", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("Screen")).toBeTruthy()
  })

  it("renders camera track when present", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("Camera")).toBeTruthy()
  })

  it("renders trim handles", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByTitle("In point")).toBeTruthy()
    expect(screen.getByTitle("Out point")).toBeTruthy()
  })

  it("renders time ruler", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("0:00")).toBeTruthy()
  })
})
