# Metal Preview Renderer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the CSS-based editor preview with Metal-rendered frames so preview is pixel-identical to export.

**Architecture:** The existing `MetalCompositor.renderFrame()` (already stateless) renders preview frames on demand at 720p. JPEG-encoded frames travel Swift → Rust FFI (raw bytes + length) → Tauri IPC (`tauri::ipc::Response`) → frontend `<canvas>` via `createImageBitmap`. A new `PreviewRenderer` Swift class owns AVAssetImageGenerators for random-access frame extraction, reuses MetalCompositor, and computes zoom/cursor/click state from timeline data. The **frontend owns sequence→source time mapping** (reusing existing `sequenceTimeToSourceTime()`) and passes `sourceTimeMs` to the backend, keeping the Swift side stateless w.r.t. sequence edits.

**Tech Stack:** Swift (AVFoundation, Metal, CoreGraphics), Rust (Tauri v2 IPC), TypeScript/React (Canvas API)

---

## Task 0: Swift — Make Shared Types Accessible

**Files:**
- Modify: `RekoEngine/Sources/RekoEngine/export/export-pipeline.swift` (line 281)

**Context:** `MouseEvt` is `private` in `export-pipeline.swift:281` but needs to be used by the new `PreviewRenderer` class in a different file. All other types (`ExportClip`, `ExportZoomEvent`, `ExportTransition`, `ExportMath.ClipOutputRange`) are already `public`.

**Step 1: Change `MouseEvt` from `private` to `public`**

In `RekoEngine/Sources/RekoEngine/export/export-pipeline.swift`, line 281, change:

```swift
private struct MouseEvt: Codable {
```

to:

```swift
public struct MouseEvt: Codable {
```

**Step 2: Build Swift to verify**

Run: `cd RekoEngine && swift build -c release 2>&1 | tail -20`

Expected: Successful build (no behavior change, just visibility).

**Step 3: Commit**

```bash
git add RekoEngine/Sources/RekoEngine/export/export-pipeline.swift
git commit -m "refactor: make MouseEvt public for preview renderer reuse"
```

---

## Task 1: Swift — `PreviewRenderer` Class

**Files:**
- Create: `RekoEngine/Sources/RekoEngine/preview/preview-renderer.swift`

**Context:** The `MetalCompositor` at `RekoEngine/Sources/RekoEngine/export/metal-compositor.swift` has a `renderFrame()` method (line ~769) that accepts screen/camera pixel buffers, effects, zoom, cursor, and click params and returns a composited `CVPixelBuffer`. The `ExportPipeline` at `export/export-pipeline.swift` has helper functions we need to reuse: `ExportMath.interpolateZoomEvents()` (line ~203), `cursorPosition()` (line ~721), `activeClick()` (line ~698). Mouse events are stored as JSONL with fields `{timeMs, x, y, type}`.

**Key architectural decision:** The frontend owns sequence→source time mapping (it already has `sequenceTimeToSourceTime()` in `src/lib/sequence.ts`). The Swift `renderFrame()` accepts `sourceTimeMs` (source video time) and `clipIndex` + `clipZoomEventsJson` for zoom state. This avoids duplicating sequence logic in Swift AND avoids stale clip ranges when the user edits clips.

**Step 1: Create the preview directory and file with the full class**

