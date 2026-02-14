import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Monitor, Mic, Camera, MousePointerClick, Check, ChevronRight, SkipForward, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type PermissionStatus = "not_determined" | "granted" | "denied"

interface PermissionStep {
  id: string
  kind: string
  title: string
  description: string
  icon: React.ElementType
  required: boolean
}

const STEPS: PermissionStep[] = [
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
  const [currentStep, setCurrentStep] = useState(0)
  const [statuses, setStatuses] = useState<Record<string, PermissionStatus>>({})
  const [mandatoryGranted, setMandatoryGranted] = useState(false)

  const step = STEPS[currentStep]
  const status = statuses[step?.kind] ?? "not_determined"
  const isGranted = status === "granted"
  const isLastStep = currentStep === STEPS.length - 1

  // Poll current step's permission status
  useEffect(() => {
    if (!step) return
    let cancelled = false

    const check = async () => {
      try {
        const result = await invoke<string>("check_permission", { kind: step.kind })
        if (!cancelled) {
          setStatuses((prev) => ({ ...prev, [step.kind]: result as PermissionStatus }))
        }
      } catch {
        // ignore
      }
    }

    check()
    const interval = setInterval(check, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [step])

  // Track when mandatory permission is granted
  useEffect(() => {
    if (statuses["screen"] === "granted") {
      setMandatoryGranted(true)
    }
  }, [statuses])

  // Auto-advance when permission is granted
  useEffect(() => {
    if (isGranted && !isLastStep) {
      const timer = setTimeout(() => setCurrentStep((s) => s + 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [isGranted, isLastStep])

  const handleGrant = async () => {
    await invoke("open_permission_settings", { kind: step.kind }).catch(() => {})
  }

  const handleSkip = () => {
    if (isLastStep) {
      finish()
    } else {
      setCurrentStep((s) => s + 1)
    }
  }

  const handleContinue = () => {
    if (isLastStep) {
      finish()
    } else {
      setCurrentStep((s) => s + 1)
    }
  }

  const finish = useCallback(async () => {
    localStorage.setItem("onboarding_completed", "true")
    const current = getCurrentWindow()
    try {
      const { WebviewWindow: WW } = await import("@tauri-apps/api/webviewWindow")
      const recorder = await WW.getByLabel("recorder")
      if (recorder) {
        await recorder.show()
        await recorder.setFocus()
      }
    } catch {
      // Recorder window should already exist
    }
    await current.close()
  }, [])

  const handleSkipAll = () => {
    finish()
  }

  if (!step) return null

  const Icon = step.icon

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white" data-tauri-drag-region>
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 pt-8">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`h-1.5 w-8 rounded-full transition-colors ${
              i < currentStep
                ? "bg-white/40"
                : i === currentStep
                  ? "bg-white"
                  : "bg-white/15"
            }`}
          />
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-12">
        {/* Icon */}
        <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${
          isGranted ? "bg-emerald-500/15" : "bg-white/10"
        }`}>
          {isGranted ? (
            <Check className="h-8 w-8 text-emerald-400" />
          ) : (
            <Icon className="h-8 w-8 text-white/80" />
          )}
        </div>

        {/* Title + badge */}
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{step.title}</h1>
          <Badge variant={step.required ? "destructive" : "secondary"} className="text-[10px]">
            {step.required ? "Required" : "Optional"}
          </Badge>
        </div>

        {/* Description */}
        <p className="text-center text-sm text-white/50">{step.description}</p>

        {/* Status / Action */}
        {isGranted ? (
          <p className="text-sm font-medium text-emerald-400">Permission granted</p>
        ) : (
          <Button onClick={handleGrant} variant="secondary" size="sm">
            <Shield className="mr-2 h-4 w-4" />
            Open System Settings
          </Button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-8 pb-8">
        <div>
          {!step.required && (
            <Button variant="ghost" size="sm" onClick={handleSkip} className="text-white/40">
              Skip
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {mandatoryGranted && !isLastStep && (
            <Button variant="ghost" size="sm" onClick={handleSkipAll} className="text-white/40">
              <SkipForward className="mr-1.5 h-3.5 w-3.5" />
              Skip all & finish
            </Button>
          )}
          {isGranted && (
            <Button size="sm" onClick={handleContinue}>
              {isLastStep ? "Finish" : "Continue"}
              {!isLastStep && <ChevronRight className="ml-1.5 h-3.5 w-3.5" />}
            </Button>
          )}
          {isLastStep && !isGranted && !step.required && (
            <Button size="sm" onClick={handleSkip}>
              Finish
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
