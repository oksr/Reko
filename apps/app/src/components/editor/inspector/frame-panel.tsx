import { SquareDashed, Layers2 } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import { StyledSlider } from "./styled-slider"
import { ToggleSwitch } from "./toggle-switch"

export function FramePanel() {
  const frame = useEditorStore((s) => s.project?.effects.frame)
  const setFrame = useEditorStore((s) => s.setFrame)

  if (!frame) return null

  return (
    <>
      {/* Rounded corners */}
      <div className="px-4 pt-4 pb-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <SquareDashed className="size-3.5 text-white/60 shrink-0" />
          <span className="text-[13px] font-semibold text-white leading-none">Rounded corners</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/40">Radius</span>
            <span className="text-[11px] tabular-nums">{frame.borderRadius}</span>
          </div>
          <StyledSlider
            min={0}
            max={96}
            value={frame.borderRadius}
            onChange={(v) => setFrame({ borderRadius: v })}
            showReset={frame.borderRadius !== 12}
            onReset={() => setFrame({ borderRadius: 12 })}
          />
        </div>
      </div>

      {/* Shadow */}
      <div className="border-t border-white/[0.07] mx-4" />
      <div className="px-4 pt-4 pb-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Layers2 className="size-3.5 text-white/60 shrink-0" />
            <span className="text-[13px] font-semibold text-white leading-none">Shadow</span>
          </div>
          <ToggleSwitch checked={frame.shadow} onChange={(v) => setFrame({ shadow: v })} />
        </div>

        {frame.shadow && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/40">Intensity</span>
              <span className="text-[11px] tabular-nums">{Math.round(frame.shadowIntensity * 100)}%</span>
            </div>
            <StyledSlider
              min={0}
              max={100}
              value={frame.shadowIntensity * 100}
              onChange={(v) => setFrame({ shadowIntensity: v / 100 })}
            />
          </div>
        )}
      </div>
    </>
  )
}
