import { describe, it, expect, beforeEach } from "vitest"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

const MOCK_PROJECT: EditorProject = {
  id: "test-123",
  name: "Test Recording",
  created_at: Date.now(),
  tracks: {
    screen: "/path/to/screen.mov",
    mic: "/path/to/mic.wav",
    system_audio: null,
    camera: "/path/to/camera.mov",
    mouse_events: null,
  },
  timeline: {
    duration_ms: 10000,
    in_point: 0,
    out_point: 10000,
  },
  effects: {
    background: {
      type: "solid",
      color: "#000000",
      gradientFrom: "#000",
      gradientTo: "#111",
      gradientAngle: 135,
      padding: 8,
      presetId: null,
    },
    cameraBubble: {
      visible: true,
      position: "bottom-right",
      size: 15,
      shape: "circle",
      borderWidth: 3,
      borderColor: "#ffffff",
    },
    frame: {
      borderRadius: 12,
      shadow: true,
      shadowIntensity: 0.5,
    },
    cursor: {
      enabled: false,
      type: "highlight",
      size: 40,
      color: "#ffcc00",
      opacity: 0.6,
    },
    zoomKeyframes: [],
  },
}

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
    useEditorStore.temporal.getState().clear()
  })

  it("loads a project", () => {
    const { project } = useEditorStore.getState()
    expect(project?.id).toBe("test-123")
    expect(project?.tracks.screen).toBe("/path/to/screen.mov")
  })

  it("sets in point with validation", () => {
    useEditorStore.getState().setInPoint(2000)
    expect(useEditorStore.getState().project?.timeline.in_point).toBe(2000)
  })

  it("clamps in point to not exceed out point", () => {
    useEditorStore.getState().setOutPoint(5000)
    useEditorStore.getState().setInPoint(6000) // past out_point
    expect(useEditorStore.getState().project?.timeline.in_point).toBeLessThan(5000)
  })

  it("sets out point with validation", () => {
    useEditorStore.getState().setOutPoint(8000)
    expect(useEditorStore.getState().project?.timeline.out_point).toBe(8000)
  })

  it("updates background", () => {
    useEditorStore.getState().setBackground({ color: "#ff0000", type: "solid" })
    const bg = useEditorStore.getState().project?.effects.background
    expect(bg?.color).toBe("#ff0000")
    expect(bg?.type).toBe("solid")
    expect(bg?.padding).toBe(8)
  })

  it("updates camera bubble", () => {
    useEditorStore.getState().setCameraBubble({ size: 20, position: "top-left" })
    const cam = useEditorStore.getState().project?.effects.cameraBubble
    expect(cam?.size).toBe(20)
    expect(cam?.position).toBe("top-left")
    expect(cam?.shape).toBe("circle")
  })

  it("updates frame config", () => {
    useEditorStore.getState().setFrame({ borderRadius: 24, shadow: false })
    const frame = useEditorStore.getState().project?.effects.frame
    expect(frame?.borderRadius).toBe(24)
    expect(frame?.shadow).toBe(false)
  })

  it("undo reverts last change", async () => {
    useEditorStore.getState().setBackground({ color: "#ff0000" })
    // Wait for throttle to flush
    await new Promise((r) => setTimeout(r, 600))
    expect(useEditorStore.getState().project?.effects.background.color).toBe("#ff0000")

    useEditorStore.temporal.getState().undo()
    expect(useEditorStore.getState().project?.effects.background.color).toBe("#000000")
  })

  it("redo restores undone change", async () => {
    useEditorStore.getState().setBackground({ color: "#ff0000" })
    await new Promise((r) => setTimeout(r, 600))
    useEditorStore.temporal.getState().undo()
    useEditorStore.temporal.getState().redo()
    expect(useEditorStore.getState().project?.effects.background.color).toBe("#ff0000")
  })

  it("playback state is NOT tracked by undo", () => {
    useEditorStore.getState().setCurrentTime(5000)
    useEditorStore.getState().setIsPlaying(true)

    const { pastStates } = useEditorStore.temporal.getState()
    expect(pastStates.length).toBe(0)
  })

  it("setCursor updates cursor config", () => {
    useEditorStore.getState().setCursor({ enabled: true, type: "spotlight" })
    expect(useEditorStore.getState().project!.effects.cursor.enabled).toBe(true)
    expect(useEditorStore.getState().project!.effects.cursor.type).toBe("spotlight")
  })

  it("addZoomKeyframe inserts sorted", () => {
    useEditorStore.getState().addZoomKeyframe({
      timeMs: 2000, x: 0.5, y: 0.5, scale: 2.0, easing: "ease-in-out", durationMs: 300,
    })
    useEditorStore.getState().addZoomKeyframe({
      timeMs: 1000, x: 0.3, y: 0.7, scale: 1.5, easing: "ease-in-out", durationMs: 300,
    })
    const kfs = useEditorStore.getState().project!.effects.zoomKeyframes
    expect(kfs.length).toBe(2)
    expect(kfs[0].timeMs).toBe(1000)
    expect(kfs[1].timeMs).toBe(2000)
  })

  it("removeZoomKeyframe removes by timeMs", () => {
    useEditorStore.getState().addZoomKeyframe({
      timeMs: 1000, x: 0.3, y: 0.7, scale: 2.0, easing: "ease-in-out", durationMs: 300,
    })
    useEditorStore.getState().removeZoomKeyframe(1000)
    expect(useEditorStore.getState().project!.effects.zoomKeyframes.length).toBe(0)
  })

  it("tracks selectedZoomIndex", () => {
    useEditorStore.getState().setSelectedZoomIndex(2)
    expect(useEditorStore.getState().selectedZoomIndex).toBe(2)
    useEditorStore.getState().setSelectedZoomIndex(null)
    expect(useEditorStore.getState().selectedZoomIndex).toBeNull()
  })

  it("updateZoomKeyframe updates properties at index", () => {
    useEditorStore.getState().addZoomKeyframe({
      timeMs: 1000, x: 0.5, y: 0.5, scale: 2.0, easing: "ease-in-out", durationMs: 500,
    })
    useEditorStore.getState().updateZoomKeyframe(0, { scale: 1.5, easing: "linear" })
    const kf = useEditorStore.getState().project!.effects.zoomKeyframes[0]
    expect(kf.scale).toBe(1.5)
    expect(kf.easing).toBe("linear")
    expect(kf.x).toBe(0.5) // unchanged
  })

  it("moveZoomKeyframe updates timeMs and re-sorts", () => {
    useEditorStore.getState().addZoomKeyframe({
      timeMs: 1000, x: 0.5, y: 0.5, scale: 2.0, easing: "ease-in-out", durationMs: 500,
    })
    useEditorStore.getState().addZoomKeyframe({
      timeMs: 3000, x: 0.3, y: 0.7, scale: 1.5, easing: "ease-in-out", durationMs: 500,
    })
    // Move first segment to after the second
    useEditorStore.getState().moveZoomKeyframe(0, 4000)
    const kfs = useEditorStore.getState().project!.effects.zoomKeyframes
    expect(kfs[0].timeMs).toBe(3000)
    expect(kfs[1].timeMs).toBe(4000)
  })

  it("selectedZoomIndex is NOT tracked by undo", () => {
    useEditorStore.getState().setSelectedZoomIndex(1)
    const { pastStates } = useEditorStore.temporal.getState()
    expect(pastStates.length).toBe(0)
  })

  it("auto-migrates project to sequence with one clip", () => {
    const { project } = useEditorStore.getState()
    expect(project!.sequence.clips).toHaveLength(1)
    expect(project!.sequence.clips[0].sourceStart).toBe(0)
    expect(project!.sequence.clips[0].sourceEnd).toBe(MOCK_PROJECT.timeline.duration_ms)
  })

  it("splits a clip at playhead", () => {
    const store = useEditorStore.getState()
    store.setCurrentTime(2000)
    store.splitAtPlayhead()
    const { project } = useEditorStore.getState()
    expect(project!.sequence.clips).toHaveLength(2)
    expect(project!.sequence.clips[0].sourceEnd).toBe(2000)
    expect(project!.sequence.clips[1].sourceStart).toBe(2000)
    expect(project!.sequence.transitions).toHaveLength(1)
    expect(project!.sequence.transitions[0]).toBeNull() // cut
  })

  it("removes a clip with ripple delete", () => {
    const store = useEditorStore.getState()
    store.setCurrentTime(2000)
    store.splitAtPlayhead()
    store.setSelectedClipIndex(1)
    store.rippleDelete()
    const { project } = useEditorStore.getState()
    expect(project!.sequence.clips).toHaveLength(1)
    expect(project!.sequence.clips[0].sourceEnd).toBe(2000)
  })

  it("reorders clips via moveClip", () => {
    const store = useEditorStore.getState()
    // Split into 3 clips
    store.setCurrentTime(2000)
    store.splitAtPlayhead()
    store.setCurrentTime(3000) // 1000 into second clip -> source 3000
    store.splitAtPlayhead()

    const clipsBefore = useEditorStore.getState().project!.sequence.clips
    expect(clipsBefore).toHaveLength(3)

    store.moveClip(2, 0) // move last clip to first position
    const clipsAfter = useEditorStore.getState().project!.sequence.clips
    expect(clipsAfter[0].id).toBe(clipsBefore[2].id)
    expect(clipsAfter[1].id).toBe(clipsBefore[0].id)
    expect(clipsAfter[2].id).toBe(clipsBefore[1].id)
  })

  it("loadProject merges cursor defaults for old projects", () => {
    const oldProject = {
      ...MOCK_PROJECT,
      effects: {
        background: MOCK_PROJECT.effects.background,
        cameraBubble: MOCK_PROJECT.effects.cameraBubble,
        frame: MOCK_PROJECT.effects.frame,
      } as any,
    }
    useEditorStore.getState().loadProject(oldProject)
    const effects = useEditorStore.getState().project!.effects
    expect(effects.cursor.enabled).toBe(false)
    expect(effects.cursor.type).toBe("highlight")
    expect(effects.zoomKeyframes).toEqual([])
  })
})

