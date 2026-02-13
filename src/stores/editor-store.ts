import { create } from "zustand"
import { temporal } from "zundo"
import type { EditorProject, Effects, BackgroundConfig, CameraBubbleConfig, FrameConfig } from "@/types/editor"

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
}

interface EditorState {
  // Project data
  project: EditorProject | null

  // Playback state (NOT tracked by undo)
  currentTime: number
  isPlaying: boolean

  // Actions
  loadProject: (project: EditorProject) => void
  setInPoint: (ms: number) => void
  setOutPoint: (ms: number) => void
  setBackground: (bg: Partial<BackgroundConfig>) => void
  setCameraBubble: (config: Partial<CameraBubbleConfig>) => void
  setFrame: (config: Partial<FrameConfig>) => void
  setCurrentTime: (ms: number) => void
  setIsPlaying: (playing: boolean) => void
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
    (set) => ({
      project: null,
      currentTime: 0,
      isPlaying: false,

      loadProject: (project) => {
        // Ensure project has effects
        const withEffects: EditorProject = {
          ...project,
          effects: project.effects ?? { ...DEFAULT_EFFECTS },
        }
        set({ project: withEffects, currentTime: 0, isPlaying: false })
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

      setCurrentTime: (ms) => set({ currentTime: ms }),
      setIsPlaying: (playing) => set({ isPlaying: playing }),
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