```swift
import Foundation
import AVFoundation
import CoreGraphics
import CoreVideo
import CoreMedia
import CoreImage

/// Renders composited preview frames on demand using the Metal compositor.
/// Lives for the duration of an editor session. Thread-safe for sequential calls.
///
/// Thread safety note: `ck_preview_frame` grabs a strong reference to the renderer
/// under the preview lock, then releases the lock before calling `renderFrame()`.
/// If `ck_preview_destroy` is called concurrently, it nils `activePreview` but ARC
/// keeps the object alive via the local strong reference. The local `comp`/`screenGen`
/// captures in `renderFrame()` are taken before any external mutation can affect them.
public class PreviewRenderer {
    private var compositor: MetalCompositor?
    private var screenGenerator: AVAssetImageGenerator?
    private var cameraGenerator: AVAssetImageGenerator?
    private var mouseEvents: [MouseEvt] = []
    private var outputWidth: Int = 1280
    private var outputHeight: Int = 720
    private var screenWidth: Int = 1920
    private var screenHeight: Int = 1080

    // Cached for performance — avoid per-frame allocation
    private var ciContext: CIContext?
    private var screenBufferPool: CVPixelBufferPool?
    private var cameraBufferPool: CVPixelBufferPool?

    public init() {}

    // MARK: - Public API

    /// Configure the preview renderer with project data.
    /// Returns (outputWidth, outputHeight) for the frontend to size its canvas.
    public func configure(projectJson: String) throws -> (width: Int, height: Int) {
        guard let data = projectJson.data(using: .utf8) else {
            throw PreviewError.invalidJson("Could not parse project JSON")
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]

        // Parse tracks
        guard let tracks = json["tracks"] as? [String: Any],
              let screenPath = tracks["screen"] as? String else {
            throw PreviewError.invalidJson("Missing tracks.screen")
        }

        // Probe screen video for dimensions
        let screenURL = URL(fileURLWithPath: screenPath)
        let screenAsset = AVURLAsset(url: screenURL)
        let screenTrack = screenAsset.tracks(withMediaType: .video).first
        if let track = screenTrack {
            let size = track.naturalSize.applying(track.preferredTransform)
            screenWidth = Int(abs(size.width))
            screenHeight = Int(abs(size.height))
        }

        // Compute 720p output preserving aspect ratio
        let aspect = Double(screenWidth) / Double(screenHeight)
        outputHeight = 720
        // Round width to even number (required for video)
        outputWidth = Int(round(720.0 * aspect / 2.0)) * 2

        // Screen image generator
        let sg = AVAssetImageGenerator(asset: screenAsset)
        sg.requestedTimeToleranceBefore = .zero
        sg.requestedTimeToleranceAfter = .zero
        sg.appliesPreferredTrackTransform = true
        screenGenerator = sg

        // Camera image generator (optional)
        if let cameraPath = tracks["camera"] as? String {
            let cameraURL = URL(fileURLWithPath: cameraPath)
            let cameraAsset = AVURLAsset(url: cameraURL)
            let cg = AVAssetImageGenerator(asset: cameraAsset)
            cg.requestedTimeToleranceBefore = .zero
            cg.requestedTimeToleranceAfter = .zero
            cg.appliesPreferredTrackTransform = true
            cameraGenerator = cg
        }

        // Load mouse events
        if let mouseEventsPath = tracks["mouseEvents"] as? String ?? tracks["mouse_events"] as? String {
            mouseEvents = loadMouseEvents(path: mouseEventsPath)
        }

        // Set up Metal compositor
        let comp = try MetalCompositor()
        try comp.configure(width: outputWidth, height: outputHeight)

        // Load background image if configured
        if let effects = json["effects"] as? [String: Any],
           let bg = effects["background"] as? [String: Any],
           let imageUrl = bg["imageUrl"] as? String, !imageUrl.isEmpty {
            let blur = bg["imageBlur"] as? Double ?? 0
            try comp.loadBackgroundImage(path: imageUrl, blur: blur, exportWidth: outputWidth)
        }

        compositor = comp

        // Cache CIContext for JPEG encoding (expensive to create, ~5-10ms)
        ciContext = CIContext()

        // Create pixel buffer pools for input frame conversion (avoids ~4MB alloc/free per frame)
        screenBufferPool = createPixelBufferPool(width: screenWidth, height: screenHeight)
        if cameraGenerator != nil {
            // Camera dimensions may differ; use screen dimensions as default,
            // actual camera frame size is handled in pixelBuffer(from:) fallback
            cameraBufferPool = createPixelBufferPool(width: screenWidth, height: screenHeight)
        }

        return (width: outputWidth, height: outputHeight)
    }

    /// Render a single composited preview frame.
    ///
    /// - Parameters:
    ///   - sourceTimeMs: Source video time in milliseconds (frontend maps sequence→source time)
    ///   - effectsJson: JSON string of Effects object
    ///   - zoomEventsJson: JSON string of ZoomEvent[] for the active clip (frontend provides per-clip zoom events)
    /// - Returns: JPEG-encoded frame data
    public func renderFrame(sourceTimeMs: UInt64, effectsJson: String, zoomEventsJson: String) throws -> Data {
        guard let comp = compositor, let screenGen = screenGenerator else {
            throw PreviewError.notConfigured
        }

        // Parse effects
        guard let effectsData = effectsJson.data(using: .utf8),
              let effectsDict = try? JSONSerialization.jsonObject(with: effectsData) as? [String: Any] else {
            throw PreviewError.invalidJson("Could not parse effects JSON")
        }
        let effects = ExportEffects(from: effectsDict)

        // Extract screen frame
        let cmTime = CMTime(value: Int64(sourceTimeMs), timescale: 1000)
        let screenCGImage = try screenGen.copyCGImage(at: cmTime, actualTime: nil)
        guard let screenBuffer = pixelBuffer(from: screenCGImage, pool: screenBufferPool) else {
            throw PreviewError.frameExtractionFailed
        }

        // Extract camera frame (optional)
        var cameraBuffer: CVPixelBuffer? = nil
        if let cameraGen = cameraGenerator {
            if let cameraCGImage = try? cameraGen.copyCGImage(at: cmTime, actualTime: nil) {
                cameraBuffer = pixelBuffer(from: cameraCGImage, pool: cameraBufferPool)
            }
        }

        // Compute zoom state from frontend-provided zoom events for the active clip
        var zoomX: Double = 0.5
        var zoomY: Double = 0.5
        var zoomScale: Double = 1.0
        if let zoomData = zoomEventsJson.data(using: .utf8),
           let zoomArr = try? JSONSerialization.jsonObject(with: zoomData) as? [[String: Any]] {
            let events = zoomArr.compactMap { ze -> ExportZoomEvent? in
                guard let id = ze["id"] as? String,
                      let t = ze["timeMs"] as? Double,
                      let d = ze["durationMs"] as? Double,
                      let x = ze["x"] as? Double,
                      let y = ze["y"] as? Double,
                      let scale = ze["scale"] as? Double else { return nil }
                return ExportZoomEvent(id: id, timeMs: UInt64(t), durationMs: UInt64(d), x: x, y: y, scale: scale)
            }
            if !events.isEmpty {
                // sourceTimeMs is already clip-relative for zoom computation
                // The frontend passes clipRelativeTimeMs via the zoom events' timeMs offsets
                let zoom = ExportMath.interpolateZoomEvents(events, at: sourceTimeMs)
                zoomX = zoom.x
                zoomY = zoom.y
                zoomScale = zoom.scale
            }
        }

        // Compute cursor position (binary search on source time)
        let cursor = cursorPosition(mouseEvents, at: sourceTimeMs)

        // Compute click state
        let click = activeClick(mouseEvents, at: sourceTimeMs)

        // Render composited frame
        let outputBuffer = try comp.renderFrame(
            screenPixelBuffer: screenBuffer,
            cameraPixelBuffer: cameraBuffer,
            effects: effects,
            screenWidth: screenWidth,
            screenHeight: screenHeight,
            zoomX: zoomX,
            zoomY: zoomY,
            zoomScale: zoomScale,
            cursorX: cursor?.x,
            cursorY: cursor?.y,
            clickX: click?.x,
            clickY: click?.y,
            clickProgress: click?.progress ?? 0
        )

        // JPEG encode using cached CIContext
        guard let jpegData = jpegEncode(pixelBuffer: outputBuffer) else {
            throw PreviewError.frameExtractionFailed
        }

        return jpegData
    }

    public func destroy() {
        compositor = nil
        screenGenerator = nil
        cameraGenerator = nil
        mouseEvents = []
        ciContext = nil
        screenBufferPool = nil
        cameraBufferPool = nil
    }

    // MARK: - Error Type

    private enum PreviewError: Error, LocalizedError {
        case invalidJson(String)
        case notConfigured
        case frameExtractionFailed

        var errorDescription: String? {
            switch self {
            case .invalidJson(let msg): return "Preview: \(msg)"
            case .notConfigured: return "Preview: not configured"
            case .frameExtractionFailed: return "Preview: frame extraction failed"
            }
        }
    }

    // MARK: - Mouse Events

    private func loadMouseEvents(path: String) -> [MouseEvt] {
        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
        return content.split(separator: "\n").compactMap { line in
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let timeMs = obj["timeMs"] as? Double,
                  let x = obj["x"] as? Double,
                  let y = obj["y"] as? Double else { return nil }
            let type = obj["type"] as? String ?? "move"
            return MouseEvt(timeMs: UInt64(timeMs), x: x, y: y, type: type)
        }
    }

    // MARK: - Pixel Buffer Conversion

    private func createPixelBufferPool(width: Int, height: Int) -> CVPixelBufferPool? {
        let poolAttrs: [String: Any] = [
            kCVPixelBufferPoolMinimumBufferCountKey as String: 3,
        ]
        let bufferAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ]
        var pool: CVPixelBufferPool?
        CVPixelBufferPoolCreate(kCFAllocatorDefault,
                                poolAttrs as CFDictionary,
                                bufferAttrs as CFDictionary,
                                &pool)
        return pool
    }

    private func pixelBuffer(from cgImage: CGImage, pool: CVPixelBufferPool?) -> CVPixelBuffer? {
        var buffer: CVPixelBuffer?

        // Try pool first (avoids per-frame allocation)
        if let pool = pool,
           cgImage.width == screenWidth && cgImage.height == screenHeight {
            CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &buffer)
        }

        // Fallback: direct allocation (handles mismatched dimensions)
        if buffer == nil {
            let attrs: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferMetalCompatibilityKey as String: true,
            ]
            CVPixelBufferCreate(kCFAllocatorDefault, cgImage.width, cgImage.height,
                                kCVPixelFormatType_32BGRA, attrs as CFDictionary, &buffer)
        }

        guard let buf = buffer else { return nil }
        CVPixelBufferLockBaseAddress(buf, [])
        let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf),
                            width: cgImage.width, height: cgImage.height,
                            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buf),
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue |
                                        CGImageAlphaInfo.premultipliedFirst.rawValue)
        ctx?.draw(cgImage, in: CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))
        CVPixelBufferUnlockBaseAddress(buf, [])
        return buf
    }

    // MARK: - JPEG Encoding

    private func jpegEncode(pixelBuffer: CVPixelBuffer) -> Data? {
        guard let ctx = ciContext else { return nil }
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        return ctx.jpegRepresentation(of: ciImage, colorSpace: colorSpace, options: [:])
    }

    // MARK: - Cursor & Click (same logic as ExportPipeline in export-pipeline.swift)

    private func cursorPosition(_ events: [MouseEvt], at timeMs: UInt64) -> (x: Double, y: Double)? {
        guard !events.isEmpty else { return nil }
        var lo = 0, hi = events.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if events[mid].timeMs <= timeMs { lo = mid } else { hi = mid - 1 }
        }
        if events[lo].timeMs > timeMs { return nil }
        return (events[lo].x, events[lo].y)
    }

    private func activeClick(_ events: [MouseEvt], at timeMs: UInt64) -> (x: Double, y: Double, progress: Double)? {
        guard !events.isEmpty else { return nil }
        var lo = 0, hi = events.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if events[mid].timeMs <= timeMs { lo = mid } else { hi = mid - 1 }
        }
        if events[lo].timeMs > timeMs { return nil }
        // Scan backwards for click within 500ms window
        let clickDuration: UInt64 = 500
        for i in stride(from: lo, through: 0, by: -1) {
            let e = events[i]
            if timeMs - e.timeMs > clickDuration { break }
            if e.type == "click" || e.type == "rightClick" {
                let elapsed = timeMs - e.timeMs
                let progress = Double(elapsed) / Double(clickDuration)
                return (e.x, e.y, min(1.0, progress))
            }
        }
        return nil
    }
}
```

