import { usePlatform } from "@/platform/PlatformContext"
import { useEditorStore } from "@/stores/editor-store"
import { sourceTimeToSequenceTime } from "@/lib/sequence"
import { useState } from "react"
import { Wand2, Plus, X, ChevronDown, ZoomIn } from "lucide-react"
import type { ZoomEvent } from "@/types/editor"
import { DEFAULT_AUTO_ZOOM_SETTINGS } from "@/types/editor"

export function ZoomPanel() {
  const platform = usePlatform()
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
      const generated = await platform.invoke<ZoomEvent[]>("generate_auto_zoom", {
        projectId: project.id,
        zoomScale: settings.zoomScale,
      })
      const clip = sequence.clips[selectedClipIndex]
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
    <div className="px-4 pt-4 pb-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <ZoomIn className="size-3.5 text-white/60 shrink-0" />
        <span className="text-[13px] font-semibold text-white leading-none">Zoom</span>
      </div>

      {selectedClipIndex === null ? (
        <p className="text-[12px] text-white/30 leading-relaxed">
          Select a clip in the timeline to edit zoom events.
        </p>
      ) : (
        <>
          {/* Action buttons */}
          <div className="flex gap-1.5">
            <button
              className="flex items-center gap-1.5 flex-1 text-[13px] font-medium py-2 px-3 rounded-[10px] bg-white/[0.06] hover:bg-white/[0.09] text-white/60 hover:text-white transition-all disabled:opacity-30 disabled:pointer-events-none"
              onClick={handleAutoZoom}
              disabled={generating || !project.tracks.mouse_events}
            >
              <Wand2 className="w-3.5 h-3.5" />
              {generating ? "Generating…" : "Auto-Zoom"}
            </button>
            <button
              className="flex items-center justify-center w-[38px] rounded-[10px] bg-white/[0.06] hover:bg-white/[0.09] text-white/60 hover:text-white transition-all"
              onClick={handleAddEvent}
              title="Add zoom event at playhead"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {!project.tracks.mouse_events && (
            <p className="text-[12px] text-white/30 leading-relaxed">
              No mouse events. Re-record with Accessibility permission for auto-zoom.
            </p>
          )}

          {/* Settings accordion */}
          <div className="rounded-[10px] bg-white/[0.04] overflow-hidden">
            <button
              className="flex items-center justify-between w-full px-3.5 py-2.5 text-left"
              onClick={() => setShowSettings(!showSettings)}
            >
              <span className="text-[13px] text-white/50">Auto-Zoom Settings</span>
              <ChevronDown className={`w-3.5 h-3.5 text-white/30 transition-transform duration-200 ${showSettings ? "rotate-180" : ""}`} />
            </button>

            {showSettings && (
              <div className="px-3.5 pb-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-white/40">Zoom Intensity</span>
                  <span className="text-[12px] text-white font-semibold tabular-nums">{settings.zoomScale.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="1.5"
                  max="3.0"
                  step="0.1"
                  value={settings.zoomScale}
                  onChange={(e) => setAutoZoomSettings({ zoomScale: parseFloat(e.target.value) })}
                  className="w-full h-1 rounded-full appearance-none bg-white/10 accent-violet-500"
                />
              </div>
            )}
          </div>

          {/* Events list */}
          {events.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-white/40">Events ({events.length})</span>
                <button
                  className="text-[11px] text-white/25 hover:text-red-400 transition-colors"
                  onClick={() => clearZoomEvents(selectedClipIndex)}
                >
                  Clear all
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-0.5 rounded-[10px] overflow-hidden">
                {events.map((evt) => (
                  <div
                    key={evt.id}
                    className="flex items-center justify-between px-3 py-2 bg-white/[0.04] hover:bg-white/[0.07] text-white/50 transition-colors"
                  >
                    <span className="text-[12px] font-mono tabular-nums">{formatTime(evt.timeMs)}</span>
                    <span className="text-[12px] tabular-nums">{evt.scale.toFixed(1)}x</span>
                    <span className="text-[11px] text-white/25 tabular-nums flex-1 text-right mr-2">{(evt.durationMs / 1000).toFixed(1)}s</span>
                    <button
                      className="p-1 rounded hover:bg-white/[0.1] text-white/25 hover:text-white/60 transition-colors"
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
