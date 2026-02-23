import { Video } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import { SegmentedControl } from "./segmented-control"
import { StyledSlider } from "./styled-slider"
import { ToggleSwitch } from "./toggle-switch"

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
    <div className="px-4 pt-4 pb-5 space-y-4">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Video className="size-3.5 text-white/60 shrink-0" />
          <span className="text-[13px] font-semibold text-white leading-none">Camera</span>
        </div>
        <ToggleSwitch
          checked={cameraBubble.visible}
          onChange={(v) => setCameraBubble({ visible: v })}
        />
      </div>

      {cameraBubble.visible && (
        <>
          {/* Position */}
          <div className="space-y-2">
            <span className="text-[11px] text-white/40 block">Position</span>
            <div className="grid grid-cols-4 gap-1.5">
              {positions.map((pos) => (
                <button
                  key={pos.value}
                  className={`text-[11px] font-semibold py-2 rounded-[8px] transition-all duration-150 ${
                    cameraBubble.position === pos.value
                      ? "bg-white/[0.14] text-white"
                      : "bg-white/[0.05] text-white/40 hover:bg-white/[0.09] hover:text-white/65"
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
              <span className="text-[11px] text-white/40">Size</span>
              <span className="text-[11px] tabular-nums">{cameraBubble.size}%</span>
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
            <span className="text-[11px] text-white/40 block">Border</span>
            <div className="flex gap-2.5 items-center">
              <input
                type="color"
                value={cameraBubble.borderColor}
                onChange={(e) => setCameraBubble({ borderColor: e.target.value })}
                className="w-9 h-9 rounded-[8px] cursor-pointer border border-white/[0.08] bg-transparent shrink-0 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
              />
              <div className="flex-1">
                <StyledSlider
                  min={0}
                  max={8}
                  value={cameraBubble.borderWidth}
                  onChange={(v) => setCameraBubble({ borderWidth: v })}
                />
              </div>
              <span className="text-[11px] tabular-nums shrink-0 w-7 text-right">{cameraBubble.borderWidth}px</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
