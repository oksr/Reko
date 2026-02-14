# Phase 5: Auto-Zoom + Cursor Effects Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record mouse events during capture, generate auto-zoom keyframes from click patterns, render cursor highlight/spotlight effects in both CSS preview and Metal export, and add a keyframe timeline for manual editing.

**Architecture:** CGEvent tap in Swift logs mouse events to `mouse_events.jsonl` during recording. A pure-math auto-zoom generator in Rust converts click positions into zoom keyframes with easing. The frontend renders cursor effects via CSS overlays on the preview canvas, interpolating position from the mouse event log. The Metal compositor gains new uniforms for zoom crop region and cursor spotlight. Keyframes are stored in `Effects` and editable on the timeline.

**Tech Stack:** CGEventTap (Swift), serde (Rust auto-zoom math), CSS transforms + overlays (preview), Metal shader uniforms (export), zustand (keyframe state)

---

## Overview of All Tasks

| # | Component | What |
|---|-----------|------|
| 1 | Data model | Add zoom keyframes, cursor config, mouse events to TS/Rust/Swift types |
| 2 | Mouse logger | CGEvent tap in Swift, writes `mouse_events.jsonl` during recording |
| 3 | Recording integration | Wire mouse logger into RecordingPipeline, return path in RecordingResult |
| 4 | Auto-zoom generator | Pure Rust math: clicks → zoom keyframes with easing |
| 5 | Zustand store | Add cursor/zoom state, keyframe CRUD, auto-zoom action |
| 6 | Cursor overlay (preview) | CSS-based cursor highlight/spotlight on preview canvas |
| 7 | Zoom crop (preview) | CSS transform for zoom effect on screen video |
| 8 | Inspector panels | Cursor panel + zoom panel in editor sidebar |
| 9 | Keyframe timeline | Visual keyframe markers on the timeline, add/delete |
| 10 | Metal compositor (export) | Add cursor + zoom uniforms to shader, extend ExportEffects |
| 11 | Export pipeline integration | Pass zoom/cursor per-frame to MetalCompositor |

---

## Task 1: Data Model — Zoom Keyframes, Cursor Config, Mouse Events

**Files:**
- Modify: `src/types/editor.ts`
- Modify: `src-tauri/src/project.rs`

### Step 1: Add TypeScript types

Add to the bottom of `src/types/editor.ts` (before closing, after `ExportResult`):

```typescript
export interface MouseEvent {
  timeMs: number
  x: number           // normalized 0-1 (fraction of screen width)
  y: number           // normalized 0-1 (fraction of screen height)
  type: "move" | "click" | "rightClick" | "scroll"
}

export interface ZoomKeyframe {
  timeMs: number
  x: number           // center of zoom region, normalized 0-1
  y: number           // center of zoom region, normalized 0-1
  scale: number       // 1.0 = no zoom, 2.0 = 2x zoom, etc.
  easing: "ease-in-out" | "ease-in" | "ease-out" | "linear"
  durationMs: number  // transition duration to reach this keyframe
}

export interface CursorConfig {
  enabled: boolean
  type: "highlight" | "spotlight"
  size: number        // px radius (20-80)
  color: string       // hex, used for highlight ring
  opacity: number     // 0-1
}
```

Extend the existing `Effects` interface:

```typescript
export interface Effects {
  background: BackgroundConfig
  cameraBubble: CameraBubbleConfig
  frame: FrameConfig
  cursor: CursorConfig
  zoomKeyframes: ZoomKeyframe[]
}
```

### Step 2: Add Rust types

