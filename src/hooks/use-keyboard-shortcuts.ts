import { useEffect } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { useVideoSync } from "@/hooks/use-video-sync"

const SEEK_STEP_MS = 1000

export function useKeyboardShortcuts(videoSync: ReturnType<typeof useVideoSync>) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return

      const { undo, redo } = useEditorStore.temporal.getState()
      const state = useEditorStore.getState()

      if (e.code === "Space") {
        e.preventDefault()
        if (state.isPlaying) {
          videoSync.pause()
          useEditorStore.getState().setIsPlaying(false)
        } else {
          videoSync.play()
          useEditorStore.getState().setIsPlaying(true)
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault()
        undo()
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault()
        redo()
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault()
        const newTime = Math.max(0, state.currentTime - SEEK_STEP_MS)
        videoSync.seek(newTime)
        useEditorStore.getState().setCurrentTime(newTime)
      }

      if (e.key === "ArrowRight" && state.project) {
        e.preventDefault()
        const newTime = Math.min(
          state.project.timeline.duration_ms,
          state.currentTime + SEEK_STEP_MS
        )
        videoSync.seek(newTime)
        useEditorStore.getState().setCurrentTime(newTime)
      }

      // I — set in point (clamping handled by store)
      if (e.key === "i" && !e.metaKey && !e.ctrlKey) {
        useEditorStore.getState().setInPoint(state.currentTime)
      }

      // O — set out point (clamping handled by store)
      if (e.key === "o" && !e.metaKey && !e.ctrlKey) {
        useEditorStore.getState().setOutPoint(state.currentTime)
      }

      // Cmd+K — split at playhead
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        useEditorStore.getState().splitAtPlayhead()
      }

      // V — select tool
      if (e.key === "v" && !e.metaKey && !e.ctrlKey) {
        useEditorStore.getState().setActiveTool("select")
      }

      // C — razor tool
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        useEditorStore.getState().setActiveTool("razor")
      }

      // Z — zoom tool (only without modifiers to avoid conflict with undo)
      if (e.key === "z" && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        useEditorStore.getState().setActiveTool("zoom")
      }

      // Delete / Backspace — ripple delete selected clip
      if (e.key === "Delete" || e.key === "Backspace") {
        if (state.selectedClipIndex !== null) {
          e.preventDefault()
          if (e.shiftKey) {
            useEditorStore.getState().liftDelete()
          } else {
            useEditorStore.getState().rippleDelete()
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [videoSync])
}