describe("overlay actions", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
    useEditorStore.temporal.getState().clear()
  })

  it("adds an overlay track", () => {
    const store = useEditorStore.getState()
    store.addOverlayTrack("text")
    const tracks = useEditorStore.getState().project!.sequence.overlayTracks
    expect(tracks).toHaveLength(1)
    expect(tracks[0].type).toBe("text")
  })

  it("adds an overlay to a track", () => {
    const store = useEditorStore.getState()
    store.addOverlayTrack("text")
    const trackId = useEditorStore.getState().project!.sequence.overlayTracks[0].id
    store.addOverlay({
      trackId,
      type: "text",
      startMs: 1000,
      durationMs: 2000,
      position: { x: 0.5, y: 0.1 },
      size: { width: 0.3, height: 0.05 },
      opacity: 1,
    })
    const overlays = useEditorStore.getState().project!.sequence.overlays
    expect(overlays).toHaveLength(1)
    expect(overlays[0].startMs).toBe(1000)
  })

  it("removes an overlay", () => {
    const store = useEditorStore.getState()
    store.addOverlayTrack("text")
    const trackId = useEditorStore.getState().project!.sequence.overlayTracks[0].id
    store.addOverlay({
      trackId, type: "text", startMs: 1000, durationMs: 2000,
      position: { x: 0.5, y: 0.1 }, size: { width: 0.3, height: 0.05 }, opacity: 1,
    })
    const overlayId = useEditorStore.getState().project!.sequence.overlays[0].id
    store.removeOverlay(overlayId)
    expect(useEditorStore.getState().project!.sequence.overlays).toHaveLength(0)
  })

  it("enforces max 5 overlay tracks", () => {
    const store = useEditorStore.getState()
    for (let i = 0; i < 5; i++) store.addOverlayTrack("text")
    expect(useEditorStore.getState().project!.sequence.overlayTracks).toHaveLength(5)
    store.addOverlayTrack("image") // should be ignored
    expect(useEditorStore.getState().project!.sequence.overlayTracks).toHaveLength(5)
  })
})