Add to `src-tauri/src/project.rs` after `FrameConfig`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CursorConfig {
    pub enabled: bool,
    #[serde(rename = "type")]
    pub cursor_type: String,      // "highlight" | "spotlight"
    pub size: f64,                // px radius
    pub color: String,            // hex
    pub opacity: f64,             // 0-1
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ZoomKeyframe {
    pub time_ms: u64,
    pub x: f64,                   // 0-1 normalized
    pub y: f64,                   // 0-1 normalized
    pub scale: f64,               // 1.0 = no zoom
    pub easing: String,           // "ease-in-out" | "ease-in" | "ease-out" | "linear"
    pub duration_ms: u64,
}
```

Extend `Effects`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Effects {
    pub background: BackgroundConfig,
    pub camera_bubble: CameraBubbleConfig,
    pub frame: FrameConfig,
    #[serde(default)]
    pub cursor: Option<CursorConfig>,
    #[serde(default)]
    pub zoom_keyframes: Option<Vec<ZoomKeyframe>>,
}
```

### Step 3: Write failing test for new types

Add to `project.rs` test module:

```rust
#[test]
fn test_cursor_config_serialization() {
    let config = CursorConfig {
        enabled: true,
        cursor_type: "highlight".to_string(),
        size: 40.0,
        color: "#ffcc00".to_string(),
        opacity: 0.6,
    };
    let json = serde_json::to_string(&config).unwrap();
    assert!(json.contains("\"type\":\"highlight\""));
    assert!(json.contains("\"opacity\":0.6"));
    let parsed: CursorConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.cursor_type, "highlight");
}

#[test]
fn test_zoom_keyframe_serialization() {
    let kf = ZoomKeyframe {
        time_ms: 5000,
        x: 0.5,
        y: 0.3,
        scale: 2.0,
        easing: "ease-in-out".to_string(),
        duration_ms: 500,
    };
    let json = serde_json::to_string(&kf).unwrap();
    assert!(json.contains("\"timeMs\":5000"));
    assert!(json.contains("\"durationMs\":500"));
    let parsed: ZoomKeyframe = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.scale, 2.0);
}

#[test]
fn test_effects_with_cursor_and_zoom() {
    let json = r#"{"background":{"type":"solid","color":"#000","gradientFrom":"#000","gradientTo":"#000","gradientAngle":0,"padding":8,"presetId":null},"cameraBubble":{"visible":false,"position":"bottom-right","size":15,"shape":"circle","borderWidth":3,"borderColor":"#fff"},"frame":{"borderRadius":12,"shadow":true,"shadowIntensity":0.5},"cursor":{"type":"highlight","enabled":true,"size":40,"color":"#ffcc00","opacity":0.6},"zoomKeyframes":[{"timeMs":5000,"x":0.5,"y":0.3,"scale":2.0,"easing":"ease-in-out","durationMs":500}]}"#;
    let parsed: Effects = serde_json::from_str(json).unwrap();
    assert!(parsed.cursor.is_some());
    assert_eq!(parsed.zoom_keyframes.unwrap().len(), 1);
}

#[test]
fn test_effects_without_cursor_backward_compat() {
    // Old projects without cursor/zoomKeyframes should still deserialize
    let json = r#"{"background":{"type":"solid","color":"#000","gradientFrom":"#000","gradientTo":"#000","gradientAngle":0,"padding":8,"presetId":null},"cameraBubble":{"visible":false,"position":"bottom-right","size":15,"shape":"circle","borderWidth":3,"borderColor":"#fff"},"frame":{"borderRadius":12,"shadow":true,"shadowIntensity":0.5}}"#;
    let parsed: Effects = serde_json::from_str(json).unwrap();
    assert!(parsed.cursor.is_none());
    assert!(parsed.zoom_keyframes.is_none());
}
```

### Step 4: Run tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS

### Step 5: Commit

```bash
git add src/types/editor.ts src-tauri/src/project.rs
git commit -m "feat(phase5): add cursor config, zoom keyframe, and mouse event types"
```

---

## Task 2: Mouse Event Logger (Swift)

CGEvent tap captures mouse moves, clicks, and scrolls during recording. Writes JSONL to `mouse_events.jsonl`.

**Files:**
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/capture/mouse-logger.swift`
- Test: `CaptureKitEngine/Tests/CaptureKitEngineTests/MouseLoggerTests.swift`

### Step 1: Write test for JSONL formatting

Create `CaptureKitEngine/Tests/CaptureKitEngineTests/MouseLoggerTests.swift`:

```swift
import XCTest
@testable import CaptureKitEngine

final class MouseLoggerTests: XCTestCase {

    func testMouseEventToJSON() {
        let event = MouseLogEvent(
            timeMs: 1234,
            x: 0.5,
            y: 0.3,
            type: "click"
        )
        let json = event.toJSON()
        XCTAssertTrue(json.contains("\"timeMs\":1234"))
        XCTAssertTrue(json.contains("\"x\":0.5"))
        XCTAssertTrue(json.contains("\"type\":\"click\""))
        // Should be a single line (JSONL format)
        XCTAssertFalse(json.contains("\n"))
    }

    func testNormalizedCoordinates() {
        // Screen 1920x1080, mouse at (960, 540) → (0.5, 0.5)
        let (nx, ny) = MouseLogEvent.normalize(
            mouseX: 960, mouseY: 540,
            screenWidth: 1920, screenHeight: 1080
        )
        XCTAssertEqual(nx, 0.5, accuracy: 0.001)
        XCTAssertEqual(ny, 0.5, accuracy: 0.001)
    }

    func testNormalizedCoordinatesClamped() {
        // Off-screen coordinates should clamp to 0-1
        let (nx, ny) = MouseLogEvent.normalize(
            mouseX: -100, mouseY: 2000,
            screenWidth: 1920, screenHeight: 1080
        )
        XCTAssertEqual(nx, 0.0, accuracy: 0.001)
        XCTAssertEqual(ny, 1.0, accuracy: 0.001)
    }
}
```

### Step 2: Run test to verify it fails

```bash
cd CaptureKitEngine && swift test --filter MouseLoggerTests
```

Expected: FAIL — `MouseLogEvent` not found.

### Step 3: Implement mouse logger

Create `CaptureKitEngine/Sources/CaptureKitEngine/capture/mouse-logger.swift`:

```swift
import Foundation
import CoreGraphics

// MARK: - Mouse Log Event

public struct MouseLogEvent {
    public let timeMs: UInt64
    public let x: Double     // 0-1 normalized
    public let y: Double     // 0-1 normalized
    public let type: String  // "move", "click", "rightClick", "scroll"

    public func toJSON() -> String {
        return "{\"timeMs\":\(timeMs),\"x\":\(String(format: "%.4f", x)),\"y\":\(String(format: "%.4f", y)),\"type\":\"\(type)\"}"
    }

    public static func normalize(
        mouseX: CGFloat, mouseY: CGFloat,
        screenWidth: Int, screenHeight: Int
    ) -> (Double, Double) {
        let nx = min(max(Double(mouseX) / Double(screenWidth), 0), 1)
        let ny = min(max(Double(mouseY) / Double(screenHeight), 0), 1)
        return (nx, ny)
    }
}

// MARK: - Mouse Logger

/// Logs mouse events to a JSONL file using CGEvent tap.
/// Requires Accessibility permission (Input Monitoring on macOS 14+).
public final class MouseLogger {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var fileHandle: FileHandle?
    private let outputURL: URL
    private let screenWidth: Int
    private let screenHeight: Int
    private var startTime: UInt64 = 0
    private var isPaused = false

    // Throttle: skip move events if less than 16ms apart (~60fps)
    private var lastMoveTimeMs: UInt64 = 0
    private let moveThrottleMs: UInt64 = 16

    public init(outputURL: URL, screenWidth: Int, screenHeight: Int) {
        self.outputURL = outputURL
        self.screenWidth = screenWidth
        self.screenHeight = screenHeight
    }

    public func start() -> Bool {
        // Create output file
        FileManager.default.createFile(atPath: outputURL.path, contents: nil)
        fileHandle = FileHandle(forWritingAtPath: outputURL.path)

        startTime = currentTimeMs()

        // Create event tap for mouse events
        let eventMask: CGEventMask = (
            (1 << CGEventType.mouseMoved.rawValue) |
            (1 << CGEventType.leftMouseDown.rawValue) |
            (1 << CGEventType.rightMouseDown.rawValue) |
            (1 << CGEventType.leftMouseDragged.rawValue) |
            (1 << CGEventType.scrollWheel.rawValue)
        )

        // The callback needs to be a C function pointer — use a static wrapper
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,     // passive — doesn't block or modify events
            eventsOfInterest: eventMask,
            callback: mouseEventCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            print("MouseLogger: Failed to create event tap. Check Accessibility permissions.")
            return false
        }

        eventTap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        runLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)

        return true
    }

    public func pause() { isPaused = true }
    public func resume() { isPaused = false }

    public func stop() {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .commonModes)
        }
        eventTap = nil
        runLoopSource = nil
        fileHandle?.closeFile()
        fileHandle = nil
    }

    // Called from the C callback
    fileprivate func handleEvent(_ event: CGEvent) {
        guard !isPaused else { return }

        let location = event.location
        let (nx, ny) = MouseLogEvent.normalize(
            mouseX: location.x, mouseY: location.y,
            screenWidth: screenWidth, screenHeight: screenHeight
        )

        let timeMs = currentTimeMs() - startTime

        let eventType: String
        switch event.type {
        case .mouseMoved, .leftMouseDragged:
            // Throttle move events
            guard timeMs - lastMoveTimeMs >= moveThrottleMs else { return }
            lastMoveTimeMs = timeMs
            eventType = "move"
        case .leftMouseDown:
            eventType = "click"
        case .rightMouseDown:
            eventType = "rightClick"
        case .scrollWheel:
            eventType = "scroll"
        default:
            return
        }

        let logEvent = MouseLogEvent(timeMs: timeMs, x: nx, y: ny, type: eventType)
        let line = logEvent.toJSON() + "\n"
        if let data = line.data(using: .utf8) {
            fileHandle?.write(data)
        }
    }

    private func currentTimeMs() -> UInt64 {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return mach_absolute_time() * UInt64(info.numer) / UInt64(info.denom) / 1_000_000
    }
}

// C-compatible callback for CGEvent tap
private func mouseEventCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let userInfo = userInfo else { return Unmanaged.passRetained(event) }
    let logger = Unmanaged<MouseLogger>.fromOpaque(userInfo).takeUnretainedValue()
    logger.handleEvent(event)
    return Unmanaged.passRetained(event)
}
```

### Step 4: Run tests

```bash
cd CaptureKitEngine && swift test --filter MouseLoggerTests
```

Expected: PASS (tests only exercise the pure functions, not the CGEvent tap)

### Step 5: Build framework

```bash
cd CaptureKitEngine && swift build -c release
```

Expected: BUILD SUCCEEDED

### Step 6: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/capture/mouse-logger.swift \
        CaptureKitEngine/Tests/CaptureKitEngineTests/MouseLoggerTests.swift
git commit -m "feat(phase5): mouse event logger with CGEvent tap"
```

---

## Task 3: Wire Mouse Logger into Recording Pipeline

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift`

### Step 1: Add MouseLogger to RecordingPipeline

In `recording-pipeline.swift`, add:

1. A `mouseLogger` property alongside the other capture properties:

```swift
private var mouseLogger: MouseLogger?
```

2. In `start()`, after camera setup and before `frameCount = 0`, add:

```swift
// Start mouse logging
let mouseOutputURL = outputDir.appendingPathComponent("mouse_events.jsonl")
let logger = MouseLogger(
    outputURL: mouseOutputURL,
    screenWidth: display.width,
    screenHeight: display.height
)
if logger.start() {
    mouseLogger = logger
}
```

3. In `pause()`, add: `mouseLogger?.pause()`

4. In `resume()`, add: `mouseLogger?.resume()`

5. In `stop()`, before the return statement, add: `mouseLogger?.stop()`

6. In `RecordingResult`, add a new field:

```swift
public let mouseEventsPath: String?
```

And in the return statement of `stop()`, set:

```swift
mouseEventsPath: mouseLogger != nil ? "mouse_events.jsonl" : nil,
```

### Step 2: Update Tracks in Rust to include mouse events path

In `src-tauri/src/project.rs`, add to `Tracks`:

```rust
pub mouse_events: Option<String>,
```

In `src-tauri/src/commands/recording.rs`, in `stop_recording`, where `Tracks` is constructed from the Swift result, add the `mouse_events` field:

```rust
mouse_events: swift_result.mouse_events_path.clone(),
```

Update the `SwiftRecordingResult` deserialization struct to include:

```rust
pub mouse_events_path: Option<String>,
```

Also update `src/types/editor.ts` — add `mouse_events: string | null` to the `tracks` field of `EditorProject`.

### Step 3: Build full stack

```bash
cd CaptureKitEngine && swift build -c release
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: BUILD SUCCEEDED for both

