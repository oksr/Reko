# Permission Onboarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a step-by-step permission onboarding wizard in a separate window that appears on first launch, before showing the recording toolbar.

**Architecture:** A new `/onboarding` route renders a wizard UI in a dynamically-created Tauri window (500×400, centered, dark, no decorations). New Swift `@_cdecl` functions check permission status for screen recording, microphone, camera, and accessibility. New Rust commands expose these to the frontend. The recorder window launch is deferred until onboarding completes. A `localStorage` flag tracks completion.

**Tech Stack:** React + Tailwind + Lucide icons (frontend), Rust Tauri commands (bridge), Swift AVFoundation/ScreenCaptureKit/ApplicationServices (permissions)

---

### Task 1: Add Swift permission-check functions

**Files:**
- Modify: `RekoEngine/Sources/RekoEngine/capi.swift` (append after line 16, after `ck_free_string`)

**Step 1: Add the four permission-check C functions**

Append to `capi.swift`:

```swift
import AVFoundation
import ApplicationServices

@_cdecl("ck_check_screen_recording_permission")
public func ck_check_screen_recording_permission() -> Int32 {
    // CGWindowListCopyWindowInfo returns only owned windows if permission not granted
    guard let windowList = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
        return 0
    }
    // If we can see windows from other apps, permission is granted
    let myPid = ProcessInfo.processInfo.processIdentifier
    let hasOtherWindows = windowList.contains { dict in
        guard let pid = dict[kCGWindowOwnerPID as String] as? Int32 else { return false }
        return pid != myPid
    }
    return hasOtherWindows ? 1 : 0
}

@_cdecl("ck_check_microphone_permission")
public func ck_check_microphone_permission() -> Int32 {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return 1
    case .denied, .restricted: return 2
    case .notDetermined: return 0
    @unknown default: return 0
    }
}

@_cdecl("ck_check_camera_permission")
public func ck_check_camera_permission() -> Int32 {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return 1
    case .denied, .restricted: return 2
    case .notDetermined: return 0
    @unknown default: return 0
    }
}

@_cdecl("ck_check_accessibility_permission")
public func ck_check_accessibility_permission() -> Int32 {
    return AXIsProcessTrusted() ? 1 : 0
}
```

**Step 2: Build Swift to verify**

Run: `cd RekoEngine && swift build -c release`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add RekoEngine/Sources/RekoEngine/capi.swift
git commit -m "feat: add Swift permission-check functions for onboarding"
```

---

### Task 2: Add Rust FFI bindings and Tauri commands for permissions

**Files:**
- Modify: `src-tauri/src/swift_ffi.rs` (add extern declarations and wrapper methods)
- Create: `src-tauri/src/commands/permissions.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod permissions;`)
- Modify: `src-tauri/src/lib.rs` (register new commands in invoke_handler)

**Step 1: Add FFI declarations to `swift_ffi.rs`**

Add to the `extern "C"` block (after line 23):

```rust
    fn ck_check_screen_recording_permission() -> i32;
    fn ck_check_microphone_permission() -> i32;
    fn ck_check_camera_permission() -> i32;
    fn ck_check_accessibility_permission() -> i32;
```

Add to `impl RekoEngine` (after `finish_export` method, before closing `}`):

```rust
    pub fn check_screen_recording_permission() -> i32 {
        unsafe { ck_check_screen_recording_permission() }
    }

    pub fn check_microphone_permission() -> i32 {
        unsafe { ck_check_microphone_permission() }
    }

    pub fn check_camera_permission() -> i32 {
        unsafe { ck_check_camera_permission() }
    }

    pub fn check_accessibility_permission() -> i32 {
        unsafe { ck_check_accessibility_permission() }
    }
```

**Step 2: Create `src-tauri/src/commands/permissions.rs`**

```rust
use crate::swift_ffi::RekoEngine;

#[tauri::command]
pub fn check_permission(kind: String) -> Result<String, String> {
    let status = match kind.as_str() {
        "screen" => RekoEngine::check_screen_recording_permission(),
        "microphone" => RekoEngine::check_microphone_permission(),
        "camera" => RekoEngine::check_camera_permission(),
        "accessibility" => RekoEngine::check_accessibility_permission(),
        _ => return Err(format!("Unknown permission kind: {}", kind)),
    };
    // 0 = not_determined, 1 = granted, 2 = denied
    let label = match status {
        1 => "granted",
        2 => "denied",
        _ => "not_determined",
    };
    Ok(label.to_string())
}

