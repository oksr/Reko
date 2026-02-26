import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen, fireEvent } from "@testing-library/react"
import { Timeline } from "@/components/editor/timeline"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"
import { renderWithPlatform } from "./render-with-platform"

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
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null, imageUrl: null, imageBlur: 0, unsplashId: null, unsplashAuthor: null, wallpaperId: null },
    cameraBubble: { visible: true, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff", shadow: false, shadowIntensity: 0 },
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
  register: vi.fn(), unregister: vi.fn(), play: vi.fn(),
  pause: vi.fn(), seek: vi.fn(), getCurrentTime: vi.fn(() => 0),
}

describe("Timeline", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
  })

  it("renders clip track with duration label", () => {
    renderWithPlatform(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("Clip")).toBeTruthy()
  })

  it("renders time ruler", () => {
    renderWithPlatform(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("0:00")).toBeTruthy()
  })

  it("renders sequence track as the clip track", () => {
    const { getByTestId } = renderWithPlatform(<Timeline videoSync={mockVideoSync} />)
    expect(getByTestId("sequence-track")).toBeTruthy()
  })

  it("renders sequence track with multiple clips", () => {
    const store = useEditorStore.getState()
    store.setCurrentTime(2000)
    store.splitAtPlayhead()

    const { getByTestId, getAllByTestId } = renderWithPlatform(
      <Timeline videoSync={mockVideoSync} />
    )
    expect(getByTestId("sequence-track")).toBeTruthy()
    expect(getAllByTestId("clip-block")).toHaveLength(2)
  })

  it("renders zoom track as separate row", () => {
    const { container } = renderWithPlatform(<Timeline videoSync={mockVideoSync} />)
    // Zoom track shows hint text when empty
    expect(container.querySelector(".bg-indigo-950\\/40")).toBeTruthy()
  })

  it("renders timeline toolbar with tool buttons", () => {
    const { getByTestId } = renderWithPlatform(
      <Timeline videoSync={mockVideoSync} />
    )
    expect(getByTestId("tool-select")).toBeTruthy()
    expect(getByTestId("tool-razor")).toBeTruthy()
    expect(getByTestId("tool-zoom")).toBeTruthy()
  })

  it("switches active tool on click", () => {
    const { getByTestId } = renderWithPlatform(
      <Timeline videoSync={mockVideoSync} />
    )
    const razorBtn = getByTestId("tool-razor")
    fireEvent.click(razorBtn)
    expect(useEditorStore.getState().activeTool).toBe("razor")
  })

  it("reorders clips via drag and drop", () => {
    const store = useEditorStore.getState()
    store.setCurrentTime(2000)
    store.splitAtPlayhead()

    const clipsBefore = useEditorStore.getState().project!.sequence.clips

    const { getAllByTestId } = renderWithPlatform(
      <Timeline videoSync={mockVideoSync} />
    )
    const blocks = getAllByTestId("clip-block")
    expect(blocks).toHaveLength(2)

    // Simulate drag: move second clip to first position via store
    store.moveClip(1, 0)
    const clipsAfter = useEditorStore.getState().project!.sequence.clips
    expect(clipsAfter[0].id).toBe(clipsBefore[1].id)
  })

  it("trims clip end via store action", () => {
    const store = useEditorStore.getState()
    const clipBefore = store.project!.sequence.clips[0]
    store.trimClipEnd(0, clipBefore.sourceEnd - 1000)
    const clipAfter = useEditorStore.getState().project!.sequence.clips[0]
    expect(clipAfter.sourceEnd).toBe(clipBefore.sourceEnd - 1000)
  })

  it("trims clip start via store action", () => {
    const store = useEditorStore.getState()
    store.trimClipStart(0, 1000)
    const clipAfter = useEditorStore.getState().project!.sequence.clips[0]
    expect(clipAfter.sourceStart).toBe(1000)
  })

  it("renders transition block between clips", () => {
    const store = useEditorStore.getState()
    store.setCurrentTime(2000)
    store.splitAtPlayhead()
    store.addTransition(0, { type: "crossfade", durationMs: 200 })

    const { getByTestId } = renderWithPlatform(
      <Timeline videoSync={mockVideoSync} />
    )
    expect(getByTestId("transition-block")).toBeTruthy()
  })

  it("renders cut-point between clips when no transition", () => {
    const store = useEditorStore.getState()
    store.setCurrentTime(2000)
    store.splitAtPlayhead()

    const { getAllByTestId } = renderWithPlatform(
      <Timeline videoSync={mockVideoSync} />
    )
    expect(getAllByTestId("cut-point")).toHaveLength(1)
  })

  it("shows transition menu on right-click on cut-point", () => {
    const store = useEditorStore.getState()
    store.setCurrentTime(2000)
    store.splitAtPlayhead()

    const { getAllByTestId, getByTestId } = renderWithPlatform(
      <Timeline videoSync={mockVideoSync} />
    )

    const cutPoint = getAllByTestId("cut-point")[0]
    fireEvent.contextMenu(cutPoint)

    expect(getByTestId("transition-menu")).toBeTruthy()
  })

  it("adds transition via context menu click", () => {
    const store = useEditorStore.getState()
    store.setCurrentTime(2000)
    store.splitAtPlayhead()

    const { getAllByTestId, getByText } = renderWithPlatform(
      <Timeline videoSync={mockVideoSync} />
    )

    const cutPoint = getAllByTestId("cut-point")[0]
    fireEvent.contextMenu(cutPoint)

    fireEvent.click(getByText("Crossfade"))

    const seq = useEditorStore.getState().project!.sequence
    expect(seq.transitions[0]?.type).toBe("crossfade")
  })

  it("renders overlay tracks with overlay blocks", () => {
    const store = useEditorStore.getState()
    store.addOverlayTrack("text")
    const trackId = useEditorStore.getState().project!.sequence.overlayTracks[0].id
    store.addOverlay({
      trackId, type: "text", startMs: 500, durationMs: 2000,
      position: { x: 0.5, y: 0.1 }, size: { width: 0.3, height: 0.05 }, opacity: 1,
    })

    const { getByTestId, getAllByTestId } = renderWithPlatform(
      <Timeline videoSync={mockVideoSync} />
    )
    expect(getByTestId("overlay-track")).toBeTruthy()
    expect(getAllByTestId("overlay-block")).toHaveLength(1)
  })
})
