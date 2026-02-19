import { useState, useEffect } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { ShieldAlert } from "lucide-react"

interface Props {
  onPermissionGranted: () => void
}

export function PermissionCheck({ onPermissionGranted }: Props) {
  const platform = usePlatform()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const status = await platform.invoke<string>("check_permission", { kind: "screen" })
        if (!cancelled && status === "granted") {
          onPermissionGranted()
          return
        }
      } catch {
        // Permission not granted
      }
      if (!cancelled) {
        setChecking(false)
      }
    }
    check()
    return () => { cancelled = true }
  }, [onPermissionGranted]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll every 2 seconds after initial check fails
  useEffect(() => {
    if (checking) return
    const interval = setInterval(async () => {
      try {
        const status = await platform.invoke<string>("check_permission", { kind: "screen" })
        if (status === "granted") {
          onPermissionGranted()
        }
      } catch {
        // Still no permission
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [checking, onPermissionGranted]) // eslint-disable-line react-hooks/exhaustive-deps

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
          platform.invoke("open_permission_settings", { kind: "screen" }).catch(() => {})
        }}
        className="mt-1 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/15"
      >
        Open System Settings
      </button>
    </div>
  )
}
