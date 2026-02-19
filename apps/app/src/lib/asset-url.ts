import { usePlatform } from "@/platform/PlatformContext"

export function useAssetUrl() {
  const platform = usePlatform()
  return (path: string) => platform.filesystem.assetUrl(path)
}
