# Phase 2: Camera, Pause/Resume & Audio Levels — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add webcam capture, pause/resume, and audio level meters to the recording flow.

**Architecture:** Camera capture uses AVFoundation (`AVCaptureSession`) in the Swift framework, writing to a separate `camera.mov` via the existing `VideoWriter`. Pause/resume uses an `isPaused` flag on `RecordingPipeline` that skips writing samples while paused, with accumulated pause duration subtracted from the total. Audio level meters use a polling approach — Swift tracks peak levels from incoming buffers, Rust exposes a Tauri command, and the frontend polls every 100ms during recording.

**Tech Stack:** Swift (AVFoundation, AVCaptureSession), Rust (Tauri FFI), React (shadcn/ui), Vitest + Testing Library

**Already implemented in Phase 1:** System audio capture (ScreenCaptureKit), recording indicator (pulsing dot in timer badge).

**Test strategy:**
- **Swift (XCTest):** Serialization of config/result types, pure functions (`peakLevel` audio math), camera listing safety. Hardware-dependent capture code is verified by build + manual run.
- **Rust (`#[cfg(test)]`):** JSON deserialization matching Swift output format, type roundtrips for all new structs. FFI calls can't run in `cargo test` (no Swift library linked), so FFI wrappers are verified by build.
- **React (Vitest + Testing Library):** Component rendering in all states, mock `@tauri-apps/api/core` invoke calls.

---

## Task 1: Test Infrastructure

**Files:**
- Modify: `CaptureKitEngine/Package.swift`
- Create: `CaptureKitEngine/Tests/CaptureKitEngineTests/CaptureKitEngineTests.swift`
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/__tests__/setup.ts`
- Create: `src/__tests__/smoke.test.tsx`

### Step 1: Add Swift test target to Package.swift

Add a test target to the `targets` array in `CaptureKitEngine/Package.swift`:

```swift
        .testTarget(
            name: "CaptureKitEngineTests",
            dependencies: ["CaptureKitEngine"]
        ),
```

### Step 2: Create first Swift test

```swift
// CaptureKitEngine/Tests/CaptureKitEngineTests/CaptureKitEngineTests.swift
import XCTest
@testable import CaptureKitEngine

final class CaptureKitEngineTests: XCTestCase {
    func testVersionIsNotEmpty() {
        XCTAssertFalse(CaptureKitEngine.version.isEmpty)
    }
}
```

### Step 3: Run Swift tests to verify they pass

Run: `cd CaptureKitEngine && swift test`
Expected: 1 test passed

### Step 4: Install Vitest + Testing Library for React

Run:
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @testing-library/user-event
```

### Step 5: Add Vitest config to vite.config.ts

Replace `vite.config.ts` with:

```typescript
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
})
```

### Step 6: Create test setup file with Tauri mock

```typescript
// src/__tests__/setup.ts
import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// Mock Tauri IPC — tests override invoke per-test via vi.mocked()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}))
```

### Step 7: Create first React smoke test

```tsx
// src/__tests__/smoke.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RecordButton } from "@/components/recording/record-button"

describe("RecordButton", () => {
  it("renders Start Recording when not recording", () => {
    render(
      <RecordButton isRecording={false} onStart={() => {}} onStop={() => {}} disabled={false} />
    )
    expect(screen.getByText("Start Recording")).toBeInTheDocument()
  })

  it("renders Stop Recording when recording", () => {
    render(
      <RecordButton isRecording={true} onStart={() => {}} onStop={() => {}} disabled={false} />
    )
    expect(screen.getByText("Stop Recording")).toBeInTheDocument()
  })
})
```

### Step 8: Add test script to package.json

Add to the `"scripts"` section:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

### Step 9: Add Rust test module in project.rs

Add at the bottom of `src-tauri/src/project.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tracks_serialization_roundtrip() {
        let tracks = Tracks {
            screen: "screen.mov".to_string(),
            mic: Some("mic.wav".to_string()),
            system_audio: None,
        };
        let json = serde_json::to_string(&tracks).unwrap();
        let parsed: Tracks = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.screen, "screen.mov");
        assert_eq!(parsed.mic, Some("mic.wav".to_string()));
        assert!(parsed.system_audio.is_none());
    }
}
```

### Step 10: Run all test suites to verify green baseline

Run: `cd CaptureKitEngine && swift test`
Expected: 1 test passed

Run: `npm test`
Expected: 2 tests passed

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: 1 test passed

### Step 11: Commit

```bash
git add CaptureKitEngine/Package.swift CaptureKitEngine/Tests/ package.json package-lock.json vite.config.ts src/__tests__/ src-tauri/src/project.rs
git commit -m "feat: test infrastructure — Swift XCTest, Vitest, Rust tests"
```

---

## Task 2: Camera Discovery — Swift

**Files:**
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/capture/camera-capture.swift`
- Create: `CaptureKitEngine/Tests/CaptureKitEngineTests/CameraTests.swift`
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capture/screen-capture.swift` (add `cameraNotFound` error)

### Step 1: Write the failing tests

```swift
// CaptureKitEngine/Tests/CaptureKitEngineTests/CameraTests.swift
import XCTest
@testable import CaptureKitEngine

final class CameraTests: XCTestCase {
    func testCameraInfoEncodesToSnakeCase() throws {
        let camera = CameraInfo(id: "abc-123", name: "FaceTime HD")
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(camera)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["id"] as? String, "abc-123")
        XCTAssertEqual(json["name"] as? String, "FaceTime HD")
    }

    func testListCamerasReturnsArray() {
        // May be empty in CI/headless, but should not crash
        let cameras = CameraCapture.listCameras()
        XCTAssertNotNil(cameras)
    }

    func testStopCaptureOnFreshInstanceDoesNotCrash() {
        let capture = CameraCapture()
        capture.stopCapture() // should be a no-op
    }
}
```

### Step 2: Run tests — verify they fail (CameraInfo and CameraCapture don't exist yet)

Run: `cd CaptureKitEngine && swift test`
Expected: FAIL — cannot find `CameraInfo` / `CameraCapture` in scope

### Step 3: Implement CameraCapture with listing and stub methods

```swift
// CaptureKitEngine/Sources/CaptureKitEngine/capture/camera-capture.swift
import Foundation
import AVFoundation
import CoreMedia

public struct CameraInfo: Codable {
    public let id: String
    public let name: String
}

public final class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private var session: AVCaptureSession?
    private var onVideoFrame: ((CMSampleBuffer) -> Void)?

    public static func listCameras() -> [CameraInfo] {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
            mediaType: .video,
            position: .unspecified
        ).devices
        return devices.map { CameraInfo(id: $0.uniqueID, name: $0.localizedName) }
    }

    public func stopCapture() {
        session?.stopRunning()
        session = nil
    }
}
```

