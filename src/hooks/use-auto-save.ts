import { useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useEditorStore } from "@/stores/editor-store"

const DEBOUNCE_MS = 2000

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
          invoke("save_project_state", { project }).catch(() => {})
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
          await invoke("save_project_state", { project: state.project })
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
