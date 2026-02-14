import { describe, it, expect, beforeEach } from "vitest"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

const MOCK_PROJECT: EditorProject = {
  id: "e2e-test",
  name: "E2E Test",
  created_at: Date.now(),
  tracks: {
    screen: "/path/to/screen.mov",
    mic: "/path/to/mic.wav",
    system_audio: null,
    camera: null,
    mouse_events: null,
  },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: false, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: false, shadowIntensity: 0 },
    cursor: { enabled: false, type: "highlight", size: 40, color: "#ffcc00", opacity: 0.6 },
    zoomKeyframes: [],
  },
}

describe("sequence editing e2e", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
    useEditorStore.temporal.getState().clear()
  })

  it("full workflow: load → split → reorder → transition → delete → undo", async () => {
    const store = useEditorStore.getState()
    const seq = () => useEditorStore.getState().project!.sequence

    // 1. Verify auto-migration creates one clip
    expect(seq().clips).toHaveLength(1)
    expect(seq().clips[0].sourceStart).toBe(0)
    expect(seq().clips[0].sourceEnd).toBe(10000)

    // 2. Split at 3s
    store.setCurrentTime(3000)
    store.splitAtPlayhead()
    expect(seq().clips).toHaveLength(2)
    expect(seq().clips[0].sourceEnd).toBe(3000)
    expect(seq().clips[1].sourceStart).toBe(3000)

    // 3. Split at 7s
    store.setCurrentTime(7000)
    store.splitAtPlayhead()
    expect(seq().clips).toHaveLength(3)
    expect(seq().clips[2].sourceStart).toBe(7000)
    expect(seq().clips[2].sourceEnd).toBe(10000)

    // 4. Add crossfade between clips 0 and 1
    store.addTransition(0, { type: "crossfade", durationMs: 200 })
    expect(seq().transitions[0]?.type).toBe("crossfade")

    // 5. Reorder: move clip 2 to position 0
    const clip2Id = seq().clips[2].id
    store.moveClip(2, 0)
    expect(seq().clips[0].id).toBe(clip2Id)
    expect(seq().clips).toHaveLength(3)

    // 6. Select and delete clip 1
    store.setSelectedClipIndex(1)
    store.rippleDelete()
    expect(seq().clips).toHaveLength(2)

    // 7. Add zoom keyframe to first clip
    store.addZoomKeyframeToClip(0, {
      timeMs: 500, x: 0.5, y: 0.5, scale: 2.0, easing: "ease-in-out", durationMs: 300,
    })
    expect(seq().clips[0].zoomKeyframes).toHaveLength(1)

    // 8. Undo should revert the zoom keyframe add
    await new Promise((r) => setTimeout(r, 600)) // wait for throttle
    useEditorStore.temporal.getState().undo()
    expect(seq().clips[0].zoomKeyframes).toHaveLength(0)
  })

  it("trim workflow: trim start and end of clips", () => {
    const store = useEditorStore.getState()
    const seq = () => useEditorStore.getState().project!.sequence

    // Split into two clips
    store.setCurrentTime(5000)
    store.splitAtPlayhead()
    expect(seq().clips).toHaveLength(2)

    // Trim start of second clip
    store.trimClipStart(1, 6000)
    expect(seq().clips[1].sourceStart).toBe(6000)

    // Trim end of first clip
    store.trimClipEnd(0, 4000)
    expect(seq().clips[0].sourceEnd).toBe(4000)

    // Verify minimum clip duration is enforced
    store.trimClipEnd(0, 0) // try to make it too short
    expect(seq().clips[0].sourceEnd).toBeGreaterThanOrEqual(seq().clips[0].sourceStart + 500)
  })

  it("overlay workflow: add tracks and overlays", () => {
    const store = useEditorStore.getState()
    const seq = () => useEditorStore.getState().project!.sequence

    // Add overlay track
    store.addOverlayTrack("text")
    expect(seq().overlayTracks).toHaveLength(1)

    // Add overlay to track
    const trackId = seq().overlayTracks[0].id
    store.addOverlay({
      trackId, type: "text", startMs: 1000, durationMs: 3000,
      position: { x: 0.5, y: 0.1 }, size: { width: 0.4, height: 0.05 }, opacity: 1,
    })
    expect(seq().overlays).toHaveLength(1)

    // Remove overlay
    const overlayId = seq().overlays[0].id
    store.removeOverlay(overlayId)
    expect(seq().overlays).toHaveLength(0)

    // Remove track
    store.removeOverlayTrack(trackId)
    expect(seq().overlayTracks).toHaveLength(0)
  })
})
