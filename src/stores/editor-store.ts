import { create } from "zustand"
import { temporal } from "zundo"
import type { EditorProject, Effects, BackgroundConfig, CameraBubbleConfig, FrameConfig, CursorConfig, ZoomKeyframe, Transition, Sequence, OverlayTrack, Overlay } from "@/types/editor"
import { createClip, splitClip, sequenceTimeToSourceTime } from "@/lib/sequence"

const DEFAULT_EFFECTS: Effects = {
  background: {
    type: "gradient",
    color: "#1a1a2e",
    gradientFrom: "#1a1a2e",
    gradientTo: "#16213e",
    gradientAngle: 135,
    padding: 8,
    presetId: "midnight",
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
}

const DEFAULT_SEQUENCE: Sequence = {
  clips: [],
  transitions: [],
  overlayTracks: [],
  overlays: [],
}

function migrateToSequence(project: EditorProject): EditorProject {
  if (project.sequence?.clips?.length > 0) return project
  const clip = createClip(
    project.timeline.in_point ?? 0,
    project.timeline.out_point ?? project.timeline.duration_ms,
    project.effects?.zoomKeyframes ?? []
  )
  return {
    ...project,
    sequence: {
      clips: [clip],
      transitions: [],
      overlayTracks: [],
      overlays: [],
    },
  }
}

interface EditorState {
  // Project data
  project: EditorProject | null

  // Playback state (NOT tracked by undo)
  currentTime: number
  isPlaying: boolean

  // Selection state
  selectedClipIndex: number | null
  activeTool: "select" | "razor" | "zoom"

  // Actions
  loadProject: (project: EditorProject) => void
  setInPoint: (ms: number) => void
  setOutPoint: (ms: number) => void
  setBackground: (bg: Partial<BackgroundConfig>) => void
  setCameraBubble: (config: Partial<CameraBubbleConfig>) => void
  setFrame: (config: Partial<FrameConfig>) => void
  setCursor: (config: Partial<CursorConfig>) => void
  addZoomKeyframe: (kf: ZoomKeyframe) => void
  removeZoomKeyframe: (timeMs: number) => void
  setZoomKeyframes: (kfs: ZoomKeyframe[]) => void
  selectedZoomIndex: number | null
  zoomPopoverOpen: boolean
  setSelectedZoomIndex: (index: number | null) => void
  setZoomPopoverOpen: (open: boolean) => void
  updateZoomKeyframe: (index: number, updates: Partial<ZoomKeyframe>) => void
  moveZoomKeyframe: (index: number, newTimeMs: number) => void
  setCurrentTime: (ms: number) => void
  setIsPlaying: (playing: boolean) => void

  // Sequence actions
  splitAtPlayhead: () => void
  rippleDelete: () => void
  liftDelete: () => void
  moveClip: (fromIndex: number, toIndex: number) => void
  trimClipStart: (clipIndex: number, newSourceStart: number) => void
  trimClipEnd: (clipIndex: number, newSourceEnd: number) => void
  setSelectedClipIndex: (index: number | null) => void
  setActiveTool: (tool: "select" | "razor" | "zoom") => void
  addTransition: (index: number, transition: Transition) => void
  removeTransition: (index: number) => void

  // Clip-scoped zoom actions
  addZoomKeyframeToClip: (clipIndex: number, kf: ZoomKeyframe) => void
  removeZoomKeyframeFromClip: (clipIndex: number, timeMs: number) => void
  updateClipZoomKeyframe: (clipIndex: number, kfIndex: number, updates: Partial<ZoomKeyframe>) => void
  clearClipZoomKeyframes: (clipIndex: number) => void

  // Overlay actions
  addOverlayTrack: (type: OverlayTrack["type"]) => void
  removeOverlayTrack: (trackId: string) => void
  addOverlay: (overlay: Omit<Overlay, "id">) => void
  removeOverlay: (overlayId: string) => void
  updateOverlay: (overlayId: string, updates: Partial<Overlay>) => void
}

// State that gets tracked for undo/redo
type TrackedState = Pick<EditorState, "project">

// Throttle helper for undo debouncing
function throttle<T extends (...args: any[]) => any>(fn: T, ms: number): T {
  let lastCall = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: any[]) => {
    const now = Date.now()
    if (timer) clearTimeout(timer)
    if (now - lastCall >= ms) {
      lastCall = now
      fn(...args)
    } else {
      timer = setTimeout(() => {
        lastCall = Date.now()
        fn(...args)
      }, ms - (now - lastCall))
    }
  }) as T
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, get) => ({
      project: null,
      currentTime: 0,
      isPlaying: false,
      selectedZoomIndex: null,
      zoomPopoverOpen: false,
      selectedClipIndex: null,
      activeTool: "select" as const,

      loadProject: (project) => {
        // Ensure project has effects with defaults for new fields
        const withEffects: EditorProject = {
          ...project,
          effects: {
            ...DEFAULT_EFFECTS,
            ...(project.effects ?? {}),
            cursor: { ...DEFAULT_EFFECTS.cursor, ...(project.effects?.cursor ?? {}) },
            zoomKeyframes: project.effects?.zoomKeyframes ?? [],
          },
          sequence: project.sequence ?? DEFAULT_SEQUENCE,
        }
        const migrated = migrateToSequence(withEffects)
        set({ project: migrated, currentTime: 0, isPlaying: false })
      },

      setInPoint: (ms) =>
        set((s) => {
          if (!s.project) return s
          const clamped = Math.min(ms, s.project.timeline.out_point - 100)
          return {
            project: {
              ...s.project,
              timeline: { ...s.project.timeline, in_point: Math.max(0, clamped) },
            },
          }
        }),

      setOutPoint: (ms) =>
        set((s) => {
          if (!s.project) return s
          const clamped = Math.max(ms, s.project.timeline.in_point + 100)
          return {
            project: {
              ...s.project,
              timeline: {
                ...s.project.timeline,
                out_point: Math.min(s.project.timeline.duration_ms, clamped),
              },
            },
          }
        }),

      setBackground: (bg) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: {
                ...s.project.effects,
                background: { ...s.project.effects.background, ...bg },
              },
            },
          }
        }),

      setCameraBubble: (config) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: {
                ...s.project.effects,
                cameraBubble: { ...s.project.effects.cameraBubble, ...config },
              },
            },
          }
        }),

      setFrame: (config) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: {
                ...s.project.effects,
                frame: { ...s.project.effects.frame, ...config },
              },
            },
          }
        }),

      setCursor: (config) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: {
                ...s.project.effects,
                cursor: { ...s.project.effects.cursor, ...config },
              },
            },
          }
        }),

      addZoomKeyframe: (kf) =>
        set((s) => {
          if (!s.project) return s
          const existing = s.project.effects.zoomKeyframes
          const filtered = existing.filter((k) => k.timeMs !== kf.timeMs)
          const updated = [...filtered, kf].sort((a, b) => a.timeMs - b.timeMs)
          return {
            project: {
              ...s.project,
              effects: { ...s.project.effects, zoomKeyframes: updated },
            },
          }
        }),

      removeZoomKeyframe: (timeMs) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: {
                ...s.project.effects,
                zoomKeyframes: s.project.effects.zoomKeyframes.filter(
                  (k) => k.timeMs !== timeMs
                ),
              },
            },
          }
        }),

      setZoomKeyframes: (kfs) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: { ...s.project.effects, zoomKeyframes: kfs },
            },
          }
        }),

      setSelectedZoomIndex: (index) => set({ selectedZoomIndex: index }),
      setZoomPopoverOpen: (open) => set({ zoomPopoverOpen: open }),

      updateZoomKeyframe: (index, updates) =>
        set((s) => {
          if (!s.project) return s
          const kfs = [...s.project.effects.zoomKeyframes]
          if (index < 0 || index >= kfs.length) return s
          kfs[index] = { ...kfs[index], ...updates }
          return {
            project: {
              ...s.project,
              effects: { ...s.project.effects, zoomKeyframes: kfs },
            },
          }
        }),

      moveZoomKeyframe: (index, newTimeMs) =>
        set((s) => {
          if (!s.project) return s
          const kfs = [...s.project.effects.zoomKeyframes]
          if (index < 0 || index >= kfs.length) return s
          kfs[index] = { ...kfs[index], timeMs: newTimeMs }
          kfs.sort((a, b) => a.timeMs - b.timeMs)
          return {
            project: {
              ...s.project,
              effects: { ...s.project.effects, zoomKeyframes: kfs },
            },
          }
        }),

      setCurrentTime: (ms) => set({ currentTime: ms }),
      setIsPlaying: (playing) => set({ isPlaying: playing }),

      // Sequence actions
      setSelectedClipIndex: (index) => set({ selectedClipIndex: index }),
      setActiveTool: (tool) => set({ activeTool: tool }),

      splitAtPlayhead: () =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const mapping = sequenceTimeToSourceTime(
            s.currentTime,
            sequence.clips,
            sequence.transitions
          )
          if (!mapping) return s

          const clip = sequence.clips[mapping.clipIndex]
          // Don't split at clip boundaries
          if (mapping.sourceTime <= clip.sourceStart || mapping.sourceTime >= clip.sourceEnd) {
            return s
          }

          const [left, right] = splitClip(clip, mapping.sourceTime)
          const newClips = [...sequence.clips]
          newClips.splice(mapping.clipIndex, 1, left, right)

          // Insert a null transition (cut) at the split point
          const newTransitions = [...sequence.transitions]
          newTransitions.splice(mapping.clipIndex, 0, null)

          return {
            project: {
              ...s.project,
              sequence: {
                ...sequence,
                clips: newClips,
                transitions: newTransitions,
              },
            },
          }
        }),

      rippleDelete: () =>
        set((s) => {
          if (!s.project || s.selectedClipIndex === null) return s
          const { sequence } = s.project
          const idx = s.selectedClipIndex
          if (idx < 0 || idx >= sequence.clips.length) return s
          if (sequence.clips.length <= 1) return s // don't delete last clip

          const newClips = [...sequence.clips]
          newClips.splice(idx, 1)

          const newTransitions = [...sequence.transitions]
          // Remove the transition to the left of the deleted clip, or to the right if first clip
          if (idx > 0) {
            newTransitions.splice(idx - 1, 1)
          } else if (newTransitions.length > 0) {
            newTransitions.splice(0, 1)
          }

          return {
            selectedClipIndex: null,
            project: {
              ...s.project,
              sequence: {
                ...sequence,
                clips: newClips,
                transitions: newTransitions,
              },
            },
          }
        }),

      liftDelete: () =>
        set((s) => {
          // Same as ripple delete for now — lift delete leaves a gap (future: replace with black)
          if (!s.project || s.selectedClipIndex === null) return s
          const { sequence } = s.project
          const idx = s.selectedClipIndex
          if (idx < 0 || idx >= sequence.clips.length) return s
          if (sequence.clips.length <= 1) return s

          const newClips = [...sequence.clips]
          newClips.splice(idx, 1)

          const newTransitions = [...sequence.transitions]
          if (idx > 0) {
            newTransitions.splice(idx - 1, 1)
          } else if (newTransitions.length > 0) {
            newTransitions.splice(0, 1)
          }

          return {
            selectedClipIndex: null,
            project: {
              ...s.project,
              sequence: {
                ...sequence,
                clips: newClips,
                transitions: newTransitions,
              },
            },
          }
        }),

      moveClip: (fromIndex, toIndex) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          if (fromIndex < 0 || fromIndex >= sequence.clips.length) return s
          if (toIndex < 0 || toIndex >= sequence.clips.length) return s
          if (fromIndex === toIndex) return s

          const newClips = [...sequence.clips]
          const [moved] = newClips.splice(fromIndex, 1)
          newClips.splice(toIndex, 0, moved)

          // Reset transitions to all cuts when reordering
          const newTransitions: (Transition | null)[] = new Array(
            Math.max(0, newClips.length - 1)
          ).fill(null)

          return {
            project: {
              ...s.project,
              sequence: {
                ...sequence,
                clips: newClips,
                transitions: newTransitions,
              },
            },
          }
        }),

      trimClipStart: (clipIndex, newSourceStart) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          // Enforce minimum 500ms clip duration
          const clamped = Math.min(newSourceStart, clip.sourceEnd - 500)
          const newClips = [...sequence.clips]
          newClips[clipIndex] = { ...clip, sourceStart: Math.max(0, clamped) }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      trimClipEnd: (clipIndex, newSourceEnd) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          // Enforce minimum 500ms clip duration
          const clamped = Math.max(newSourceEnd, clip.sourceStart + 500)
          const newClips = [...sequence.clips]
          newClips[clipIndex] = { ...clip, sourceEnd: clamped }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      addTransition: (index, transition) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          if (index < 0 || index >= sequence.transitions.length) return s
          const newTransitions = [...sequence.transitions]
          newTransitions[index] = transition
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, transitions: newTransitions },
            },
          }
        }),

      removeTransition: (index) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          if (index < 0 || index >= sequence.transitions.length) return s
          const newTransitions = [...sequence.transitions]
          newTransitions[index] = null
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, transitions: newTransitions },
            },
          }
        }),

      // Clip-scoped zoom actions
      addZoomKeyframeToClip: (clipIndex, kf) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          const filtered = clip.zoomKeyframes.filter((k) => k.timeMs !== kf.timeMs)
          const updated = [...filtered, kf].sort((a, b) => a.timeMs - b.timeMs)
          const newClips = [...sequence.clips]
          newClips[clipIndex] = { ...clip, zoomKeyframes: updated }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      removeZoomKeyframeFromClip: (clipIndex, timeMs) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          const newClips = [...sequence.clips]
          newClips[clipIndex] = {
            ...clip,
            zoomKeyframes: clip.zoomKeyframes.filter((k) => k.timeMs !== timeMs),
          }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      updateClipZoomKeyframe: (clipIndex, kfIndex, updates) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip || kfIndex < 0 || kfIndex >= clip.zoomKeyframes.length) return s
          const newKfs = [...clip.zoomKeyframes]
          newKfs[kfIndex] = { ...newKfs[kfIndex], ...updates }
          const newClips = [...sequence.clips]
          newClips[clipIndex] = { ...clip, zoomKeyframes: newKfs }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      clearClipZoomKeyframes: (clipIndex) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          const newClips = [...sequence.clips]
          newClips[clipIndex] = { ...clip, zoomKeyframes: [] }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      // Overlay actions
      addOverlayTrack: (type) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          if (sequence.overlayTracks.length >= 5) return s
          const track: OverlayTrack = {
            id: crypto.randomUUID(),
            type,
            locked: false,
            visible: true,
          }
          return {
            project: {
              ...s.project,
              sequence: {
                ...sequence,
                overlayTracks: [...sequence.overlayTracks, track],
              },
            },
          }
        }),

      removeOverlayTrack: (trackId) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          return {
            project: {
              ...s.project,
              sequence: {
                ...sequence,
                overlayTracks: sequence.overlayTracks.filter((t) => t.id !== trackId),
                overlays: sequence.overlays.filter((o) => o.trackId !== trackId),
              },
            },
          }
        }),

      addOverlay: (overlay) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const newOverlay: Overlay = { ...overlay, id: crypto.randomUUID() }
          return {
            project: {
              ...s.project,
              sequence: {
                ...sequence,
                overlays: [...sequence.overlays, newOverlay],
              },
            },
          }
        }),

      removeOverlay: (overlayId) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          return {
            project: {
              ...s.project,
              sequence: {
                ...sequence,
                overlays: sequence.overlays.filter((o) => o.id !== overlayId),
              },
            },
          }
        }),

      updateOverlay: (overlayId, updates) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          return {
            project: {
              ...s.project,
              sequence: {
                ...sequence,
                overlays: sequence.overlays.map((o) =>
                  o.id === overlayId ? { ...o, ...updates } : o
                ),
              },
            },
          }
        }),
    }),
    {
      // Only track project state for undo/redo (not playback)
      partialize: (state): TrackedState => ({
        project: state.project,
      }),
      limit: 100,
      // Throttle undo tracking so slider drags don't create
      // excessive history entries. Coalesces changes within 500ms.
      handleSet: (handleSet) => throttle(handleSet, 500),
    }
  )
)
