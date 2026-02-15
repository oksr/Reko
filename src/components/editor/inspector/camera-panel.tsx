import { useEditorStore } from "@/stores/editor-store"
import { SegmentedControl } from "./segmented-control"
import { StyledSlider } from "./styled-slider"

export function CameraPanel() {
  const cameraBubble = useEditorStore((s) => s.project?.effects.cameraBubble)
  const hasCameraTrack = useEditorStore((s) => !!s.project?.tracks.camera)
  const setCameraBubble = useEditorStore((s) => s.setCameraBubble)

  if (!cameraBubble || !hasCameraTrack) return null

  const positions = [
    { value: "top-left" as const, label: "TL" },
    { value: "top-right" as const, label: "TR" },
    { value: "bottom-left" as const, label: "BL" },
    { value: "bottom-right" as const, label: "BR" },
  ]

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold tracking-tight">Camera</h3>
        <button
          className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
            cameraBubble.visible
              ? "bg-violet-400/20 text-violet-300"
              : "bg-white/[0.05] text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setCameraBubble({ visible: !cameraBubble.visible })}
        >
          {cameraBubble.visible ? "On" : "Off"}
        </button>
      </div>

      {cameraBubble.visible && (
        <>
          {/* Position grid */}
          <div className="space-y-2">
            <label className="text-[11px] text-muted-foreground">Position</label>
            <div className="grid grid-cols-4 gap-1">
              {positions.map((pos) => (
                <button
                  key={pos.value}
                  className={`text-[10px] font-medium py-1.5 rounded-md transition-all ${
                    cameraBubble.position === pos.value
                      ? "bg-white/[0.12] text-foreground"
                      : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]"
                  }`}
                  onClick={() => setCameraBubble({ position: pos.value })}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground">Size</label>
              <span className="text-[11px] text-muted-foreground tabular-nums">{cameraBubble.size}%</span>
            </div>
            <StyledSlider
              min={5}
              max={30}
              value={cameraBubble.size}
              onChange={(v) => setCameraBubble({ size: v })}
            />
          </div>

          {/* Shape */}
          <SegmentedControl
            options={[
              { value: "circle", label: "Circle" },
              { value: "rounded", label: "Rounded" },
            ]}
            value={cameraBubble.shape}
            onChange={(v) => setCameraBubble({ shape: v })}
          />

          {/* Border */}
          <div className="space-y-2">
            <label className="text-[11px] text-muted-foreground">Border</label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={cameraBubble.borderColor}
                onChange={(e) => setCameraBubble({ borderColor: e.target.value })}
                className="w-8 h-8 rounded-md cursor-pointer border border-white/[0.08] bg-transparent shrink-0 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-none"
              />
              <div className="flex-1">
                <StyledSlider
                  min={0}
                  max={8}
                  value={cameraBubble.borderWidth}
                  onChange={(v) => setCameraBubble({ borderWidth: v })}
                />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-6 text-right">{cameraBubble.borderWidth}px</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