Add `cameraNotFound` to `CaptureError` in `screen-capture.swift`:

```swift
public enum CaptureError: Error {
    case displayNotFound
    case cameraNotFound
}
```

### Step 4: Add `ck_list_cameras` C API in capi.swift

Add after `ck_list_audio_inputs`:

```swift
@_cdecl("ck_list_cameras")
public func ck_list_cameras(outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    let cameras = CameraCapture.listCameras()
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    guard let data = try? encoder.encode(cameras),
          let json = String(data: data, encoding: .utf8) else {
        outJson.pointee = strdup("[]")
        return -1
    }
    outJson.pointee = strdup(json)
    return 0
}
```

### Step 5: Run tests — verify they pass

Run: `cd CaptureKitEngine && swift test`
Expected: All tests pass (CaptureKitEngineTests: 1 passed, CameraTests: 3 passed)

### Step 6: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/capture/camera-capture.swift CaptureKitEngine/Sources/CaptureKitEngine/capture/screen-capture.swift CaptureKitEngine/Sources/CaptureKitEngine/capi.swift CaptureKitEngine/Tests/CaptureKitEngineTests/CameraTests.swift
git commit -m "feat: camera discovery via AVFoundation with C API"
```

---

## Task 3: Camera Capture Module — Swift

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capture/camera-capture.swift`

### Step 1: Write a failing test for camera dimensions struct

Add to `CameraTests.swift`:

```swift
    func testCameraDimensionsArePositive() {
        let dims = CameraCapture.CameraDimensions(width: 1920, height: 1080)
        XCTAssertGreaterThan(dims.width, 0)
        XCTAssertGreaterThan(dims.height, 0)
    }
```

### Step 2: Run tests — verify failure

Run: `cd CaptureKitEngine && swift test`
Expected: FAIL — `CameraDimensions` is not a member type of `CameraCapture`

### Step 3: Implement full capture functionality

Add to the `CameraCapture` class in `camera-capture.swift`:

```swift
    public struct CameraDimensions {
        public let width: Int
        public let height: Int
    }

    public func startCapture(
        deviceId: String,
        onVideoFrame: @escaping (CMSampleBuffer) -> Void
    ) throws -> CameraDimensions {
        self.onVideoFrame = onVideoFrame

        let session = AVCaptureSession()
        session.sessionPreset = .high

        guard let device = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
            mediaType: .video,
            position: .unspecified
        ).devices.first(where: { $0.uniqueID == deviceId }) else {
            throw CaptureError.cameraNotFound
        }

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw CaptureError.cameraNotFound
        }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        let queue = DispatchQueue(label: "com.capturekit.camera", qos: .userInteractive)
        output.setSampleBufferDelegate(self, queue: queue)
        output.alwaysDiscardsLateVideoFrames = true

        guard session.canAddOutput(output) else {
            throw CaptureError.cameraNotFound
        }
        session.addOutput(output)

        session.startRunning()
        self.session = session

        let desc = device.activeFormat.formatDescription
        let dims = CMVideoFormatDescriptionGetDimensions(desc)
        return CameraDimensions(width: Int(dims.width), height: Int(dims.height))
    }

    // MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

    public func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        onVideoFrame?(sampleBuffer)
    }
```

### Step 4: Run tests — verify pass

Run: `cd CaptureKitEngine && swift test`
Expected: All tests pass

### Step 5: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/capture/camera-capture.swift CaptureKitEngine/Tests/CaptureKitEngineTests/CameraTests.swift
git commit -m "feat: camera capture via AVCaptureSession"
```

---

## Task 4: Camera in Recording Pipeline — Swift

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift`
- Create: `CaptureKitEngine/Tests/CaptureKitEngineTests/RecordingConfigTests.swift`

### Step 1: Write failing tests for config/result serialization with camera fields

```swift
// CaptureKitEngine/Tests/CaptureKitEngineTests/RecordingConfigTests.swift
import XCTest
@testable import CaptureKitEngine

final class RecordingConfigTests: XCTestCase {
    func testRecordingConfigDecodesWithCameraId() throws {
        let json = """
        {
            "display_id": 1,
            "fps": 60,
            "capture_system_audio": true,
            "output_dir": "/tmp/test",
            "mic_id": null,
            "camera_id": "cam-abc"
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let config = try decoder.decode(RecordingConfig.self, from: json)
        XCTAssertEqual(config.cameraId, "cam-abc")
    }

    func testRecordingConfigDecodesWithoutCameraId() throws {
        let json = """
        {
            "display_id": 1,
            "fps": 30,
            "capture_system_audio": false,
            "output_dir": "/tmp/test",
            "mic_id": null,
            "camera_id": null
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let config = try decoder.decode(RecordingConfig.self, from: json)
        XCTAssertNil(config.cameraId)
    }

    func testRecordingResultEncodesWithCameraPath() throws {
        let result = RecordingResult(
            screenPath: "screen.mov",
            systemAudioPath: nil,
            micPath: nil,
            cameraPath: "camera.mov",
            durationMs: 5000,
            frameCount: 300
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(result)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["camera_path"] as? String, "camera.mov")
    }

    func testRecordingResultEncodesNullCameraPath() throws {
        let result = RecordingResult(
            screenPath: "screen.mov",
            systemAudioPath: nil,
            micPath: nil,
            cameraPath: nil,
            durationMs: 5000,
            frameCount: 300
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(result)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertTrue(json["camera_path"] is NSNull)
    }
}
```

### Step 2: Run tests — verify failure

Run: `cd CaptureKitEngine && swift test`
Expected: FAIL — `RecordingConfig` has no member `cameraId`, `RecordingResult` initializer has no `cameraPath`

### Step 3: Update RecordingConfig and RecordingResult

In `recording-pipeline.swift`, update both structs:

```swift
public struct RecordingConfig: Codable {
    public let displayId: UInt32
    public let fps: Int
    public let captureSystemAudio: Bool
    public let outputDir: String
    public let micId: String?
    public let cameraId: String?
}

public struct RecordingResult: Codable {
    public let screenPath: String
    public let systemAudioPath: String?
    public let micPath: String?
    public let cameraPath: String?
    public let durationMs: UInt64
    public let frameCount: UInt64
}
```

### Step 4: Add camera properties and capture logic to RecordingPipeline

Add properties:

```swift
    private var cameraCapture: CameraCapture?
    private var cameraWriter: VideoWriter?
```

