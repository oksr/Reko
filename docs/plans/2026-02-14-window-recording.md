# Window Recording Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the ability to record a specific window by clicking "Window" in the toolbar, hovering to select a window via a fullscreen overlay, and immediately starting recording.

**Architecture:** The flow adds a new source type ("window") alongside "display". Clicking "Window" opens a Tauri fullscreen transparent overlay. The overlay fetches window list from Swift (via ScreenCaptureKit), does JS-side hit-testing on mouse move, and on click shows a confirmation UI. "Start recording" triggers recording via `SCContentFilter(desktopIndependentWindow:)`.

**Tech Stack:** Swift ScreenCaptureKit, Rust/Tauri FFI, React + Tailwind CSS

**Review fixes applied:** Coordinate conversion uses monitor API (not `window.innerHeight`), `window_id` passed through Rust FFI, `excludingDesktopWindows(true)`, icon caching by bundleId, glass-morphism confirmation card, red record button, segmented toggle style, empty state handling, stale closure fix via refs.

---

### Task 1: Swift — Add `listWindows()` to ScreenCapture

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capture/screen-capture.swift`

**Step 1: Add WindowInfo struct and listWindows method**

Add after the `DisplayInfo` struct (line ~10):

```swift
public struct WindowInfo: Codable {
    public let id: UInt32
    public let appName: String
    public let title: String
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int
    public let bundleId: String
    public let appIcon: String  // base64-encoded 64x64 PNG
}
```

Add after `listDisplays()` (line ~30):

```swift
// Icon cache: apps don't change icons mid-session, so cache by bundleId
private static var iconCache: [String: String] = [:]

public static func listWindows() async throws -> [WindowInfo] {
    let content = try await SCShareableContent.excludingDesktopWindows(
        true, onScreenWindowsOnly: true
    )

    let excludedBundleIds: Set<String> = [
        "com.capturekit.app",
        "com.apple.dock",
        "com.apple.SystemUIServer",
        "com.apple.WindowManager",
        "com.apple.controlcenter",
        "com.apple.notificationcenterui",
    ]

    let minSize = 50

    return content.windows.compactMap { window in
        guard let app = window.owningApplication else { return nil }
        let bundleId = app.bundleIdentifier
        guard !excludedBundleIds.contains(bundleId) else { return nil }

        let frame = window.frame
        guard Int(frame.width) >= minSize && Int(frame.height) >= minSize else { return nil }

        // Use window title, fall back to app name for windows with empty titles
        let title = window.title ?? ""
        let displayTitle = title.isEmpty ? app.applicationName : title

        // Get app icon as base64 (cached by bundleId)
        let iconBase64: String
        if let cached = iconCache[bundleId] {
            iconBase64 = cached
        } else if let appURL = app.bundleURL {
            let icon = NSWorkspace.shared.icon(forFile: appURL.path)
            let size = NSSize(width: 64, height: 64)
            let resized = NSImage(size: size)
            resized.lockFocus()
            icon.draw(in: NSRect(origin: .zero, size: size))
            resized.unlockFocus()
            if let tiff = resized.tiffRepresentation,
               let bitmap = NSBitmapImageRep(data: tiff),
               let png = bitmap.representation(using: .png, properties: [:]) {
                iconBase64 = png.base64EncodedString()
            } else {
                iconBase64 = ""
            }
            iconCache[bundleId] = iconBase64
        } else {
            iconBase64 = ""
        }

        return WindowInfo(
            id: window.windowID,
            appName: app.applicationName,
            title: displayTitle,
            x: Int(frame.origin.x),
            y: Int(frame.origin.y),
            width: Int(frame.width),
            height: Int(frame.height),
            bundleId: bundleId,
            appIcon: iconBase64
        )
    }
}
```

Also add `import AppKit` at the top of the file (needed for NSWorkspace, NSImage).

**Step 2: Add CaptureError.windowNotFound**

Add to the `CaptureError` enum at the bottom of the file:

```swift
case windowNotFound
```

**Step 3: Add window capture overload to startCapture**

Add a new method after the existing `startCapture` method (~line 72):

```swift
public func startWindowCapture(
    windowID: UInt32,
    fps: Int,
    captureAudio: Bool,
    onVideoFrame: @escaping (CMSampleBuffer) -> Void,
    onAudioSample: ((CMSampleBuffer) -> Void)? = nil
) async throws {
    self.onVideoFrame = onVideoFrame
    self.onAudioSample = onAudioSample

    let content = try await SCShareableContent.excludingDesktopWindows(
        true, onScreenWindowsOnly: true
    )
    guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
        throw CaptureError.windowNotFound
    }

    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    config.width = Int(window.frame.width) * 2
    config.height = Int(window.frame.height) * 2
    config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.showsCursor = true
    config.capturesAudio = captureAudio
    if captureAudio {
        config.sampleRate = 48000
        config.channelCount = 2
    }

    let stream = SCStream(filter: filter, configuration: config, delegate: self)
    let videoQueue = DispatchQueue(label: "com.capturekit.video", qos: .userInteractive)
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: videoQueue)
    if captureAudio {
        let audioQueue = DispatchQueue(label: "com.capturekit.audio", qos: .userInteractive)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
    }

    try await stream.startCapture()
    self.stream = stream
}
```

**Step 4: Build Swift to verify**

Run: `cd CaptureKitEngine && swift build -c release`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/capture/screen-capture.swift
git commit -m "feat: add window listing and window capture to ScreenCapture"
```

