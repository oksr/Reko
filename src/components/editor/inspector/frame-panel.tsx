import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/stores/editor-store"
import { StyledSlider } from "./styled-slider"

export function FramePanel() {
  const frame = useEditorStore((s) => s.project?.effects.frame)
  const setFrame = useEditorStore((s) => s.setFrame)

  if (!frame) return null

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Frame</h3>

      <div className="space-y-1">
        <Label className="text-xs">Border Radius: {frame.borderRadius}px</Label>
        <StyledSlider
          min={0}
          max={48}
          value={frame.borderRadius}
          onChange={(v) => setFrame({ borderRadius: v })}
        />
      </div>

      <Button
        size="sm"
        variant={frame.shadow ? "default" : "ghost"}
        className="text-xs h-7 px-2"
        onClick={() => setFrame({ shadow: !frame.shadow })}
      >
        Shadow: {frame.shadow ? "On" : "Off"}
      </Button>

      {frame.shadow && (
        <div className="space-y-1">
          <Label className="text-xs">Intensity: {Math.round(frame.shadowIntensity * 100)}%</Label>
          <StyledSlider
            min={0}
            max={100}
            value={frame.shadowIntensity * 100}
            onChange={(v) => setFrame({ shadowIntensity: v / 100 })}
          />
        </div>
      )}
    </div>
  )
}