**Step 2: Build Swift to verify compilation**

Run: `cd RekoEngine && swift build -c release 2>&1 | tail -20`

Expected: Successful build.

**Step 3: Commit**

```bash
git add RekoEngine/Sources/RekoEngine/preview/preview-renderer.swift
git commit -m "feat(preview): add PreviewRenderer class with Metal compositing"
```

---

## Task 2: Swift — C API Functions

**Files:**
- Modify: `RekoEngine/Sources/RekoEngine/capi.swift` (add after line 335, the `ck_finish_export` function)

**Context:** The existing C API pattern uses module-level storage with locks (e.g., `activeSessions`, `activeExports`). Preview is a singleton — only one editor session has an active preview at a time. We use raw bytes for the frame data hot path. `configure` now returns output dimensions as a JSON string so the frontend can size its canvas correctly.

**Step 1: Add the preview C API functions to capi.swift**

Append at the end of `capi.swift`:

```swift
// MARK: - Preview API

private var activePreview: PreviewRenderer? = nil
private let previewLock = NSLock()

/// Configure the preview renderer. Returns JSON: {"width": N, "height": N} or error code.
@_cdecl("ck_preview_configure")
public func ck_preview_configure(
    projectJson: UnsafePointer<CChar>,
    outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    let json = String(cString: projectJson)
    let renderer = PreviewRenderer()

    do {
        let dims = try renderer.configure(projectJson: json)
        previewLock.lock()
        activePreview = renderer
        previewLock.unlock()
        outJson.pointee = strdup("{\"width\":\(dims.width),\"height\":\(dims.height)}")
        return 0
    } catch {
        print("Preview configure error: \(error)")
        return -1
    }
}

/// Render a preview frame. Returns malloc'd JPEG bytes via pointer + length.
/// Caller must call ck_preview_free_bytes() on the returned pointer.
@_cdecl("ck_preview_frame")
public func ck_preview_frame(
    sourceTimeMs: UInt64,
    effectsJson: UnsafePointer<CChar>,
    zoomEventsJson: UnsafePointer<CChar>,
    outLength: UnsafeMutablePointer<Int>
) -> UnsafeMutablePointer<UInt8>? {
    // Grab strong reference under lock (ARC keeps object alive even if
    // ck_preview_destroy nils activePreview concurrently)
    previewLock.lock()
    guard let renderer = activePreview else {
        previewLock.unlock()
        outLength.pointee = 0
        return nil
    }
    previewLock.unlock()

    let effects = String(cString: effectsJson)
    let zoomEvents = String(cString: zoomEventsJson)

    do {
        let jpegData = try renderer.renderFrame(
            sourceTimeMs: sourceTimeMs,
            effectsJson: effects,
            zoomEventsJson: zoomEvents
        )
        let length = jpegData.count
        let ptr = UnsafeMutablePointer<UInt8>.allocate(capacity: length)
        jpegData.copyBytes(to: ptr, count: length)
        outLength.pointee = length
        return ptr
    } catch {
        print("Preview frame error: \(error)")
        outLength.pointee = 0
        return nil
    }
}

@_cdecl("ck_preview_free_bytes")
public func ck_preview_free_bytes(ptr: UnsafeMutablePointer<UInt8>?) {
    ptr?.deallocate()
}

@_cdecl("ck_preview_destroy")
public func ck_preview_destroy() {
    previewLock.lock()
    activePreview?.destroy()
    activePreview = nil
    previewLock.unlock()
}
```