### Step 4: Run Rust tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS (update existing `test_tracks_serialization_*` tests to include `mouse_events: None`)

### Step 5: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift \
        src-tauri/src/project.rs \
        src-tauri/src/commands/recording.rs \
        src/types/editor.ts
git commit -m "feat(phase5): wire mouse logger into recording pipeline"
```

---

## Task 4: Auto-Zoom Generator (Rust Pure Math)

Converts mouse click events into zoom keyframes. Pure math — no platform dependencies.

**Files:**
- Create: `src-tauri/src/autozoom.rs`
- Modify: `src-tauri/src/lib.rs` (register module + command)
- Modify: `src-tauri/src/commands/editor.rs` (add Tauri command)

### Step 1: Write failing tests

Create `src-tauri/src/autozoom.rs`:

```rust
use crate::project::ZoomKeyframe;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseEvent {
    pub time_ms: u64,
    pub x: f64,
    pub y: f64,
    #[serde(rename = "type")]
    pub event_type: String,
}

/// Generate zoom keyframes from mouse click events.
///
/// Algorithm:
/// 1. Filter to click events only
/// 2. Group clicks that are close in time (within `cluster_ms`)
/// 3. For each cluster, create a zoom-in keyframe at the cluster center
/// 4. After each zoom-in, add a zoom-out keyframe (`hold_ms` later)
/// 5. Ensure keyframes don't overlap
pub fn generate_zoom_keyframes(
    events: &[MouseEvent],
    zoom_scale: f64,
    transition_ms: u64,
    hold_ms: u64,
    cluster_ms: u64,
) -> Vec<ZoomKeyframe> {
    // Filter clicks only
    let clicks: Vec<&MouseEvent> = events
        .iter()
        .filter(|e| e.event_type == "click" || e.event_type == "rightClick")
        .collect();

    if clicks.is_empty() {
        return vec![];
    }

    // Cluster clicks that are within cluster_ms of each other
    let mut clusters: Vec<Vec<&MouseEvent>> = vec![];
    let mut current_cluster: Vec<&MouseEvent> = vec![clicks[0]];

    for click in &clicks[1..] {
        let last = current_cluster.last().unwrap();
        if click.time_ms - last.time_ms <= cluster_ms {
            current_cluster.push(click);
        } else {
            clusters.push(current_cluster);
            current_cluster = vec![click];
        }
    }
    clusters.push(current_cluster);

    // Generate zoom-in + zoom-out pairs from clusters
    let mut keyframes: Vec<ZoomKeyframe> = vec![];

    for cluster in &clusters {
        // Cluster center = average position
        let cx: f64 = cluster.iter().map(|e| e.x).sum::<f64>() / cluster.len() as f64;
        let cy: f64 = cluster.iter().map(|e| e.y).sum::<f64>() / cluster.len() as f64;
        let time_ms = cluster[0].time_ms;

        // Check there's room: don't overlap with previous zoom-out
        if let Some(last) = keyframes.last() {
            if time_ms < last.time_ms + last.duration_ms + 100 {
                continue; // Skip — too close to previous
            }
        }

        // Zoom IN
        keyframes.push(ZoomKeyframe {
            time_ms,
            x: cx,
            y: cy,
            scale: zoom_scale,
            easing: "ease-in-out".to_string(),
            duration_ms: transition_ms,
        });

        // Zoom OUT (return to 1.0)
        keyframes.push(ZoomKeyframe {
            time_ms: time_ms + transition_ms + hold_ms,
            x: 0.5,
            y: 0.5,
            scale: 1.0,
            easing: "ease-in-out".to_string(),
            duration_ms: transition_ms,
        });
    }

    keyframes
}

/// Interpolate the zoom state at a given time from the keyframe list.
/// Returns (x, y, scale) at `time_ms`.
pub fn interpolate_zoom(keyframes: &[ZoomKeyframe], time_ms: u64) -> (f64, f64, f64) {
    if keyframes.is_empty() {
        return (0.5, 0.5, 1.0);
    }

    // Before first keyframe
    if time_ms <= keyframes[0].time_ms {
        return (0.5, 0.5, 1.0);
    }

    // After last keyframe
    if let Some(last) = keyframes.last() {
        if time_ms >= last.time_ms + last.duration_ms {
            return (last.x, last.y, last.scale);
        }
    }

    // Find the active keyframe (the one we're transitioning into)
    for (i, kf) in keyframes.iter().enumerate() {
        let end = kf.time_ms + kf.duration_ms;
        if time_ms >= kf.time_ms && time_ms < end {
            // We're in a transition — interpolate
            let t = (time_ms - kf.time_ms) as f64 / kf.duration_ms as f64;
            let eased_t = ease_in_out(t); // always use ease-in-out for now

            // Previous state
            let (px, py, ps) = if i > 0 {
                let prev = &keyframes[i - 1];
                (prev.x, prev.y, prev.scale)
            } else {
                (0.5, 0.5, 1.0)
            };

            let x = px + (kf.x - px) * eased_t;
            let y = py + (kf.y - py) * eased_t;
            let s = ps + (kf.scale - ps) * eased_t;
            return (x, y, s);
        }

        // Between this keyframe's end and next keyframe's start — hold
        if i + 1 < keyframes.len() && time_ms >= end && time_ms < keyframes[i + 1].time_ms {
            return (kf.x, kf.y, kf.scale);
        }
    }

    (0.5, 0.5, 1.0)
}