#[tauri::command]
pub fn open_permission_settings(kind: String) -> Result<(), String> {
    let url = match kind.as_str() {
        "screen" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "microphone" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        "camera" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
        "accessibility" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        _ => return Err(format!("Unknown permission kind: {}", kind)),
    };
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

**Step 3: Register in `mod.rs`**

Add to `src-tauri/src/commands/mod.rs`:

```rust
pub mod permissions;
```

**Step 4: Register commands in `lib.rs`**

Add to the `generate_handler!` macro in `src-tauri/src/lib.rs`:

```rust
            commands::permissions::check_permission,
            commands::permissions::open_permission_settings,
```

**Step 5: Build Rust to verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src-tauri/src/swift_ffi.rs src-tauri/src/commands/permissions.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for permission checks and settings"
```

---

### Task 3: Add `/onboarding` route and OnboardingApp shell

**Files:**
- Modify: `src/main.tsx` (add onboarding route)
- Create: `src/onboarding-app.tsx` (wizard shell)

**Step 1: Add route in `main.tsx`**

Add import and route. Modified `Root` function:

```tsx
import { OnboardingApp } from "./onboarding-app"

function Root() {
  const path = window.location.pathname
  if (path.startsWith("/editor")) return <EditorApp />
  if (path.startsWith("/window-picker")) return <WindowPickerApp />
  if (path.startsWith("/onboarding")) return <OnboardingApp />
  return <RecorderApp />
}
```

**Step 2: Create `src/onboarding-app.tsx`**

```tsx
import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
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
    // Open the recorder window and close onboarding
    const current = getCurrentWindow()
    try {
      // Show the recorder window (it's the default static window, just hidden)
      const { WebviewWindow: WW } = await import("@tauri-apps/api/webviewWindow")
      const recorder = await WW.getByLabel("recorder")
      if (recorder) {
        await recorder.show()
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
```

**Step 3: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No errors (or only pre-existing ones)

**Step 4: Commit**

```bash
git add src/main.tsx src/onboarding-app.tsx
git commit -m "feat: add onboarding wizard UI with step-by-step permissions"
```

---

### Task 4: Launch onboarding window on first startup

**Files:**
- Modify: `src/recorder-app.tsx` (check onboarding flag, create onboarding window if needed)

**Step 1: Add onboarding check at the start of RecorderApp**

Add this logic at the top of the `RecorderApp` component, before the existing `useEffect` for positioning. This replaces the current permission-check flow for first launch:

In `src/recorder-app.tsx`, add a new `useEffect` after the state declarations (after line 60), before the `handlePermissionGranted` callback:

```tsx
  // First-launch onboarding: open onboarding window and hide recorder
  useEffect(() => {
    const completed = localStorage.getItem("onboarding_completed")
    if (completed === "true") return

    // Hide recorder and open onboarding window
    const win = getCurrentWindow()
    windowHiddenRef.current = true
    win.hide().catch(() => {})

    new WebviewWindow("onboarding", {
      url: "/onboarding",
      width: 500,
      height: 400,
      resizable: false,
      decorations: false,
      transparent: false,
      center: true,
      title: "Reko — Setup",
    })

    // Listen for onboarding window close to show recorder
    const unlisten = win.listen("tauri://focus", async () => {
      // When recorder regains focus after onboarding closes
      if (localStorage.getItem("onboarding_completed") === "true") {
        windowHiddenRef.current = false
        handlePermissionGranted()
      }
    })

    return () => { unlisten.then((fn) => fn()) }
  }, [])
```

Also modify the initial `appState`: if onboarding is already completed, still start with `"permission-check"` (existing flow handles it). If not completed, the recorder is hidden and onboarding takes over.

**Step 2: Update the onboarding finish to show the recorder**

In `src/onboarding-app.tsx`, update the `finish` function to emit an event to the recorder window before closing:

```tsx
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
```

**Step 3: Verify with `npx tsc --noEmit`**

Expected: No new errors

**Step 4: Commit**

```bash
git add src/recorder-app.tsx src/onboarding-app.tsx
git commit -m "feat: launch onboarding window on first startup before recorder"
```

---

### Task 5: Integration test — full startup flow

**Files:** No new files

**Step 1: Build and test the full flow**

Run: `npx tauri dev`

**Manual test checklist:**
1. Clear localStorage (DevTools → Application → Local Storage → delete `onboarding_completed`)
2. App launches → onboarding window appears (500×400, centered, dark)
3. Step 1: Screen Recording — shows "Required" badge, "Grant Permission" button, no Skip
4. Grant screen recording in System Settings → green check, auto-advances after 1s
5. Step 2: Microphone — shows "Optional" badge, has "Skip" button and "Skip all & finish"
6. Click "Skip all & finish" → onboarding closes, recorder toolbar appears
7. Quit and relaunch → recorder toolbar appears directly (no onboarding)

**Step 2: Commit any fixes**

```bash
git commit -am "fix: onboarding integration fixes"
```

---

## Summary of all files touched

| File | Action |
|------|--------|
| `RekoEngine/Sources/RekoEngine/capi.swift` | Add 4 permission-check `@_cdecl` functions |
| `src-tauri/src/swift_ffi.rs` | Add FFI declarations + wrapper methods |
| `src-tauri/src/commands/permissions.rs` | New — `check_permission` and `open_permission_settings` commands |
| `src-tauri/src/commands/mod.rs` | Add `pub mod permissions;` |
| `src-tauri/src/lib.rs` | Register 2 new commands |
| `src/main.tsx` | Add `/onboarding` route |
| `src/onboarding-app.tsx` | New — wizard UI component |
| `src/recorder-app.tsx` | Add first-launch onboarding check |