**Step 2: Build Swift to verify**

Run: `cd RekoEngine && swift build -c release 2>&1 | tail -20`

Expected: Successful build.

**Step 3: Commit**

```bash
git add RekoEngine/Sources/RekoEngine/capi.swift
git commit -m "feat(preview): add C API functions for preview renderer"
```

---

## Task 3: Rust — FFI Wrappers

**Files:**
- Modify: `src-tauri/src/swift_ffi.rs` (add extern declarations + wrapper methods)

**Context:** Existing FFI pattern: `extern "C"` block for C function declarations, `RekoEngine` impl block for safe Rust wrappers. The `call_json` helper handles JSON-returning FFI calls. For preview frames we use raw byte pointers (`*mut u8` + `usize` length) instead of JSON. `configure` now returns JSON with output dimensions via the existing `call_json` pattern.

**Step 1: Add the extern "C" declarations**

In `src-tauri/src/swift_ffi.rs`, add these to the existing `extern "C"` block (after line 28, before the closing `}`):

```rust
    fn ck_preview_configure(
        project_json: *const c_char,
        out_json: *mut *const c_char,
    ) -> i32;
    fn ck_preview_frame(
        source_time_ms: u64,
        effects_json: *const c_char,
        zoom_events_json: *const c_char,
        out_length: *mut usize,
    ) -> *mut u8;
    fn ck_preview_free_bytes(ptr: *mut u8);
    fn ck_preview_destroy();
```

**Step 2: Add the safe wrapper methods to `impl RekoEngine`**

Add these methods inside the `impl RekoEngine` block (after `check_screen_recording_permission`, before the closing `}`):

