import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/stores/editor-store"
import { sourceTimeToSequenceTime } from "@/lib/sequence"
import { invoke } from "@tauri-apps/api/core"
import { useState } from "react"
import { Wand2, Plus, Trash2 } from "lucide-react"
import type { ZoomKeyframe } from "@/types/editor"

export function ZoomPanel() {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const selectedClipIndex = useEditorStore((s) => s.selectedClipIndex)
  const addZoomKeyframeToClip = useEditorStore((s) => s.addZoomKeyframeToClip)
  const removeZoomKeyframeFromClip = useEditorStore((s) => s.removeZoomKeyframeFromClip)
  const clearClipZoomKeyframes = useEditorStore((s) => s.clearClipZoomKeyframes)
  const selectedZoomIndex = useEditorStore((s) => s.selectedZoomIndex)
  const setSelectedZoomIndex = useEditorStore((s) => s.setSelectedZoomIndex)
  const [generating, setGenerating] = useState(false)

  if (!project) return null

  const sequence = project.sequence
  const selectedClip = selectedClipIndex !== null ? sequence.clips[selectedClipIndex] : null
  const keyframes = selectedClip?.zoomKeyframes ?? []

  const handleAutoZoom = async () => {
    if (selectedClipIndex === null) return
    setGenerating(true)
    try {
      const kfs = await invoke<ZoomKeyframe[]>("generate_auto_zoom", {
        projectId: project.id,
      })
      // Filter keyframes to those within the selected clip's source range
      const clip = sequence.clips[selectedClipIndex]
      const clipRelativeKfs = kfs
        .filter((kf) => kf.timeMs >= clip.sourceStart && kf.timeMs < clip.sourceEnd)
        .map((kf) => ({ ...kf, timeMs: kf.timeMs - clip.sourceStart }))
      // Replace clip's keyframes
      clearClipZoomKeyframes(selectedClipIndex)
      for (const kf of clipRelativeKfs) {
        addZoomKeyframeToClip(selectedClipIndex, kf)
      }
    } catch (e) {
      console.error("Auto-zoom failed:", e)
    }
    setGenerating(false)
  }

  const handleAddKeyframe = () => {
    if (selectedClipIndex === null || !selectedClip) return
    const clipSeqStart = sourceTimeToSequenceTime(
      selectedClip.sourceStart,
      selectedClipIndex,
      sequence.clips,
      sequence.transitions
    )
    const clipRelativeTime = Math.max(0, currentTime - clipSeqStart)
    addZoomKeyframeToClip(selectedClipIndex, {
      timeMs: Math.round(clipRelativeTime),
      x: 0.5,
      y: 0.5,
      scale: 1.5,
      easing: "ease-in-out",
      durationMs: 500,
    })
  }

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toString().padStart(2, "0")}`
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Zoom</h3>

      {selectedClipIndex === null && (
        <p className="text-xs text-muted-foreground">
          Select a clip to edit zoom keyframes.
        </p>
      )}

      {selectedClipIndex !== null && (
        <>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 flex-1"
              onClick={handleAutoZoom}
              disabled={generating || !project.tracks.mouse_events}
            >
              <Wand2 className="w-3 h-3 mr-1" />
              {generating ? "Generating..." : "Auto-Zoom"}
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleAddKeyframe}>
              <Plus className="w-3 h-3" />
            </Button>
          </div>

          {!project.tracks.mouse_events && (
            <p className="text-xs text-muted-foreground">
              No mouse events recorded. Re-record with Accessibility permission to enable auto-zoom.
            </p>
          )}

          {keyframes.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Keyframes ({keyframes.length})</Label>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {keyframes.map((kf, i) => (
                  <div
                    key={kf.timeMs}
                    className={`flex items-center justify-between text-xs rounded px-2 py-1 cursor-pointer ${
                      selectedZoomIndex === i ? "bg-primary/20 ring-1 ring-primary" : "bg-muted/50 hover:bg-muted"
                    }`}
                    onClick={() => setSelectedZoomIndex(i)}
                  >
                    <span className="font-mono">{formatTime(kf.timeMs)}</span>
                    <span>{kf.scale}x</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0"
                      onClick={() => removeZoomKeyframeFromClip(selectedClipIndex, kf.timeMs)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {keyframes.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7 text-destructive"
              onClick={() => clearClipZoomKeyframes(selectedClipIndex)}
            >
              Clear All
            </Button>
          )}
        </>
      )}
    </div>
  )
}
