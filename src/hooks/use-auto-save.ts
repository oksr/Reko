import { useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

const DEBOUNCE_MS = 2000

/** Round all millisecond fields to integers before sending to Rust (which expects u64) */
export function sanitizeProject(project: EditorProject): EditorProject {
  return {
    ...project,
    created_at: Math.round(project.created_at),
    timeline: {
      duration_ms: Math.round(project.timeline.duration_ms),
      in_point: Math.round(project.timeline.in_point),
      out_point: Math.round(project.timeline.out_point),
    },
    effects: {
      ...project.effects,
      zoomKeyframes: project.effects.zoomKeyframes.map((kf) => ({
        ...kf,
        timeMs: Math.round(kf.timeMs),
      })),
    },
    sequence: {
      ...project.sequence,
      clips: project.sequence.clips.map((clip) => ({
        ...clip,
        sourceStart: Math.round(clip.sourceStart),
        sourceEnd: Math.round(clip.sourceEnd),
        zoomKeyframes: clip.zoomKeyframes.map((kf) => ({
          ...kf,
          timeMs: Math.round(kf.timeMs),
        })),
      })),
      transitions: project.sequence.transitions.map((t) =>
        t ? { ...t, durationMs: Math.round(t.durationMs) } : t
      ),
      overlays: project.sequence.overlays.map((o) => ({
        ...o,
        startMs: Math.round(o.startMs),
        durationMs: Math.round(o.durationMs),
      })),
    },
  }
}

export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef<boolean>(false)

  useEffect(() => {
    // Flush save on window close
    const flushSave = () => {
      if (pendingSaveRef.current && timerRef.current) {
        clearTimeout(timerRef.current)
        const project = useEditorStore.getState().project
        if (project) {
          invoke("save_project_state", { project: sanitizeProject(project) }).catch(() => {})
        }
      }
    }
    window.addEventListener("beforeunload", flushSave)

    const unsub = useEditorStore.subscribe((state, prevState) => {
      if (state.project === prevState.project) return
      if (!state.project) return

      if (timerRef.current) clearTimeout(timerRef.current)
      pendingSaveRef.current = true

      timerRef.current = setTimeout(async () => {
        try {
          await invoke("save_project_state", { project: sanitizeProject(state.project!) })
          pendingSaveRef.current = false
        } catch (e) {
          console.error("Auto-save failed:", e)
        }
      }, DEBOUNCE_MS)
    })

    return () => {
      unsub()
      window.removeEventListener("beforeunload", flushSave)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])
}