fn ease_in_out(t: f64) -> f64 {
    if t < 0.5 {
        2.0 * t * t
    } else {
        -1.0 + (4.0 - 2.0 * t) * t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_click(time_ms: u64, x: f64, y: f64) -> MouseEvent {
        MouseEvent { time_ms, x, y, event_type: "click".to_string() }
    }

    fn make_move(time_ms: u64, x: f64, y: f64) -> MouseEvent {
        MouseEvent { time_ms, x, y, event_type: "move".to_string() }
    }

    #[test]
    fn test_no_clicks_returns_empty() {
        let events = vec![make_move(100, 0.5, 0.5)];
        let kfs = generate_zoom_keyframes(&events, 2.0, 300, 1000, 500);
        assert!(kfs.is_empty());
    }

    #[test]
    fn test_single_click_generates_zoom_pair() {
        let events = vec![make_click(1000, 0.3, 0.7)];
        let kfs = generate_zoom_keyframes(&events, 2.0, 300, 1000, 500);
        assert_eq!(kfs.len(), 2);
        // Zoom in
        assert_eq!(kfs[0].time_ms, 1000);
        assert_eq!(kfs[0].x, 0.3);
        assert_eq!(kfs[0].y, 0.7);
        assert_eq!(kfs[0].scale, 2.0);
        assert_eq!(kfs[0].duration_ms, 300);
        // Zoom out
        assert_eq!(kfs[1].time_ms, 1000 + 300 + 1000); // 2300
        assert_eq!(kfs[1].scale, 1.0);
    }

    #[test]
    fn test_clustered_clicks_merge() {
        let events = vec![
            make_click(1000, 0.3, 0.3),
            make_click(1200, 0.4, 0.4), // within 500ms cluster
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, 300, 1000, 500);
        assert_eq!(kfs.len(), 2); // one pair, not two
        // Center of cluster
        assert!((kfs[0].x - 0.35).abs() < 0.01);
        assert!((kfs[0].y - 0.35).abs() < 0.01);
    }

    #[test]
    fn test_spaced_clicks_generate_multiple_pairs() {
        let events = vec![
            make_click(1000, 0.2, 0.2),
            make_click(5000, 0.8, 0.8), // well spaced
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, 300, 1000, 500);
        assert_eq!(kfs.len(), 4); // two pairs
    }

    #[test]
    fn test_interpolate_before_first_keyframe() {
        let kfs = vec![ZoomKeyframe {
            time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
            easing: "ease-in-out".to_string(), duration_ms: 300,
        }];
        let (x, y, s) = interpolate_zoom(&kfs, 500);
        assert_eq!(x, 0.5);
        assert_eq!(y, 0.5);
        assert_eq!(s, 1.0);
    }

    #[test]
    fn test_interpolate_mid_transition() {
        let kfs = vec![ZoomKeyframe {
            time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
            easing: "ease-in-out".to_string(), duration_ms: 1000,
        }];
        let (x, y, s) = interpolate_zoom(&kfs, 1500); // 50% through
        // At t=0.5 with ease-in-out, eased_t ≈ 0.5
        assert!(s > 1.0 && s < 2.0);
        assert!(x < 0.5 && x > 0.3);
    }

    #[test]
    fn test_interpolate_empty_keyframes() {
        let (x, y, s) = interpolate_zoom(&[], 1000);
        assert_eq!((x, y, s), (0.5, 0.5, 1.0));
    }
}
```

### Step 2: Register module in lib.rs

Add `pub mod autozoom;` to `src-tauri/src/lib.rs`.

### Step 3: Add Tauri command

In `src-tauri/src/commands/editor.rs`, add:

```rust
use crate::autozoom;
use crate::project::{self, ZoomKeyframe};

#[tauri::command]
pub fn generate_auto_zoom(project_id: String) -> Result<Vec<ZoomKeyframe>, String> {
    let raw = project::raw_dir(&project_id);
    let mouse_path = raw.join("mouse_events.jsonl");

    if !mouse_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&mouse_path).map_err(|e| e.to_string())?;
    let events: Vec<autozoom::MouseEvent> = content
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();

    Ok(autozoom::generate_zoom_keyframes(
        &events,
        2.0,   // zoom_scale
        300,   // transition_ms
        1500,  // hold_ms
        500,   // cluster_ms
    ))
}
```

Register `commands::editor::generate_auto_zoom` in the `invoke_handler` in `lib.rs`.

### Step 4: Run tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS

### Step 5: Commit

```bash
git add src-tauri/src/autozoom.rs src-tauri/src/lib.rs src-tauri/src/commands/editor.rs
git commit -m "feat(phase5): auto-zoom generator with click clustering and interpolation"
```

---

## Task 5: Zustand Store — Cursor & Zoom State

**Files:**
- Modify: `src/stores/editor-store.ts`
- Modify: `src/types/editor.ts` (already done in Task 1)

### Step 1: Add default cursor/zoom to store

In `editor-store.ts`, extend `DEFAULT_EFFECTS`:

```typescript
const DEFAULT_EFFECTS: Effects = {
  // ... existing background, cameraBubble, frame ...
  cursor: {
    enabled: false,
    type: "highlight",
    size: 40,
    color: "#ffcc00",
    opacity: 0.6,
  },
  zoomKeyframes: [],
}
```

### Step 2: Add new actions to EditorState interface

```typescript
// In EditorState interface, add:
setCursor: (config: Partial<CursorConfig>) => void
addZoomKeyframe: (kf: ZoomKeyframe) => void
removeZoomKeyframe: (timeMs: number) => void
setZoomKeyframes: (kfs: ZoomKeyframe[]) => void
```

### Step 3: Implement actions

Add to the store implementation (inside `temporal(...)`):

```typescript
setCursor: (config) =>
  set((s) => {
    if (!s.project) return s
    return {
      project: {
        ...s.project,
        effects: {
          ...s.project.effects,
          cursor: { ...s.project.effects.cursor, ...config },
        },
      },
    }
  }),

addZoomKeyframe: (kf) =>
  set((s) => {
    if (!s.project) return s
    const existing = s.project.effects.zoomKeyframes
    // Insert sorted by timeMs, replace if same timeMs
    const filtered = existing.filter((k) => k.timeMs !== kf.timeMs)
    const updated = [...filtered, kf].sort((a, b) => a.timeMs - b.timeMs)
    return {
      project: {
        ...s.project,
        effects: { ...s.project.effects, zoomKeyframes: updated },
      },
    }
  }),

removeZoomKeyframe: (timeMs) =>
  set((s) => {
    if (!s.project) return s
    return {
      project: {
        ...s.project,
        effects: {
          ...s.project.effects,
          zoomKeyframes: s.project.effects.zoomKeyframes.filter(
            (k) => k.timeMs !== timeMs
          ),
        },
      },
    }
  }),

setZoomKeyframes: (kfs) =>
  set((s) => {
    if (!s.project) return s
    return {
      project: {
        ...s.project,
        effects: { ...s.project.effects, zoomKeyframes: kfs },
      },
    }
  }),
```

### Step 4: Update loadProject to merge defaults

In `loadProject`, ensure new fields have defaults:

```typescript
loadProject: (project) => {
  const withEffects: EditorProject = {
    ...project,
    effects: {
      ...DEFAULT_EFFECTS,
      ...(project.effects ?? {}),
      cursor: { ...DEFAULT_EFFECTS.cursor, ...(project.effects?.cursor ?? {}) },
      zoomKeyframes: project.effects?.zoomKeyframes ?? [],
    },
  }
  set({ project: withEffects, currentTime: 0, isPlaying: false })
},
```

### Step 5: Update editor-store.test.ts

Add a test for the new actions to `src/__tests__/editor-store.test.ts`:

```typescript
test("setCursor updates cursor config", () => {
  store.getState().loadProject(mockProject)
  store.getState().setCursor({ enabled: true, type: "spotlight" })
  expect(store.getState().project!.effects.cursor.enabled).toBe(true)
  expect(store.getState().project!.effects.cursor.type).toBe("spotlight")
})

test("addZoomKeyframe inserts sorted", () => {
  store.getState().loadProject(mockProject)
  store.getState().addZoomKeyframe({
    timeMs: 2000, x: 0.5, y: 0.5, scale: 2.0, easing: "ease-in-out", durationMs: 300,
  })
  store.getState().addZoomKeyframe({
    timeMs: 1000, x: 0.3, y: 0.7, scale: 1.5, easing: "ease-in-out", durationMs: 300,
  })
  const kfs = store.getState().project!.effects.zoomKeyframes
  expect(kfs.length).toBe(2)
  expect(kfs[0].timeMs).toBe(1000)
  expect(kfs[1].timeMs).toBe(2000)
})

test("removeZoomKeyframe removes by timeMs", () => {
  store.getState().loadProject(mockProject)
  store.getState().addZoomKeyframe({
    timeMs: 1000, x: 0.3, y: 0.7, scale: 2.0, easing: "ease-in-out", durationMs: 300,
  })
  store.getState().removeZoomKeyframe(1000)
  expect(store.getState().project!.effects.zoomKeyframes.length).toBe(0)
})
```

### Step 6: Run tests

```bash
npm test
```

Expected: PASS

### Step 7: Commit

```bash
git add src/stores/editor-store.ts src/__tests__/editor-store.test.ts
git commit -m "feat(phase5): zustand cursor/zoom state with keyframe CRUD"
```

---

## Task 6: Cursor Overlay on Preview Canvas (CSS)

Render a cursor highlight or spotlight effect on the CSS preview by reading `mouse_events.jsonl` and tracking cursor position at the current playback time.

**Files:**
- Create: `src/hooks/use-mouse-events.ts`
- Modify: `src/components/editor/preview-canvas.tsx`

### Step 1: Create mouse events hook

Create `src/hooks/use-mouse-events.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { MouseEvent as MouseLogEvent } from "@/types/editor"

