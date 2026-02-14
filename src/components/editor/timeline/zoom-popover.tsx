import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useEditorStore } from "@/stores/editor-store"
import { Trash2 } from "lucide-react"
import type { ZoomKeyframe } from "@/types/editor"

interface ZoomPopoverProps {
  segment: ZoomKeyframe
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function ZoomPopover({ segment, index, open, onOpenChange, children }: ZoomPopoverProps) {
  const updateZoomKeyframe = useEditorStore((s) => s.updateZoomKeyframe)
  const removeZoomKeyframe = useEditorStore((s) => s.removeZoomKeyframe)

  const handleDelete = () => {
    removeZoomKeyframe(segment.timeMs)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent side="top" align="center" className="w-56 p-3 space-y-3">
        {/* Scale slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Scale</Label>
            <span className="text-xs font-mono text-muted-foreground">{segment.scale.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={1.1}
            max={3.0}
            step={0.1}
            value={segment.scale}
            onChange={(e) => updateZoomKeyframe(index, { scale: parseFloat(e.target.value) })}
            className="w-full h-1.5 accent-primary"
          />
        </div>

        {/* Easing select */}
        <div className="space-y-1">
          <Label className="text-xs">Easing</Label>
          <select
            value={segment.easing}
            onChange={(e) => updateZoomKeyframe(index, { easing: e.target.value as ZoomKeyframe["easing"] })}
            className="w-full text-xs bg-muted border border-border rounded px-2 py-1"
          >
            <option value="ease-in-out">Ease In-Out</option>
            <option value="ease-in">Ease In</option>
            <option value="ease-out">Ease Out</option>
            <option value="linear">Linear</option>
          </select>
        </div>

        {/* Delete */}
        <Button size="sm" variant="destructive" className="w-full h-7 text-xs" onClick={handleDelete}>
          <Trash2 className="w-3 h-3 mr-1" /> Delete Segment
        </Button>
      </PopoverContent>
    </Popover>
  )
}
