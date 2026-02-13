import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorStore } from "@/stores/editor-store"
import { GRADIENT_PRESETS } from "@/types/editor"
import { StyledSlider } from "./styled-slider"

export function BackgroundPanel() {
  const background = useEditorStore((s) => s.project?.effects.background)
  const setBackground = useEditorStore((s) => s.setBackground)

  if (!background) return null

  const handlePresetClick = (preset: typeof GRADIENT_PRESETS[number]) => {
    setBackground({
      type: "preset",
      gradientFrom: preset.from,
      gradientTo: preset.to,
      gradientAngle: preset.angle,
      presetId: preset.id,
    })
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Background</h3>

      <div className="flex gap-1">
        <Button
          size="sm"
          variant={background.type === "solid" ? "default" : "ghost"}
          className="text-xs h-7 px-2"
          onClick={() => setBackground({ type: "solid" })}
        >
          Solid
        </Button>
        <Button
          size="sm"
          variant={background.type === "gradient" ? "default" : "ghost"}
          className="text-xs h-7 px-2"
          onClick={() => setBackground({ type: "gradient" })}
        >
          Gradient
        </Button>
      </div>

      {/* Gradient presets — 8 curated swatches */}
      {(background.type === "gradient" || background.type === "preset") && (
        <div className="space-y-2">
          <Label className="text-xs">Presets</Label>
          <div className="grid grid-cols-4 gap-1.5">
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={`h-8 rounded-md border-2 transition-all ${
                  background.presetId === preset.id
                    ? "border-primary scale-105"
                    : "border-transparent hover:border-muted-foreground/30"
                }`}
                style={{
                  background: `linear-gradient(${preset.angle}deg, ${preset.from}, ${preset.to})`,
                }}
                onClick={() => handlePresetClick(preset)}
                title={preset.name}
              />
            ))}
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="color"
                value={background.gradientFrom}
                onChange={(e) => setBackground({ gradientFrom: e.target.value, presetId: null, type: "gradient" })}
                className="h-8"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="color"
                value={background.gradientTo}
                onChange={(e) => setBackground({ gradientTo: e.target.value, presetId: null, type: "gradient" })}
                className="h-8"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Angle: {background.gradientAngle}&deg;</Label>
            <StyledSlider
              min={0}
              max={360}
              value={background.gradientAngle}
              onChange={(v) => setBackground({ gradientAngle: v })}
            />
          </div>
        </div>
      )}

      {background.type === "solid" && (
        <div className="space-y-1">
          <Label className="text-xs">Color</Label>
          <Input
            type="color"
            value={background.color}
            onChange={(e) => setBackground({ color: e.target.value })}
            className="h-8 w-full"
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Padding: {background.padding}%</Label>
        <StyledSlider
          min={0}
          max={20}
          value={background.padding}
          onChange={(v) => setBackground({ padding: v })}
        />
      </div>
    </div>
  )
}
