import { MousePointer2, Sparkles } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import { CURSOR_ICONS } from "@/types/editor"
import { CURSOR_ICON_ASSETS } from "@/assets/cursors"
import { SegmentedControl } from "./segmented-control"
import { StyledSlider } from "./styled-slider"
import { ToggleSwitch } from "./toggle-switch"

export function CursorPanel() {
  const cursor = useEditorStore((s) => s.project?.effects.cursor)
  const hasMouseEvents = useEditorStore((s) => !!s.project?.tracks.mouse_events)
  const setCursor = useEditorStore((s) => s.setCursor)
  const setClickHighlight = useEditorStore((s) => s.setClickHighlight)

  if (!cursor) return null

  const clickHighlight = cursor.clickHighlight

  return (
    <>
      {/* Cursor icon section */}
      <div className="px-4 pt-4 pb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <MousePointer2 className="size-3.5 text-white/60 shrink-0" />
            <span className="text-[13px] font-semibold text-white leading-none">Cursor</span>
          </div>
          {hasMouseEvents && (
            <ToggleSwitch checked={cursor.enabled} onChange={(v) => setCursor({ enabled: v })} />
          )}
        </div>

        {!hasMouseEvents && (
          <p className="text-[12px] text-white/30 leading-relaxed">
            Re-record with Accessibility permission enabled.
          </p>
        )}

        {hasMouseEvents && cursor.enabled && (
          <>
            {/* Cursor icon picker */}
            <div className="space-y-2">
              <span className="text-[11px] text-white/40">Style</span>
              <div className="grid grid-cols-5 gap-2">
                {CURSOR_ICONS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setCursor({ icon: id })}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-colors ${
                      cursor.icon === id
                        ? "border-white/30 bg-white/[0.08]"
                        : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"
                    }`}
                  >
                    <img
                      src={CURSOR_ICON_ASSETS[id]}
                      alt={label}
                      className="size-6 object-contain"
                    />
                    <span className="text-[10px] text-white/50 leading-none">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Size slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/40">Size</span>
                <span className="text-[11px] tabular-nums">{cursor.size}px</span>
              </div>
              <StyledSlider min={16} max={64} step={1} value={cursor.size} onChange={(v) => setCursor({ size: v })} />
            </div>
          </>
        )}
      </div>

      {/* Cursor highlight section */}
      {hasMouseEvents && (
        <>
          <div className="border-t border-white/[0.07] mx-4" />
          <div className="px-4 pt-4 pb-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Sparkles className="size-3.5 text-white/60 shrink-0" />
                <span className="text-[13px] font-semibold text-white leading-none">Cursor highlight</span>
              </div>
              <ToggleSwitch checked={cursor.highlightEnabled} onChange={(v) => setCursor({ highlightEnabled: v })} />
            </div>

            {cursor.highlightEnabled && (
              <>
                <SegmentedControl
                  options={[
                    { value: "highlight", label: "Highlight" },
                    { value: "spotlight", label: "Spotlight" },
                  ]}
                  value={cursor.type}
                  onChange={(v) => setCursor({ type: v })}
                />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">Size</span>
                    <span className="text-[11px] tabular-nums">{cursor.highlightSize}px</span>
                  </div>
                  <StyledSlider min={20} max={80} step={1} value={cursor.highlightSize} onChange={(v) => setCursor({ highlightSize: v })} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">Opacity</span>
                    <span className="text-[11px] tabular-nums">{Math.round(cursor.opacity * 100)}%</span>
                  </div>
                  <StyledSlider min={0} max={100} step={5} value={cursor.opacity * 100} onChange={(v) => setCursor({ opacity: v / 100 })} />
                </div>

                {cursor.type === "highlight" && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">Color</span>
                    <input
                      type="color"
                      value={cursor.color}
                      onChange={(e) => setCursor({ color: e.target.value })}
                      className="w-9 h-9 rounded-[8px] cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Click highlight section */}
      {hasMouseEvents && (
        <>
          <div className="border-t border-white/[0.07] mx-4" />
          <div className="px-4 pt-4 pb-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-white leading-none">Click highlight</span>
              <ToggleSwitch
                checked={!!clickHighlight?.enabled}
                onChange={(v) => setClickHighlight({ enabled: v })}
              />
            </div>

            {clickHighlight?.enabled && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">Ring size</span>
                    <span className="text-[11px] tabular-nums">{clickHighlight.size}px</span>
                  </div>
                  <StyledSlider min={5} max={100} step={1} value={clickHighlight.size} onChange={(v) => setClickHighlight({ size: v })} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">Opacity</span>
                    <span className="text-[11px] tabular-nums">{Math.round(clickHighlight.opacity * 100)}%</span>
                  </div>
                  <StyledSlider min={0} max={100} step={5} value={clickHighlight.opacity * 100} onChange={(v) => setClickHighlight({ opacity: v / 100 })} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/40">Color</span>
                  <input
                    type="color"
                    value={clickHighlight.color}
                    onChange={(e) => setClickHighlight({ color: e.target.value })}
                    className="w-9 h-9 rounded-[8px] cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
