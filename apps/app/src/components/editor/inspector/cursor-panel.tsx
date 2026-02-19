import { useEditorStore } from "@/stores/editor-store"
import { SegmentedControl } from "./segmented-control"
import { StyledSlider } from "./styled-slider"

export function CursorPanel() {
  const cursor = useEditorStore((s) => s.project?.effects.cursor)
  const hasMouseEvents = useEditorStore((s) => !!s.project?.tracks.mouse_events)
  const setCursor = useEditorStore((s) => s.setCursor)
  const setClickHighlight = useEditorStore((s) => s.setClickHighlight)

  if (!cursor) return null

  const clickHighlight = cursor.clickHighlight

  return (
    <div className="space-y-4 py-4">
      <h3 className="text-[13px] font-semibold tracking-tight">Cursor</h3>

      {!hasMouseEvents && (
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
          No mouse events recorded. Re-record with Accessibility permission to see cursor effects.
        </p>
      )}

      {hasMouseEvents && (
        <>
          {/* Cursor Highlight */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted-foreground">Cursor Highlight</label>
              <button
                className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                  cursor.enabled
                    ? "bg-violet-400/20 text-violet-300"
                    : "bg-white/[0.05] text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setCursor({ enabled: !cursor.enabled })}
              >
                {cursor.enabled ? "On" : "Off"}
              </button>
            </div>

            {cursor.enabled && (
              <>
                <SegmentedControl
                  options={[
                    { value: "highlight", label: "Highlight" },
                    { value: "spotlight", label: "Spotlight" },
                  ]}
                  value={cursor.type}
                  onChange={(v) => setCursor({ type: v })}
                />

                {/* Size */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-muted-foreground">Size</label>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{cursor.size}px</span>
                  </div>
                  <StyledSlider
                    min={20}
                    max={80}
                    step={1}
                    value={cursor.size}
                    onChange={(v) => setCursor({ size: v })}
                  />
                </div>

                {/* Opacity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-muted-foreground">Opacity</label>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(cursor.opacity * 100)}%</span>
                  </div>
                  <StyledSlider
                    min={0}
                    max={100}
                    step={5}
                    value={cursor.opacity * 100}
                    onChange={(v) => setCursor({ opacity: v / 100 })}
                  />
                </div>

                {/* Color (highlight mode only) */}
                {cursor.type === "highlight" && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-muted-foreground">Color</label>
                    <input
                      type="color"
                      value={cursor.color}
                      onChange={(e) => setCursor({ color: e.target.value })}
                      className="w-full h-8 rounded-md cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Click Highlight */}
          <div className="border-t border-white/[0.06] pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted-foreground">Click Highlight</label>
              <button
                className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                  clickHighlight?.enabled
                    ? "bg-violet-400/20 text-violet-300"
                    : "bg-white/[0.05] text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setClickHighlight({ enabled: !clickHighlight?.enabled })}
              >
                {clickHighlight?.enabled ? "On" : "Off"}
              </button>
            </div>

            {clickHighlight?.enabled && (
              <>
                {/* Click ring size */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-muted-foreground">Ring Size</label>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{clickHighlight.size}px</span>
                  </div>
                  <StyledSlider
                    min={5}
                    max={100}
                    step={1}
                    value={clickHighlight.size}
                    onChange={(v) => setClickHighlight({ size: v })}
                  />
                </div>

                {/* Click opacity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-muted-foreground">Opacity</label>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{Math.round(clickHighlight.opacity * 100)}%</span>
                  </div>
                  <StyledSlider
                    min={0}
                    max={100}
                    step={5}
                    value={clickHighlight.opacity * 100}
                    onChange={(v) => setClickHighlight({ opacity: v / 100 })}
                  />
                </div>

                {/* Click color */}
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">Color</label>
                  <input
                    type="color"
                    value={clickHighlight.color}
                    onChange={(e) => setClickHighlight({ color: e.target.value })}
                    className="w-full h-8 rounded-md cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none"
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