---

### Task 2: Swift — Update RecordingPipeline for window capture

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift`

**Step 1: Update RecordingConfig to support optional window_id**

Change `RecordingConfig` (line ~35):

```swift
public struct RecordingConfig: Codable {
    public let displayId: UInt32?
    public let windowId: UInt32?
    public let fps: Int
    public let captureSystemAudio: Bool
    public let outputDir: String
    public let micId: String?
    public let cameraId: String?
}
```

**Step 2: Update RecordingPipeline.start() to branch on window vs display**

Replace the section in `start()` that resolves the display and starts screen capture (lines ~83-167). The key changes are:

1. Determine capture dimensions from either the display or window
2. Call `startWindowCapture` or `startCapture` based on config
3. Skip mouse logger for window recording

Replace from `let displays = try await ...` through the end of `start()`:

```swift
// Determine capture source dimensions
let captureWidth: Int
let captureHeight: Int

if let windowId = config.windowId {
    // Window capture path
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
        throw CaptureError.windowNotFound
    }
    captureWidth = Int(window.frame.width) * 2
    captureHeight = Int(window.frame.height) * 2
} else if let displayId = config.displayId {
    let displays = try await ScreenCapture.listDisplays()
    guard let display = displays.first(where: { $0.id == displayId }) else {
        throw CaptureError.displayNotFound
    }
    captureWidth = display.width * 2
    captureHeight = display.height * 2

    // Start mouse logging (display recording only)
    let mouseOutputURL = outputDir.appendingPathComponent("mouse_events.jsonl")
    let logger = MouseLogger(
        outputURL: mouseOutputURL,
        screenWidth: display.width,
        screenHeight: display.height
    )
    if logger.start() {
        mouseLogger = logger
    }
} else {
    throw CaptureError.displayNotFound
}

videoWriter = try VideoWriter(
    outputURL: outputDir.appendingPathComponent("screen.mov"),
    width: captureWidth, height: captureHeight, fps: config.fps
)

if config.captureSystemAudio {
    systemAudioWriter = try AudioFileWriter(
        outputURL: outputDir.appendingPathComponent("system_audio.wav"),
        sampleRate: 48000, channels: 2
    )
}

if config.micId != nil {
    let mic = MicCapture()
    let format = mic.inputFormat()
    let writer = try MicWriter(
        outputURL: outputDir.appendingPathComponent("mic.wav"),
        format: format
    )
    try mic.start { [weak self] buffer, _ in
        guard let self = self, !self.isPaused else { return }
        writer.write(buffer: buffer)
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        self.levelsLock.lock()
        self.micLevel = level
        self.levelsLock.unlock()
    }
    micCapture = mic
    micWriter = writer
}