In `start()`, add after the mic capture block (after `micWriter = writer`), before `frameCount = 0`:

```swift
        if let cameraId = config.cameraId {
            let camera = CameraCapture()
            let dims = try camera.startCapture(deviceId: cameraId) { [weak self] sampleBuffer in
                guard let self = self, self.isRecording else { return }
                self.cameraWriter?.appendVideoSample(sampleBuffer)
            }
            cameraWriter = try VideoWriter(
                outputURL: outputDir.appendingPathComponent("camera.mov"),
                width: dims.width, height: dims.height, fps: config.fps
            )
            cameraCapture = camera
        }
```

In `stop()`, add after `micWriter?.finish()`:

```swift
        cameraCapture?.stopCapture()
        await cameraWriter?.finish()
```

Update the return in `stop()`:

```swift
        return RecordingResult(
            screenPath: "screen.mov",
            systemAudioPath: config.captureSystemAudio ? "system_audio.wav" : nil,
            micPath: micCapture != nil ? "mic.wav" : nil,
            cameraPath: cameraCapture != nil ? "camera.mov" : nil,
            durationMs: durationMs,
            frameCount: frameCount
        )
```

### Step 5: Run tests — verify pass

Run: `cd CaptureKitEngine && swift test`
Expected: All tests pass

### Step 6: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift CaptureKitEngine/Tests/CaptureKitEngineTests/RecordingConfigTests.swift
git commit -m "feat: integrate camera capture into recording pipeline"
```

---

## Task 5: Camera — Rust FFI & Tauri Commands

**Files:**
- Modify: `src-tauri/src/swift_ffi.rs`
- Modify: `src-tauri/src/commands/sources.rs`
- Modify: `src-tauri/src/commands/recording.rs`
- Modify: `src-tauri/src/project.rs`
- Modify: `src-tauri/src/lib.rs`

### Step 1: Write failing Rust tests

Add test module at bottom of `src-tauri/src/commands/sources.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_camera_info_deserializes_from_swift_json() {
        let json = r#"[{"id":"abc-123","name":"FaceTime HD"}]"#;
        let cameras: Vec<CameraInfo> = serde_json::from_str(json).unwrap();
        assert_eq!(cameras.len(), 1);
        assert_eq!(cameras[0].id, "abc-123");
        assert_eq!(cameras[0].name, "FaceTime HD");
    }

    #[test]
    fn test_camera_info_empty_array() {
        let json = "[]";
        let cameras: Vec<CameraInfo> = serde_json::from_str(json).unwrap();
        assert!(cameras.is_empty());
    }
}
```

Add test to `src-tauri/src/commands/recording.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recording_config_serializes_with_camera_id() {
        let config = RecordingConfig {
            display_id: 1,
            mic_id: None,
            camera_id: Some("cam-abc".to_string()),
            capture_system_audio: true,
            fps: 60,
        };
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["camera_id"], "cam-abc");
    }

    #[test]
    fn test_swift_result_deserializes_with_camera_path() {
        let json = r#"{
            "screen_path": "screen.mov",
            "system_audio_path": null,
            "mic_path": null,
            "camera_path": "camera.mov",
            "duration_ms": 5000,
            "frame_count": 300
        }"#;
        let result: SwiftRecordingResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.camera_path, Some("camera.mov".to_string()));
    }

    #[test]
    fn test_swift_result_deserializes_without_camera_path() {
        let json = r#"{
            "screen_path": "screen.mov",
            "system_audio_path": null,
            "mic_path": null,
            "camera_path": null,
            "duration_ms": 5000,
            "frame_count": 300
        }"#;
        let result: SwiftRecordingResult = serde_json::from_str(json).unwrap();
        assert!(result.camera_path.is_none());
    }
}
```

Update test in `src-tauri/src/project.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tracks_serialization_with_camera() {
        let tracks = Tracks {
            screen: "screen.mov".to_string(),
            mic: Some("mic.wav".to_string()),
            system_audio: None,
            camera: Some("camera.mov".to_string()),
        };
        let json = serde_json::to_string(&tracks).unwrap();
        let parsed: Tracks = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.camera, Some("camera.mov".to_string()));
    }

    #[test]
    fn test_tracks_serialization_without_camera() {
        let tracks = Tracks {
            screen: "screen.mov".to_string(),
            mic: None,
            system_audio: None,
            camera: None,
        };
        let json = serde_json::to_string(&tracks).unwrap();
        let parsed: Tracks = serde_json::from_str(&json).unwrap();
        assert!(parsed.camera.is_none());
    }
}
```

### Step 2: Run tests — verify failure

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: FAIL — `CameraInfo` not found, `camera_id` not a field of `RecordingConfig`, `camera` not a field of `Tracks`

### Step 3: Implement all Rust changes

**swift_ffi.rs** — add to extern block:

```rust
    fn ck_list_cameras(out_json: *mut *const c_char) -> i32;
```

Add to `impl CaptureKitEngine`:

```rust
    pub fn list_cameras() -> Result<String, String> {
        unsafe { call_json(|p| ck_list_cameras(p)) }
    }
```

**commands/sources.rs** — add struct and command:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct CameraInfo {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub async fn list_cameras() -> Result<Vec<CameraInfo>, String> {
    let json = CaptureKitEngine::list_cameras()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}
```

**commands/recording.rs** — add `camera_id` to `RecordingConfig`, `camera_path` to `SwiftRecordingResult`:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingConfig {
    pub display_id: u32,
    pub mic_id: Option<String>,
    pub camera_id: Option<String>,
    pub capture_system_audio: bool,
    pub fps: u32,
}

#[derive(Debug, Deserialize)]
struct SwiftRecordingResult {
    screen_path: String,
    system_audio_path: Option<String>,
    mic_path: Option<String>,
    camera_path: Option<String>,
    duration_ms: u64,
    #[allow(dead_code)]
    frame_count: u64,
}
```

Update `swift_config` in `start_recording`:

```rust
    let swift_config = serde_json::json!({
        "display_id": config.display_id,
        "fps": config.fps,
        "capture_system_audio": config.capture_system_audio,
        "output_dir": raw.to_string_lossy(),
        "mic_id": config.mic_id,
        "camera_id": config.camera_id,
    });
```

Update `Tracks` construction in `stop_recording`:

```rust
        tracks: Tracks {
            screen: result.screen_path,
            mic: result.mic_path,
            system_audio: result.system_audio_path,
            camera: result.camera_path,
        },
