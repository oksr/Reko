# Camera Mirror Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a live camera bubble preview on screen when the user enables their camera in the recorder, so they can see how they look before recording.

**Architecture:** Open a small borderless, transparent, always-on-top Tauri window (`camera-preview`) that uses `getUserMedia` to display a live camera feed in a circular bubble. The RecorderApp manages the window lifecycle — opens it when camera is enabled, closes it when camera is disabled or recording starts.

**Tech Stack:** React, Tauri window API, `navigator.mediaDevices.getUserMedia`, CSS

---

### Task 1: Create the CameraPreviewApp component

**Files:**
- Create: `apps/app/src/camera-preview-app.tsx`

**Step 1: Create the component**

```tsx
import { useEffect, useRef, useState } from "react"

export function CameraPreviewApp() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  // Read camera device ID from URL search params
  const deviceId = new URLSearchParams(window.location.search).get("deviceId")

  useEffect(() => {
    if (!deviceId) return

    let active = true
    let mediaStream: MediaStream | null = null

    navigator.mediaDevices
      .getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: false,
      })
      .then((s) => {
        if (!active) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        mediaStream = s
        setStream(s)
        if (videoRef.current) {
          videoRef.current.srcObject = s
        }
      })
      .catch((err) => {
        console.error("Camera preview failed:", err)
      })

    return () => {
      active = false
      mediaStream?.getTracks().forEach((t) => t.stop())
    }
  }, [deviceId])

  // Sync stream to video element when ref mounts
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className="camera-preview-window">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="camera-preview-video"
      />
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/app/src/camera-preview-app.tsx
git commit -m "feat(recorder): add CameraPreviewApp component with getUserMedia"
```

---

### Task 2: Add CSS styles for the camera preview bubble

**Files:**
- Modify: `apps/app/src/index.css`

**Step 1: Add styles**

Add after the `body:has(.recorder-window)` block (around line 139):

```css
body:has(.camera-preview-window) {
  background: transparent !important;
  overflow: hidden;
}

.camera-preview-window {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  -webkit-app-region: drag;
}

.camera-preview-window:active {
  cursor: grabbing;
}

.camera-preview-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  transform: scaleX(-1);
  border: 3px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}
```