if let cameraId = config.cameraId {
    let camera = CameraCapture()
    let dims = try camera.startCapture(deviceId: cameraId) { [weak self] sampleBuffer in
        guard let self = self, self.isRecording, !self.isPaused else { return }
        self.cameraWriter?.appendVideoSample(sampleBuffer)
    }
    cameraWriter = try VideoWriter(
        outputURL: outputDir.appendingPathComponent("camera.mov"),
        width: dims.width, height: dims.height, fps: config.fps
    )
    cameraCapture = camera
}

frameCount = 0
startTime = mach_absolute_time()
isRecording = true

let videoHandler: (CMSampleBuffer) -> Void = { [weak self] sampleBuffer in
    guard let self = self, self.isRecording, !self.isPaused else { return }
    self.videoWriter?.appendVideoSample(sampleBuffer)
    self.frameCount += 1
}
let audioHandler: (CMSampleBuffer) -> Void = { [weak self] sampleBuffer in
    guard let self = self, self.isRecording, !self.isPaused else { return }
    self.systemAudioWriter?.appendAudioSample(sampleBuffer)
    let level = AudioLevelCalculator.peakLevel(from: sampleBuffer)
    self.levelsLock.lock()
    self.systemAudioLevel = level
    self.levelsLock.unlock()
}

if let windowId = config.windowId {
    try await screenCapture.startWindowCapture(
        windowID: windowId,
        fps: config.fps,
        captureAudio: config.captureSystemAudio,
        onVideoFrame: videoHandler,
        onAudioSample: audioHandler
    )
} else if let displayId = config.displayId {
    try await screenCapture.startCapture(
        displayID: displayId,
        fps: config.fps,
        captureAudio: config.captureSystemAudio,
        onVideoFrame: videoHandler,
        onAudioSample: audioHandler
    )
}
```

**Step 3: Build Swift to verify**

Run: `cd CaptureKitEngine && swift build -c release`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift
git commit -m "feat: recording pipeline supports window capture via windowId config"
```

---

### Task 3: Swift — Add `ck_list_windows` C API

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`

**Step 1: Add ck_list_windows function**

Add after `ck_list_displays` (line ~40):

```swift
@_cdecl("ck_list_windows")
public func ck_list_windows(outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    let semaphore = DispatchSemaphore(value: 0)
    var resultJson = "[]"
    var errorCode: Int32 = 0

    Task {
        do {
            let windows = try await ScreenCapture.listWindows()
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            let data = try encoder.encode(windows)
            resultJson = String(data: data, encoding: .utf8) ?? "[]"
        } catch {
            errorCode = -1
        }
        semaphore.signal()
    }

    semaphore.wait()
    outJson.pointee = strdup(resultJson)
    return errorCode
}
```

**Step 2: Build Swift to verify**

Run: `cd CaptureKitEngine && swift build -c release`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/capi.swift
git commit -m "feat: add ck_list_windows C API function"
```

---

### Task 4: Rust — Add window FFI and Tauri commands

**Files:**
- Modify: `src-tauri/src/swift_ffi.rs`
- Modify: `src-tauri/src/commands/sources.rs`
- Modify: `src-tauri/src/commands/recording.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add ck_list_windows to swift_ffi.rs**

In the `extern "C"` block (line ~6), add:

```rust
fn ck_list_windows(out_json: *mut *const c_char) -> i32;
```

In the `impl CaptureKitEngine` block, add:

```rust
pub fn list_windows() -> Result<String, String> {
    unsafe { call_json(|p| ck_list_windows(p)) }
}
```

**Step 2: Add WindowInfo struct and list_windows command to sources.rs**

Add after `CameraInfo` struct:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub bundle_id: String,
    pub app_icon: String,
}

#[tauri::command]
pub async fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let json = CaptureKitEngine::list_windows()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}
```

**Step 3: Update RecordingConfig in recording.rs**

