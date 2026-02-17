import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { PreviewCanvas } from "@/components/editor/preview-canvas"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

const MOCK_PROJECT: EditorProject = {
  id: "test-1",
  name: "Test",
  created_at: 0,
  tracks: { screen: "/screen.mov", mic: null, system_audio: null, camera: "/camera.mov", mouse_events: null },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: true, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: true, shadowIntensity: 0.5 },
    cursor: { enabled: false, type: "highlight", size: 40, color: "#ffcc00", opacity: 0.6 },
  },
}

const mockVideoSync = {
  register: vi.fn(),
  unregister: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
}

describe("PreviewCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
  })

  it("renders screen video", () => {
    render(<PreviewCanvas videoSync={mockVideoSync} />)
    const videos = document.querySelectorAll("video")
    expect(videos.length).toBeGreaterThanOrEqual(1)
  })

  it("renders camera video when visible", () => {
    render(<PreviewCanvas videoSync={mockVideoSync} />)
    const videos = document.querySelectorAll("video")
    expect(videos.length).toBe(2)
  })

  it("hides camera when not visible", () => {
    useEditorStore.getState().setCameraBubble({ visible: false })
    render(<PreviewCanvas videoSync={mockVideoSync} />)
    const videos = document.querySelectorAll("video")
    expect(videos.length).toBe(1)
  })

  it("registers videos with videoSync", () => {
    render(<PreviewCanvas videoSync={mockVideoSync} />)
    expect(mockVideoSync.register).toHaveBeenCalled()
  })
})