Key details:
- `transform: scaleX(-1)` mirrors the video horizontally (standard for selfie/mirror view)
- `border-radius: 50%` makes it circular (matching editor's default camera bubble)
- `-webkit-app-region: drag` makes the entire window draggable
- Transparent background so only the bubble is visible

**Step 2: Commit**

```bash
git add apps/app/src/index.css
git commit -m "feat(recorder): add camera preview bubble styles"
```

---

### Task 3: Add route for camera-preview window

**Files:**
- Modify: `apps/app/src/root.tsx`

**Step 1: Add the route**

Add import at top:
```tsx
import { CameraPreviewApp } from "./camera-preview-app"
```

Add route before the default `RecorderApp` return (after the area-selection line):
```tsx
if (label === "camera-preview" || path.startsWith("/camera-preview")) return <CameraPreviewApp />
```

**Step 2: Commit**

```bash
git add apps/app/src/root.tsx
git commit -m "feat(recorder): add camera-preview window route"
```

---

### Task 4: Open/close preview window from RecorderApp

**Files:**
- Modify: `apps/app/src/recorder-app.tsx`

**Step 1: Add helper functions to open/close the camera preview window**

Add these functions inside `RecorderApp`, after the `handleToggleMic` function (around line 448):

```tsx
const openCameraPreview = async (deviceId: string) => {
  try {
    await platform.navigation.openWindow({
      url: `/?deviceId=${encodeURIComponent(deviceId)}`,
      label: "camera-preview",
      width: 160,
      height: 160,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      shadow: false,
    })
  } catch (e) {
    // Window may already exist, ignore
  }
}

const closeCameraPreview = async () => {
  try {
    await platform.navigation.closeWindow("camera-preview")
  } catch (e) {
    // Window may not exist, ignore
  }
}
```

**Step 2: Update `handleToggleCamera` to open/close preview**

Replace the existing `handleToggleCamera`:

```tsx
const handleToggleCamera = (enabled: boolean) => {
  setCameraEnabled(enabled)
  if (enabled) {
    const deviceId = selectedCamera || (cameras.length > 0 ? cameras[0].id : null)
    if (!selectedCamera && cameras.length > 0) {
      setSelectedCamera(cameras[0].id)
    }
    if (deviceId) {
      openCameraPreview(deviceId)
    }
  } else {
    closeCameraPreview()
  }
}
```

**Step 3: Close preview when recording starts**

In the `startRecording` function, add `closeCameraPreview()` right before `await platform.invoke("start_recording", ...)`:

```tsx
const startRecording = async () => {
  setIsLoading(true)
  closeCameraPreview()
  try {
    // ... existing code
  }
}
```

Also close in the `window-selected` listener (around line 213) and the `area-selected` listener (around line 248), add `closeCameraPreview()` right before the `await platform.invoke("start_recording", ...)` call in each.

**Step 4: Close preview when camera device changes**

Add an effect to reopen the preview with the new device when `selectedCamera` changes while camera is enabled:

```tsx
useEffect(() => {
  if (cameraEnabled && selectedCamera) {
    openCameraPreview(selectedCamera)
  } else if (!cameraEnabled) {
    closeCameraPreview()
  }
}, [selectedCamera]) // eslint-disable-line react-hooks/exhaustive-deps
```

**Step 5: Close preview on recorder close**

Update `handleClose`:

```tsx
const handleClose = () => {
  closeCameraPreview()
  platform.window.close()
}
```

**Step 6: Commit**

```bash
git add apps/app/src/recorder-app.tsx
git commit -m "feat(recorder): open/close camera preview on toggle and recording"
```

---

### Task 5: Position the preview window at bottom-right of screen

**Files:**
- Modify: `apps/app/src/recorder-app.tsx`

**Step 1: Update `openCameraPreview` to position the window**

The preview should appear at the bottom-right corner of the screen, above the recorder toolbar. Update the function:

```tsx
const openCameraPreview = async (deviceId: string) => {
  try {
    const monitor = await platform.monitor.getCurrent()
    let x: number | undefined
    let y: number | undefined
    if (monitor) {
      const factor = monitor.scaleFactor
      const screenW = monitor.size.width / factor
      const screenH = monitor.size.height / factor
      const bubbleSize = 160
      const margin = 20
      const toolbarMargin = 130 // above the recorder toolbar
      x = Math.round(screenW - bubbleSize - margin)
      y = Math.round(screenH - bubbleSize - toolbarMargin)
    }
    await platform.navigation.openWindow({
      url: `/?deviceId=${encodeURIComponent(deviceId)}`,
      label: "camera-preview",
      width: 160,
      height: 160,
      x,
      y,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      shadow: false,
    })
  } catch (e) {
    // Window may already exist, ignore
  }
}
```

**Step 2: Commit**

```bash
git add apps/app/src/recorder-app.tsx
git commit -m "feat(recorder): position camera preview at bottom-right of screen"
```

---

### Task 6: Verify the feature manually

**Step 1: Run the app**

```bash
pnpm dev
```

**Step 2: Test checklist**

- [ ] Click camera icon → preview bubble appears at bottom-right
- [ ] Video feed is mirrored (text appears reversed)
- [ ] Bubble is circular with white border and shadow
- [ ] Bubble is draggable
- [ ] Click camera icon again to disable → preview disappears
- [ ] Right-click camera → select different camera → preview reopens with new device
- [ ] Click record → preview disappears
- [ ] Toggle camera on, then close recorder → preview also closes

**Step 3: Final commit if any tweaks needed**