/**
 * Loads mouse_events.jsonl and provides the cursor position at the current time.
 * Uses binary search for efficient lookup during playback.
 */
export function useMouseEvents() {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const [events, setEvents] = useState<MouseLogEvent[]>([])

  // Load events from JSONL file
  useEffect(() => {
    if (!project?.tracks.mouse_events) {
      setEvents([])
      return
    }

    // Read the file via fetch (Tauri asset protocol)
    const path = project.tracks.mouse_events
    fetch(path)
      .then((r) => r.text())
      .then((text) => {
        const parsed = text
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try { return JSON.parse(line) as MouseLogEvent }
            catch { return null }
          })
          .filter(Boolean) as MouseLogEvent[]
        setEvents(parsed)
      })
      .catch(() => setEvents([]))
  }, [project?.tracks.mouse_events])

  // Binary search for cursor position at current time
  const getCursorAt = useCallback(
    (timeMs: number): { x: number; y: number } | null => {
      if (events.length === 0) return null

      // Binary search for the last event at or before timeMs
      let lo = 0
      let hi = events.length - 1
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (events[mid].timeMs <= timeMs) {
          lo = mid
        } else {
          hi = mid - 1
        }
      }

      if (events[lo].timeMs > timeMs) return null
      return { x: events[lo].x, y: events[lo].y }
    },
    [events]
  )

  const cursorPos = getCursorAt(currentTime)

  return { cursorPos, events, getCursorAt }
}
```

### Step 2: Add cursor overlay to preview canvas

In `preview-canvas.tsx`, import the hook and the cursor config:

```typescript
import { useMouseEvents } from "@/hooks/use-mouse-events"
```

Inside `PreviewCanvas`, after `const { effects, tracks } = project`:

```typescript
const { cursorPos } = useMouseEvents()
const cursor = effects.cursor
```

Add the cursor overlay element after the camera bubble `<video>`, before the closing `</div>`:

```tsx
{/* Cursor effect overlay */}
{cursor.enabled && cursorPos && (
  <div
    className="absolute pointer-events-none"
    style={{
      left: `${cursorPos.x * 100}%`,
      top: `${cursorPos.y * 100}%`,
      transform: "translate(-50%, -50%)",
      width: cursor.size * 2,
      height: cursor.size * 2,
      borderRadius: "50%",
      background:
        cursor.type === "highlight"
          ? `radial-gradient(circle, ${cursor.color}${Math.round(cursor.opacity * 255).toString(16).padStart(2, "0")} 0%, transparent 70%)`
          : undefined,
      boxShadow:
        cursor.type === "spotlight"
          ? `0 0 0 9999px rgba(0,0,0,${cursor.opacity})`
          : undefined,
      transition: "left 16ms linear, top 16ms linear",
    }}
  />
)}
```

### Step 3: Build and test manually

```bash
npm run dev
```

Open a project that has `mouse_events.jsonl`. Enable cursor in inspector (Task 8). Play the video — cursor overlay should follow the mouse position.

### Step 4: Commit

```bash
git add src/hooks/use-mouse-events.ts src/components/editor/preview-canvas.tsx
git commit -m "feat(phase5): cursor highlight/spotlight overlay on preview canvas"
```

---

## Task 7: Zoom Crop Effect on Preview (CSS Transform)

Apply zoom to the screen video using CSS `transform: scale() translate()` based on the current zoom keyframe interpolation.

**Files:**
- Create: `src/lib/zoom-interpolation.ts`
- Modify: `src/components/editor/preview-canvas.tsx`

### Step 1: Create zoom interpolation utility

Create `src/lib/zoom-interpolation.ts`:

```typescript
import type { ZoomKeyframe } from "@/types/editor"

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

/**
 * Interpolate zoom state at a given time from keyframe list.
 * Returns { x, y, scale } where x,y are normalized center coords (0-1).
 * Must match Rust `interpolate_zoom` exactly for preview/export parity.
 */
export function interpolateZoom(
  keyframes: ZoomKeyframe[],
  timeMs: number
): { x: number; y: number; scale: number } {
  if (keyframes.length === 0) return { x: 0.5, y: 0.5, scale: 1 }

  // Before first keyframe
  if (timeMs <= keyframes[0].timeMs) return { x: 0.5, y: 0.5, scale: 1 }

  // After last keyframe
  const last = keyframes[keyframes.length - 1]
  if (timeMs >= last.timeMs + last.durationMs) {
    return { x: last.x, y: last.y, scale: last.scale }
  }

  // Find active keyframe
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i]
    const end = kf.timeMs + kf.durationMs
    if (timeMs >= kf.timeMs && timeMs < end) {
      const t = (timeMs - kf.timeMs) / kf.durationMs
      const et = easeInOut(t)

      const prev = i > 0
        ? { x: keyframes[i - 1].x, y: keyframes[i - 1].y, scale: keyframes[i - 1].scale }
        : { x: 0.5, y: 0.5, scale: 1 }

      return {
        x: prev.x + (kf.x - prev.x) * et,
        y: prev.y + (kf.y - prev.y) * et,
        scale: prev.scale + (kf.scale - prev.scale) * et,
      }
    }

    // Between keyframes (hold state)
    if (i + 1 < keyframes.length && timeMs >= end && timeMs < keyframes[i + 1].timeMs) {
      return { x: kf.x, y: kf.y, scale: kf.scale }
    }
  }

  return { x: 0.5, y: 0.5, scale: 1 }
}
```

### Step 2: Apply zoom transform to screen video

In `preview-canvas.tsx`, import and use the interpolation:

```typescript
import { interpolateZoom } from "@/lib/zoom-interpolation"
```

Compute zoom state:

```typescript
const zoomState = interpolateZoom(effects.zoomKeyframes, currentTime)
```

Add `currentTime` subscription at top:

```typescript
const currentTime = useEditorStore((s) => s.currentTime)
```

Apply CSS transform to the screen `<video>` element's style:

```typescript
// Replace the existing screen video style with:
style={{
  borderRadius: frame.borderRadius,
  boxShadow: multiLayerShadow,
  transition: "border-radius 200ms ease, box-shadow 200ms ease",
  transform: zoomState.scale !== 1
    ? `scale(${zoomState.scale}) translate(${(0.5 - zoomState.x) * 100 / zoomState.scale}%, ${(0.5 - zoomState.y) * 100 / zoomState.scale}%)`
    : undefined,
  transformOrigin: "center center",
}}
```

### Step 3: Write unit test for interpolation

Create `src/__tests__/zoom-interpolation.test.ts`:

```typescript
import { describe, test, expect } from "vitest"
import { interpolateZoom } from "@/lib/zoom-interpolation"