Change `RecordingConfig` (line ~14):

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingConfig {
    pub display_id: Option<u32>,
    pub window_id: Option<u32>,
    pub mic_id: Option<String>,
    pub camera_id: Option<String>,
    pub capture_system_audio: bool,
    pub fps: u32,
}
```

**Step 4: Update start_recording command to pass window_id through FFI**

In `src-tauri/src/commands/recording.rs`, update the `swift_config` JSON in `start_recording` (line ~43) to include `window_id`:

```rust
let swift_config = serde_json::json!({
    "display_id": config.display_id,
    "window_id": config.window_id,
    "fps": config.fps,
    "capture_system_audio": config.capture_system_audio,
    "output_dir": raw.to_string_lossy(),
    "mic_id": config.mic_id,
    "camera_id": config.camera_id,
});
```

**Step 5: Register list_windows in lib.rs**

Add to the `generate_handler!` macro (line ~38):

```rust
commands::sources::list_windows,
```

**Step 6: Update Rust tests in recording.rs**

Update `test_recording_config_serializes_with_camera_id` to use the new optional fields:

```rust
let config = RecordingConfig {
    display_id: Some(1),
    window_id: None,
    mic_id: None,
    camera_id: Some("cam-abc".to_string()),
    capture_system_audio: true,
    fps: 60,
};
```

**Step 7: Build Rust to verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Build succeeds

**Step 8: Commit**

```bash
git add src-tauri/src/swift_ffi.rs src-tauri/src/commands/sources.rs src-tauri/src/commands/recording.rs src-tauri/src/lib.rs
git commit -m "feat: add list_windows Tauri command and update RecordingConfig for window capture"
```

---

### Task 5: Frontend — Add WindowInfo type and update RecordingConfig

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add WindowInfo type and update RecordingConfig**

Add after `CameraInfo`:

```ts
export interface WindowInfo {
  id: number
  app_name: string
  title: string
  x: number
  y: number
  width: number
  height: number
  bundle_id: string
  app_icon: string
}
```

Update `RecordingConfig`:

```ts
export interface RecordingConfig {
  display_id: number | null
  window_id: number | null
  mic_id: string | null
  camera_id: string | null
  capture_system_audio: boolean
  fps: number
}
```

**Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add WindowInfo type and update RecordingConfig for window capture"
```

---

### Task 6: Frontend — Update SourceTypeButton to support display/window toggle

**Files:**
- Modify: `src/components/recording/source-type-button.tsx`

**Step 1: Rewrite SourceTypeButton with two options**

```tsx
import { Monitor, AppWindow } from "lucide-react"

export type SourceType = "display" | "window"

interface Props {
  sourceType: SourceType
  onSourceTypeChange: (type: SourceType) => void
}

export function SourceTypeButton({ sourceType, onSourceTypeChange }: Props) {
  return (
    <div
      className="flex rounded-lg p-0.5"
      style={{ background: "rgba(255, 255, 255, 0.05)" }}
      role="radiogroup"
      aria-label="Capture source"
    >
      <button
        className={`toolbar-btn ${sourceType === "display" ? "active" : ""}`}
        role="radio"
        aria-checked={sourceType === "display"}
        onClick={() => onSourceTypeChange("display")}
      >
        <Monitor size={20} strokeWidth={2} />
        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.6 }}>Display</span>
      </button>
      <button
        className={`toolbar-btn ${sourceType === "window" ? "active" : ""}`}
        role="radio"
        aria-checked={sourceType === "window"}
        onClick={() => onSourceTypeChange("window")}
      >
        <AppWindow size={20} strokeWidth={2} />
        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.6 }}>Window</span>
      </button>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/recording/source-type-button.tsx
git commit -m "feat: SourceTypeButton supports display/window toggle"
```

---

### Task 7: Frontend — Create window picker overlay component

**Files:**
- Create: `src/components/recording/window-picker-overlay.tsx`

**Step 1: Create the overlay component**

This is the fullscreen overlay that shows when "Window" is selected. It:
- Fetches window list on mount
- Tracks mouse position and hit-tests against window rects
- Highlights hovered window
- On click, shows confirmation UI with app icon, name, dimensions
- "Start recording" button triggers recording

