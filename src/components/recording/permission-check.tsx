import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ShieldAlert } from "lucide-react"

interface Props {
  onPermissionGranted: () => void
}

export function PermissionCheck({ onPermissionGranted }: Props) {
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const displays = await invoke<unknown[]>("list_displays")
        if (!cancelled && displays.length > 0) {
          onPermissionGranted()
          return
        }
      } catch {
        // Permission not granted yet
      }
      if (!cancelled) {
        setChecking(false)
      }
    }
    check()
    return () => { cancelled = true }
  }, [onPermissionGranted])

  // Poll for permission grant every 2 seconds
  useEffect(() => {
    if (checking) return
    const interval = setInterval(async () => {
      try {
        const displays = await invoke<unknown[]>("list_displays")
        if (displays.length > 0) {
          onPermissionGranted()
        }
      } catch {
        // Still no permission
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [checking, onPermissionGranted])

  if (checking) return null

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-4 text-center">
      <ShieldAlert className="w-8 h-8 text-amber-400" />
      <p className="text-sm font-medium text-white/90">
        Screen Recording permission required
      </p>
      <p className="text-xs text-white/50">
        Grant access in System Settings to start recording
      </p>
      <button
        onClick={() => {
          invoke("open_screen_recording_settings").catch(() => {
            // Fallback: open System Settings via shell
            invoke("plugin:opener|open_url", {
              url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            }).catch(() => {})
          })
        }}
        className="mt-1 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/15"
      >
        Open System Settings
      </button>
    </div>
  )
}