describe("interpolateZoom", () => {
  test("empty keyframes returns default", () => {
    expect(interpolateZoom([], 1000)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("before first keyframe returns default", () => {
    const kfs = [{ timeMs: 1000, x: 0.3, y: 0.7, scale: 2, easing: "ease-in-out" as const, durationMs: 300 }]
    expect(interpolateZoom(kfs, 500)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("mid-transition interpolates", () => {
    const kfs = [{ timeMs: 1000, x: 0.3, y: 0.7, scale: 2, easing: "ease-in-out" as const, durationMs: 1000 }]
    const result = interpolateZoom(kfs, 1500) // 50% through
    expect(result.scale).toBeGreaterThan(1)
    expect(result.scale).toBeLessThan(2)
  })

  test("after transition holds", () => {
    const kfs = [
      { timeMs: 1000, x: 0.3, y: 0.7, scale: 2, easing: "ease-in-out" as const, durationMs: 300 },
      { timeMs: 3000, x: 0.5, y: 0.5, scale: 1, easing: "ease-in-out" as const, durationMs: 300 },
    ]
    // Between kf[0] end (1300) and kf[1] start (3000) — should hold at kf[0]
    const result = interpolateZoom(kfs, 2000)
    expect(result.x).toBeCloseTo(0.3)
    expect(result.scale).toBe(2)
  })
})
```

### Step 4: Run tests

```bash
npm test
```

Expected: PASS

### Step 5: Commit

```bash
git add src/lib/zoom-interpolation.ts \
        src/components/editor/preview-canvas.tsx \
        src/__tests__/zoom-interpolation.test.ts
git commit -m "feat(phase5): zoom crop effect on preview with CSS transforms"
```

---

## Task 8: Inspector Panels — Cursor & Zoom Config

**Files:**
- Create: `src/components/editor/inspector/cursor-panel.tsx`
- Create: `src/components/editor/inspector/zoom-panel.tsx`
- Modify: `src/components/editor/inspector/index.tsx`

### Step 1: Create cursor panel

Create `src/components/editor/inspector/cursor-panel.tsx`:

```tsx
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorStore } from "@/stores/editor-store"
import { StyledSlider } from "./styled-slider"

export function CursorPanel() {
  const cursor = useEditorStore((s) => s.project?.effects.cursor)
  const setCursor = useEditorStore((s) => s.setCursor)

  if (!cursor) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Cursor</h3>
        <Button
          size="sm"
          variant={cursor.enabled ? "default" : "ghost"}
          className="text-xs h-7 px-2"
          onClick={() => setCursor({ enabled: !cursor.enabled })}
        >
          {cursor.enabled ? "On" : "Off"}
        </Button>
      </div>

      {cursor.enabled && (
        <>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={cursor.type === "highlight" ? "default" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setCursor({ type: "highlight" })}
            >
              Highlight
            </Button>
            <Button
              size="sm"
              variant={cursor.type === "spotlight" ? "default" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setCursor({ type: "spotlight" })}
            >
              Spotlight
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Size ({cursor.size}px)</Label>
            <StyledSlider
              min={20}
              max={80}
              step={1}
              value={cursor.size}
              onChange={(v) => setCursor({ size: v })}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Opacity ({Math.round(cursor.opacity * 100)}%)</Label>
            <StyledSlider
              min={0}
              max={1}
              step={0.05}
              value={cursor.opacity}
              onChange={(v) => setCursor({ opacity: v })}
            />
          </div>

          {cursor.type === "highlight" && (
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <Input
                type="color"
                value={cursor.color}
                onChange={(e) => setCursor({ color: e.target.value })}
                className="h-8"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

### Step 2: Create zoom panel

Create `src/components/editor/inspector/zoom-panel.tsx`:

```tsx
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/stores/editor-store"
import { invoke } from "@tauri-apps/api/core"
import { useState } from "react"
import { Wand2, Plus, Trash2 } from "lucide-react"
import type { ZoomKeyframe } from "@/types/editor"

export function ZoomPanel() {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const setZoomKeyframes = useEditorStore((s) => s.setZoomKeyframes)
  const addZoomKeyframe = useEditorStore((s) => s.addZoomKeyframe)
  const removeZoomKeyframe = useEditorStore((s) => s.removeZoomKeyframe)
  const [generating, setGenerating] = useState(false)

  if (!project) return null

  const keyframes = project.effects.zoomKeyframes

  const handleAutoZoom = async () => {
    setGenerating(true)
    try {
      const kfs = await invoke<ZoomKeyframe[]>("generate_auto_zoom", {
        projectId: project.id,
      })
      setZoomKeyframes(kfs)
    } catch (e) {
      console.error("Auto-zoom failed:", e)
    }
    setGenerating(false)
  }

  const handleAddKeyframe = () => {
    addZoomKeyframe({
      timeMs: Math.round(currentTime),
      x: 0.5,
      y: 0.5,
      scale: 2.0,
      easing: "ease-in-out",
      durationMs: 300,
    })
  }

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toString().padStart(2, "0")}`
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Zoom</h3>

      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 flex-1"
          onClick={handleAutoZoom}
          disabled={generating || !project.tracks.mouse_events}
        >
          <Wand2 className="w-3 h-3 mr-1" />
          {generating ? "Generating..." : "Auto-Zoom"}
        </Button>
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleAddKeyframe}>
          <Plus className="w-3 h-3" />
        </Button>
      </div>

      {!project.tracks.mouse_events && (
        <p className="text-xs text-muted-foreground">
          No mouse events recorded. Re-record with Accessibility permission to enable auto-zoom.
        </p>
      )}

      {keyframes.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs">Keyframes ({keyframes.length})</Label>
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {keyframes.map((kf) => (
              <div
                key={kf.timeMs}
                className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1"
              >
                <span className="font-mono">{formatTime(kf.timeMs)}</span>
                <span>{kf.scale}x</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 p-0"
                  onClick={() => removeZoomKeyframe(kf.timeMs)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {keyframes.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="text-xs h-7 text-destructive"
          onClick={() => setZoomKeyframes([])}
        >
          Clear All
        </Button>
      )}
    </div>
  )
}
```

### Step 3: Add panels to inspector

In `src/components/editor/inspector/index.tsx`, import and add the new panels:

```typescript
import { CursorPanel } from "./cursor-panel"
import { ZoomPanel } from "./zoom-panel"
```

Add them in the inspector layout after the existing panels (e.g. after `<CameraPanel />`):

```tsx
<Separator />
<CursorPanel />
<Separator />
<ZoomPanel />
```

### Step 4: Build and test manually

```bash
npm run dev
```

Verify the inspector shows Cursor and Zoom panels.

### Step 5: Commit

```bash
git add src/components/editor/inspector/cursor-panel.tsx \
        src/components/editor/inspector/zoom-panel.tsx \
        src/components/editor/inspector/index.tsx
git commit -m "feat(phase5): cursor and zoom inspector panels"
```

---

## Task 9: Keyframe Markers on Timeline

Show zoom keyframe markers on the existing timeline component.

**Files:**
- Modify: `src/components/editor/timeline.tsx`

### Step 1: Add keyframe markers

In `timeline.tsx`, subscribe to zoom keyframes:

```typescript
const zoomKeyframes = useEditorStore((s) => s.project?.effects.zoomKeyframes ?? [])
```

Add a keyframe marker layer inside the track area (after the playhead, before closing `</div>` of the track container):

```tsx
{/* Zoom keyframe markers */}
{zoomKeyframes.map((kf) => {
  const pct = (kf.timeMs / project.timeline.duration_ms) * 100
  const endPct = ((kf.timeMs + kf.durationMs) / project.timeline.duration_ms) * 100
  return (
    <div key={kf.timeMs} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${pct}%` }}>
      {/* Keyframe diamond marker */}
      <div
        className="absolute -top-1 w-2 h-2 bg-amber-400 border border-amber-600 rotate-45 pointer-events-auto cursor-pointer"
        style={{ transform: "translateX(-50%) rotate(45deg)" }}
        title={`${kf.scale}x zoom at ${Math.round(kf.timeMs / 1000)}s`}
      />
      {/* Transition duration bar */}
      <div
        className="absolute top-0 h-full bg-amber-400/20"
        style={{ width: `${endPct - pct}%`, minWidth: 2 }}
      />
    </div>
  )
})}
```

### Step 2: Build and verify

```bash
npm run dev
```

Zoom keyframes should appear as amber diamond markers on the timeline.

### Step 3: Commit

```bash
git add src/components/editor/timeline.tsx
git commit -m "feat(phase5): zoom keyframe markers on timeline"
```

---

## Task 10: Metal Compositor — Cursor + Zoom Uniforms

Extend the Metal shader and `CompositeUniforms` to support cursor effects and zoom crop.

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/export/metal-compositor.swift`

### Step 1: Extend CompositeUniforms

Add new fields to the `CompositeUniforms` struct (after `_pad1`):

```swift
// Zoom
var zoomCenterX: Float = 0.5       // 4  (normalised 0..1)
var zoomCenterY: Float = 0.5       // 4
var zoomScale: Float = 1.0         // 4  (1.0 = no zoom)
var _pad2: Float = 0               // 4

// Cursor
var hasCursor: Float = 0           // 4  (0 or 1)
var cursorX: Float = 0             // 4  (normalised 0..1)
var cursorY: Float = 0             // 4
var cursorRadius: Float = 0        // 4  (pixels)
var cursorIsSpotlight: Float = 0   // 4  (0=highlight, 1=spotlight)
var cursorOpacity: Float = 0       // 4
var _pad3: SIMD2<Float> = .zero    // 8
var cursorColor: SIMD4<Float> = .zero // 16
```

### Step 2: Add matching fields to Metal shader

In the Metal shader's `CompositeUniforms` struct (inside `metalShaderSource` string), add after `_pad1`:

```metal
// Zoom
float  zoomCenterX;
float  zoomCenterY;
float  zoomScale;
float  _pad2;

// Cursor
float  hasCursor;
float  cursorX;
float  cursorY;
float  cursorRadius;
float  cursorIsSpotlight;
float  cursorOpacity;
float2 _pad3;
float4 cursorColor;
```

### Step 3: Add zoom crop to the screen sampling in fragment shader

Replace the screen content sampling (Layer 3) with zoom-aware sampling:

```metal
// ---- Layer 3: Screen content (rounded corners via SDF, with zoom crop) ----
{
    float d = roundedRectSDF(px, scrCenter, scrHalf, scrRadius);
    if (d < 0.5) {
        // Map pixel to screen texture UV
        float2 scrUV = (px - scrOrigin) / scrSize;

        // Apply zoom crop: zoom into (zoomCenterX, zoomCenterY) by zoomScale
        if (u.zoomScale > 1.001) {
            float invScale = 1.0 / u.zoomScale;
            float2 zoomCenter = float2(u.zoomCenterX, u.zoomCenterY);
            scrUV = zoomCenter + (scrUV - zoomCenter) * invScale;
        }

        scrUV = saturate(scrUV);
        float4 scrColor = screenTex.sample(texSampler, scrUV);
        float aa = 1.0 - smoothstep(-0.5, 0.5, d);
        color = mix(color, scrColor, aa);
    }
}
```

### Step 4: Add cursor effect after Layer 4 (camera)

Add a new Layer 5 at the end of the fragment shader (before `return color;`):

```metal
// ---- Layer 5: Cursor effect ----
if (u.hasCursor > 0.5) {
    // Cursor position in pixel space (relative to screen rect)
    float2 cursorPx = scrOrigin + float2(u.cursorX, u.cursorY) * scrSize;

    // Apply same zoom transform as screen content
    if (u.zoomScale > 1.001) {
        float2 zoomCenter = scrOrigin + float2(u.zoomCenterX, u.zoomCenterY) * scrSize;
        cursorPx = zoomCenter + (cursorPx - zoomCenter) * u.zoomScale;
    }

    float dist = length(px - cursorPx);

    if (u.cursorIsSpotlight > 0.5) {
        // Spotlight: darken everything except around cursor
        float spotlightMask = smoothstep(u.cursorRadius * 0.8, u.cursorRadius * 1.2, dist);
        color = mix(color, color * (1.0 - u.cursorOpacity), spotlightMask);
    } else {
        // Highlight: bright ring/glow around cursor
        float ring = 1.0 - smoothstep(u.cursorRadius * 0.6, u.cursorRadius, dist);
        color = mix(color, u.cursorColor, ring * u.cursorOpacity);
    }
}
```

### Step 5: Extend ExportEffects

Add to `ExportEffects` struct:

```swift
// Cursor
public var cursorEnabled: Bool
public var cursorType: String      // "highlight" | "spotlight"
public var cursorSize: Double      // px
public var cursorColor: String     // hex
public var cursorOpacity: Double   // 0-1
```

Update the `init(from dict:)` initializer:

```swift
let cur = dict["cursor"] as? [String: Any] ?? [:]
self.cursorEnabled = cur["enabled"] as? Bool ?? false
self.cursorType = cur["type"] as? String ?? "highlight"
self.cursorSize = cur["size"] as? Double ?? 40
self.cursorColor = cur["color"] as? String ?? "#ffcc00"
self.cursorOpacity = cur["opacity"] as? Double ?? 0.6
```

### Step 6: Build Swift framework

```bash
cd CaptureKitEngine && swift build -c release
```

Expected: BUILD SUCCEEDED

### Step 7: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/export/metal-compositor.swift
git commit -m "feat(phase5): Metal shader zoom crop and cursor highlight/spotlight"
```

---

## Task 11: Export Pipeline Integration — Per-Frame Zoom + Cursor

Pass zoom and cursor state per-frame to the MetalCompositor during export.

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/export/export-pipeline.swift`

### Step 1: Parse zoom keyframes and mouse events from project JSON

In `ExportPipeline.run()`, after parsing `effects`, add:

```swift
// Parse zoom keyframes
struct ZoomKF: Codable {
    let timeMs: UInt64
    let x: Double
    let y: Double
    let scale: Double
    let easing: String
    let durationMs: UInt64
}

let zoomKeyframes: [ZoomKF] = {
    guard let kfs = effectsDict["zoomKeyframes"] as? [[String: Any]] else { return [] }
    return kfs.compactMap { kf in
        guard let t = kf["timeMs"] as? UInt64,
              let x = kf["x"] as? Double,
              let y = kf["y"] as? Double,
              let s = kf["scale"] as? Double,
              let d = kf["durationMs"] as? UInt64 else { return nil }
        return ZoomKF(timeMs: t, x: x, y: y, scale: s, easing: kf["easing"] as? String ?? "ease-in-out", durationMs: d)
    }
}()

// Parse mouse events
struct MouseEvt: Codable {
    let timeMs: UInt64
    let x: Double
    let y: Double
    let type: String
}

var mouseEvents: [MouseEvt] = []
if let mouseEventsPath = tracks["mouseEvents"] as? String ?? tracks["mouse_events"] as? String {
    let mouseURL = URL(fileURLWithPath: mouseEventsPath)
    if let content = try? String(contentsOf: mouseURL, encoding: .utf8) {
        mouseEvents = content.split(separator: "\n").compactMap { line in
            try? JSONDecoder().decode(MouseEvt.self, from: Data(line.utf8))
        }
    }
}
```

### Step 2: Add zoom/cursor interpolation functions

Add as private methods on `ExportPipeline`:

```swift
private func interpolateZoom(_ keyframes: [ZoomKF], at timeMs: UInt64) -> (x: Double, y: Double, scale: Double) {
    guard !keyframes.isEmpty else { return (0.5, 0.5, 1.0) }
    if timeMs <= keyframes[0].timeMs { return (0.5, 0.5, 1.0) }

    if let last = keyframes.last, timeMs >= last.timeMs + last.durationMs {
        return (last.x, last.y, last.scale)
    }

    for (i, kf) in keyframes.enumerated() {
        let end = kf.timeMs + kf.durationMs
        if timeMs >= kf.timeMs && timeMs < end {
            let t = Double(timeMs - kf.timeMs) / Double(kf.durationMs)
            let et = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

            let prev: (x: Double, y: Double, scale: Double) = i > 0
                ? (keyframes[i-1].x, keyframes[i-1].y, keyframes[i-1].scale)
                : (0.5, 0.5, 1.0)

            return (
                prev.x + (kf.x - prev.x) * et,
                prev.y + (kf.y - prev.y) * et,
                prev.scale + (kf.scale - prev.scale) * et
            )
        }

        if i + 1 < keyframes.count && timeMs >= end && timeMs < keyframes[i+1].timeMs {
            return (kf.x, kf.y, kf.scale)
        }
    }
    return (0.5, 0.5, 1.0)
}

private func cursorPosition(_ events: [MouseEvt], at timeMs: UInt64) -> (x: Double, y: Double)? {
    guard !events.isEmpty else { return nil }
    // Binary search for last event at or before timeMs
    var lo = 0, hi = events.count - 1
    while lo < hi {
        let mid = (lo + hi + 1) / 2
        if events[mid].timeMs <= timeMs { lo = mid } else { hi = mid - 1 }
    }
    if events[lo].timeMs > timeMs { return nil }
    return (events[lo].x, events[lo].y)
}
```

### Step 3: Pass per-frame uniforms in the frame loop

In the frame loop, before `compositor.renderFrame(...)`, compute the current frame time and set zoom/cursor uniforms. The `MetalCompositor.renderFrame` signature needs to accept these new parameters. **Alternatively**, extend the `renderFrame` method to accept zoom and cursor parameters.

The simplest approach: add `zoomState` and `cursorState` parameters to `renderFrame`. In the MetalCompositor, set the uniform fields from these parameters before rendering.

Add to `MetalCompositor.renderFrame` signature:

```swift
public func renderFrame(
    screenPixelBuffer: CVPixelBuffer,
    cameraPixelBuffer: CVPixelBuffer?,
    effects: ExportEffects,
    screenWidth: Int,
    screenHeight: Int,
    zoomX: Double = 0.5,
    zoomY: Double = 0.5,
    zoomScale: Double = 1.0,
    cursorX: Double? = nil,
    cursorY: Double? = nil
) throws -> CVPixelBuffer
```

And set the uniforms:

```swift
uniforms.zoomCenterX = Float(zoomX)
uniforms.zoomCenterY = Float(zoomY)
uniforms.zoomScale = Float(zoomScale)

if effects.cursorEnabled, let cx = cursorX, let cy = cursorY {
    uniforms.hasCursor = 1.0
    uniforms.cursorX = Float(cx)
    uniforms.cursorY = Float(cy)
    uniforms.cursorRadius = Float(effects.cursorSize)
    uniforms.cursorIsSpotlight = effects.cursorType == "spotlight" ? 1.0 : 0.0
    uniforms.cursorOpacity = Float(effects.cursorOpacity)
    uniforms.cursorColor = parseHexColor(effects.cursorColor)
}
```

In the frame loop of `export-pipeline.swift`:

```swift
let frameTimeMs = inPointMs + UInt64(Double(frameIndex) / Double(screenDecoder.fps) * 1000.0)
let (zx, zy, zs) = interpolateZoom(zoomKeyframes, at: frameTimeMs)
let cursorPos = cursorPosition(mouseEvents, at: frameTimeMs)

let composited = try compositor.renderFrame(
    screenPixelBuffer: screenBuffer,
    cameraPixelBuffer: cameraBuffer,
    effects: effects,
    screenWidth: screenDecoder.naturalWidth,
    screenHeight: screenDecoder.naturalHeight,
    zoomX: zx,
    zoomY: zy,
    zoomScale: zs,
    cursorX: cursorPos?.x,
    cursorY: cursorPos?.y
)
```

### Step 4: Build full stack

```bash
cd CaptureKitEngine && swift build -c release
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: BUILD SUCCEEDED

### Step 5: Manual test

```bash
npx tauri dev
```

1. Record a screen capture (ensure Accessibility permission for mouse events)
2. Open editor, click "Auto-Zoom" in the Zoom panel
3. Verify keyframes appear on timeline as amber diamonds
4. Enable cursor highlight in Cursor panel
5. Play — see cursor overlay + zoom transitions in preview
6. Export — verify exported .mp4 has cursor + zoom effects

### Step 6: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/export/export-pipeline.swift \
        CaptureKitEngine/Sources/CaptureKitEngine/export/metal-compositor.swift
git commit -m "feat(phase5): per-frame zoom and cursor effects in Metal export"
```

---

## Edge Cases & Gotchas

### CGEvent Tap Permissions
- Requires "Input Monitoring" (Accessibility) permission on macOS 14+
- `CGEvent.tapCreate` returns `nil` if permission not granted
- **Fallback:** Recording works fine without mouse events — auto-zoom is just disabled
- Show a hint in the Zoom panel if `mouse_events` is null

### Mouse Coordinate Normalization
- CGEvent gives absolute screen coordinates (pixels)
- Normalize to 0-1 using the display dimensions from `ScreenCapture.listDisplays()`
- For multi-display: CGEvent coordinates are in the global coordinate space. The current implementation uses the recording display dimensions. If the user's mouse moves to a secondary display, coordinates will be out of range (handled by clamping to 0-1).

### Zoom Interpolation Parity
- The `easeInOut` function (`t < 0.5 ? 2*t*t : -1+(4-2*t)*t`) must be identical in TypeScript, Rust, and Swift
- Preview/export visual parity depends on this

### Metal Struct Alignment
- New uniform fields must maintain 16-byte alignment
- The `SIMD4<Float>` for `cursorColor` is naturally 16-byte aligned
- Verify with `MemoryLayout<CompositeUniforms>.stride` that the Swift and Metal sizes match

### Backward Compatibility
- Old projects without `cursor` or `zoomKeyframes` in their JSON must still load
- `#[serde(default)]` in Rust handles missing fields → `None`
- Frontend `loadProject` merges with `DEFAULT_EFFECTS` to fill gaps
- Metal export handles missing cursor/zoom gracefully (uniforms default to disabled)

### Move Event Throttling
- At 60fps mouse polling, a 5-minute recording generates ~18,000 move events
- JSONL file ~700KB — acceptable
- Binary search (O(log n)) for cursor position lookup is fast
- Throttle to ~60fps (16ms) to keep file size reasonable

---

## Files Summary

### New Files (7)
| File | Purpose |
|------|---------|
| `CaptureKitEngine/Sources/CaptureKitEngine/capture/mouse-logger.swift` | CGEvent tap mouse event logger |
| `CaptureKitEngine/Tests/CaptureKitEngineTests/MouseLoggerTests.swift` | Unit tests for mouse event formatting |
| `src-tauri/src/autozoom.rs` | Auto-zoom generator (click → keyframe math) |
| `src/hooks/use-mouse-events.ts` | Load + binary-search mouse events for preview |
| `src/lib/zoom-interpolation.ts` | Zoom keyframe interpolation (shared math) |
| `src/components/editor/inspector/cursor-panel.tsx` | Cursor effects inspector panel |
| `src/components/editor/inspector/zoom-panel.tsx` | Zoom keyframes inspector panel |

### Modified Files (9)
| File | Changes |
|------|---------|
| `src/types/editor.ts` | Add `MouseEvent`, `ZoomKeyframe`, `CursorConfig`; extend `Effects` |
| `src-tauri/src/project.rs` | Add `CursorConfig`, `ZoomKeyframe`; extend `Effects`, `Tracks` |
| `CaptureKitEngine/.../recording-pipeline.swift` | Wire `MouseLogger` into recording |
| `src-tauri/src/commands/editor.rs` | Add `generate_auto_zoom` command |
| `src-tauri/src/commands/recording.rs` | Add `mouse_events_path` to result |
| `src-tauri/src/lib.rs` | Register `autozoom` module + new command |
| `src/stores/editor-store.ts` | Add cursor/zoom state, keyframe CRUD actions |
| `src/components/editor/preview-canvas.tsx` | Add cursor overlay + zoom CSS transform |
| `src/components/editor/timeline.tsx` | Add keyframe diamond markers |
| `CaptureKitEngine/.../metal-compositor.swift` | Extend shader with zoom crop + cursor effects |
| `CaptureKitEngine/.../export-pipeline.swift` | Per-frame zoom/cursor during export |
| `src/components/editor/inspector/index.tsx` | Add cursor + zoom panels |