```tsx
import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Circle, X } from "lucide-react"
import type { WindowInfo } from "@/types"

interface MonitorInfo {
  height: number
  originX: number
  originY: number
}

interface Props {
  onStartRecording: (windowId: number) => void
  onCancel: () => void
}

export function WindowPickerOverlay({ onStartRecording, onCancel }: Props) {
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [hoveredWindow, setHoveredWindow] = useState<WindowInfo | null>(null)
  const [selectedWindow, setSelectedWindow] = useState<WindowInfo | null>(null)
  const [monitor, setMonitor] = useState<MonitorInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch windows and monitor info on mount
  useEffect(() => {
    Promise.all([
      invoke<WindowInfo[]>("list_windows"),
      getCurrentWindow().currentMonitor(),
    ])
      .then(([wins, mon]) => {
        setWindows(wins)
        if (mon) {
          setMonitor({
            height: mon.size.height / mon.scaleFactor,
            originX: mon.position.x / mon.scaleFactor,
            originY: mon.position.y / mon.scaleFactor,
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedWindow) {
          setSelectedWindow(null)
        } else {
          onCancel()
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedWindow, onCancel])

  // Convert macOS screen coords (bottom-left origin, global) to overlay coords (top-left origin)
  const toOverlayX = useCallback(
    (w: WindowInfo) => (monitor ? w.x - monitor.originX : w.x),
    [monitor]
  )
  const toOverlayY = useCallback(
    (w: WindowInfo) =>
      monitor ? monitor.height - (w.y - monitor.originY) - w.height : 0,
    [monitor]
  )

  // Hit-test mouse position against window rects
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (selectedWindow || !monitor) return

      const mx = e.clientX
      const my = e.clientY

      // Find the smallest window containing the point (topmost when overlapping)
      let best: WindowInfo | null = null
      let bestArea = Infinity

      for (const w of windows) {
        const wx = toOverlayX(w)
        const wy = toOverlayY(w)
        if (mx >= wx && mx <= wx + w.width && my >= wy && my <= wy + w.height) {
          const area = w.width * w.height
          if (area < bestArea) {
            bestArea = area
            best = w
          }
        }
      }

      setHoveredWindow(best)
    },
    [windows, selectedWindow, monitor, toOverlayX, toOverlayY]
  )

  const handleClick = useCallback(() => {
    if (hoveredWindow && !selectedWindow) {
      setSelectedWindow(hoveredWindow)
    }
  }, [hoveredWindow, selectedWindow])

  const handleStartRecording = useCallback(() => {
    if (selectedWindow) {
      onStartRecording(selectedWindow.id)
    }
  }, [selectedWindow, onStartRecording])

  // Empty state: no windows found
  if (!loading && windows.length === 0) {
    return (
      <div className="fixed inset-0" style={{ zIndex: 9999 }}>
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <p className="text-white/60 text-lg">No windows available</p>
          <button
            className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-lg transition-colors"
            onClick={onCancel}
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 cursor-crosshair"
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      style={{ zIndex: 9999 }}
    >
      {/* Dark backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Highlighted window cutout — smooth transitions between windows */}
      {hoveredWindow && !selectedWindow && (
        <div
          className="absolute border-[3px] border-blue-400 rounded-lg"
          style={{
            left: toOverlayX(hoveredWindow),
            top: toOverlayY(hoveredWindow),
            width: hoveredWindow.width,
            height: hoveredWindow.height,
            backgroundColor: "rgba(255,255,255,0.05)",
            boxShadow: "0 0 0 2px rgba(96,165,250,0.3)",
            pointerEvents: "none",
            transition: "left 150ms ease-out, top 150ms ease-out, width 150ms ease-out, height 150ms ease-out",
          }}
        />
      )}

      {/* Selected window confirmation */}
      {selectedWindow && (
        <>
          {/* Highlight the selected window */}
          <div
            className="absolute border-[3px] border-blue-500 rounded-lg"
            style={{
              left: toOverlayX(selectedWindow),
              top: toOverlayY(selectedWindow),
              width: selectedWindow.width,
              height: selectedWindow.height,
              backgroundColor: "rgba(255,255,255,0.08)",
              boxShadow: "0 0 0 2px rgba(59,130,246,0.3)",
              pointerEvents: "none",
            }}
          />

          {/* Confirmation card with glass-morphism */}
          <div
            className="absolute flex flex-col items-center gap-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6"
            style={{
              left: toOverlayX(selectedWindow) + selectedWindow.width / 2,
              top: toOverlayY(selectedWindow) + selectedWindow.height / 2,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
              animation: "picker-card-in 200ms ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* App icon */}
            {selectedWindow.app_icon && (
              <img
                src={`data:image/png;base64,${selectedWindow.app_icon}`}
                alt={selectedWindow.app_name}
                className="w-16 h-16 rounded-xl"
                draggable={false}
              />
            )}

            {/* App name */}
            <h2 className="text-xl font-semibold text-white">
              {selectedWindow.app_name}
            </h2>

            {/* Dimensions */}
            <span className="text-sm text-white/50">
              {selectedWindow.width} &times; {selectedWindow.height}
            </span>

            {/* Start recording button — red to match app recording color */}
            <button
              className="flex items-center gap-2 px-6 py-2.5 bg-red-500 hover:bg-red-400 text-white rounded-full font-medium transition-colors"
              onClick={handleStartRecording}
            >
              <Circle size={16} fill="#fff" stroke="none" />
              Start recording
            </button>
          </div>

          {/* Cancel button with subtle background */}
          <button
            className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/15 rounded-full text-white/60 hover:text-white transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              setSelectedWindow(null)
            }}
            aria-label="Cancel selection"
          >
            <X size={20} />
          </button>
        </>
      )}

      {/* Cancel hint */}
      {!selectedWindow && !loading && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/60 text-sm">
          Click a window to select it &middot; Press Escape to cancel
        </div>
      )}
    </div>
  )
}
```

