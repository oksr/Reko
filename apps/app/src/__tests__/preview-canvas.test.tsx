import { describe, it, expect, vi, beforeEach } from "vitest"
import { PreviewCanvas } from "@/components/editor/preview-canvas"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"
import { renderWithPlatform } from "./render-with-platform"

vi.mock("@/lib/webgl-compositor", () => ({
  WebGLCompositor: vi.fn().mockImplementation(() => ({
    configure: vi.fn(),
    uploadScreen: vi.fn(),
    uploadCamera: vi.fn(),
    loadBackgroundImage: vi.fn().mockResolvedValue(undefined),
    render: vi.fn(),
    destroy: vi.fn(),
  })),
}))

vi.mock("@/hooks/use-mouse-events", () => ({
  useMouseEvents: () => ({
    cursorPos: null,
    events: [],
    getCursorAt: () => null,
    getClicksInRange: () => [],
  }),
}))

const MOCK_PROJECT: EditorProject = {
  id: "test-1",
  name: "Test",
  created_at: 0,
  tracks: { screen: "/screen.mov", mic: "/mic.wav", system_audio: null, camera: null, mouse_events: null },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: {
      type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111",
      gradientAngle: 135, padding: 8, presetId: null, imageUrl: null,
      imageBlur: 0, unsplashId: null, unsplashAuthor: null, wallpaperId: null,
    },
    cameraBubble: { visible: false, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: true, shadowIntensity: 0.5 },
    cursor: {
      enabled: false, type: "highlight", size: 40, color: "#ffcc00", opacity: 0.6,
      clickHighlight: { enabled: true, color: "#ffffff", opacity: 0.5, size: 30 },
    },
  },
  sequence: {
    clips: [{ id: "clip-1", sourceStart: 0, sourceEnd: 10000, speed: 1, zoomEvents: [] }],
    transitions: [],
    overlayTracks: [],
    overlays: [],
  },
}

describe("PreviewCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
  })

  it("renders a canvas element", () => {
    renderWithPlatform(<PreviewCanvas />)
    const canvas = document.querySelector("canvas")
    expect(canvas).toBeTruthy()
  })

  it("renders hidden video for screen track", () => {
    renderWithPlatform(<PreviewCanvas />)
    const video = document.querySelector('video[data-testid="screen-video"]')
    expect(video).toBeTruthy()
  })

  it("renders audio element when mic track exists", () => {
    renderWithPlatform(<PreviewCanvas />)
    const audios = document.querySelectorAll("audio")
    expect(audios.length).toBe(1)
  })

  it("does not render audio when no audio tracks", () => {
    useEditorStore.getState().loadProject({
      ...MOCK_PROJECT,
      tracks: { ...MOCK_PROJECT.tracks, mic: null },
    })
    renderWithPlatform(<PreviewCanvas />)
    const audios = document.querySelectorAll("audio")
    expect(audios.length).toBe(0)
  })

  it("returns null when no project", () => {
    useEditorStore.setState({ project: null })
    const { container } = renderWithPlatform(<PreviewCanvas />)
    expect(container.innerHTML).toBe("")
  })
})