```

**project.rs** — add `camera` to `Tracks`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tracks {
    pub screen: String,
    pub mic: Option<String>,
    pub system_audio: Option<String>,
    pub camera: Option<String>,
}
```

**lib.rs** — register `list_cameras`:

```rust
        .invoke_handler(tauri::generate_handler![
            get_engine_version,
            commands::sources::list_displays,
            commands::sources::list_audio_inputs,
            commands::sources::list_cameras,
            commands::recording::start_recording,
            commands::recording::stop_recording,
        ])
```

### Step 4: Run tests — verify pass

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: All tests pass

### Step 5: Build full binary to verify linking

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles successfully

### Step 6: Commit

```bash
git add src-tauri/src/swift_ffi.rs src-tauri/src/commands/sources.rs src-tauri/src/commands/recording.rs src-tauri/src/project.rs src-tauri/src/lib.rs
git commit -m "feat: camera FFI bindings and Tauri commands"
```

---

## Task 6: Camera Picker — React UI

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/__tests__/source-picker.test.tsx`
- Modify: `src/components/recording/source-picker.tsx`
- Modify: `src/App.tsx`

### Step 1: Write failing tests

```tsx
// src/__tests__/source-picker.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { invoke } from "@tauri-apps/api/core"
import { SourcePicker } from "@/components/recording/source-picker"

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockedInvoke.mockReset()
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_displays") return [{ id: 1, width: 1920, height: 1080, is_main: true }]
    if (cmd === "list_audio_inputs") return [{ id: "mic-1", name: "Built-in Mic" }]
    if (cmd === "list_cameras") return [{ id: "cam-1", name: "FaceTime HD" }]
    return null
  })
})

describe("SourcePicker", () => {
  it("renders camera select dropdown", async () => {
    render(
      <SourcePicker
        onDisplaySelected={() => {}}
        selectedDisplayId={1}
        onMicSelected={() => {}}
        selectedMicId={null}
        onCameraSelected={() => {}}
        selectedCameraId={null}
      />
    )
    await waitFor(() => {
      expect(screen.getByText("Camera")).toBeInTheDocument()
    })
  })

  it("calls list_cameras on mount", async () => {
    render(
      <SourcePicker
        onDisplaySelected={() => {}}
        selectedDisplayId={null}
        onMicSelected={() => {}}
        selectedMicId={null}
        onCameraSelected={() => {}}
        selectedCameraId={null}
      />
    )
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("list_cameras")
    })
  })
})
```

### Step 2: Run tests — verify failure

Run: `npm test`
Expected: FAIL — SourcePicker does not accept `onCameraSelected` / `selectedCameraId`

### Step 3: Add CameraInfo type to types/index.ts

Add after `AudioInputInfo`:

```typescript
export interface CameraInfo {
  id: string
  name: string
}
```

Update `RecordingConfig`:

```typescript
export interface RecordingConfig {
  display_id: number
  mic_id: string | null
  camera_id: string | null
  capture_system_audio: boolean
  fps: number
}
```

Update `ProjectState.tracks`:

```typescript
  tracks: {
    screen: string
    mic: string | null
    system_audio: string | null
    camera: string | null
  }
