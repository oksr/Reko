import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Undo2, Redo2 } from "lucide-react"
import { ErrorBoundary } from "@/components/error-boundary"
import { useEditorStore } from "@/stores/editor-store"
import { useVideoSync } from "@/hooks/use-video-sync"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useAutoSave } from "@/hooks/use-auto-save"
import { PreviewCanvas } from "@/components/editor/preview-canvas"
import { PlaybackControls } from "@/components/editor/playback-controls"
import { Timeline } from "@/components/editor/timeline"
import { ExportButton } from "@/components/editor/export-button"
import { Inspector } from "@/components/editor/inspector"
import type { ProjectState } from "@/types"
import type { EditorProject } from "@/types/editor"

function EditorContent() {
  const [error, setError] = useState<string | null>(null)
  const project = useEditorStore((s) => s.project)
  const loadProject = useEditorStore((s) => s.loadProject)
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)

  const videoSync = useVideoSync({
    onTimeUpdate: setCurrentTime,
  })

  useKeyboardShortcuts(videoSync)
  useAutoSave()

  // Re-seek video when clip data changes (reorder, trim, speed) so preview
  // shows the correct frame for the current timeline position.
  // Use a fingerprint string so unrelated project mutations (background, etc.)
  // don't trigger spurious seeks.
  const clipFingerprint = useEditorStore((s) =>
    s.project?.sequence.clips
      .map((c) => `${c.id}:${c.sourceStart}:${c.sourceEnd}:${c.speed}`)
      .join("|")
  )
  const transitionFingerprint = useEditorStore((s) =>
    s.project?.sequence.transitions
      .map((t) => (t ? `${t.type}:${t.durationMs}` : "cut"))
      .join("|")
  )
  const prevClipFP = useRef(clipFingerprint)
  const prevTransFP = useRef(transitionFingerprint)
  useEffect(() => {
    if (prevClipFP.current === clipFingerprint && prevTransFP.current === transitionFingerprint) {
      prevClipFP.current = clipFingerprint
      prevTransFP.current = transitionFingerprint
      return
    }
    prevClipFP.current = clipFingerprint
    prevTransFP.current = transitionFingerprint
    if (useEditorStore.getState().isPlaying) return
    videoSync.seek(useEditorStore.getState().currentTime)
  }, [clipFingerprint, transitionFingerprint, videoSync])

  // Stable dependency array — loadProject is a zustand action (never changes)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const projectId = params.get("project")
    if (!projectId) {
      setError("No project ID")
      return
    }

    invoke<ProjectState>("load_project", { projectId })
      .then((p) => {
        // Cast to EditorProject — loadProject() handles migration
        // (sequence creation via migrateToSequence, effects defaults, etc.)
        const editorProject: EditorProject = {
          ...p,
          tracks: p.tracks,
          sequence: (p as unknown as EditorProject).sequence ?? {
            clips: [],
            transitions: [],
            overlayTracks: [],
            overlays: [],
          },
          effects: p.effects ?? {
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
              visible: !!p.tracks.camera,
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
              color: "#facc15",
              opacity: 0.5,
            },
            zoomKeyframes: [],
          },
        }
        loadProject(editorProject)
      })
      .catch((e) => setError(String(e)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  const handleUndo = () => useEditorStore.temporal.getState().undo()
  const handleRedo = () => useEditorStore.temporal.getState().redo()

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="h-12 border-b flex items-center px-4 gap-3 shrink-0">
        <h1 className="text-sm font-medium truncate">{project.name}</h1>
        <div className="flex-1" />
        <PlaybackControls videoSync={videoSync} />
        <Separator orientation="vertical" className="h-6" />
        <Button variant="ghost" size="icon" onClick={handleUndo} title="Undo (Cmd+Z)">
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleRedo} title="Redo (Cmd+Shift+Z)">
          <Redo2 className="w-4 h-4" />
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <ExportButton />
      </header>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Inspector */}
        <aside className="w-80 border-r overflow-y-auto p-4">
          <Inspector />
        </aside>

        {/* Preview */}
        <div className="flex-1 flex items-center justify-center p-6 bg-muted/20 overflow-hidden">
          <div className="w-full max-w-5xl">
            <PreviewCanvas videoSync={videoSync} />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="border-t shrink-0 px-4 py-3">
        <Timeline videoSync={videoSync} />
      </div>
    </div>
  )
}

export function EditorApp() {
  return (
    <ErrorBoundary>
      <EditorContent />
    </ErrorBoundary>
  )
}
