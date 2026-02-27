# Pre-warm Camera to Eliminate Black Frames

## Context

When recording starts with camera enabled, `RecordingPipeline` creates a **new** `CameraCapture` instance. The camera hardware needs warm-up time and delivers black frames initially. Meanwhile, the camera mirror/preview feature already starts the camera (via WebRTC `getUserMedia`) when the user toggles it on — but that's a completely separate code path (browser API vs native AVFoundation). So the native capture still sees warm-up frames.

**Goal:** Start the native `CameraCapture` when the user toggles camera on (alongside the WebRTC preview), so by the time recording starts, the camera is already delivering real frames. `RecordingPipeline` then reuses this pre-warmed instance instead of creating a new one.

## New Flow

1. User toggles camera ON → frontend calls `prewarm_camera` → Swift starts `CameraCapture` globally (frames discarded until recording)
2. WebRTC preview window still opens for display (unchanged)
3. User clicks Record → `start_recording` grabs the pre-warmed `CameraCapture` instead of creating a new one
4. `isRecording = true` → camera frames start writing immediately with real content
5. User toggles camera OFF (no recording) → frontend calls `stop_camera_prewarm` → Swift stops the pre-warmed capture

## Files to Modify

### 1. `RekoEngine/Sources/RekoEngine/capture/camera-capture.swift`

Add ability to swap the frame callback after construction, so RecordingPipeline can redirect frames from "discard" to "write":

- Add `public func setFrameCallback(_ callback: @escaping (CMSampleBuffer) -> Void)` method
- Remove the `waitUntilReady()`, `readyContinuation`, `isReady`, `readyLock` properties and `checkReady()` method (no longer needed — camera is already warm)

### 2. `RekoEngine/Sources/RekoEngine/capi.swift`

Add global pre-warm state and two new C API functions:

```swift
private var prewarmedCamera: CameraCapture?
private var prewarmedCameraDims: CameraCapture.CameraDimensions?
private let prewarmLock = NSLock()
```

- `ck_prewarm_camera(deviceId) -> Int32` — creates a `CameraCapture`, calls `startCapture` with a no-op frame callback, stores it in `prewarmedCamera`
- `ck_stop_camera_prewarm() -> Int32` — stops and clears `prewarmedCamera` (only if not currently in use by a recording session)
- Modify `ck_start_recording` — before creating the pipeline, extract `prewarmedCamera` (set global to nil so stop_prewarm won't kill it mid-recording). Pass it to `RecordingPipeline` via a new initializer parameter.

### 3. `RekoEngine/Sources/RekoEngine/recording/recording-pipeline.swift`

Accept an optional pre-warmed camera:

- Add `private let prewarmedCamera: CameraCapture?` and `private let prewarmedCameraDims: CameraCapture.CameraDimensions?` properties
- Update `init(config:prewarmedCamera:prewarmedCameraDims:)`
- In `start()`, camera setup block (lines 180-191): if `prewarmedCamera` is provided and `config.cameraId` matches, use it + call `setFrameCallback` to redirect frames to the writer. Otherwise fall back to creating a new `CameraCapture` (safety net for edge cases)
- Remove `await cameraCapture!.waitUntilReady()` call

### 4. `apps/tauri/src-tauri/src/swift_ffi.rs`

Add FFI declarations and wrappers:

```rust
extern "C" {
    fn ck_prewarm_camera(device_id: *const c_char) -> i32;
    fn ck_stop_camera_prewarm() -> i32;
}
```

Add `RekoEngine::prewarm_camera(device_id: &str)` and `RekoEngine::stop_camera_prewarm()` wrappers.

### 5. `apps/tauri/src-tauri/src/commands/sources.rs`

Add two new Tauri commands:

```rust
#[tauri::command]
pub async fn prewarm_camera(device_id: String) -> Result<(), String>

#[tauri::command]
pub async fn stop_camera_prewarm() -> Result<(), String>
```

### 6. `apps/tauri/src-tauri/src/lib.rs`

Register the new commands in `invoke_handler`.

### 7. `apps/app/src/recorder-app.tsx`

- `handleToggleCamera(true)` → after setting state, call `platform.invoke("prewarm_camera", { deviceId })`
- `handleToggleCamera(false)` → call `platform.invoke("stop_camera_prewarm")` before/alongside closing preview
- `selectedCamera` change effect → call prewarm with new device
- `handleClose` → call `stop_camera_prewarm`
- No change to `closeCameraPreview` or recording start — the recording pipeline handles handoff internally

## Verification

1. `cd RekoEngine && swift build -c release` — must compile cleanly
2. `cargo build --manifest-path apps/tauri/src-tauri/Cargo.toml` — Rust must compile
3. `pnpm dev` — start the app
4. Toggle camera on → verify preview shows, then start recording → verify first camera frame is real (not black)
5. Toggle camera off without recording → verify no crash / resource leak
6. Start recording without ever toggling camera → verify fallback creates new CameraCapture and still works
