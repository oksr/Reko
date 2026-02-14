import { convertFileSrc } from "@tauri-apps/api/core"

/**
 * Convert an absolute file path to a URL the webview can load.
 *
 * In dev mode the webview runs on http://localhost:5173 which can't
 * access Tauri's asset:// scheme (cross-origin). We proxy through
 * a Vite middleware at /__asset__/ instead.
 *
 * In production builds convertFileSrc works natively.
 */
export function assetUrl(absolutePath: string): string {
  if (import.meta.env.DEV) {
    const encoded = absolutePath
      .split("/")
      .map(encodeURIComponent)
      .join("/")
    return `/__asset__${encoded}`
  }
  return convertFileSrc(absolutePath)
}
