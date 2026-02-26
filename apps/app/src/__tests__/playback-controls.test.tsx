import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PlaybackControls } from "@/components/editor/playback-controls"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"
import { renderWithPlatform } from "./render-with-platform"

const MOCK_PROJECT: EditorProject = {
  id: "t", name: "T", created_at: 0,
  tracks: { screen: "/s.mov", mic: null, system_audio: null, camera: null, mouse_events: null },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null, imageUrl: null, imageBlur: 0, unsplashId: null, unsplashAuthor: null, wallpaperId: null },
    cameraBubble: { visible: false, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff", shadow: false, shadowIntensity: 0 },
    frame: { borderRadius: 12, shadow: false, shadowIntensity: 0 },
    cursor: { enabled: false, type: "highlight", size: 40, color: "#ffcc00", opacity: 0.6, clickHighlight: { enabled: false, color: "#ffffff", opacity: 0.5, size: 30 } },
  },
  sequence: {
    clips: [{ id: "clip-1", sourceStart: 0, sourceEnd: 10000, speed: 1, zoomEvents: [] }],
    transitions: [],
    overlayTracks: [],
    overlays: [],
  },
}

const mockVideoSync = {
  register: vi.fn(), unregister: vi.fn(),
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(), seek: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
}

describe("PlaybackControls", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
    useEditorStore.getState().setIsPlaying(false)
  })

  it("renders play button when paused", () => {
    renderWithPlatform(<PlaybackControls videoSync={mockVideoSync} />)
    expect(screen.getByTitle("Play")).toBeTruthy()
  })

  it("calls videoSync.play on play click", async () => {
    renderWithPlatform(<PlaybackControls videoSync={mockVideoSync} />)
    await userEvent.click(screen.getByTitle("Play"))
    expect(mockVideoSync.play).toHaveBeenCalled()
  })

  it("renders time display", () => {
    renderWithPlatform(<PlaybackControls videoSync={mockVideoSync} />)
    // Should show 00:00.0 / 00:10.0 for a 10s clip
    expect(screen.getByText(/00:00\.0/)).toBeTruthy()
  })

  it("skip back seeks to start of sequence", async () => {
    renderWithPlatform(<PlaybackControls videoSync={mockVideoSync} />)
    await userEvent.click(screen.getByTitle("Go to start"))
    expect(mockVideoSync.seek).toHaveBeenCalledWith(0)
  })
})
