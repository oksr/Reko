import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useEditorStore } from "@/stores/editor-store"
import { Trash2 } from "lucide-react"
import type { SequenceZoomEvent } from "./zoom-track"

interface ZoomPopoverProps {
  seqEvent: SequenceZoomEvent
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void
  children: React.ReactNode
}

export function ZoomPopover({ seqEvent, open, onOpenChange, onDelete, children }: ZoomPopoverProps) {
  const updateZoomEvent = useEditorStore((s) => s.updateZoomEvent)
  const { clipIndex, event } = seqEvent

  const handleDelete = () => {
    onDelete()
    onOpenChange(false)
  }

  const handleScaleChange = (newScale: number) => {
    updateZoomEvent(clipIndex, event.id, { scale: newScale })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        className="w-56 p-3 space-y-3"
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        {/* Scale slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Scale</Label>
            <span className="text-xs font-mono text-muted-foreground">{event.scale.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={1.1}
            max={3.0}
            step={0.1}
            value={event.scale}
            onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
            className="w-full h-1.5 accent-primary"
          />
        </div>

        {/* Delete */}
        <Button size="sm" variant="destructive" className="w-full h-7 text-xs" onClick={handleDelete}>
          <Trash2 className="w-3 h-3 mr-1" /> Delete Zoom
        </Button>
      </PopoverContent>
    </Popover>
  )
}
