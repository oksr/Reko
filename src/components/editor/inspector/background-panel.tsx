import { useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { GRADIENT_PRESETS } from "@/types/editor"
import { SegmentedControl } from "./segmented-control"
import { StyledSlider } from "./styled-slider"
import { UnsplashBackgroundSection } from "./unsplash-background-section"
import { WallpaperSection } from "./wallpaper-section"
import { CustomBackgroundSection } from "./custom-background-section"

type TopTab = "wallpaper" | "unsplash" | "color" | "custom"
type ColorSubTab = "solid" | "gradient"

function deriveTopTab(type: string): TopTab {
  if (type === "wallpaper") return "wallpaper"
  if (type === "image") return "unsplash"
  if (type === "custom") return "custom"
  return "color" // solid, gradient, preset
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
      case "wallpaper":
        setBackground({ type: "wallpaper" })
        break
      case "unsplash":
        setBackground({ type: "image" })
        break
      case "color":
        setBackground({ type: colorSubTab === "solid" ? "solid" : "gradient" })
        break
      case "custom":
        setBackground({ type: "custom" })
        break
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

  return (
    <div className="space-y-4 py-4">
      <h3 className="text-[13px] font-semibold tracking-tight">Background</h3>

      <SegmentedControl
        options={[
          { value: "wallpaper" as TopTab, label: "Wallpaper" },
          { value: "unsplash" as TopTab, label: "Unsplash" },
          { value: "color" as TopTab, label: "Color" },
          { value: "custom" as TopTab, label: "Custom" },
        ]}
        value={topTab}
        onChange={handleTopTabChange}
      />

      {topTab === "wallpaper" && <WallpaperSection />}

      {topTab === "unsplash" && <UnsplashBackgroundSection />}

      {topTab === "color" && (
        <div className="space-y-3">
          <SegmentedControl
            options={[
              { value: "solid" as ColorSubTab, label: "Solid" },
              { value: "gradient" as ColorSubTab, label: "Gradient" },
            ]}
            value={
              background.type === "solid" ? "solid" : "gradient"
            }
            onChange={handleColorSubTabChange}
          />

          {(background.type === "gradient" || background.type === "preset") && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {GRADIENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className={`aspect-square rounded-lg transition-all duration-150 ${
                      background.presetId === preset.id
                        ? "ring-2 ring-violet-400 ring-offset-1 ring-offset-background scale-[1.04]"
                        : "hover:scale-[1.06] hover:ring-1 hover:ring-white/20"
                    }`}
                    style={{
                      background: `linear-gradient(${preset.angle}deg, ${preset.from}, ${preset.to})`,
                    }}
                    onClick={() => handlePresetClick(preset)}
                    title={preset.name}
                  />
                ))}
              </div>

              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">From</label>
                  <div className="relative">
                    <input
                      type="color"
                      value={background.gradientFrom}
                      onChange={(e) => setBackground({ gradientFrom: e.target.value, presetId: null, type: "gradient" })}
                      className="w-full h-8 rounded-md cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none"
                    />
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  <label className="text-[11px] text-muted-foreground">To</label>
                  <div className="relative">
                    <input
                      type="color"
                      value={background.gradientTo}
                      onChange={(e) => setBackground({ gradientTo: e.target.value, presetId: null, type: "gradient" })}
                      className="w-full h-8 rounded-md cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-muted-foreground">Angle</label>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{background.gradientAngle}&deg;</span>
                </div>
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
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">Color</label>
              <input
                type="color"
                value={background.color}
                onChange={(e) => setBackground({ color: e.target.value })}
                className="w-full h-9 rounded-md cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-none"
              />
            </div>
          )}
        </div>
      )}

      {topTab === "custom" && <CustomBackgroundSection />}

      {/* Blur slider - shown for wallpaper, unsplash, and custom when an image is set */}
      {(topTab === "wallpaper" || topTab === "unsplash" || topTab === "custom") && background.imageUrl && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-muted-foreground">Blur</label>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {background.imageBlur}px
            </span>
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
      )}

      {/* Padding slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-muted-foreground">Padding</label>
          <span className="text-[11px] text-muted-foreground tabular-nums">{background.padding}%</span>
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

      {/* Unsplash attribution */}
      {topTab === "unsplash" && background.unsplashAuthor && (
        <p className="text-[10px] text-muted-foreground/60">
          Photo by {background.unsplashAuthor} on{" "}
          <a
            href="https://unsplash.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-muted-foreground"
          >
            Unsplash
          </a>
        </p>
      )}
    </div>
  )
}
