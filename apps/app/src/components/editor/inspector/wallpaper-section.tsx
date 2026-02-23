import { useState, useEffect } from "react"
import { FolderOpen } from "lucide-react"
import { usePlatform } from "@/platform/PlatformContext"
import { useAssetUrl } from "@/lib/asset-url"
import { useEditorStore } from "@/stores/editor-store"
import type { WallpaperInfo } from "@/types/editor"

export function WallpaperSection() {
  const platform = usePlatform()
  const assetUrl = useAssetUrl()
  const background = useEditorStore((s) => s.project?.effects.background)
  const projectId = useEditorStore((s) => s.project?.id)
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

  const handlePickCustom = async () => {
    if (!projectId) return
    const selected = await platform.filesystem.openDialog({
      multiple: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
    })
    if (!selected) return
    const sourcePath = typeof selected === "string" ? selected : selected[0]
    const ext = sourcePath.split(".").pop() || "jpg"
    const filename = `bg-custom-${Date.now()}.${ext}`
    try {
      const localPath = await platform.invoke<string>("copy_background_image", {
        projectId,
        sourcePath,
        filename,
      })
      setBackground({
        type: "custom",
        imageUrl: localPath,
        unsplashId: null,
        unsplashAuthor: null,
        wallpaperId: null,
      })
    } catch (e) {
      console.error("Failed to copy image:", e)
    }
  }

  if (!background) return null

  const isCustom = background.type === "custom"

  return (
    <div className="space-y-3">
      <div className="max-h-[260px] overflow-y-auto">
        <div className="grid grid-cols-6 gap-2 p-1">
          {wallpapers.map((wp) => (
            <button
              key={wp.id}
              className={`relative aspect-square rounded-[8px] overflow-hidden transition-all duration-150 ${
                background.wallpaperId === wp.id
                  ? "ring-2 ring-violet-400 ring-offset-1 ring-offset-black scale-[1.04]"
                  : "hover:scale-[1.06] hover:ring-1 hover:ring-white/25 opacity-80 hover:opacity-100"
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
            Array.from({ length: 12 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="aspect-square rounded-[8px] bg-white/[0.06] animate-pulse"
              />
            ))}

          {/* Upload custom image button */}
          {!loading && (
            <button
              onClick={handlePickCustom}
              title="Upload custom image"
              className={`aspect-square rounded-[8px] flex items-center justify-center transition-all duration-150 ${
                isCustom
                  ? "ring-2 ring-violet-400 ring-offset-1 ring-offset-black bg-violet-500/20"
                  : "bg-white/[0.06] hover:bg-white/[0.10] text-white/30 hover:text-white/70"
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Custom image preview */}
      {isCustom && background.imageUrl && (
        <button
          onClick={handlePickCustom}
          className="w-full relative aspect-video rounded-[8px] overflow-hidden ring-2 ring-violet-400 ring-offset-1 ring-offset-black group"
        >
          <img
            src={assetUrl(background.imageUrl)}
            alt="Custom background"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
            <span className="text-[11px] text-white/0 group-hover:text-white/80 transition-colors font-medium">
              Change…
            </span>
          </div>
        </button>
      )}

      {!loading && wallpapers.length === 0 && (
        <p className="text-[12px] text-white/30 text-center py-4">
          No wallpapers found
        </p>
      )}
    </div>
  )
}
