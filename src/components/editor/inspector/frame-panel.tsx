import { useEditorStore } from "@/stores/editor-store"
import { StyledSlider } from "./styled-slider"

export function FramePanel() {
  const frame = useEditorStore((s) => s.project?.effects.frame)
  const setFrame = useEditorStore((s) => s.setFrame)

  if (!frame) return null

  return (
    <div className="space-y-4 py-4">
      <h3 className="text-[13px] font-semibold tracking-tight">Frame</h3>

      {/* Border Radius */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-muted-foreground">Rounded corners</label>
          <span className="text-[11px] text-muted-foreground tabular-nums">{frame.borderRadius}px</span>
        </div>
        <StyledSlider
          min={0}
          max={48}
          value={frame.borderRadius}
          onChange={(v) => setFrame({ borderRadius: v })}
          showReset={frame.borderRadius !== 12}
          onReset={() => setFrame({ borderRadius: 12 })}
        />
      </div>

      {/* Shadow */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-muted-foreground">Shadow</label>
          <button
            className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
              frame.shadow
                ? "bg-violet-400/20 text-violet-300"
                : "bg-white/[0.05] text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setFrame({ shadow: !frame.shadow })}
          >
            {frame.shadow ? "On" : "Off"}
          </button>
        </div>

        {frame.shadow && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground">Intensity</label>
              <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(frame.shadowIntensity * 100)}%</span>
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
    </div>
  )
}
