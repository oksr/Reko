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