```

### Step 4: Update SourcePicker with camera dropdown

Update Props interface:

```typescript
interface Props {
  onDisplaySelected: (displayId: number) => void
  selectedDisplayId: number | null
  onMicSelected: (micId: string | null) => void
  selectedMicId: string | null
  onCameraSelected: (cameraId: string | null) => void
  selectedCameraId: string | null
}
```

Add `CameraInfo` to imports:

```typescript
import type { DisplayInfo, AudioInputInfo, CameraInfo } from "@/types"
```

Update function signature, add cameras state:

```typescript
export function SourcePicker({
  onDisplaySelected,
  selectedDisplayId,
  onMicSelected,
  selectedMicId,
  onCameraSelected,
  selectedCameraId,
}: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [mics, setMics] = useState<AudioInputInfo[]>([])
  const [cameras, setCameras] = useState<CameraInfo[]>([])
  const [error, setError] = useState<string | null>(null)
```

Add camera fetch to useEffect:

```typescript
    invoke<CameraInfo[]>("list_cameras")
      .then((result) => {
        setCameras(result)
        if (!selectedCameraId && result.length > 0) {
          onCameraSelected(result[0].id)
        }
      })
      .catch(() => {})
```

Add camera select dropdown after the microphone dropdown JSX:

```tsx
      <div className="space-y-2">
        <Label>Camera</Label>
        <Select
          value={selectedCameraId ?? "none"}
          onValueChange={(val) => onCameraSelected(val === "none" ? null : val)}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select a camera" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No camera</SelectItem>
            {cameras.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
```

### Step 5: Update App.tsx — add camera state and wire through

Add state:

```typescript
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
```

Pass to SourcePicker:

```tsx
          <SourcePicker
            onDisplaySelected={setSelectedDisplay}
            selectedDisplayId={selectedDisplay}
            onMicSelected={setSelectedMic}
            selectedMicId={selectedMic}
            onCameraSelected={setSelectedCamera}
            selectedCameraId={selectedCamera}
          />
```

Add `camera_id` to recording config in `handleStart`:

```typescript
      await invoke("start_recording", {
        config: {
          display_id: selectedDisplay,
          mic_id: selectedMic,
          camera_id: selectedCamera,
          capture_system_audio: true,
          fps: 60,
        },
      })
```

Add camera track to last recording card:

```tsx
            {lastProject.tracks.camera && (
              <p><span className="text-muted-foreground">Camera:</span> {lastProject.tracks.camera}</p>
            )}
```

### Step 6: Run tests — verify pass

Run: `npm test`
Expected: All tests pass

### Step 7: Verify in dev mode

Run: `npx tauri dev`
Expected: Camera dropdown appears, recording with camera produces `camera.mov`

### Step 8: Commit

```bash
git add src/types/index.ts src/components/recording/source-picker.tsx src/App.tsx src/__tests__/source-picker.test.tsx
git commit -m "feat: camera picker UI with recording integration"
```

---

## Task 7: Pause/Resume — Swift

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift`
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`
- Create: `CaptureKitEngine/Tests/CaptureKitEngineTests/PauseResumeTests.swift`

### Step 1: Write failing tests

```swift
// CaptureKitEngine/Tests/CaptureKitEngineTests/PauseResumeTests.swift
import XCTest
@testable import CaptureKitEngine

final class PauseResumeTests: XCTestCase {
    func testDurationCalculationWithPause() {
        // Test the math: elapsed - paused = effective duration
        // Simulating: 10s total, 3s paused = 7s effective
        let startTime: UInt64 = 0
        let stopTime: UInt64 = 10_000_000_000 // 10s in nanoseconds (assuming numer/denom = 1)
        let totalPausedNano: UInt64 = 3_000_000_000 // 3s
        let effectiveNano = stopTime - startTime - totalPausedNano
        let effectiveMs = effectiveNano / 1_000_000
        XCTAssertEqual(effectiveMs, 7000)
    }

    func testDurationCalculationWithNoPause() {
        let startTime: UInt64 = 0
        let stopTime: UInt64 = 5_000_000_000
        let totalPausedNano: UInt64 = 0
        let effectiveNano = stopTime - startTime - totalPausedNano
        let effectiveMs = effectiveNano / 1_000_000
        XCTAssertEqual(effectiveMs, 5000)
    }

    func testDurationCalculationWithMultiplePauses() {
        // 20s total, paused twice: 2s + 3s = 5s paused = 15s effective
        let startTime: UInt64 = 0
        let stopTime: UInt64 = 20_000_000_000
        let totalPausedNano: UInt64 = 5_000_000_000
        let effectiveNano = stopTime - startTime - totalPausedNano
        let effectiveMs = effectiveNano / 1_000_000
        XCTAssertEqual(effectiveMs, 15000)
    }
}
```

### Step 2: Run tests — verify they pass (these test pure math, should pass immediately)

Run: `cd CaptureKitEngine && swift test`
Expected: Pass — these test the duration math we'll use in the implementation

### Step 3: Implement pause/resume in RecordingPipeline

Add properties after `isRecording`:

```swift
    private var isPaused = false
    private var totalPausedNano: UInt64 = 0
    private var pauseStartNano: UInt64 = 0
```

Add methods after `stop()`:

```swift
    public func pause() {
        guard isRecording, !isPaused else { return }
        isPaused = true
        pauseStartNano = mach_absolute_time()
    }

    public func resume() {
        guard isRecording, isPaused else { return }
        isPaused = false
        totalPausedNano += mach_absolute_time() - pauseStartNano
    }
```

Update all frame/audio callbacks in `start()` to check `!self.isPaused`:

Screen video callback:
```swift
            onVideoFrame: { [weak self] sampleBuffer in
                guard let self = self, self.isRecording, !self.isPaused else { return }
                self.videoWriter?.appendVideoSample(sampleBuffer)
                self.frameCount += 1
            },
```

System audio callback:
```swift
            onAudioSample: { [weak self] sampleBuffer in
                guard let self = self, self.isRecording, !self.isPaused else { return }
                self.systemAudioWriter?.appendAudioSample(sampleBuffer)
            }
```

Mic callback:
```swift
            try mic.start { [weak self] buffer, _ in
                guard let self = self, !self.isPaused else { return }
                writer.write(buffer: buffer)
            }
```

Camera callback:
```swift
            let dims = try camera.startCapture(deviceId: cameraId) { [weak self] sampleBuffer in
                guard let self = self, self.isRecording, !self.isPaused else { return }
                self.cameraWriter?.appendVideoSample(sampleBuffer)
            }
```

Update duration calculation in `stop()`:

```swift
        var timebaseInfo = mach_timebase_info_data_t()
        mach_timebase_info(&timebaseInfo)
        let elapsed = mach_absolute_time() - startTime - totalPausedNano
        let durationMs = elapsed * UInt64(timebaseInfo.numer) / UInt64(timebaseInfo.denom) / 1_000_000
```

### Step 4: Add C API functions in capi.swift

Add after `ck_start_recording`:

```swift
@_cdecl("ck_pause_recording")
public func ck_pause_recording(sessionId: UInt64) -> Int32 {
    sessionsLock.lock()
    guard let pipeline = activeSessions[sessionId] else {
        sessionsLock.unlock()
        return -1
    }
    sessionsLock.unlock()
    pipeline.pause()
    return 0
}

@_cdecl("ck_resume_recording")
public func ck_resume_recording(sessionId: UInt64) -> Int32 {
    sessionsLock.lock()
    guard let pipeline = activeSessions[sessionId] else {
        sessionsLock.unlock()
        return -1
    }
    sessionsLock.unlock()
    pipeline.resume()
    return 0
}
```

### Step 5: Run tests — verify pass

Run: `cd CaptureKitEngine && swift test`
Expected: All tests pass

### Step 6: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift CaptureKitEngine/Sources/CaptureKitEngine/capi.swift CaptureKitEngine/Tests/CaptureKitEngineTests/PauseResumeTests.swift
git commit -m "feat: pause/resume recording in Swift pipeline"
```

---

## Task 8: Pause/Resume — Rust FFI & Tauri Commands

**Files:**
- Modify: `src-tauri/src/swift_ffi.rs`
- Modify: `src-tauri/src/commands/recording.rs`
- Modify: `src-tauri/src/lib.rs`

### Step 1: Write failing test

Add to the `tests` module in `src-tauri/src/commands/recording.rs`:

```rust
    #[test]
    fn test_recording_state_defaults_to_none() {
        let state = RecordingState {
            active_session_id: std::sync::Mutex::new(None),
            active_project_id: std::sync::Mutex::new(None),
        };
        assert!(state.active_session_id.lock().unwrap().is_none());
        assert!(state.active_project_id.lock().unwrap().is_none());
    }
```

### Step 2: Run test — verify pass (baseline)

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: Pass

### Step 3: Add pause/resume FFI in swift_ffi.rs

In the `extern "C"` block:

```rust
    fn ck_pause_recording(session_id: u64) -> i32;
    fn ck_resume_recording(session_id: u64) -> i32;
```

In `impl CaptureKitEngine`:

```rust
    pub fn pause_recording(session_id: u64) -> Result<(), String> {
        unsafe {
            if ck_pause_recording(session_id) != 0 {
                return Err("Failed to pause recording".into());
            }
        }
        Ok(())
    }

    pub fn resume_recording(session_id: u64) -> Result<(), String> {
        unsafe {
            if ck_resume_recording(session_id) != 0 {
                return Err("Failed to resume recording".into());
            }
        }
        Ok(())
    }
```

### Step 4: Add Tauri commands in recording.rs

```rust
#[tauri::command]
pub async fn pause_recording(
    state: State<'_, RecordingState>,
) -> Result<(), String> {
    let session_id = state.active_session_id.lock().unwrap()
        .ok_or("No active recording")?;
    CaptureKitEngine::pause_recording(session_id)
}

#[tauri::command]
pub async fn resume_recording(
    state: State<'_, RecordingState>,
) -> Result<(), String> {
    let session_id = state.active_session_id.lock().unwrap()
        .ok_or("No active recording")?;
    CaptureKitEngine::resume_recording(session_id)
}
```

### Step 5: Register commands in lib.rs

```rust
        .invoke_handler(tauri::generate_handler![
            get_engine_version,
            commands::sources::list_displays,
            commands::sources::list_audio_inputs,
            commands::sources::list_cameras,
            commands::recording::start_recording,
            commands::recording::stop_recording,
            commands::recording::pause_recording,
            commands::recording::resume_recording,
        ])
```

### Step 6: Run tests and build

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: All tests pass

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles successfully

### Step 7: Commit

```bash
git add src-tauri/src/swift_ffi.rs src-tauri/src/commands/recording.rs src-tauri/src/lib.rs
git commit -m "feat: pause/resume Tauri commands"
```

---

## Task 9: Pause/Resume — React UI

**Files:**
- Create: `src/__tests__/record-button.test.tsx`
- Create: `src/__tests__/recording-timer.test.tsx`
- Modify: `src/components/recording/record-button.tsx`
- Modify: `src/components/recording/recording-timer.tsx`
- Modify: `src/App.tsx`

### Step 1: Write failing tests

```tsx
// src/__tests__/record-button.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { RecordButton } from "@/components/recording/record-button"

describe("RecordButton", () => {
  const noop = () => {}

  it("shows Start Recording when not recording", () => {
    render(
      <RecordButton
        isRecording={false} isPaused={false}
        onStart={noop} onStop={noop} onPause={noop} onResume={noop}
        disabled={false}
      />
    )
    expect(screen.getByText("Start Recording")).toBeInTheDocument()
  })

  it("shows Stop and Pause when recording", () => {
    render(
      <RecordButton
        isRecording={true} isPaused={false}
        onStart={noop} onStop={noop} onPause={noop} onResume={noop}
        disabled={false}
      />
    )
    expect(screen.getByText("Stop")).toBeInTheDocument()
    expect(screen.getByText("Pause")).toBeInTheDocument()
  })

  it("shows Resume instead of Pause when paused", () => {
    render(
      <RecordButton
        isRecording={true} isPaused={true}
        onStart={noop} onStop={noop} onPause={noop} onResume={noop}
        disabled={false}
      />
    )
    expect(screen.getByText("Stop")).toBeInTheDocument()
    expect(screen.getByText("Resume")).toBeInTheDocument()
    expect(screen.queryByText("Pause")).not.toBeInTheDocument()
  })
})
```

```tsx
// src/__tests__/recording-timer.test.tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RecordingTimer } from "@/components/recording/recording-timer"

describe("RecordingTimer", () => {
  it("renders nothing when not recording", () => {
    const { container } = render(<RecordingTimer isRecording={false} isPaused={false} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders timer badge when recording", () => {
    render(<RecordingTimer isRecording={true} isPaused={false} />)
    expect(screen.getByText("00:00")).toBeInTheDocument()
  })
})
```

### Step 2: Run tests — verify failure

Run: `npm test`
Expected: FAIL — `RecordButton` doesn't accept `isPaused`/`onPause`/`onResume`, `RecordingTimer` doesn't accept `isPaused`

### Step 3: Rewrite RecordButton with pause/resume

Replace `src/components/recording/record-button.tsx`:

```tsx
import { Button } from "@/components/ui/button"
import { Circle, Square, Pause, Play } from "lucide-react"

interface Props {
  isRecording: boolean
  isPaused: boolean
  onStart: () => void
  onStop: () => void
  onPause: () => void
  onResume: () => void
  disabled: boolean
}

export function RecordButton({
  isRecording,
  isPaused,
  onStart,
  onStop,
  onPause,
  onResume,
  disabled,
}: Props) {
  if (!isRecording) {
    return (
      <Button
        variant="default"
        size="lg"
        onClick={onStart}
        disabled={disabled}
        className="gap-2"
      >
        <Circle className="h-4 w-4 fill-current" />
        Start Recording
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="destructive"
        size="lg"
        onClick={onStop}
        className="gap-2"
      >
        <Square className="h-4 w-4" />
        Stop
      </Button>
      <Button
        variant="outline"
        size="lg"
        onClick={isPaused ? onResume : onPause}
        className="gap-2"
      >
        {isPaused ? (
          <>
            <Play className="h-4 w-4" />
            Resume
          </>
        ) : (
          <>
            <Pause className="h-4 w-4" />
            Pause
          </>
        )}
      </Button>
    </div>
  )
}
```

### Step 4: Rewrite RecordingTimer with pause support

Replace `src/components/recording/recording-timer.tsx`:

```tsx
import { useState, useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"

interface Props {
  isRecording: boolean
  isPaused: boolean
}

export function RecordingTimer({ isRecording, isPaused }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const offsetRef = useRef(0)
  const segmentStartRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!isRecording) {
      cancelAnimationFrame(rafRef.current)
      setElapsed(0)
      offsetRef.current = 0
      return
    }

    if (isPaused) {
      cancelAnimationFrame(rafRef.current)
      offsetRef.current += Date.now() - segmentStartRef.current
    } else {
      segmentStartRef.current = Date.now()
      const tick = () => {
        setElapsed(offsetRef.current + Date.now() - segmentStartRef.current)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    return () => cancelAnimationFrame(rafRef.current)
  }, [isRecording, isPaused])

  if (!isRecording) return null

  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const display = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`

  return (
    <Badge variant={isPaused ? "secondary" : "destructive"} className="gap-2 text-lg px-4 py-2 tabular-nums">
      {!isPaused && <span className="h-2 w-2 rounded-full bg-white animate-pulse" />}
      {isPaused && <span className="h-2 w-2 rounded-full bg-muted-foreground" />}
      {display}
    </Badge>
  )
}
```

### Step 5: Update App.tsx with pause/resume state and handlers

Add state:

```typescript
  const [isPaused, setIsPaused] = useState(false)
```

Add handlers:

```typescript
  const handlePause = async () => {
    try {
      await invoke("pause_recording")
      setIsPaused(true)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleResume = async () => {
    try {
      await invoke("resume_recording")
      setIsPaused(false)
    } catch (e) {
      setError(String(e))
    }
  }
```

Reset `isPaused` in `handleStart` (after `setIsRecording(true)`):

```typescript
      setIsPaused(false)
```

Reset `isPaused` in `handleStop` (after `setIsRecording(false)`):

```typescript
      setIsPaused(false)
```

Update JSX controls:

```tsx
          <div className="flex items-center gap-4">
            <RecordButton
              isRecording={isRecording}
              isPaused={isPaused}
              onStart={handleStart}
              onStop={handleStop}
              onPause={handlePause}
              onResume={handleResume}
              disabled={!selectedDisplay || isLoading}
            />
            <RecordingTimer isRecording={isRecording} isPaused={isPaused} />
          </div>
```

### Step 6: Run tests — verify pass

Run: `npm test`
Expected: All tests pass

### Step 7: Verify in dev mode

Run: `npx tauri dev`
Expected: Pause button during recording, timer freezes when paused, resumes correctly

### Step 8: Commit

```bash
git add src/App.tsx src/components/recording/record-button.tsx src/components/recording/recording-timer.tsx src/__tests__/record-button.test.tsx src/__tests__/recording-timer.test.tsx
git commit -m "feat: pause/resume recording UI"
```

---

## Task 10: Audio Level Meters — Swift

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift`
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`
- Create: `CaptureKitEngine/Tests/CaptureKitEngineTests/AudioLevelTests.swift`

### Step 1: Write failing tests for peak level calculation

```swift
// CaptureKitEngine/Tests/CaptureKitEngineTests/AudioLevelTests.swift
import XCTest
import AVFoundation
@testable import CaptureKitEngine

final class AudioLevelTests: XCTestCase {
    func testPeakLevelWithSilence() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 100)!
        buffer.frameLength = 100
        // All zeros = silence
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 0.0)
    }

    func testPeakLevelWithMaxSignal() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 100)!
        buffer.frameLength = 100
        let ptr = buffer.floatChannelData![0]
        for i in 0..<100 {
            ptr[i] = (i % 2 == 0) ? 1.0 : -1.0
        }
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 1.0)
    }

    func testPeakLevelWithHalfSignal() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 100)!
        buffer.frameLength = 100
        let ptr = buffer.floatChannelData![0]
        for i in 0..<100 {
            ptr[i] = 0.5
        }
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 0.5, accuracy: 0.001)
    }

    func testPeakLevelClampedToOne() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 10)!
        buffer.frameLength = 10
        let ptr = buffer.floatChannelData![0]
        ptr[0] = 2.5 // Over 1.0
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 1.0) // Clamped
    }

    func testPeakLevelNegativeValues() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 10)!
        buffer.frameLength = 10
        let ptr = buffer.floatChannelData![0]
        ptr[0] = -0.75
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 0.75, accuracy: 0.001)
    }
}
```

### Step 2: Run tests — verify failure

Run: `cd CaptureKitEngine && swift test`
Expected: FAIL — `AudioLevelCalculator` not found

### Step 3: Implement AudioLevelCalculator and integrate into pipeline

Add a new internal utility at the top of `recording-pipeline.swift` (before `RecordingPipeline` class):

```swift
enum AudioLevelCalculator {
    static func peakLevel(from buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData else { return 0 }
        let frames = Int(buffer.frameLength)
        var peak: Float = 0
        for i in 0..<frames {
            peak = max(peak, abs(channelData[0][i]))
        }
        return min(peak, 1.0)
    }