describe("clip-scoped zoom actions", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
    useEditorStore.temporal.getState().clear()
  })

  it("addZoomKeyframeToClip adds keyframe to specific clip", () => {
    const store = useEditorStore.getState()
    store.addZoomKeyframeToClip(0, {
      timeMs: 500, x: 0.3, y: 0.7, scale: 2.0, easing: "ease-in-out", durationMs: 300,
    })
    const clip = useEditorStore.getState().project!.sequence.clips[0]
    expect(clip.zoomKeyframes).toHaveLength(1)
    expect(clip.zoomKeyframes[0].timeMs).toBe(500)
  })

  it("removeZoomKeyframeFromClip removes by timeMs", () => {
    const store = useEditorStore.getState()
    store.addZoomKeyframeToClip(0, {
      timeMs: 500, x: 0.3, y: 0.7, scale: 2.0, easing: "ease-in-out", durationMs: 300,
    })
    store.removeZoomKeyframeFromClip(0, 500)
    const clip = useEditorStore.getState().project!.sequence.clips[0]
    expect(clip.zoomKeyframes).toHaveLength(0)
  })

  it("clearClipZoomKeyframes clears all keyframes from a clip", () => {
    const store = useEditorStore.getState()
    store.addZoomKeyframeToClip(0, {
      timeMs: 500, x: 0.3, y: 0.7, scale: 2.0, easing: "ease-in-out", durationMs: 300,
    })
    store.addZoomKeyframeToClip(0, {
      timeMs: 1500, x: 0.5, y: 0.5, scale: 1.5, easing: "ease-in-out", durationMs: 300,
    })
    store.clearClipZoomKeyframes(0)
    const clip = useEditorStore.getState().project!.sequence.clips[0]
    expect(clip.zoomKeyframes).toHaveLength(0)
  })
})
