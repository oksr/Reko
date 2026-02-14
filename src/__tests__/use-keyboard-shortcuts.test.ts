import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

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
  play: vi.fn(), pause: vi.fn(),
  seek: vi.fn(), getCurrentTime: vi.fn(() => 0),
}

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }))
}

describe("useKeyboardShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
    useEditorStore.getState().setIsPlaying(false)
    useEditorStore.getState().setCurrentTime(5000)
    useEditorStore.temporal.getState().clear()
  })

  it("Space toggles play", () => {
    renderHook(() => useKeyboardShortcuts(mockVideoSync))
    fireKey(" ", { code: "Space" })
    expect(mockVideoSync.play).toHaveBeenCalled()
  })

  it("Space pauses when playing", () => {
    useEditorStore.getState().setIsPlaying(true)
    renderHook(() => useKeyboardShortcuts(mockVideoSync))
    fireKey(" ", { code: "Space" })
    expect(mockVideoSync.pause).toHaveBeenCalled()
  })

  it("ArrowLeft seeks backward", () => {
    renderHook(() => useKeyboardShortcuts(mockVideoSync))
    fireKey("ArrowLeft")
    expect(mockVideoSync.seek).toHaveBeenCalledWith(4000)
  })

  it("ArrowRight seeks forward", () => {
    renderHook(() => useKeyboardShortcuts(mockVideoSync))
    fireKey("ArrowRight")
    expect(mockVideoSync.seek).toHaveBeenCalledWith(6000)
  })

  it("i sets in point at current time", () => {
    renderHook(() => useKeyboardShortcuts(mockVideoSync))
    fireKey("i")
    expect(useEditorStore.getState().project?.timeline.in_point).toBe(5000)
  })

  it("o sets out point at current time", () => {
    renderHook(() => useKeyboardShortcuts(mockVideoSync))
    fireKey("o")
    expect(useEditorStore.getState().project?.timeline.out_point).toBe(5000)
  })

  it("ArrowLeft does not go below 0", () => {
    useEditorStore.getState().setCurrentTime(500)
    renderHook(() => useKeyboardShortcuts(mockVideoSync))
    fireKey("ArrowLeft")
    expect(mockVideoSync.seek).toHaveBeenCalledWith(0)
  })
})