```rust
    /// Configure the preview renderer. Returns JSON: {"width": N, "height": N}
    pub fn preview_configure(project_json: &str) -> Result<String, String> {
        let c = CString::new(project_json).map_err(|e| e.to_string())?;
        unsafe { call_json(|p| ck_preview_configure(c.as_ptr(), p)) }
    }

    /// Render a preview frame. Returns raw JPEG bytes.
    pub fn preview_frame(
        source_time_ms: u64,
        effects_json: &str,
        zoom_events_json: &str,
    ) -> Result<Vec<u8>, String> {
        let e = CString::new(effects_json).map_err(|e| e.to_string())?;
        let z = CString::new(zoom_events_json).map_err(|e| e.to_string())?;
        let mut length: usize = 0;
        unsafe {
            let ptr = ck_preview_frame(source_time_ms, e.as_ptr(), z.as_ptr(), &mut length);
            if ptr.is_null() || length == 0 {
                return Err("Failed to render preview frame".into());
            }
            let bytes = std::slice::from_raw_parts(ptr, length).to_vec();
            ck_preview_free_bytes(ptr);
            Ok(bytes)
        }
    }

    pub fn preview_destroy() {
        unsafe { ck_preview_destroy() }
    }
```

**Step 3: Build Rust to verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`

Expected: Successful compilation (linker warnings expected — Swift symbols resolve at final link).

**Step 4: Commit**

```bash
git add src-tauri/src/swift_ffi.rs
git commit -m "feat(preview): add Rust FFI wrappers for preview renderer"
```

---

## Task 4: Rust — Tauri Commands

**Files:**
- Create: `src-tauri/src/commands/preview.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod preview;`)
- Modify: `src-tauri/src/lib.rs` (register 3 new commands in `generate_handler!`)

**Context:** The `tauri-v2` skill should be invoked for Tauri command patterns. `configure_preview` now returns `PreviewDimensions` so the frontend knows the canvas size. `render_preview_frame` accepts `source_time_ms` (not sequence time) + `zoom_events_json` and returns raw binary via `tauri::ipc::Response`.

**Step 1: Create `src-tauri/src/commands/preview.rs`**

```rust
use crate::project;
use crate::swift_ffi::RekoEngine;

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDimensions {
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn configure_preview(project_id: String) -> Result<PreviewDimensions, String> {
    let project_path = project::project_dir(&project_id).join("project.json");
    let project_json = std::fs::read_to_string(&project_path).map_err(|e| e.to_string())?;
    let dims_json = RekoEngine::preview_configure(&project_json)?;
    serde_json::from_str(&dims_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn render_preview_frame(
    source_time_ms: u64,
    effects: serde_json::Value,
    zoom_events: serde_json::Value,
) -> Result<tauri::ipc::Response, String> {
    let effects_json = serde_json::to_string(&effects).map_err(|e| e.to_string())?;
    let zoom_events_json = serde_json::to_string(&zoom_events).map_err(|e| e.to_string())?;
    let jpeg_bytes = RekoEngine::preview_frame(source_time_ms, &effects_json, &zoom_events_json)?;
    Ok(tauri::ipc::Response::new(jpeg_bytes))
}

#[tauri::command]
pub fn destroy_preview() -> Result<(), String> {
    RekoEngine::preview_destroy();
    Ok(())
}
```

**Step 2: Add module to `src-tauri/src/commands/mod.rs`**

Add `pub mod preview;` to the module list:

```rust
pub mod editor;
pub mod export;
pub mod permissions;
pub mod preview;
pub mod recording;
pub mod sources;
```

**Step 3: Register commands in `src-tauri/src/lib.rs`**

Add these 3 entries to the `tauri::generate_handler![]` macro (after the existing `commands::export::finish_export` line ~151):

```rust
            commands::preview::configure_preview,
            commands::preview::render_preview_frame,
            commands::preview::destroy_preview,
```

**Step 4: Build to verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`

Expected: Successful compilation.

**Step 5: Commit**

```bash
git add src-tauri/src/commands/preview.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(preview): add Tauri commands for preview renderer"
```

---

## Task 5: Frontend — `usePlaybackClock` Hook

**Files:**
- Create: `src/hooks/use-playback-clock.ts`

**Context:** **CRITICAL FIX from review:** The old `useVideoSync` advanced `currentTime` during playback by reading `video.currentTime` from HTMLVideoElements in a RAF loop. With Metal preview, no video elements are registered with `useVideoSync` anymore, so pressing Play would do nothing — nothing advances `currentTime`.

This new hook is a standalone playback clock that uses `requestAnimationFrame` + wall-clock delta to advance `currentTime` in the editor store. It respects clip boundaries, speed changes, and sequence duration. It replaces the time-advancement responsibility of `useVideoSync`.

**Step 1: Create the playback clock hook**

```typescript
import { useRef, useCallback, useEffect } from "react"
import { useEditorStore } from "@/stores/editor-store"
import {
  sequenceTimeToSourceTime,
  getSequenceDuration,
} from "@/lib/sequence"

interface PlaybackClockOptions {
  onTimeUpdate?: (timeMs: number) => void
}

export function usePlaybackClock(options: PlaybackClockOptions = {}) {
  const rafRef = useRef<number>(0)
  const lastWallRef = useRef<number>(0)
  const playingRef = useRef(false)
  const onTimeUpdateRef = useRef(options.onTimeUpdate)
  onTimeUpdateRef.current = options.onTimeUpdate

  const stopLoop = useCallback(() => {
    playingRef.current = false
    cancelAnimationFrame(rafRef.current)
  }, [])

  const play = useCallback(() => {
    const state = useEditorStore.getState()
    const sequence = state.project?.sequence
    if (!sequence || sequence.clips.length === 0) return

    playingRef.current = true
    lastWallRef.current = performance.now()

    const tick = () => {
      if (!playingRef.current) return

      const now = performance.now()
      const wallDelta = now - lastWallRef.current
      lastWallRef.current = now

      const state = useEditorStore.getState()
      const sequence = state.project?.sequence
      if (!sequence) { stopLoop(); return }

      // Get current clip speed
      const mapping = sequenceTimeToSourceTime(
        state.currentTime, sequence.clips, sequence.transitions
      )
      const speed = mapping ? sequence.clips[mapping.clipIndex].speed : 1

      // Advance by wall-clock delta * clip speed
      const newTime = state.currentTime + wallDelta * speed
      const seqDuration = getSequenceDuration(sequence.clips, sequence.transitions)

      if (newTime >= seqDuration) {
        // End of sequence
        state.setCurrentTime(seqDuration)
        state.setIsPlaying(false)
        onTimeUpdateRef.current?.(seqDuration)
        stopLoop()
        return
      }

      state.setCurrentTime(newTime)
      onTimeUpdateRef.current?.(newTime)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [stopLoop])

  const pause = useCallback(() => {
    stopLoop()
  }, [stopLoop])

  const seek = useCallback((seqTimeMs: number) => {
    useEditorStore.getState().setCurrentTime(seqTimeMs)
    onTimeUpdateRef.current?.(seqTimeMs)
  }, [])

  // Cleanup
  useEffect(() => {
    return () => {
      playingRef.current = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return { play, pause, seek }
}
```

**Step 2: Commit**

```bash
git add src/hooks/use-playback-clock.ts
git commit -m "feat(preview): add standalone playback clock hook for Metal preview"
```

---

## Task 6: Frontend — `usePreviewRenderer` Hook

**Files:**
- Create: `src/hooks/use-preview-renderer.ts`

**Context:** The hook manages Metal frame requests: configure on project load (receives canvas dimensions), request frames on scrub/effects change, run RAF loop during playback. Sequence→source time mapping happens here (using existing `sequenceTimeToSourceTime` from `src/lib/sequence.ts`), so the Swift side never holds stale clip ranges. Uses a `queuedTimeRef` pattern to ensure the final frame during fast scrubbing is always rendered.

**Step 1: Create the hook file**

```typescript
import { useRef, useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useEditorStore } from "@/stores/editor-store"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

interface PreviewDimensions {
  width: number
  height: number
}

export function usePreviewRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const project = useEditorStore((s) => s.project)
  const effects = useEditorStore((s) => s.project?.effects)
  const currentTime = useEditorStore((s) => s.currentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)
  const pendingRef = useRef(false)
  const queuedTimeRef = useRef<number | null>(null)
  const effectsRef = useRef(effects)
  effectsRef.current = effects
  const [dims, setDims] = useState<PreviewDimensions | null>(null)

  // Configure on project load — receive canvas dimensions
  useEffect(() => {
    if (!project?.id) return
    invoke<PreviewDimensions>("configure_preview", { projectId: project.id })
      .then((d) => {
        setDims(d)
        // Set canvas size to match compositor output
        if (canvasRef.current) {
          canvasRef.current.width = d.width
          canvasRef.current.height = d.height
        }
      })
      .catch((e) => console.error("Preview configure failed:", e))
    return () => {
      invoke("destroy_preview").catch(() => {})
    }
  }, [project?.id, canvasRef])

  // Map sequence time to source time + zoom events for the active clip
  const mapTime = useCallback(
    (seqTimeMs: number) => {
      const sequence = useEditorStore.getState().project?.sequence
      if (!sequence || sequence.clips.length === 0) {
        return { sourceTimeMs: seqTimeMs, zoomEvents: [] }
      }
      const mapping = sequenceTimeToSourceTime(
        seqTimeMs,
        sequence.clips,
        sequence.transitions
      )
      if (!mapping) {
        return { sourceTimeMs: seqTimeMs, zoomEvents: [] }
      }
      const clip = sequence.clips[mapping.clipIndex]
      // Zoom events are clip-relative; pass source time relative to clip start
      // for zoom interpolation
      return {
        sourceTimeMs: mapping.sourceTime,
        zoomEvents: clip.zoomEvents ?? [],
      }
    },
    []
  )

  // Request a single frame — with queued-time pattern to avoid dropping the final scrub frame
  const requestFrame = useCallback(
    async (timeMs: number) => {
      if (pendingRef.current) {
        queuedTimeRef.current = timeMs // remember latest
        return
      }
      if (!canvasRef.current) return
      pendingRef.current = true
      queuedTimeRef.current = null
      try {
        const { sourceTimeMs, zoomEvents } = mapTime(timeMs)
        const jpegBytes: ArrayBuffer = await invoke("render_preview_frame", {
          sourceTimeMs: Math.round(sourceTimeMs),
          effects: effectsRef.current,
          zoomEvents,
        })
        const blob = new Blob([jpegBytes], { type: "image/jpeg" })
        const bitmap = await createImageBitmap(blob)
        const ctx = canvasRef.current?.getContext("2d")
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, ctx.canvas.width, ctx.canvas.height)
        }
        bitmap.close()
      } catch (e) {
        console.error("Preview frame failed:", e)
      } finally {
        pendingRef.current = false
        // If a frame was queued during this render, fire it now
        const queued = queuedTimeRef.current
        if (queued !== null) {
          queuedTimeRef.current = null
          requestFrame(queued)
        }
      }
    },
    [canvasRef, mapTime]
  )

  // Scrubbing: request frame when currentTime changes (not during playback)
  useEffect(() => {
    if (!isPlaying) {
      requestFrame(currentTime)
    }
  }, [currentTime, isPlaying, requestFrame])

  // Effects change: re-render current frame
  useEffect(() => {
    requestFrame(useEditorStore.getState().currentTime)
  }, [effects, requestFrame])

  // Playback loop: request frames as fast as Metal can render them
  useEffect(() => {
    if (!isPlaying) return
    let running = true
    const tick = () => {
      if (!running) return
      requestFrame(useEditorStore.getState().currentTime)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      running = false
    }
  }, [isPlaying, requestFrame])

  return { dims }
}
```

**Step 2: Commit**

```bash
git add src/hooks/use-preview-renderer.ts
git commit -m "feat(preview): add usePreviewRenderer hook with sequence time mapping"
```

---

## Task 7: Frontend — Rewrite `preview-canvas.tsx` + Update `editor-app.tsx`

**Files:**
- Modify: `src/components/editor/preview-canvas.tsx` (full rewrite)
- Modify: `src/editor-app.tsx` (swap to `usePlaybackClock`, remove `videoSync` prop from `PreviewCanvas`)

**Context:** The current `PreviewCanvas` (236 lines) renders a complex DOM tree with `<video>` elements, CSS transforms, radial gradients, and overlay divs. The new version replaces all of that with a `<canvas>` driven by `usePreviewRenderer` plus hidden `<audio>` elements for preview audio. Audio sync uses `sequenceTimeToSourceTime` to correctly map sequence time to source time (handles trimmed/reordered clips).

`editor-app.tsx` switches from `useVideoSync` to `usePlaybackClock` for time advancement. `useVideoSync` is kept for now (used by `Timeline` and `PlaybackControls`) but its `play/pause` methods are replaced by the playback clock.

**Step 1: Rewrite `preview-canvas.tsx`**

Replace the entire file content:

```tsx
import { useRef, useEffect } from "react"
import { usePreviewRenderer } from "@/hooks/use-preview-renderer"
import { useEditorStore } from "@/stores/editor-store"
import { assetUrl } from "@/lib/asset-url"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const micRef = useRef<HTMLAudioElement>(null)
  const systemAudioRef = useRef<HTMLAudioElement>(null)
  const { dims } = usePreviewRenderer(canvasRef)

  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)

  // Sync audio on seek (when not playing) — map sequence time → source time
  useEffect(() => {
    if (isPlaying || !project?.sequence) return
    const mapping = sequenceTimeToSourceTime(
      currentTime,
      project.sequence.clips,
      project.sequence.transitions
    )
    if (mapping) {
      const sourceTimeSec = mapping.sourceTime / 1000
      if (micRef.current) micRef.current.currentTime = sourceTimeSec
      if (systemAudioRef.current) systemAudioRef.current.currentTime = sourceTimeSec
    }
  }, [currentTime, isPlaying, project?.sequence])

  // Play/pause audio
  useEffect(() => {
    const audios = [micRef.current, systemAudioRef.current].filter(
      Boolean
    ) as HTMLAudioElement[]
    if (isPlaying && project?.sequence) {
      const mapping = sequenceTimeToSourceTime(
        useEditorStore.getState().currentTime,
        project.sequence.clips,
        project.sequence.transitions
      )
      if (mapping) {
        const clip = project.sequence.clips[mapping.clipIndex]
        const sourceTimeSec = mapping.sourceTime / 1000
        audios.forEach((a) => {
          a.currentTime = sourceTimeSec
          a.playbackRate = clip.speed
          a.play().catch(() => {})
        })
      }
    } else {
      audios.forEach((a) => a.pause())
    }
  }, [isPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null

  return (
    <div
      className="relative w-full aspect-video overflow-hidden ring-1 ring-white/5 select-none"
      style={{ borderRadius: 8 }}
    >
      <canvas
        ref={canvasRef}
        width={dims?.width ?? 1280}
        height={dims?.height ?? 720}
        className="w-full h-full"
      />
      {/* Hidden audio elements for preview playback */}
      {project.tracks.mic && (
        <audio
          ref={micRef}
          src={assetUrl(project.tracks.mic)}
          preload="auto"
        />
      )}
      {project.tracks.system_audio && (
        <audio
          ref={systemAudioRef}
          src={assetUrl(project.tracks.system_audio)}
          preload="auto"
        />
      )}
    </div>
  )
}
```

**Step 2: Update `editor-app.tsx`**

In `src/editor-app.tsx`:

1. Add import for `usePlaybackClock`:
```typescript
import { usePlaybackClock } from "@/hooks/use-playback-clock"
```

2. In `EditorContent`, add the playback clock alongside the existing `useVideoSync`:
```typescript
  const playbackClock = usePlaybackClock({
    onTimeUpdate: setCurrentTime,
  })
```

3. Change `PreviewCanvas` usage (line ~211) — remove `videoSync` prop:
```tsx
            <PreviewCanvas />
```

4. Wire `PlaybackControls` to use the playback clock for play/pause. The exact wiring depends on how `PlaybackControls` consumes `videoSync` — it likely calls `videoSync.play()` and `videoSync.pause()`. Pass `playbackClock` alongside or merge into `videoSync`. Check `PlaybackControls` implementation for the correct approach.

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: No errors.

**Step 4: Commit**

```bash
git add src/components/editor/preview-canvas.tsx src/editor-app.tsx
git commit -m "feat(preview): rewrite PreviewCanvas with Metal canvas + audio sync"
```

---

## Task 8: Integration Test — Full Build & Manual Verification

**Files:** None (verification only)

**Step 1: Full Tauri build**

Run: `npx tauri dev 2>&1`

Expected: App launches. If Swift linker errors occur, they'll be about missing symbols. Check that `build.rs` links the RekoEngine static library.

**Step 2: Manual test checklist**

Open a project in the editor and verify:
- [ ] Preview canvas shows a Metal-rendered frame (not a black/empty canvas)
- [ ] Canvas dimensions match the video aspect ratio (not stretched)
- [ ] Scrubbing the timeline updates the preview frame
- [ ] Fast scrubbing lands on the final frame (queuedTimeRef pattern works)
- [ ] Changing effects (background, shadow, border radius) re-renders the frame
- [ ] Zoom keyframes are applied correctly in the preview
- [ ] Cursor highlight appears when enabled
- [ ] Click ripples animate when cursor clicks are present
- [ ] Camera bubble appears when camera track exists
- [ ] Pressing Play advances the timeline (playback clock works)
- [ ] Audio plays during playback in sync with video
- [ ] Audio seeks correctly when scrubbing (especially with trimmed clips)
- [ ] Editing a clip (trim, speed change) shows correct preview at current time
- [ ] Export still works correctly (regression check)

**Step 3: Fix any issues found**

Common issues:
- Zoom event `timeMs` values need to be clip-relative for the Swift `interpolateZoomEvents` — verify the frontend passes them correctly
- Audio playback rate may not update when crossing clip boundaries during playback
- JPEG quality/size — if frames are too large, add compression quality option: `ctx.jpegRepresentation(of:colorSpace:options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.85])`
- Canvas aspect ratio mismatch — ensure `dims` from `configure_preview` propagates before first frame render

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix(preview): address integration issues from Metal preview renderer"
```

---

## File Changes Summary

| File | Action | Task |
|---|---|---|
| `RekoEngine/Sources/RekoEngine/export/export-pipeline.swift` | **Edit** (make `MouseEvt` public) | 0 |
| `RekoEngine/Sources/RekoEngine/preview/preview-renderer.swift` | **Create** | 1 |
| `RekoEngine/Sources/RekoEngine/capi.swift` | **Edit** | 2 |
| `src-tauri/src/swift_ffi.rs` | **Edit** | 3 |
| `src-tauri/src/commands/preview.rs` | **Create** | 4 |
| `src-tauri/src/commands/mod.rs` | **Edit** | 4 |
| `src-tauri/src/lib.rs` | **Edit** | 4 |
| `src/hooks/use-playback-clock.ts` | **Create** | 5 |
| `src/hooks/use-preview-renderer.ts` | **Create** | 6 |
| `src/components/editor/preview-canvas.tsx` | **Rewrite** | 7 |
| `src/editor-app.tsx` | **Edit** | 7 |

**NOT deleted:** `src/hooks/use-video-sync.ts` — still used by `Timeline` and `PlaybackControls` for seek functionality. `src/hooks/use-mouse-events.ts` — no longer imported by preview-canvas but may be used elsewhere; keep it.

---

## Review Fixes Incorporated

| Review Issue | Resolution |
|---|---|
| **CRITICAL: No playback time advancement** | Added Task 5: `usePlaybackClock` hook with RAF + wall-clock delta |
| **MAJOR: `ExportTransition` missing `type` param** | Removed clip range parsing from Swift entirely — frontend owns time mapping |
| **MAJOR: Types wrongly namespaced `ExportMath.X`** | Removed clip range parsing from Swift entirely — no longer needed |
| **MAJOR: `MouseEvt` is private** | Task 0: change to `public` in export-pipeline.swift |
| **MAJOR: No CVPixelBufferPool** | Task 1: added `screenBufferPool`/`cameraBufferPool` with pool-first allocation |
| **MAJOR: CIContext created per frame** | Task 1: cached as instance property, initialized in `configure()` |
| **MAJOR: Scrub drops final frame** | Task 6: `queuedTimeRef` pattern in `requestFrame` |
| **MAJOR: Canvas hardcoded 1280x720** | Tasks 2+4+6: `configure_preview` returns `{width, height}`, canvas sizes dynamically |
| **MAJOR: Audio ignores sequence mapping** | Task 7: audio sync uses `sequenceTimeToSourceTime()` |
| **MAJOR: Stale clipRanges after edits** | Architectural change: frontend owns sequence→source time mapping, passes `sourceTimeMs` + `zoomEvents` per frame |
