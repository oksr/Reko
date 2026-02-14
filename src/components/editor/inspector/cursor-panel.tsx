import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorStore } from "@/stores/editor-store"
import { StyledSlider } from "./styled-slider"

export function CursorPanel() {
  const cursor = useEditorStore((s) => s.project?.effects.cursor)
  const hasMouseEvents = useEditorStore((s) => !!s.project?.tracks.mouse_events)
  const setCursor = useEditorStore((s) => s.setCursor)

  if (!cursor) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Cursor</h3>
        <Button
          size="sm"
          variant={cursor.enabled ? "default" : "ghost"}
          className="text-xs h-7 px-2"
          onClick={() => setCursor({ enabled: !cursor.enabled })}
        >
          {cursor.enabled ? "On" : "Off"}
        </Button>
      </div>

      {!hasMouseEvents && (
        <p className="text-xs text-muted-foreground">
          No mouse events recorded. Re-record with Accessibility permission to see cursor effects.
        </p>
      )}

      {cursor.enabled && hasMouseEvents && (
        <>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={cursor.type === "highlight" ? "default" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setCursor({ type: "highlight" })}
            >
              Highlight
            </Button>
            <Button
              size="sm"
              variant={cursor.type === "spotlight" ? "default" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setCursor({ type: "spotlight" })}
            >
              Spotlight
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Size: {cursor.size}px</Label>
            <StyledSlider
              min={20}
              max={80}
              step={1}
              value={cursor.size}
              onChange={(v) => setCursor({ size: v })}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Opacity: {Math.round(cursor.opacity * 100)}%</Label>
            <StyledSlider
              min={0}
              max={100}
              step={5}
              value={cursor.opacity * 100}
              onChange={(v) => setCursor({ opacity: v / 100 })}
            />
          </div>

          {cursor.type === "highlight" && (
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <Input
                type="color"
                value={cursor.color}
                onChange={(e) => setCursor({ color: e.target.value })}
                className="h-8"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
