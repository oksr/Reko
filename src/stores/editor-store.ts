import { create } from "zustand"
import { temporal } from "zundo"
import type { EditorProject, Effects, BackgroundConfig, CameraBubbleConfig, FrameConfig, CursorConfig, ClickHighlightConfig, ZoomEvent, Transition, Sequence, OverlayTrack, Overlay, AutoZoomSettings } from "@/types/editor"
import { DEFAULT_AUTO_ZOOM_SETTINGS } from "@/types/editor"
import { createClip, splitClip, sequenceTimeToSourceTime } from "@/lib/sequence"

const DEFAULT_EFFECTS: Effects = {
  background: {
    type: "wallpaper",
    color: "#1a1a2e",
    gradientFrom: "#1a1a2e",
    gradientTo: "#16213e",
    gradientAngle: 135,
    padding: 4,
    imageUrl: null, // resolved at load time from wallpaperId
    imageBlur: 0,
    unsplashId: null,
    unsplashAuthor: null,
    presetId: null,
    wallpaperId: "12-Dark-thumbnail",
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
    borderRadius: 8,
    shadow: true,
    shadowIntensity: 0.7,
  },
  cursor: {
    enabled: false,
    type: "highlight",
    size: 40,
    color: "#ffcc00",
    opacity: 0.6,
    clickHighlight: {
      enabled: true,
      color: "#ffffff",
      opacity: 0.5,
      size: 30,
    },
  },
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
    project.timeline.out_point ?? project.timeline.duration_ms
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
  setClickHighlight: (config: Partial<ClickHighlightConfig>) => void
  selectedZoomEventId: string | null
  zoomPopoverOpen: boolean
  setSelectedZoomEventId: (id: string | null) => void
  setZoomPopoverOpen: (open: boolean) => void
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

  // Clip-scoped zoom event actions
  addZoomEvent: (clipIndex: number, event: ZoomEvent) => void
  removeZoomEvent: (clipIndex: number, eventId: string) => void
  updateZoomEvent: (clipIndex: number, eventId: string, updates: Partial<ZoomEvent>) => void
  setClipZoomEvents: (clipIndex: number, events: ZoomEvent[]) => void
  clearZoomEvents: (clipIndex: number) => void
  clampClipsToVideoDuration: (videoDurationMs: number) => void

  // Auto-zoom settings
  setAutoZoomSettings: (settings: Partial<AutoZoomSettings>) => void

  // Overlay actions
  addOverlayTrack: (type: OverlayTrack["type"]) => void
  removeOverlayTrack: (trackId: string) => void
  addOverlay: (overlay: Omit<Overlay, "id">) => void
  removeOverlay: (overlayId: string) => void
  updateOverlay: (overlayId: string, updates: Partial<Overlay>) => void
}

// State that gets tracked for undo/redo
type TrackedState = Pick<EditorState, "project">

/** Pause/resume undo tracking during continuous drags to avoid excessive history entries */
export function pauseUndo() { useEditorStore.temporal.getState().pause() }
export function resumeUndo() { useEditorStore.temporal.getState().resume() }

export const useEditorStore = create<EditorState>()(
  temporal(
    (set, _get) => ({
      project: null,
      currentTime: 0,
      isPlaying: false,
      selectedZoomEventId: null,
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
            background: { ...DEFAULT_EFFECTS.background, ...(project.effects?.background ?? {}) },
            cursor: {
              ...DEFAULT_EFFECTS.cursor,
              ...(project.effects?.cursor ?? {}),
              clickHighlight: { ...DEFAULT_EFFECTS.cursor.clickHighlight, ...(project.effects?.cursor?.clickHighlight ?? {}) },
            },
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

      setClickHighlight: (config) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: {
                ...s.project.effects,
                cursor: {
                  ...s.project.effects.cursor,
                  clickHighlight: { ...s.project.effects.cursor.clickHighlight, ...config },
                },
              },
            },
          }
        }),

      setSelectedZoomEventId: (id) => set({ selectedZoomEventId: id }),
      setZoomPopoverOpen: (open) => set({ zoomPopoverOpen: open }),

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

      // Clip-scoped zoom event actions
      addZoomEvent: (clipIndex, event) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          const updated = [...clip.zoomEvents, event].sort((a, b) => a.timeMs - b.timeMs)
          const newClips = [...sequence.clips]
          newClips[clipIndex] = { ...clip, zoomEvents: updated }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      removeZoomEvent: (clipIndex, eventId) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          const newClips = [...sequence.clips]
          newClips[clipIndex] = {
            ...clip,
            zoomEvents: clip.zoomEvents.filter((e) => e.id !== eventId),
          }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      updateZoomEvent: (clipIndex, eventId, updates) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          const newClips = [...sequence.clips]
          newClips[clipIndex] = {
            ...clip,
            zoomEvents: clip.zoomEvents.map((e) =>
              e.id === eventId ? { ...e, ...updates } : e
            ),
          }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      setClipZoomEvents: (clipIndex, events) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          const newClips = [...sequence.clips]
          newClips[clipIndex] = { ...clip, zoomEvents: events }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      clearZoomEvents: (clipIndex) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          const clip = sequence.clips[clipIndex]
          if (!clip) return s
          const newClips = [...sequence.clips]
          newClips[clipIndex] = { ...clip, zoomEvents: [] }
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: newClips },
            },
          }
        }),

      clampClipsToVideoDuration: (videoDurationMs) =>
        set((s) => {
          if (!s.project) return s
          const { sequence } = s.project
          let changed = false
          const newClips = sequence.clips.map((clip) => {
            if (clip.sourceEnd > videoDurationMs) {
              changed = true
              const clampedEnd = videoDurationMs
              // Ensure sourceStart doesn't exceed clamped sourceEnd (minimum 0ms duration)
              const clampedStart = Math.min(clip.sourceStart, clampedEnd)
              return { ...clip, sourceStart: clampedStart, sourceEnd: clampedEnd }
            }
            return clip
          })
          if (!changed) return s
          // Filter out zero-duration clips
          const validClips = newClips.filter((c) => c.sourceEnd > c.sourceStart)
          if (validClips.length === 0) return s // don't remove all clips
          return {
            project: {
              ...s.project,
              sequence: { ...sequence, clips: validClips },
            },
          }
        }),

      // Auto-zoom settings
      setAutoZoomSettings: (settings) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              autoZoomSettings: {
                ...(s.project.autoZoomSettings ?? DEFAULT_AUTO_ZOOM_SETTINGS),
                ...settings,
              },
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
      equality: (past, curr) => past.project === curr.project,
      limit: 100,
    }
  )
)
