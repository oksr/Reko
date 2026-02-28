import { useState, useEffect, useCallback } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { Monitor, Mic, Camera, MousePointerClick, Check, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type PermissionStatus = "not_determined" | "granted" | "denied"

interface PermissionItem {
  id: string
  kind: string
  title: string
  description: string
  icon: React.ElementType
  required: boolean
}

const PERMISSIONS: PermissionItem[] = [
  {
    id: "screen",
    kind: "screen",
    title: "Screen Recording",
    description: "Required to capture your screen content.",
    icon: Monitor,
    required: true,
  },
  {
    id: "microphone",
    kind: "microphone",
    title: "Microphone",
    description: "Record voice narration with your screen capture.",
    icon: Mic,
    required: false,
  },
  {
    id: "camera",
    kind: "camera",
    title: "Camera",
    description: "Add a webcam overlay to your recordings.",
    icon: Camera,
    required: false,
  },
  {
    id: "accessibility",
    kind: "accessibility",
    title: "Accessibility",
    description: "Track mouse clicks and keystrokes for visual effects.",
    icon: MousePointerClick,
    required: false,
  },
]

export function OnboardingApp() {
  const platform = usePlatform()
  const [statuses, setStatuses] = useState<Record<string, PermissionStatus>>({})

  const screenGranted = statuses["screen"] === "granted"

  // Poll all permission statuses
  useEffect(() => {
    let cancelled = false

    const checkAll = async () => {
      for (const perm of PERMISSIONS) {
        try {
          const result = await platform.invoke<string>("check_permission", { kind: perm.kind })
          if (!cancelled) {
            setStatuses((prev) => ({ ...prev, [perm.kind]: result as PermissionStatus }))
          }
        } catch {
          // ignore
        }
      }
    }

    checkAll()
    const interval = setInterval(checkAll, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGrant = async (perm: PermissionItem) => {
    if (perm.kind === "camera" || perm.kind === "microphone") {
      await platform.invoke("request_permission", { kind: perm.kind }).catch(() => {})
    } else {
      await platform.invoke("open_permission_settings", { kind: perm.kind }).catch(() => {})
    }
  }

  const finish = useCallback(async () => {
    localStorage.setItem("onboarding_completed", "true")
    await platform.window.close()
  }, [platform])

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white" data-tauri-drag-region>
      {/* Header */}
      <div className="px-10 pt-10 pb-2" data-tauri-drag-region>
        <h1 className="text-lg font-semibold">Permissions</h1>
        <p className="mt-1 text-sm text-white/40">
          Reko needs a few permissions to record your screen.
        </p>
      </div>

      {/* Permission rows */}
      <div className="flex flex-1 flex-col justify-center gap-2 px-10">
        {PERMISSIONS.map((perm) => {
          const Icon = perm.icon
          const granted = statuses[perm.kind] === "granted"

          return (
            <div
              key={perm.id}
              className="flex items-center gap-4 rounded-xl bg-white/[0.04] px-4 py-3.5"
            >
              {/* Icon */}
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                  granted ? "bg-emerald-500/15" : "bg-white/[0.06]"
                }`}
              >
                {granted ? (
                  <Check className="h-5 w-5 text-emerald-400" />
                ) : (
                  <Icon className="h-5 w-5 text-white/50" />
                )}
              </div>

              {/* Text */}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{perm.title}</span>
                  <Badge
                    variant={perm.required ? "destructive" : "secondary"}
                    className="px-1.5 py-0 text-[10px] leading-4"
                  >
                    {perm.required ? "Required" : "Optional"}
                  </Badge>
                </div>
                <span className="text-[12px] text-white/35">{perm.description}</span>
              </div>

              {/* Action */}
              {granted ? (
                <span className="shrink-0 text-[12px] font-medium text-emerald-400">Granted</span>
              ) : (
                <Button
                  onClick={() => handleGrant(perm)}
                  variant="secondary"
                  size="sm"
                  className="shrink-0 gap-1.5 text-[12px]"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Open System Settings
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end px-10 pb-8">
        <Button
          size="sm"
          onClick={finish}
          disabled={!screenGranted}
          className="px-5"
        >
          {screenGranted ? "Get Started" : "Grant Screen Recording to continue"}
        </Button>
      </div>
    </div>
  )
}