    static func peakLevel(from sampleBuffer: CMSampleBuffer) -> Float {
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer),
              let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else { return 0 }
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)!.pointee
        let length = CMBlockBufferGetDataLength(blockBuffer)
        guard length > 0 else { return 0 }

        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &dataPointer)
        guard let src = dataPointer else { return 0 }

        let floatPtr = UnsafeRawPointer(src).assumingMemoryBound(to: Float.self)
        let sampleCount = length / MemoryLayout<Float>.size
        var peak: Float = 0
        for i in 0..<sampleCount {
            peak = max(peak, abs(floatPtr[i]))
        }
        return min(peak, 1.0)
    }
}
```

Add level tracking properties to `RecordingPipeline`:

```swift
    private var micLevel: Float = 0
    private var systemAudioLevel: Float = 0
    private let levelsLock = NSLock()
```

Add public getter:

```swift
    public func getAudioLevels() -> (mic: Float, systemAudio: Float) {
        levelsLock.lock()
        defer { levelsLock.unlock() }
        return (micLevel, systemAudioLevel)
    }
```

Update the `onAudioSample` callback in `start()`:

```swift
            onAudioSample: { [weak self] sampleBuffer in
                guard let self = self, self.isRecording, !self.isPaused else { return }
                self.systemAudioWriter?.appendAudioSample(sampleBuffer)
                let level = AudioLevelCalculator.peakLevel(from: sampleBuffer)
                self.levelsLock.lock()
                self.systemAudioLevel = level
                self.levelsLock.unlock()
            }
