import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorStore } from "@/stores/editor-store"
import { StyledSlider } from "./styled-slider"

export function CameraPanel() {
  const cameraBubble = useEditorStore((s) => s.project?.effects.cameraBubble)
  const hasCameraTrack = useEditorStore((s) => !!s.project?.tracks.camera)
  const setCameraBubble = useEditorStore((s) => s.setCameraBubble)

  if (!cameraBubble || !hasCameraTrack) return null

  const positions = ["bottom-right", "bottom-left", "top-right", "top-left"] as const

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Camera</h3>
        <Button
          size="sm"
          variant={cameraBubble.visible ? "default" : "ghost"}
          className="text-xs h-7 px-2"
          onClick={() => setCameraBubble({ visible: !cameraBubble.visible })}
        >
          {cameraBubble.visible ? "On" : "Off"}
        </Button>
      </div>

      {cameraBubble.visible && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Position</Label>
            <div className="grid grid-cols-2 gap-1">
              {positions.map((pos) => (
                <Button
                  key={pos}
                  size="sm"
                  variant={cameraBubble.position === pos ? "default" : "ghost"}
                  className="text-[10px] h-7 px-2"
                  onClick={() => setCameraBubble({ position: pos })}
                >
                  {pos.replace("-", " ")}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Size: {cameraBubble.size}%</Label>
            <StyledSlider
              min={5}
              max={30}
              value={cameraBubble.size}
              onChange={(v) => setCameraBubble({ size: v })}
            />
          </div>

          <div className="flex gap-1">
            <Button
              size="sm"
              variant={cameraBubble.shape === "circle" ? "default" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setCameraBubble({ shape: "circle" })}
            >
              Circle
            </Button>
            <Button
              size="sm"
              variant={cameraBubble.shape === "rounded" ? "default" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setCameraBubble({ shape: "rounded" })}
            >
              Rounded
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Border Color</Label>
            <Input
              type="color"
              value={cameraBubble.borderColor}
              onChange={(e) => setCameraBubble({ borderColor: e.target.value })}
              className="h-8 w-full"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Border: {cameraBubble.borderWidth}px</Label>
            <StyledSlider
              min={0}
              max={8}
              value={cameraBubble.borderWidth}
              onChange={(v) => setCameraBubble({ borderWidth: v })}
            />
          </div>
        </>
      )}
    </div>
  )
}
