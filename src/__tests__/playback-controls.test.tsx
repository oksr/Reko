import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PlaybackControls } from "@/components/editor/playback-controls"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}))

const MOCK_PROJECT: EditorProject = {
  id: "t", name: "T", created_at: 0,
  tracks: { screen: "/s.mov", mic: null, system_audio: null, camera: null, mouse_events: null },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: false, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: false, shadowIntensity: 0 },
    cursor: { enabled: false, type: "highlight", size: 40, color: "#ffcc00", opacity: 0.6 },
    zoomKeyframes: [],
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
    render(<PlaybackControls videoSync={mockVideoSync} />)
    expect(screen.getByTitle("Play")).toBeTruthy()
  })

  it("calls videoSync.play on play click", async () => {
    render(<PlaybackControls videoSync={mockVideoSync} />)
    await userEvent.click(screen.getByTitle("Play"))
    expect(mockVideoSync.play).toHaveBeenCalled()
  })

  it("renders time display", () => {
    render(<PlaybackControls videoSync={mockVideoSync} />)
    // Should show 00:00.0 / 00:10.0 for a 10s clip
    expect(screen.getByText(/00:00\.0/)).toBeTruthy()
  })

  it("skip back seeks to in point", async () => {
    useEditorStore.getState().setInPoint(2000)
    render(<PlaybackControls videoSync={mockVideoSync} />)
    await userEvent.click(screen.getByTitle("Go to start"))
    expect(mockVideoSync.seek).toHaveBeenCalledWith(2000)
  })
})