```

Update the mic callback:

```swift
            try mic.start { [weak self] buffer, _ in
                guard let self = self, !self.isPaused else { return }
                writer.write(buffer: buffer)
                let level = AudioLevelCalculator.peakLevel(from: buffer)
                self.levelsLock.lock()
                self.micLevel = level
                self.levelsLock.unlock()
            }
```

### Step 4: Add C API function in capi.swift

```swift
@_cdecl("ck_get_audio_levels")
public func ck_get_audio_levels(
    sessionId: UInt64,
    outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    sessionsLock.lock()
    guard let pipeline = activeSessions[sessionId] else {
        sessionsLock.unlock()
        return -1
    }
    sessionsLock.unlock()

    let levels = pipeline.getAudioLevels()
    let json = "{\"mic_level\":\(levels.mic),\"system_audio_level\":\(levels.systemAudio)}"
    outJson.pointee = strdup(json)
    return 0
}
```

### Step 5: Run tests — verify pass

Run: `cd CaptureKitEngine && swift test`
Expected: All tests pass (including 5 new AudioLevelTests)

### Step 6: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift CaptureKitEngine/Sources/CaptureKitEngine/capi.swift CaptureKitEngine/Tests/CaptureKitEngineTests/AudioLevelTests.swift
git commit -m "feat: audio level metering in Swift pipeline"
```

---

## Task 11: Audio Level Meters — Rust & React

**Files:**
- Modify: `src-tauri/src/swift_ffi.rs`
- Modify: `src-tauri/src/commands/recording.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/index.ts`
- Create: `src/components/recording/audio-level-meter.tsx`
- Create: `src/__tests__/audio-level-meter.test.tsx`
- Modify: `src/App.tsx`

### Step 1: Write failing Rust test

Add to `tests` module in `src-tauri/src/commands/recording.rs`:

