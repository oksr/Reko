import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { PreviewCanvas } from "@/components/editor/preview-canvas"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ width: 1280, height: 720 }),
  convertFileSrc: (path: string) => `asset://${path}`,
}))

const MOCK_PROJECT: EditorProject = {
  id: "test-1",
  name: "Test",
  created_at: 0,
  tracks: { screen: "/screen.mov", mic: "/mic.wav", system_audio: null, camera: null, mouse_events: null },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: false, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: true, shadowIntensity: 0.5 },
    cursor: { enabled: false, type: "highlight", size: 40, color: "#ffcc00", opacity: 0.6 },
  },
}

describe("PreviewCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
  })

  it("renders a canvas element", () => {
    render(<PreviewCanvas />)
    const canvas = document.querySelector("canvas")
    expect(canvas).toBeTruthy()
  })

  it("renders audio element when mic track exists", () => {
    render(<PreviewCanvas />)
    const audios = document.querySelectorAll("audio")
    expect(audios.length).toBe(1)
  })

  it("does not render audio when no audio tracks", () => {
    useEditorStore.getState().loadProject({
      ...MOCK_PROJECT,
      tracks: { ...MOCK_PROJECT.tracks, mic: null },
    })
    render(<PreviewCanvas />)
    const audios = document.querySelectorAll("audio")
    expect(audios.length).toBe(0)
  })

  it("returns null when no project", () => {
    useEditorStore.setState({ project: null })
    const { container } = render(<PreviewCanvas />)
    expect(container.innerHTML).toBe("")
  })
})
