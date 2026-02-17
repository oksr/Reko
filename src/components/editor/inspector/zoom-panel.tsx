import { useEditorStore } from "@/stores/editor-store"
import { sourceTimeToSequenceTime } from "@/lib/sequence"
import { invoke } from "@tauri-apps/api/core"
import { useState } from "react"
import { Wand2, Plus, X, ChevronDown } from "lucide-react"
import type { ZoomEvent } from "@/types/editor"
import { DEFAULT_AUTO_ZOOM_SETTINGS } from "@/types/editor"

export function ZoomPanel() {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const selectedClipIndex = useEditorStore((s) => s.selectedClipIndex)
  const addZoomEvent = useEditorStore((s) => s.addZoomEvent)
  const removeZoomEvent = useEditorStore((s) => s.removeZoomEvent)
  const clearZoomEvents = useEditorStore((s) => s.clearZoomEvents)
  const setClipZoomEvents = useEditorStore((s) => s.setClipZoomEvents)
  const setAutoZoomSettings = useEditorStore((s) => s.setAutoZoomSettings)
  const [generating, setGenerating] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  if (!project) return null

  const settings = project.autoZoomSettings ?? DEFAULT_AUTO_ZOOM_SETTINGS
  const sequence = project.sequence
  const selectedClip = selectedClipIndex !== null ? sequence.clips[selectedClipIndex] : null
  const events = selectedClip?.zoomEvents ?? []

  const handleAutoZoom = async () => {
    if (selectedClipIndex === null) return
    setGenerating(true)
    try {
      const generated = await invoke<ZoomEvent[]>("generate_auto_zoom", {
        projectId: project.id,
        zoomScale: settings.zoomScale,
      })
      const clip = sequence.clips[selectedClipIndex]
      // Filter to events within this clip's source range and convert to clip-relative time
      const clipEvents = generated
        .filter((e) => e.timeMs >= clip.sourceStart && e.timeMs < clip.sourceEnd)
        .map((e) => ({ ...e, timeMs: e.timeMs - clip.sourceStart }))
      setClipZoomEvents(selectedClipIndex, clipEvents)
    } catch (e) {
      console.error("Auto-zoom failed:", e)
    }
    setGenerating(false)
  }

  const handleAddEvent = () => {
    if (selectedClipIndex === null || !selectedClip) return
    const clipSeqStart = sourceTimeToSequenceTime(
      selectedClip.sourceStart,
      selectedClipIndex,
      sequence.clips,
      sequence.transitions
    )
    const clipRelativeTime = Math.max(0, currentTime - clipSeqStart)

    const newEvent: ZoomEvent = {
      id: crypto.randomUUID(),
      timeMs: Math.max(0, Math.round(clipRelativeTime - 300)),
      durationMs: 1500,
      x: 0.5,
      y: 0.5,
      scale: 2.0,
    }

    addZoomEvent(selectedClipIndex, newEvent)
  }

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toString().padStart(2, "0")}`
  }

  return (
    <div className="space-y-4 py-4">
      <h3 className="text-[13px] font-semibold tracking-tight">Zoom</h3>

      {selectedClipIndex === null && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
          Select a clip to edit zoom events.
        </p>
      )}

      {selectedClipIndex !== null && (
        <>
          <div className="flex gap-1.5">
            <button
              className="flex items-center gap-1.5 flex-1 text-[11px] font-medium py-2 px-3 rounded-lg bg-white/[0.05] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
              onClick={handleAutoZoom}
              disabled={generating || !project.tracks.mouse_events}
            >
              <Wand2 className="w-3.5 h-3.5" />
              {generating ? "Generating..." : "Auto-Zoom"}
            </button>
            <button
              className="flex items-center justify-center w-9 text-[11px] rounded-lg bg-white/[0.05] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-colors"
              onClick={handleAddEvent}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {!project.tracks.mouse_events && (
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              No mouse events recorded. Re-record with Accessibility permission to enable auto-zoom.
            </p>
          )}

          {/* Auto-Zoom Settings */}
          <div className="rounded-lg bg-white/[0.03] overflow-hidden">
            <button
              className="flex items-center justify-between w-full text-[11px] text-muted-foreground px-3 py-2 hover:bg-white/[0.03] transition-colors"
              onClick={() => setShowSettings(!showSettings)}
            >
              <span>Auto-Zoom Settings</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showSettings ? "rotate-180" : ""}`} />
            </button>

            {showSettings && (
              <div className="px-3 pb-3 space-y-3">
                {/* Zoom Intensity */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-muted-foreground/70">Zoom Intensity</label>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{settings.zoomScale.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="1.5"
                    max="3.0"
                    step="0.1"
                    value={settings.zoomScale}
                    onChange={(e) => setAutoZoomSettings({ zoomScale: parseFloat(e.target.value) })}
                    className="w-full h-1 rounded-full appearance-none bg-white/10 accent-violet-400"
                  />
                </div>
              </div>
            )}
          </div>

          {events.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-muted-foreground">Events ({events.length})</label>
                <button
                  className="text-[10px] text-muted-foreground/60 hover:text-destructive transition-colors"
                  onClick={() => clearZoomEvents(selectedClipIndex)}
                >
                  Clear all
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-0.5 rounded-lg">
                {events.map((evt) => (
                  <div
                    key={evt.id}
                    className="flex items-center justify-between text-[11px] rounded-md px-2.5 py-1.5 bg-white/[0.03] hover:bg-white/[0.06] text-muted-foreground transition-colors"
                  >
                    <span className="font-mono tabular-nums">{formatTime(evt.timeMs)}</span>
                    <span className="tabular-nums">{evt.scale.toFixed(1)}x</span>
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums">{(evt.durationMs / 1000).toFixed(1)}s</span>
                    <button
                      className="p-0.5 rounded hover:bg-white/[0.1] text-muted-foreground/50 hover:text-foreground transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeZoomEvent(selectedClipIndex, evt.id)
                      }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
