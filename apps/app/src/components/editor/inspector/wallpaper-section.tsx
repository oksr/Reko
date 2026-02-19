import { useState, useEffect } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { useAssetUrl } from "@/lib/asset-url"
import { useEditorStore } from "@/stores/editor-store"
import type { WallpaperInfo } from "@/types/editor"

export function WallpaperSection() {
  const platform = usePlatform()
  const assetUrl = useAssetUrl()
  const background = useEditorStore((s) => s.project?.effects.background)
  const setBackground = useEditorStore((s) => s.setBackground)

  const [wallpapers, setWallpapers] = useState<WallpaperInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    platform.invoke<WallpaperInfo[]>("list_wallpapers")
      .then((results) => {
        setWallpapers(results)
        setLoading(false)
      })
      .catch((e) => {
        console.error("Failed to load wallpapers:", e)
        setLoading(false)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (wallpaper: WallpaperInfo) => {
    setBackground({
      type: "wallpaper",
      imageUrl: wallpaper.path,
      wallpaperId: wallpaper.id,
      unsplashId: null,
      unsplashAuthor: null,
    })
  }

  if (!background) return null

  return (
    <div className="space-y-3">
      <div className="max-h-[280px] overflow-y-auto p-1 -m-1">
        <div className="grid grid-cols-3 gap-2">
          {wallpapers.map((wp) => (
            <button
              key={wp.id}
              className={`relative aspect-video rounded-md overflow-hidden transition-all duration-150 ${
                background.wallpaperId === wp.id
                  ? "ring-2 ring-violet-400 ring-offset-1 ring-offset-background scale-[1.02]"
                  : "hover:scale-[1.03] hover:ring-1 hover:ring-white/20"
              }`}
              onClick={() => handleSelect(wp)}
            >
              <img
                src={assetUrl(wp.path)}
                alt={wp.name}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}

          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="aspect-video rounded-md bg-white/[0.06] animate-pulse"
              />
            ))}
        </div>
      </div>

      {!loading && wallpapers.length === 0 && (
        <p className="text-[11px] text-muted-foreground text-center py-4">
          No wallpapers found
        </p>
      )}
    </div>
  )
}