Also add this CSS animation to `src/index.css`:

```css
@keyframes picker-card-in {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
```

**Step 2: Commit**

```bash
git add src/components/recording/window-picker-overlay.tsx
git commit -m "feat: WindowPickerOverlay component with hover highlight and confirmation UI"
```

---

### Task 8: Frontend — Create window picker Tauri command and RecorderApp integration

**Files:**
- Modify: `src/recorder-app.tsx`
- Modify: `src/main.tsx`

**Step 1: Add window-picker route to main.tsx**

Update `Root` component in `src/main.tsx`:

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { RecorderApp } from "./recorder-app"
import { EditorApp } from "./editor-app"
import { WindowPickerApp } from "./window-picker-app"

function Root() {
  const path = window.location.pathname
  if (path.startsWith("/editor")) return <EditorApp />
  if (path.startsWith("/window-picker")) return <WindowPickerApp />
  return <RecorderApp />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
```

**Step 2: Create WindowPickerApp**

Create `src/window-picker-app.tsx`:

```tsx
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { WindowPickerOverlay } from "@/components/recording/window-picker-overlay"

export function WindowPickerApp() {
  const handleStartRecording = async (windowId: number) => {
    // Communicate back to recorder via the recorder window
    const recorderWindow = (await import("@tauri-apps/api/webviewWindow")).WebviewWindow.getByLabel("recorder")
    if (recorderWindow) {
      await recorderWindow.emit("window-selected", { windowId })
    }
    getCurrentWindow().close()
  }

  const handleCancel = () => {
    getCurrentWindow().close()
  }

  return (
    <WindowPickerOverlay
      onStartRecording={handleStartRecording}
      onCancel={handleCancel}
    />
  )
}
```

**Step 3: Update RecorderApp to handle window source type**

In `src/recorder-app.tsx`, make the following changes:

Add imports:
```tsx
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { SourceType } from "@/components/recording/source-type-button"
```

Add state (after existing state declarations):
```tsx
const [sourceType, setSourceType] = useState<SourceType>("display")
```

Add refs for input state (to avoid stale closures in event listener — same pattern as existing shortcut refs):
```tsx
const micEnabledRef = useRef(micEnabled)
const selectedMicRef = useRef(selectedMic)
const cameraEnabledRef = useRef(cameraEnabled)
const selectedCameraRef = useRef(selectedCamera)
const systemAudioEnabledRef = useRef(systemAudioEnabled)
micEnabledRef.current = micEnabled
selectedMicRef.current = selectedMic
cameraEnabledRef.current = cameraEnabled
selectedCameraRef.current = selectedCamera
systemAudioEnabledRef.current = systemAudioEnabled
```

Add window-selected event listener (in a useEffect with no deps — uses refs):
```tsx
useEffect(() => {
  const unlisten = getCurrentWindow().listen<{ windowId: number }>(
    "window-selected",
    async (event) => {
      const windowId = event.payload.windowId
      setIsLoading(true)
      try {
        await invoke("start_recording", {
          config: {
            display_id: null,
            window_id: windowId,
            mic_id: micEnabledRef.current ? selectedMicRef.current : null,
            camera_id: cameraEnabledRef.current ? selectedCameraRef.current : null,
            capture_system_audio: systemAudioEnabledRef.current,
            fps: 60,
          },
        })
        setAppState("recording")
        setIsPaused(false)
      } catch (e) {
        console.error("Failed to start recording:", e)
      } finally {
        setIsLoading(false)
      }
    }
  )
  return () => { unlisten.then((fn) => fn()) }
}, [])
```

Add handler for source type change (uses the extracted `openWindowPicker`):
```tsx
const handleSourceTypeChange = async (type: SourceType) => {
  setSourceType(type)
  if (type === "window") {
    openWindowPicker()
  }
}
```

Update `handleStartRecording` to pass correct config. In window mode, the record button opens the picker overlay instead:
```tsx
const handleStartRecording = async () => {
  if (sourceType === "window") {
    // In window mode, the record button opens the picker
    openWindowPicker()
    return
  }
  if (!selectedDisplay) return

  if (countdownEnabled) {
    setAppState("countdown")
  } else {
    await startRecording()
  }
}

const startRecording = async () => {
  setIsLoading(true)
  try {
    await invoke("start_recording", {
      config: {
        display_id: selectedDisplay,
        window_id: null,
        mic_id: micEnabled ? selectedMic : null,
        camera_id: cameraEnabled ? selectedCamera : null,
        capture_system_audio: systemAudioEnabled,
        fps: 60,
      },
    })
    setAppState("recording")
    setIsPaused(false)
  } catch (e) {
    console.error("Failed to start recording:", e)
    setAppState("idle")
  } finally {
    setIsLoading(false)
  }
}
```

Extract the window picker opening logic into a reusable function (called from both `handleSourceTypeChange` and `handleStartRecording`):
```tsx
const openWindowPicker = async () => {
  try {
    const monitor = await getCurrentWindow().currentMonitor()
    if (!monitor) return
    const { width, height } = monitor.size
    const scaleFactor = monitor.scaleFactor

    new WebviewWindow("window-picker", {
      url: "/window-picker",
      width: width / scaleFactor,
      height: height / scaleFactor,
      x: 0,
      y: 0,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
    })
  } catch (e) {
    console.error("Failed to open window picker:", e)
  }
}
```

Update the `SourceTypeButton` usage in JSX:
```tsx
<SourceTypeButton
  sourceType={sourceType}
  onSourceTypeChange={handleSourceTypeChange}
/>
```

Update the record button disabled logic — in window mode, it should always be enabled (it opens the picker):
```tsx
<button
  className={`record-btn ${
    (sourceType === "display" && !selectedDisplay) || isLoading ? "disabled" : ""
  }`}
  onClick={handleStartRecording}
  disabled={(sourceType === "display" && !selectedDisplay) || isLoading}
  aria-label="Start Recording (Cmd+Shift+R)"
  title="Start Recording (Cmd+Shift+R)"
>
```

**Step 4: Update capabilities to allow window-picker window**

Modify `src-tauri/capabilities/default.json` — change `"windows": ["recorder"]` to:

```json
"windows": ["recorder", "window-picker"]
```

**Step 5: Build and verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/main.tsx src/window-picker-app.tsx src/recorder-app.tsx src/components/recording/source-type-button.tsx src-tauri/capabilities/default.json
git commit -m "feat: window picker overlay integration with recorder app"
```

---

### Task 9: Manual integration test

**Step 1: Run the full app**

Run: `npx tauri dev`

**Step 2: Test the flow**

1. Verify "Display" and "Window" buttons appear in the toolbar
2. Click "Window" — fullscreen overlay should appear
3. Hover over windows — hovered window should highlight
4. Click a window — confirmation UI should appear (icon, name, dimensions)
5. Click "Start recording" — recording should begin
6. Stop recording — verify the output video contains only the selected window

**Step 3: Fix any issues found during testing**

If coordinate mapping is off (macOS bottom-left vs top-left), adjust the `toScreenY` function in the overlay. The monitor position offset may also need to be accounted for.

**Step 4: Final commit with any fixes**

```bash
git add -A
git commit -m "fix: window picker integration fixes from manual testing"
```
