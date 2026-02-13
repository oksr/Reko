import { convertFileSrc } from "@tauri-apps/api/core"

/**
 * Convert an absolute file path to a URL the webview can load.
 */
export function assetUrl(absolutePath: string): string {
  try {
    return convertFileSrc(absolutePath)
  } catch (e) {
    console.error("Failed to convert file path to asset URL:", absolutePath, e)
    return absolutePath
  }
}
