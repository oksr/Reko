import { useState } from "react"
import { Image, Maximize2 } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import { GRADIENT_PRESETS } from "@/types/editor"
import { SegmentedControl } from "./segmented-control"
import { StyledSlider } from "./styled-slider"
import { UnsplashBackgroundSection } from "./unsplash-background-section"
import { WallpaperSection } from "./wallpaper-section"

type TopTab = "wallpaper" | "unsplash" | "color"
type ColorSubTab = "solid" | "gradient"

function deriveTopTab(type: string): TopTab {
  if (type === "wallpaper" || type === "custom") return "wallpaper"
  if (type === "image") return "unsplash"
  return "color"
}

export function BackgroundPanel() {
  const background = useEditorStore((s) => s.project?.effects.background)
  const setBackground = useEditorStore((s) => s.setBackground)

  const topTab = background ? deriveTopTab(background.type) : "color"
  const [colorSubTab, setColorSubTab] = useState<ColorSubTab>(
    background?.type === "solid" ? "solid" : "gradient"
  )

  if (!background) return null

  const handleTopTabChange = (tab: TopTab) => {
    switch (tab) {
      case "wallpaper": setBackground({ type: "wallpaper" }); break
      case "unsplash":  setBackground({ type: "image" }); break
      case "color":     setBackground({ type: colorSubTab === "solid" ? "solid" : "gradient" }); break
    }
  }

  const handleColorSubTabChange = (sub: ColorSubTab) => {
    setColorSubTab(sub)
    setBackground({ type: sub === "solid" ? "solid" : "gradient" })
  }

  const handlePresetClick = (preset: typeof GRADIENT_PRESETS[number]) => {
    setBackground({
      type: "preset",
      gradientFrom: preset.from,
      gradientTo: preset.to,
      gradientAngle: preset.angle,
      presetId: preset.id,
    })
  }

  const showBlur = (topTab === "wallpaper" || topTab === "unsplash") && background.imageUrl

  return (
    <>
      {/* Tab bar */}
      <div className="px-4 pt-5 pb-4">
        <SegmentedControl
          options={[
            { value: "wallpaper" as TopTab, label: "Wallpaper" },
            { value: "unsplash" as TopTab, label: "Unsplash" },
            { value: "color" as TopTab, label: "Color" },
          ]}
          value={topTab}
          onChange={handleTopTabChange}
        />
      </div>

      {/* Section header */}
      <div className="px-4 pb-3 flex items-center gap-2.5">
        <Image className="size-3.5 text-white/60 shrink-0" />
        <span className="text-[13px] font-semibold text-white leading-none">
          {topTab === "wallpaper" ? "Wallpaper"
            : topTab === "unsplash" ? "Unsplash"
            : "Color"}
        </span>
      </div>

      {/* Content */}
      <div className="px-4 pb-2">
        {topTab === "wallpaper" && <WallpaperSection />}
        {topTab === "unsplash" && <UnsplashBackgroundSection />}

        {topTab === "color" && (
          <div className="space-y-4">
            <SegmentedControl
              options={[
                { value: "solid" as ColorSubTab, label: "Solid" },
                { value: "gradient" as ColorSubTab, label: "Gradient" },
              ]}
              value={background.type === "solid" ? "solid" : "gradient"}
              onChange={handleColorSubTabChange}
            />

            {(background.type === "gradient" || background.type === "preset") && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-2">
                  {GRADIENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className={`aspect-square rounded-[10px] transition-all duration-150 ${
                        background.presetId === preset.id
                          ? "ring-2 ring-violet-400 ring-offset-1 ring-offset-black scale-[1.04]"
                          : "hover:scale-[1.06] hover:ring-1 hover:ring-white/20"
                      }`}
                      style={{ background: `linear-gradient(${preset.angle}deg, ${preset.from}, ${preset.to})` }}
                      onClick={() => handlePresetClick(preset)}
                      title={preset.name}
                    />
                  ))}
                </div>

                <div className="flex gap-3">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-[12px] text-white/40">From</label>
                    <input
                      type="color"
                      value={background.gradientFrom}
                      onChange={(e) => setBackground({ gradientFrom: e.target.value, presetId: null, type: "gradient" })}
                      className="w-full h-8 rounded-[8px] cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
                    />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <label className="text-[12px] text-white/40">To</label>
                    <input
                      type="color"
                      value={background.gradientTo}
                      onChange={(e) => setBackground({ gradientTo: e.target.value, presetId: null, type: "gradient" })}
                      className="w-full h-8 rounded-[8px] cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">Angle</span>
                    <span className="text-[11px] tabular-nums">{background.gradientAngle}°</span>
                  </div>
                  <StyledSlider min={0} max={360} value={background.gradientAngle} onChange={(v) => setBackground({ gradientAngle: v })} />
                </div>
              </div>
            )}

            {background.type === "solid" && (
              <div className="space-y-1.5">
                <label className="text-[12px] text-white/40">Color</label>
                <input
                  type="color"
                  value={background.color}
                  onChange={(e) => setBackground({ color: e.target.value })}
                  className="w-full h-9 rounded-[8px] cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
                />
              </div>
            )}
          </div>
        )}

        {topTab === "unsplash" && background.unsplashAuthor && (
          <p className="text-[11px] text-white/25 mt-3">
            Photo by {background.unsplashAuthor} on{" "}
            <a href="https://unsplash.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/45">
              Unsplash
            </a>
          </p>
        )}
      </div>

      {/* Padding section */}
      <div className="border-t border-white/[0.07] mx-4 mt-3" />
      <div className="px-4 pt-4 pb-5 space-y-3">
        <div className="flex items-center gap-2.5">
          <Maximize2 className="size-3.5 text-white/60 shrink-0" />
          <span className="text-[13px] font-semibold text-white leading-none">Padding</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/40">Amount</span>
            <span className="text-[11px] tabular-nums">{background.padding}%</span>
          </div>
          <StyledSlider
            min={0}
            max={20}
            value={background.padding}
            onChange={(v) => setBackground({ padding: v })}
            showReset={background.padding !== 0}
            onReset={() => setBackground({ padding: 0 })}
          />
        </div>
      </div>

      {/* Blur section (conditional) */}
      {showBlur && (
        <>
          <div className="border-t border-white/[0.07] mx-4" />
          <div className="px-4 pt-4 pb-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] font-semibold text-white leading-none">Blur</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/40">Amount</span>
                <span className="text-[11px] tabular-nums">{background.imageBlur}px</span>
              </div>
              <StyledSlider
                min={0}
                max={20}
                value={background.imageBlur}
                onChange={(v) => setBackground({ imageBlur: v })}
                showReset={background.imageBlur !== 0}
                onReset={() => setBackground({ imageBlur: 0 })}
              />
            </div>
          </div>
        </>
      )}
    </>
  )
}