```rust
    #[test]
    fn test_audio_levels_deserializes_from_swift_json() {
        let json = r#"{"mic_level":0.75,"system_audio_level":0.3}"#;
        let levels: AudioLevels = serde_json::from_str(json).unwrap();
        assert!((levels.mic_level - 0.75).abs() < 0.001);
        assert!((levels.system_audio_level - 0.3).abs() < 0.001);
    }

    #[test]
    fn test_audio_levels_deserializes_zeros() {
        let json = r#"{"mic_level":0.0,"system_audio_level":0.0}"#;
        let levels: AudioLevels = serde_json::from_str(json).unwrap();
        assert_eq!(levels.mic_level, 0.0);
        assert_eq!(levels.system_audio_level, 0.0);
    }
```

### Step 2: Write failing React test

```tsx
// src/__tests__/audio-level-meter.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { invoke } from "@tauri-apps/api/core"
import { AudioLevelMeter } from "@/components/recording/audio-level-meter"

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockedInvoke.mockReset()
  mockedInvoke.mockResolvedValue({ mic_level: 0.5, system_audio_level: 0.3 })
})

describe("AudioLevelMeter", () => {
  it("renders nothing when not recording", () => {
    const { container } = render(<AudioLevelMeter isRecording={false} isPaused={false} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders mic and system labels when recording", async () => {
    render(<AudioLevelMeter isRecording={true} isPaused={false} />)
    expect(screen.getByText("Mic")).toBeInTheDocument()
    expect(screen.getByText("System")).toBeInTheDocument()
  })
})
```

### Step 3: Run tests — verify failure

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: FAIL — `AudioLevels` not found

Run: `npm test`
Expected: FAIL — `AudioLevelMeter` module not found

### Step 4: Implement Rust FFI and Tauri command

**swift_ffi.rs** — add to extern block:

```rust
    fn ck_get_audio_levels(session_id: u64, out_json: *mut *const c_char) -> i32;
```

Add to `impl CaptureKitEngine`:

```rust
    pub fn get_audio_levels(session_id: u64) -> Result<String, String> {
        unsafe { call_json(|p| ck_get_audio_levels(session_id, p)) }
    }
```

**commands/recording.rs** — add struct and command:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct AudioLevels {
    pub mic_level: f32,
    pub system_audio_level: f32,
}

#[tauri::command]
pub async fn get_audio_levels(
    state: State<'_, RecordingState>,
) -> Result<AudioLevels, String> {
    let session_id = state.active_session_id.lock().unwrap()
        .ok_or("No active recording")?;
    let json = CaptureKitEngine::get_audio_levels(session_id)?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}
```

**lib.rs** — add to handler:

```rust
            commands::recording::get_audio_levels,
```

### Step 5: Run Rust tests — verify pass

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: All tests pass

### Step 6: Add AudioLevels type to types/index.ts

```typescript
export interface AudioLevels {
  mic_level: number
  system_audio_level: number
}
```

### Step 7: Create AudioLevelMeter component

```tsx
// src/components/recording/audio-level-meter.tsx
import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Label } from "@/components/ui/label"
import type { AudioLevels } from "@/types"

interface Props {
  isRecording: boolean
  isPaused: boolean
}

export function AudioLevelMeter({ isRecording, isPaused }: Props) {
  const [levels, setLevels] = useState<AudioLevels>({ mic_level: 0, system_audio_level: 0 })
  const intervalRef = useRef<ReturnType<typeof setInterval>>(0 as unknown as ReturnType<typeof setInterval>)

  useEffect(() => {
    if (isRecording && !isPaused) {
      const poll = () => {
        invoke<AudioLevels>("get_audio_levels")
          .then(setLevels)
          .catch(() => {})
      }
      intervalRef.current = setInterval(poll, 100)
    } else {
      clearInterval(intervalRef.current)
      if (!isRecording) {
        setLevels({ mic_level: 0, system_audio_level: 0 })
      }
    }
    return () => clearInterval(intervalRef.current)
  }, [isRecording, isPaused])

  if (!isRecording) return null

  return (
    <div className="space-y-2">
      <LevelBar label="Mic" level={levels.mic_level} />
      <LevelBar label="System" level={levels.system_audio_level} />
    </div>
  )
}

function LevelBar({ label, level }: { label: string; level: number }) {
  const percent = Math.round(level * 100)
  const color = level > 0.8 ? "bg-red-500" : level > 0.5 ? "bg-yellow-500" : "bg-green-500"

  return (
    <div className="flex items-center gap-3">
      <Label className="w-14 text-xs text-muted-foreground">{label}</Label>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-100 ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
```

### Step 8: Wire into App.tsx

Add import:

```typescript
import { AudioLevelMeter } from "@/components/recording/audio-level-meter"
```

Add after the RecordButton/Timer row, inside CardContent:

```tsx
          {isRecording && (
            <AudioLevelMeter isRecording={isRecording} isPaused={isPaused} />
          )}
```

### Step 9: Run React tests — verify pass

Run: `npm test`
Expected: All tests pass

### Step 10: Build full binary and verify

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles

Run: `npx tauri dev`
Expected: Level bars animate green/yellow/red during recording, freeze when paused

### Step 11: Commit

```bash
git add src-tauri/src/swift_ffi.rs src-tauri/src/commands/recording.rs src-tauri/src/lib.rs src/types/index.ts src/components/recording/audio-level-meter.tsx src/__tests__/audio-level-meter.test.tsx src/App.tsx
git commit -m "feat: real-time audio level meters during recording"
```

---

## Summary of Deliverables

| Feature | Tests | Implementation |
|---------|-------|---------------|
| Test infrastructure | Swift XCTest + Vitest + Rust `#[cfg(test)]` | Task 1 |
| Camera discovery | Swift: serialization, listing safety. Rust: JSON deser | Task 2 |
| Camera capture | Swift: dimensions struct, stop safety | Task 3 |
| Camera in pipeline | Swift: config/result with camera fields | Task 4 |
| Camera FFI + commands | Rust: deser, config, tracks | Task 5 |
| Camera picker UI | React: renders dropdown, calls list_cameras | Task 6 |
| Pause/resume (Swift) | Swift: duration math with pauses | Task 7 |
| Pause/resume (Rust) | Rust: state defaults | Task 8 |
| Pause/resume UI | React: button states, timer pause | Task 9 |
| Audio levels (Swift) | Swift: peakLevel with synthetic buffers (5 tests) | Task 10 |
| Audio levels (Rust + React) | Rust: AudioLevels deser. React: renders bars | Task 11 |

**Total: 11 tasks, ~25+ tests across 3 test suites**

**Test commands:**
- Swift: `cd CaptureKitEngine && swift test`
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- React: `npm test`
- All: Run all three in sequence to verify full green
