import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useEditorStore } from "@/stores/editor-store"
import { Trash2 } from "lucide-react"
import type { ZoomKeyframe } from "@/types/editor"
import type { ZoomRegion } from "./zoom-track"

interface ZoomPopoverProps {
  region: ZoomRegion
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void
  children: React.ReactNode
}

export function ZoomPopover({ region, index: _index, open, onOpenChange, onDelete, children }: ZoomPopoverProps) {
  const updateClipZoomKeyframe = useEditorStore((s) => s.updateClipZoomKeyframe)

  const handleDelete = () => {
    onDelete()
    onOpenChange(false)
  }

  // Update scale on all zoomed keyframes in the region
  const handleScaleChange = (newScale: number) => {
    for (const kf of region.keyframes) {
      if (kf.scale > 1.01) {
        updateClipZoomKeyframe(kf.clipIndex, kf.kfIndex, { scale: newScale })
      }
    }
  }

  // Update easing on all zoomed keyframes in the region
  const handleEasingChange = (newEasing: ZoomKeyframe["easing"]) => {
    for (const kf of region.keyframes) {
      if (kf.scale > 1.01) {
        updateClipZoomKeyframe(kf.clipIndex, kf.kfIndex, { easing: newEasing })
      }
    }
  }

  // Use the primary zoomed keyframe for display
  const primaryKf = region.keyframes.find((k) => k.scale > 1.01)
  const displayScale = primaryKf?.scale ?? region.peakScale
  const displayEasing = primaryKf?.easing ?? "spring"

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent side="top" align="center" className="w-56 p-3 space-y-3">
        {/* Scale slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Scale</Label>
            <span className="text-xs font-mono text-muted-foreground">{displayScale.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={1.1}
            max={3.0}
            step={0.1}
            value={displayScale}
            onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
            className="w-full h-1.5 accent-primary"
          />
        </div>

        {/* Easing select */}
        <div className="space-y-1">
          <Label className="text-xs">Easing</Label>
          <select
            value={displayEasing}
            onChange={(e) => handleEasingChange(e.target.value as ZoomKeyframe["easing"])}
            className="w-full text-xs bg-muted border border-border rounded px-2 py-1"
          >
            <option value="spring">Spring</option>
            <option value="ease-out">Ease Out</option>
            <option value="linear">Linear</option>
          </select>
        </div>

        {/* Delete */}
        <Button size="sm" variant="destructive" className="w-full h-7 text-xs" onClick={handleDelete}>
          <Trash2 className="w-3 h-3 mr-1" /> Delete Zoom
        </Button>
      </PopoverContent>
    </Popover>
  )
}
