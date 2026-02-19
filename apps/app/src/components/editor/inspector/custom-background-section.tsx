import { usePlatform } from "@/platform/PlatformContext"
import { useAssetUrl } from "@/lib/asset-url"
import { useEditorStore } from "@/stores/editor-store"

export function CustomBackgroundSection() {
  const platform = usePlatform()
  const assetUrl = useAssetUrl()
  const background = useEditorStore((s) => s.project?.effects.background)
  const projectId = useEditorStore((s) => s.project?.id)
  const setBackground = useEditorStore((s) => s.setBackground)

  if (!background) return null

  const handlePickImage = async () => {
    if (!projectId) return

    const selected = await platform.filesystem.openDialog({
      multiple: false,
      filters: [
        { name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] },
      ],
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

  const hasImage = background.type === "custom" && background.imageUrl

  return (
    <div className="space-y-3">
      {hasImage && (
        <div className="relative aspect-video rounded-md overflow-hidden ring-2 ring-violet-400 ring-offset-1 ring-offset-background">
          <img
            src={assetUrl(background.imageUrl!)}
            alt="Custom background"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <button
        onClick={handlePickImage}
        className="w-full h-9 text-xs font-medium rounded-md border border-white/[0.08] bg-white/[0.04] text-muted-foreground hover:text-foreground hover:bg-white/[0.08] transition-colors"
      >
        {hasImage ? "Change Image..." : "Choose Image..."}
      </button>
    </div>
  )
}
