# CaptureKit Phase 0 + Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working macOS app that records screen + mic to .mov/.wav files, with the full Tauri + Swift framework architecture wired end-to-end.

**Architecture:** Tauri v2 (Rust) app shell with React frontend (shadcn/ui + Tailwind). A Swift framework ("CaptureKitEngine") handles all Apple APIs via a thin C FFI boundary. No pixel data crosses the boundary — only commands, file paths, and JSON.

**Tech Stack:** Tauri v2, Rust, Swift (SwiftPM), React 18, TypeScript, Vite, shadcn/ui, Tailwind CSS, ScreenCaptureKit, AVAudioEngine, VideoToolbox, AVAssetWriter

---

## Phase 0: Foundation

### Task 1: Scaffold Frontend with shadcn/ui

**Files:**
- Create: `capturekit/` (shadcn Vite project)

**Step 1: Create the shadcn/ui Vite project**

```bash
cd /Users/ofekseroussi/Dev/reko
npx shadcn@latest create --preset "https://ui.shadcn.com/init?base=radix&style=nova&baseColor=neutral&theme=neutral&iconLibrary=lucide&font=inter&menuAccent=subtle&menuColor=default&radius=default&template=vite&rtl=false" --template vite capturekit
```

**Step 2: Install dependencies**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npm install
```

Expected: clean install.

**Step 3: Verify the dev server starts**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npm run dev
```

Expected: Vite dev server starts at `http://localhost:5173`. Open in browser to verify the shadcn starter page loads.

**Step 4: Commit**

```bash
git add capturekit/
git commit -m "feat: scaffold frontend with shadcn/ui Vite template"
```

---

### Task 2: Add Tauri v2 to the Project

**Files:**
- Modify: `capturekit/package.json`
- Create: `capturekit/src-tauri/` (Tauri scaffold)

**Step 1: Install Tauri CLI and API**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npm install -D @tauri-apps/cli@latest
npm install @tauri-apps/api@latest
```

**Step 2: Initialize Tauri**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npx tauri init
```

When prompted:
- App name: `CaptureKit`
- Window title: `CaptureKit`
- Frontend dev URL: `http://localhost:5173`
- Frontend dev command: `npm run dev`
- Frontend build command: `npm run build`
- Frontend dist directory: `../dist`

**Step 3: Add Tauri scripts to package.json**

Add to the `"scripts"` section in `capturekit/package.json`:

```json
"tauri": "tauri",
"tauri:dev": "tauri dev",
"tauri:build": "tauri build"
```

**Step 4: Add serde to Rust dependencies**

Add to `capturekit/src-tauri/Cargo.toml` under `[dependencies]`:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

**Step 5: Verify Tauri dev mode launches**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npx tauri dev
```

Expected: A native window opens showing the shadcn starter page. The Tauri + Vite integration works.

**Step 6: Commit**

```bash
git add capturekit/
git commit -m "feat: add Tauri v2 to shadcn/ui project"
```

---

### Task 3: Create Swift Package (CaptureKitEngine)

**Files:**
- Create: `CaptureKitEngine/Package.swift`
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/capturekit-engine.swift`
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/include/CaptureKitEngine.h`

**Step 1: Initialize the Swift package**

```bash
cd /Users/ofekseroussi/Dev/reko
mkdir CaptureKitEngine
cd CaptureKitEngine
swift package init --type library --name CaptureKitEngine
```

**Step 2: Replace `Package.swift`**

Write `CaptureKitEngine/Package.swift`:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CaptureKitEngine",
    platforms: [.macOS(.v14)],
    products: [
        .library(
            name: "CaptureKitEngine",
            type: .static,
            targets: ["CaptureKitEngine"]
        ),
    ],
    targets: [
        .target(
            name: "CaptureKitEngine",
            path: "Sources/CaptureKitEngine",
            publicHeadersPath: "include",
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("VideoToolbox"),
                .linkedFramework("Metal"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("CoreAudio"),
            ]
        ),
    ]
)
```

**Step 3: Create the C header**

Create directory and write `CaptureKitEngine/Sources/CaptureKitEngine/include/CaptureKitEngine.h`:

```c
#ifndef CAPTUREKIT_ENGINE_H
#define CAPTUREKIT_ENGINE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef int32_t CKResult;
#define CK_OK 0
#define CK_ERROR -1

const char* ck_get_version(void);
void ck_free_string(char *str);

#ifdef __cplusplus
}
#endif

#endif
```

**Step 4: Create the Swift implementation**

Write `CaptureKitEngine/Sources/CaptureKitEngine/capturekit-engine.swift`:

```swift
import Foundation

public final class CaptureKitEngine {
    public static let version = "0.1.0"

    public init() {}
}
```

**Step 5: Create the C API exports**

Write `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`:

```swift
import Foundation

@_cdecl("ck_get_version")
public func ck_get_version() -> UnsafePointer<CChar>? {
    return strdup(CaptureKitEngine.version)
}

@_cdecl("ck_free_string")
public func ck_free_string(ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}
```

**Step 6: Remove auto-generated files that conflict**

Delete any default test files and the auto-generated source file:

```bash
rm -rf /Users/ofekseroussi/Dev/reko/CaptureKitEngine/Tests
```

If `swift package init` created a different default source file, remove it.

**Step 7: Verify Swift package builds**

```bash
cd /Users/ofekseroussi/Dev/reko/CaptureKitEngine
swift build -c release
```

Expected: Build succeeds. Output at `.build/release/libCaptureKitEngine.a`.

**Step 8: Commit**

```bash
git add CaptureKitEngine/
git commit -m "feat: create CaptureKitEngine Swift package with C API"
```

---

### Task 4: Wire Rust FFI to Swift Framework

**Files:**
- Modify: `capturekit/src-tauri/build.rs`
- Modify: `capturekit/src-tauri/Cargo.toml`
- Create: `capturekit/src-tauri/src/swift_ffi.rs`
- Modify: `capturekit/src-tauri/src/lib.rs` (or `main.rs`, depending on scaffold)

**Step 1: Update `build.rs` to compile and link the Swift library**

Replace `capturekit/src-tauri/build.rs`:

```rust
use std::path::PathBuf;
use std::process::Command;

fn main() {
    tauri_build::build();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let swift_project_dir = manifest_dir
        .parent().unwrap()
        .parent().unwrap()
        .join("CaptureKitEngine");

    // Build Swift framework
    let status = Command::new("swift")
        .args(["build", "-c", "release"])
        .current_dir(&swift_project_dir)
        .status()
        .expect("Failed to run swift build. Is Xcode installed?");

    assert!(status.success(), "Swift build failed");

    // Link static library
    let swift_lib_dir = swift_project_dir.join(".build/release");
    println!("cargo:rustc-link-search=native={}", swift_lib_dir.display());
    println!("cargo:rustc-link-lib=static=CaptureKitEngine");

    // Link Apple frameworks
    for framework in &[
        "ScreenCaptureKit", "AVFoundation", "VideoToolbox", "Metal",
        "CoreMedia", "CoreVideo", "CoreGraphics", "CoreAudio",
        "CoreFoundation", "Foundation", "AppKit",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }

    // Link Swift standard library
    let swift_path_output = Command::new("xcrun")
        .args(["--toolchain", "default", "--find", "swift"])
        .output()
        .expect("Failed to find swift toolchain");
    let swift_bin = String::from_utf8(swift_path_output.stdout).unwrap();
    let swift_lib_path = PathBuf::from(swift_bin.trim())
        .parent().unwrap()
        .parent().unwrap()
        .join("lib/swift/macosx");
    println!("cargo:rustc-link-search=native={}", swift_lib_path.display());

    // Rebuild when Swift sources change
    println!("cargo:rerun-if-changed={}", swift_project_dir.join("Sources").display());
    println!("cargo:rerun-if-changed={}", swift_project_dir.join("Package.swift").display());
}
```

**Step 2: Create Rust FFI bindings**

Write `capturekit/src-tauri/src/swift_ffi.rs`:

```rust
use std::ffi::CStr;
use std::os::raw::c_char;

extern "C" {
    fn ck_get_version() -> *const c_char;
    fn ck_free_string(ptr: *mut c_char);
}

pub struct CaptureKitEngine;

impl CaptureKitEngine {
    pub fn version() -> String {
        unsafe {
            let ptr = ck_get_version();
            if ptr.is_null() {
                return "unknown".to_string();
            }
            let version = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            ck_free_string(ptr as *mut c_char);
            version
        }
    }
}
```

**Step 3: Add a Tauri command that calls the Swift FFI**

Update the Tauri entry file (`capturekit/src-tauri/src/lib.rs` or `main.rs` — check which one the scaffold produced). Add:

```rust
mod swift_ffi;

use swift_ffi::CaptureKitEngine;

#[tauri::command]
fn get_engine_version() -> String {
    CaptureKitEngine::version()
}
```

Register it in the builder's `invoke_handler`:

```rust
.invoke_handler(tauri::generate_handler![get_engine_version])
```

**Step 4: Verify it compiles and runs**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npx tauri dev
```

Expected: App launches without errors. If there are linker errors, common fixes:
- Missing Xcode CLI tools: `xcode-select --install`
- Architecture mismatch: ensure `swift build` targets the same arch as Cargo
- Missing framework: add it to the `build.rs` framework list

This is the riskiest step in the entire project. Resolve all build issues before proceeding.

**Step 5: Commit**

```bash
git add capturekit/src-tauri/
git commit -m "feat: wire Rust FFI to Swift CaptureKitEngine"
```

---

### Task 5: Frontend Calls Swift Through Full Chain

**Files:**
- Modify: `capturekit/src/App.tsx`

**Step 1: Update the frontend to call the Swift engine version**

Replace the main content of `capturekit/src/App.tsx` (keep any existing imports/layout from shadcn):

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"

function App() {
  const [engineVersion, setEngineVersion] = useState("")

  useEffect(() => {
    invoke<string>("get_engine_version").then(setEngineVersion)
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold">CaptureKit</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Engine v{engineVersion || "..."}
      </p>
    </main>
  )
}

export default App
```

**Step 2: Verify the full chain**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npx tauri dev
```

Expected: Window shows "CaptureKit" and "Engine v0.1.0". This confirms: Frontend → Tauri IPC → Rust → C FFI → Swift → back.

**Step 3: Commit**

```bash
git add capturekit/src/App.tsx
git commit -m "feat: verify full chain — frontend calls Swift via Rust FFI"
```

---

### Task 6: Add macOS Permission Plists

**Files:**
- Create: `capturekit/src-tauri/Info.plist`
- Create: `capturekit/src-tauri/Entitlements.plist`
- Modify: `capturekit/src-tauri/tauri.conf.json`

**Step 1: Create `Info.plist` with permission descriptions**

Write `capturekit/src-tauri/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSScreenCaptureUsageDescription</key>
    <string>CaptureKit needs to record your screen</string>
    <key>NSCameraUsageDescription</key>
    <string>CaptureKit needs camera access for webcam overlay</string>
    <key>NSMicrophoneUsageDescription</key>
    <string>CaptureKit needs microphone access to record audio</string>
</dict>
</plist>
```

**Step 2: Create `Entitlements.plist`**

Write `capturekit/src-tauri/Entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
</dict>
</plist>
```

**Step 3: Update `tauri.conf.json`**

In `capturekit/src-tauri/tauri.conf.json`, set:

```json
{
  "productName": "CaptureKit",
  "identifier": "com.capturekit.app",
  "bundle": {
    "macOS": {
      "minimumSystemVersion": "14.0",
      "entitlements": "./Entitlements.plist"
    }
  }
}
```

**Step 4: Verify dev mode still works**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npx tauri dev
```

Expected: App still launches and shows engine version.

**Step 5: Commit**

```bash
git add capturekit/src-tauri/Info.plist capturekit/src-tauri/Entitlements.plist capturekit/src-tauri/tauri.conf.json
git commit -m "feat: add macOS permission plists and entitlements"
```

---

**Phase 0 Complete.** The full chain is wired: Frontend (shadcn/ui) → Tauri IPC → Rust → C FFI → Swift → response. macOS permissions configured.

---

## Phase 1: Core Recording

### Task 7: Swift — Enumerate Displays via ScreenCaptureKit

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/include/CaptureKitEngine.h`
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/capture/screen-capture.swift`
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`

**Step 1: Add `ck_list_displays` to the C header**

Add before `#endif` in `CaptureKitEngine/Sources/CaptureKitEngine/include/CaptureKitEngine.h`:

```c
// Source discovery
CKResult ck_list_displays(const char **out_json);
```

**Step 2: Create the screen capture module**

Write `CaptureKitEngine/Sources/CaptureKitEngine/capture/screen-capture.swift`:

```swift
import Foundation
import ScreenCaptureKit
import CoreMedia

public struct DisplayInfo: Codable {
    public let id: UInt32
    public let width: Int
    public let height: Int
    public let isMain: Bool
}

public final class ScreenCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var onVideoFrame: ((CMSampleBuffer) -> Void)?
    private var onAudioSample: ((CMSampleBuffer) -> Void)?

    public static func listDisplays() async throws -> [DisplayInfo] {
        let content = try await SCShareableContent.excludingDesktopWindows(
            true, onScreenWindowsOnly: true
        )
        let mainID = CGMainDisplayID()
        return content.displays.map { display in
            DisplayInfo(
                id: display.displayID,
                width: display.width,
                height: display.height,
                isMain: display.displayID == mainID
            )
        }
    }

    public func startCapture(
        displayID: UInt32,
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
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw CaptureError.displayNotFound
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.width = display.width * 2
        config.height = display.height * 2
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

    public func stopCapture() async throws {
        guard let stream = stream else { return }
        try await stream.stopCapture()
        self.stream = nil
    }

    // MARK: - SCStreamOutput

    public func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard sampleBuffer.isValid else { return }
        switch type {
        case .screen:
            onVideoFrame?(sampleBuffer)
        case .audio:
            onAudioSample?(sampleBuffer)
        @unknown default:
            break
        }
    }

    // MARK: - SCStreamDelegate

    public func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("Stream error: \(error)")
    }
}

public enum CaptureError: Error {
    case displayNotFound
}
```

**Step 3: Add display listing to the C API**

Add to `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`:

```swift
import ScreenCaptureKit

@_cdecl("ck_list_displays")
public func ck_list_displays(outJson: UnsafeMutablePointer<UnsafePointer<CChar>?>) -> Int32 {
    let semaphore = DispatchSemaphore(value: 0)
    var resultJson = "[]"
    var errorCode: Int32 = 0

    Task {
        do {
            let displays = try await ScreenCapture.listDisplays()
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            let data = try encoder.encode(displays)
            resultJson = String(data: data, encoding: .utf8) ?? "[]"
        } catch {
            errorCode = -1
        }
        semaphore.signal()
    }

    semaphore.wait()
    outJson.pointee = UnsafePointer(strdup(resultJson))
    return errorCode
}
```

**Step 4: Verify Swift builds**

```bash
cd /Users/ofekseroussi/Dev/reko/CaptureKitEngine
swift build -c release
```

Expected: Build succeeds.

**Step 5: Commit**

```bash
git add CaptureKitEngine/
git commit -m "feat: enumerate displays via ScreenCaptureKit"
```

---

### Task 8: Rust — Display Listing Command

**Files:**
- Modify: `capturekit/src-tauri/src/swift_ffi.rs`
- Create: `capturekit/src-tauri/src/commands/mod.rs`
- Create: `capturekit/src-tauri/src/commands/sources.rs`
- Modify: `capturekit/src-tauri/src/lib.rs`

**Step 1: Extend Rust FFI with `list_displays`**

Add to the `extern "C"` block and impl in `capturekit/src-tauri/src/swift_ffi.rs`:

```rust
extern "C" {
    fn ck_get_version() -> *const c_char;
    fn ck_list_displays(out_json: *mut *const c_char) -> i32;
    fn ck_free_string(ptr: *mut c_char);
}

impl CaptureKitEngine {
    // ... existing version() ...

    pub fn list_displays() -> Result<String, String> {
        unsafe {
            let mut json_ptr: *const c_char = std::ptr::null();
            let result = ck_list_displays(&mut json_ptr);
            if result != 0 || json_ptr.is_null() {
                return Err("Failed to list displays".into());
            }
            let json = CStr::from_ptr(json_ptr).to_string_lossy().into_owned();
            ck_free_string(json_ptr as *mut c_char);
            Ok(json)
        }
    }
}
```

**Step 2: Create commands module**

Write `capturekit/src-tauri/src/commands/mod.rs`:

```rust
pub mod sources;
```

Write `capturekit/src-tauri/src/commands/sources.rs`:

```rust
use serde::{Deserialize, Serialize};
use crate::swift_ffi::CaptureKitEngine;

#[derive(Debug, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub width: i32,
    pub height: i32,
    pub is_main: bool,
}

#[tauri::command]
pub async fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    let json = CaptureKitEngine::list_displays()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}
```

**Step 3: Register in `lib.rs`**

Add `mod commands;` and register `commands::sources::list_displays` in the handler.

**Step 4: Verify it compiles**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
cargo build --manifest-path src-tauri/Cargo.toml
```

**Step 5: Commit**

```bash
git add capturekit/src-tauri/
git commit -m "feat: add list_displays Tauri command via Swift FFI"
```

---

### Task 9: Frontend — Source Picker with shadcn/ui

**Files:**
- Create: `capturekit/src/types/index.ts`
- Create: `capturekit/src/components/recording/source-picker.tsx`
- Modify: `capturekit/src/App.tsx`

**Step 1: Add shadcn Select component**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npx shadcn@latest add select label
```

**Step 2: Create shared types**

Write `capturekit/src/types/index.ts`:

```typescript
export interface DisplayInfo {
  id: number
  width: number
  height: number
  is_main: boolean
}

export interface AudioInputInfo {
  id: string
  name: string
}

export interface RecordingConfig {
  display_id: number
  mic_id: string | null
  capture_system_audio: boolean
  fps: number
}

export interface ProjectState {
  id: string
  name: string
  created_at: number
  tracks: {
    screen: string
    mic: string | null
    system_audio: string | null
  }
  timeline: {
    duration_ms: number
    in_point: number
    out_point: number
  }
}
```

**Step 3: Create the source picker**

Write `capturekit/src/components/recording/source-picker.tsx`:

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import type { DisplayInfo } from "@/types"

interface Props {
  onDisplaySelected: (displayId: number) => void
  selectedDisplayId: number | null
}

export function SourcePicker({ onDisplaySelected, selectedDisplayId }: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    invoke<DisplayInfo[]>("list_displays")
      .then((result) => {
        setDisplays(result)
        if (!selectedDisplayId) {
          const main = result.find((d) => d.is_main)
          if (main) onDisplaySelected(main.id)
        }
      })
      .catch((e) => setError(String(e)))
  }, [])

  if (error) {
    return <p className="text-sm text-destructive">Error: {error}</p>
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="display-select">Display</Label>
      <Select
        value={selectedDisplayId?.toString() ?? ""}
        onValueChange={(val) => onDisplaySelected(Number(val))}
      >
        <SelectTrigger id="display-select" className="w-64">
          <SelectValue placeholder="Select a display" />
        </SelectTrigger>
        <SelectContent>
          {displays.map((d) => (
            <SelectItem key={d.id} value={d.id.toString()}>
              Display {d.id} ({d.width}x{d.height})
              {d.is_main ? " — Main" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

**Step 4: Update App.tsx**

Replace `capturekit/src/App.tsx`:

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { SourcePicker } from "@/components/recording/source-picker"

function App() {
  const [engineVersion, setEngineVersion] = useState("")
  const [selectedDisplay, setSelectedDisplay] = useState<number | null>(null)

  useEffect(() => {
    invoke<string>("get_engine_version").then(setEngineVersion)
  }, [])

  return (
    <main className="flex min-h-screen flex-col p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">CaptureKit</h1>
        <p className="text-sm text-muted-foreground">
          Engine v{engineVersion || "..."}
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Record</h2>
        <SourcePicker
          onDisplaySelected={setSelectedDisplay}
          selectedDisplayId={selectedDisplay}
        />
      </section>
    </main>
  )
}

export default App
```

**Step 5: Verify displays are listed**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npx tauri dev
```

Expected: shadcn Select component shows connected displays. Main display auto-selected.

**Step 6: Commit**

```bash
git add capturekit/src/
git commit -m "feat: display picker with shadcn/ui Select component"
```

---

### Task 10: Swift — Recording Pipeline (Screen + System Audio)

**Files:**
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/recording/video-writer.swift`
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/recording/audio-file-writer.swift`
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift`

**Step 1: Create VideoWriter**

Write `CaptureKitEngine/Sources/CaptureKitEngine/recording/video-writer.swift`:

```swift
import Foundation
import AVFoundation
import CoreMedia

public final class VideoWriter {
    private let assetWriter: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private var isStarted = false

    public init(outputURL: URL, width: Int, height: Int, fps: Int) throws {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mov)

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 20_000_000,
                AVVideoMaxKeyFrameIntervalKey: fps,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: fps,
            ] as [String: Any],
        ]

        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = true
        assetWriter.add(videoInput)
    }

    public func appendVideoSample(_ sampleBuffer: CMSampleBuffer) {
        if !isStarted {
            assetWriter.startWriting()
            assetWriter.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
            isStarted = true
        }
        guard videoInput.isReadyForMoreMediaData else { return }
        videoInput.append(sampleBuffer)
    }

    public func finish() async {
        guard isStarted else { return }
        videoInput.markAsFinished()
        await assetWriter.finishWriting()
    }
}
```

**Step 2: Create AudioFileWriter**

Write `CaptureKitEngine/Sources/CaptureKitEngine/recording/audio-file-writer.swift`:

```swift
import Foundation
import AVFoundation
import CoreMedia

public final class AudioFileWriter {
    private var audioFile: AVAudioFile?

    public init(outputURL: URL, sampleRate: Double, channels: UInt32) throws {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ]

        audioFile = try AVAudioFile(
            forWriting: outputURL,
            settings: settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: true
        )
    }

    public func appendAudioSample(_ sampleBuffer: CMSampleBuffer) {
        guard let audioFile = audioFile,
              let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer),
              let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }

        let length = CMBlockBufferGetDataLength(blockBuffer)
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)!.pointee

        guard let pcmFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: asbd.mSampleRate,
            channels: AVAudioChannelCount(asbd.mChannelsPerFrame),
            interleaved: true
        ) else { return }

        let frameCount = UInt32(length) / UInt32(asbd.mBytesPerFrame)
        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: pcmFormat, frameCapacity: frameCount) else { return }
        pcmBuffer.frameLength = frameCount

        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &dataPointer)
        if let src = dataPointer, let dst = pcmBuffer.floatChannelData?[0] {
            memcpy(dst, src, length)
        }

        try? audioFile.write(from: pcmBuffer)
    }

    public func finish() {
        audioFile = nil
    }
}
```

**Step 3: Create RecordingPipeline**

Write `CaptureKitEngine/Sources/CaptureKitEngine/recording/recording-pipeline.swift`:

```swift
import Foundation
import CoreMedia

public struct RecordingConfig: Codable {
    public let displayId: UInt32
    public let fps: Int
    public let captureSystemAudio: Bool
    public let outputDir: String
    public let micId: String?
}

public struct RecordingResult: Codable {
    public let screenPath: String
    public let systemAudioPath: String?
    public let micPath: String?
    public let durationMs: UInt64
    public let frameCount: UInt64
}

public final class RecordingPipeline {
    private let screenCapture = ScreenCapture()
    private var videoWriter: VideoWriter?
    private var systemAudioWriter: AudioFileWriter?
    private var micCapture: MicCapture?
    private var micWriter: MicWriter?
    private var frameCount: UInt64 = 0
    private var startTime: UInt64 = 0
    private var isRecording = false
    private let config: RecordingConfig
    private let outputDir: URL

    public init(config: RecordingConfig) {
        self.config = config
        self.outputDir = URL(fileURLWithPath: config.outputDir)
    }

    public func start() async throws {
        try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

        let displays = try await ScreenCapture.listDisplays()
        guard let display = displays.first(where: { $0.id == config.displayId }) else {
            throw CaptureError.displayNotFound
        }

        let width = display.width * 2
        let height = display.height * 2

        videoWriter = try VideoWriter(
            outputURL: outputDir.appendingPathComponent("screen.mov"),
            width: width, height: height, fps: config.fps
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
            try mic.start { buffer, _ in
                writer.write(buffer: buffer)
            }
            micCapture = mic
            micWriter = writer
        }

        frameCount = 0
        startTime = mach_absolute_time()
        isRecording = true

        try await screenCapture.startCapture(
            displayID: config.displayId,
            fps: config.fps,
            captureAudio: config.captureSystemAudio,
            onVideoFrame: { [weak self] sampleBuffer in
                guard let self = self, self.isRecording else { return }
                self.videoWriter?.appendVideoSample(sampleBuffer)
                self.frameCount += 1
            },
            onAudioSample: { [weak self] sampleBuffer in
                guard let self = self, self.isRecording else { return }
                self.systemAudioWriter?.appendAudioSample(sampleBuffer)
            }
        )
    }

    public func stop() async throws -> RecordingResult {
        isRecording = false
        try await screenCapture.stopCapture()
        await videoWriter?.finish()
        systemAudioWriter?.finish()
        micCapture?.stop()
        micWriter?.finish()

        var timebaseInfo = mach_timebase_info_data_t()
        mach_timebase_info(&timebaseInfo)
        let elapsed = mach_absolute_time() - startTime
        let durationMs = elapsed * UInt64(timebaseInfo.numer) / UInt64(timebaseInfo.denom) / 1_000_000

        return RecordingResult(
            screenPath: "screen.mov",
            systemAudioPath: config.captureSystemAudio ? "system_audio.wav" : nil,
            micPath: micCapture != nil ? "mic.wav" : nil,
            durationMs: durationMs,
            frameCount: frameCount
        )
    }
}
```

**Step 4: Verify Swift builds**

```bash
cd /Users/ofekseroussi/Dev/reko/CaptureKitEngine
swift build -c release
```

**Step 5: Commit**

```bash
git add CaptureKitEngine/
git commit -m "feat: recording pipeline with screen, system audio, and video writer"
```

---

### Task 11: Swift — Mic Capture + Writer

**Files:**
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/capture/mic-capture.swift`
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/recording/mic-writer.swift`

**Step 1: Create MicCapture**

Write `CaptureKitEngine/Sources/CaptureKitEngine/capture/mic-capture.swift`:

```swift
import Foundation
import AVFoundation

public struct AudioInputInfo: Codable {
    public let id: String
    public let name: String
}

public final class MicCapture {
    private let engine = AVAudioEngine()
    private var onAudioBuffer: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?

    public static func listInputs() -> [AudioInputInfo] {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone],
            mediaType: .audio,
            position: .unspecified
        ).devices
        return devices.map { AudioInputInfo(id: $0.uniqueID, name: $0.localizedName) }
    }

    public func inputFormat() -> AVAudioFormat {
        return engine.inputNode.outputFormat(forBus: 0)
    }

    public func start(onAudioBuffer: @escaping (AVAudioPCMBuffer, AVAudioTime) -> Void) throws {
        self.onAudioBuffer = onAudioBuffer
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, time in
            self?.onAudioBuffer?(buffer, time)
        }
        engine.prepare()
        try engine.start()
    }

    public func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}
```

**Step 2: Create MicWriter**

Write `CaptureKitEngine/Sources/CaptureKitEngine/recording/mic-writer.swift`:

```swift
import Foundation
import AVFoundation

public final class MicWriter {
    private var audioFile: AVAudioFile?

    public init(outputURL: URL, format: AVAudioFormat) throws {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }
        audioFile = try AVAudioFile(
            forWriting: outputURL,
            settings: format.settings,
            commonFormat: format.commonFormat,
            interleaved: format.isInterleaved
        )
    }

    public func write(buffer: AVAudioPCMBuffer) {
        try? audioFile?.write(from: buffer)
    }

    public func finish() {
        audioFile = nil
    }
}
```

**Step 3: Verify Swift builds**

```bash
cd /Users/ofekseroussi/Dev/reko/CaptureKitEngine
swift build -c release
```

**Step 4: Commit**

```bash
git add CaptureKitEngine/
git commit -m "feat: microphone capture and WAV writer"
```

---

### Task 12: Swift C API — Full Recording Lifecycle

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/include/CaptureKitEngine.h`
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`

**Step 1: Extend the C header**

Replace `CaptureKitEngine/Sources/CaptureKitEngine/include/CaptureKitEngine.h`:

```c
#ifndef CAPTUREKIT_ENGINE_H
#define CAPTUREKIT_ENGINE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef int32_t CKResult;
#define CK_OK 0
#define CK_ERROR -1

// Version
const char* ck_get_version(void);

// Source discovery
CKResult ck_list_displays(const char **out_json);
CKResult ck_list_audio_inputs(const char **out_json);

// Recording
CKResult ck_start_recording(const char *config_json, uint64_t *out_session_id);
CKResult ck_stop_recording(uint64_t session_id, const char **out_result_json);

// Memory
void ck_free_string(char *str);

#ifdef __cplusplus
}
#endif

#endif
```

**Step 2: Implement full C API**

Replace `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`:

```swift
import Foundation
import ScreenCaptureKit

private var activeSessions: [UInt64: RecordingPipeline] = [:]
private var nextSessionId: UInt64 = 1
private let sessionsLock = NSLock()

@_cdecl("ck_get_version")
public func ck_get_version() -> UnsafePointer<CChar>? {
    return strdup(CaptureKitEngine.version)
}

@_cdecl("ck_free_string")
public func ck_free_string(ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

@_cdecl("ck_list_displays")
public func ck_list_displays(outJson: UnsafeMutablePointer<UnsafePointer<CChar>?>) -> Int32 {
    let semaphore = DispatchSemaphore(value: 0)
    var resultJson = "[]"
    var errorCode: Int32 = 0

    Task {
        do {
            let displays = try await ScreenCapture.listDisplays()
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            resultJson = String(data: try encoder.encode(displays), encoding: .utf8) ?? "[]"
        } catch {
            errorCode = -1
        }
        semaphore.signal()
    }

    semaphore.wait()
    outJson.pointee = UnsafePointer(strdup(resultJson))
    return errorCode
}

@_cdecl("ck_list_audio_inputs")
public func ck_list_audio_inputs(outJson: UnsafeMutablePointer<UnsafePointer<CChar>?>) -> Int32 {
    let inputs = MicCapture.listInputs()
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    guard let data = try? encoder.encode(inputs),
          let json = String(data: data, encoding: .utf8) else {
        outJson.pointee = UnsafePointer(strdup("[]"))
        return -1
    }
    outJson.pointee = UnsafePointer(strdup(json))
    return 0
}

@_cdecl("ck_start_recording")
public func ck_start_recording(
    configJson: UnsafePointer<CChar>,
    outSessionId: UnsafeMutablePointer<UInt64>
) -> Int32 {
    let json = String(cString: configJson)
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase

    guard let data = json.data(using: .utf8),
          let config = try? decoder.decode(RecordingConfig.self, from: data) else {
        return -1
    }

    let pipeline = RecordingPipeline(config: config)

    sessionsLock.lock()
    let sessionId = nextSessionId
    nextSessionId += 1
    activeSessions[sessionId] = pipeline
    sessionsLock.unlock()

    outSessionId.pointee = sessionId

    let semaphore = DispatchSemaphore(value: 0)
    var errorCode: Int32 = 0

    Task {
        do {
            try await pipeline.start()
        } catch {
            errorCode = -1
            print("Recording start error: \(error)")
        }
        semaphore.signal()
    }

    semaphore.wait()
    return errorCode
}

@_cdecl("ck_stop_recording")
public func ck_stop_recording(
    sessionId: UInt64,
    outResultJson: UnsafeMutablePointer<UnsafePointer<CChar>?>
) -> Int32 {
    sessionsLock.lock()
    guard let pipeline = activeSessions.removeValue(forKey: sessionId) else {
        sessionsLock.unlock()
        return -1
    }
    sessionsLock.unlock()

    let semaphore = DispatchSemaphore(value: 0)
    var resultJson = "{}"
    var errorCode: Int32 = 0

    Task {
        do {
            let result = try await pipeline.stop()
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            resultJson = String(data: try encoder.encode(result), encoding: .utf8) ?? "{}"
        } catch {
            errorCode = -1
        }
        semaphore.signal()
    }

    semaphore.wait()
    outResultJson.pointee = UnsafePointer(strdup(resultJson))
    return errorCode
}
```

**Step 3: Verify Swift builds**

```bash
cd /Users/ofekseroussi/Dev/reko/CaptureKitEngine
swift build -c release
```

**Step 4: Commit**

```bash
git add CaptureKitEngine/
git commit -m "feat: C API for full recording lifecycle"
```

---

### Task 13: Rust — Recording Commands + Project Management

**Files:**
- Modify: `capturekit/src-tauri/Cargo.toml`
- Modify: `capturekit/src-tauri/src/swift_ffi.rs`
- Create: `capturekit/src-tauri/src/project.rs`
- Create: `capturekit/src-tauri/src/commands/recording.rs`
- Modify: `capturekit/src-tauri/src/commands/mod.rs`
- Modify: `capturekit/src-tauri/src/lib.rs`

**Step 1: Add dependencies**

Add to `capturekit/src-tauri/Cargo.toml` `[dependencies]`:

```toml
uuid = { version = "1", features = ["v4"] }
chrono = "0.4"
dirs = "5"
```

**Step 2: Extend FFI with recording functions**

Add to `capturekit/src-tauri/src/swift_ffi.rs`:

```rust
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

extern "C" {
    fn ck_get_version() -> *const c_char;
    fn ck_list_displays(out_json: *mut *const c_char) -> i32;
    fn ck_list_audio_inputs(out_json: *mut *const c_char) -> i32;
    fn ck_start_recording(config_json: *const c_char, out_session_id: *mut u64) -> i32;
    fn ck_stop_recording(session_id: u64, out_result_json: *mut *const c_char) -> i32;
    fn ck_free_string(ptr: *mut c_char);
}

unsafe fn read_json(out_ptr: *mut *const c_char, call: impl FnOnce(*mut *const c_char) -> i32) -> Result<String, String> {
    let mut json_ptr: *const c_char = std::ptr::null();
    let result = call(&mut json_ptr);
    if result != 0 || json_ptr.is_null() {
        return Err("Swift call failed".into());
    }
    let json = CStr::from_ptr(json_ptr).to_string_lossy().into_owned();
    ck_free_string(json_ptr as *mut c_char);
    Ok(json)
}

pub struct CaptureKitEngine;

impl CaptureKitEngine {
    pub fn version() -> String {
        unsafe {
            let ptr = ck_get_version();
            if ptr.is_null() { return "unknown".to_string(); }
            let v = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            ck_free_string(ptr as *mut c_char);
            v
        }
    }

    pub fn list_displays() -> Result<String, String> {
        unsafe { read_json(std::ptr::null_mut(), |p| ck_list_displays(p)) }
    }

    pub fn list_audio_inputs() -> Result<String, String> {
        unsafe { read_json(std::ptr::null_mut(), |p| ck_list_audio_inputs(p)) }
    }

    pub fn start_recording(config_json: &str) -> Result<u64, String> {
        let c = CString::new(config_json).map_err(|e| e.to_string())?;
        let mut session_id: u64 = 0;
        unsafe {
            let result = ck_start_recording(c.as_ptr(), &mut session_id);
            if result != 0 { return Err("Failed to start recording".into()); }
        }
        Ok(session_id)
    }

    pub fn stop_recording(session_id: u64) -> Result<String, String> {
        unsafe { read_json(std::ptr::null_mut(), |p| ck_stop_recording(session_id, p)) }
    }
}
```

**Step 3: Create project module**

Write `capturekit/src-tauri/src/project.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectState {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub tracks: Tracks,
    pub timeline: Timeline,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tracks {
    pub screen: String,
    pub mic: Option<String>,
    pub system_audio: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Timeline {
    pub duration_ms: u64,
    pub in_point: u64,
    pub out_point: u64,
}

pub fn projects_dir() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.capturekit.app")
        .join("projects");
    fs::create_dir_all(&dir).ok();
    dir
}

pub fn project_dir(id: &str) -> PathBuf {
    projects_dir().join(id)
}

pub fn raw_dir(id: &str) -> PathBuf {
    project_dir(id).join("raw")
}

pub fn save_project(project: &ProjectState) -> Result<(), String> {
    let dir = project_dir(&project.id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(project).map_err(|e| e.to_string())?;
    fs::write(dir.join("project.json"), json).map_err(|e| e.to_string())?;
    Ok(())
}
```

**Step 4: Create recording command handler**

Write `capturekit/src-tauri/src/commands/recording.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

use crate::project::{self, ProjectState, Tracks, Timeline};
use crate::swift_ffi::CaptureKitEngine;

pub struct RecordingState {
    pub active_session_id: Mutex<Option<u64>>,
    pub active_project_id: Mutex<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingConfig {
    pub display_id: u32,
    pub mic_id: Option<String>,
    pub capture_system_audio: bool,
    pub fps: u32,
}

#[derive(Debug, Deserialize)]
struct SwiftRecordingResult {
    screen_path: String,
    system_audio_path: Option<String>,
    mic_path: Option<String>,
    duration_ms: u64,
    frame_count: u64,
}

#[tauri::command]
pub async fn start_recording(
    config: RecordingConfig,
    state: State<'_, RecordingState>,
) -> Result<String, String> {
    let project_id = uuid::Uuid::new_v4().to_string();
    let raw = project::raw_dir(&project_id);
    std::fs::create_dir_all(&raw).map_err(|e| e.to_string())?;

    let swift_config = serde_json::json!({
        "display_id": config.display_id,
        "fps": config.fps,
        "capture_system_audio": config.capture_system_audio,
        "output_dir": raw.to_string_lossy(),
        "mic_id": config.mic_id,
    });

    let session_id = CaptureKitEngine::start_recording(&swift_config.to_string())?;

    *state.active_session_id.lock().unwrap() = Some(session_id);
    *state.active_project_id.lock().unwrap() = Some(project_id.clone());

    Ok(project_id)
}

#[tauri::command]
pub async fn stop_recording(
    state: State<'_, RecordingState>,
) -> Result<ProjectState, String> {
    let session_id = state.active_session_id.lock().unwrap().take()
        .ok_or("No active recording")?;
    let project_id = state.active_project_id.lock().unwrap().take()
        .ok_or("No active project")?;

    let result_json = CaptureKitEngine::stop_recording(session_id)?;
    let result: SwiftRecordingResult = serde_json::from_str(&result_json)
        .map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap()
        .as_millis() as u64;

    let project = ProjectState {
        id: project_id,
        name: format!("Recording {}", chrono::Local::now().format("%Y-%m-%d %H:%M")),
        created_at: now,
        tracks: Tracks {
            screen: result.screen_path,
            mic: result.mic_path,
            system_audio: result.system_audio_path,
        },
        timeline: Timeline {
            duration_ms: result.duration_ms,
            in_point: 0,
            out_point: result.duration_ms,
        },
    };

    project::save_project(&project)?;
    Ok(project)
}
```

**Step 5: Update commands/mod.rs**

```rust
pub mod sources;
pub mod recording;
```

**Step 6: Update lib.rs**

```rust
mod commands;
mod project;
mod swift_ffi;

use commands::recording::RecordingState;
use std::sync::Mutex;
use swift_ffi::CaptureKitEngine;

#[tauri::command]
fn get_engine_version() -> String {
    CaptureKitEngine::version()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RecordingState {
            active_session_id: Mutex::new(None),
            active_project_id: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_version,
            commands::sources::list_displays,
            commands::sources::list_audio_inputs,
            commands::recording::start_recording,
            commands::recording::stop_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Also add `list_audio_inputs` to `commands/sources.rs`:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct AudioInputInfo {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub async fn list_audio_inputs() -> Result<Vec<AudioInputInfo>, String> {
    let json = CaptureKitEngine::list_audio_inputs()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}
```

**Step 7: Verify it compiles**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
cargo build --manifest-path src-tauri/Cargo.toml
```

**Step 8: Commit**

```bash
git add capturekit/src-tauri/
git commit -m "feat: Rust recording commands with project creation"
```

---

### Task 14: Frontend — Full Recording UI with shadcn/ui

**Files:**
- Create: `capturekit/src/components/recording/record-button.tsx`
- Create: `capturekit/src/components/recording/recording-timer.tsx`
- Modify: `capturekit/src/components/recording/source-picker.tsx`
- Modify: `capturekit/src/App.tsx`

**Step 1: Add shadcn Button component**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npx shadcn@latest add button card badge separator
```

**Step 2: Create RecordButton**

Write `capturekit/src/components/recording/record-button.tsx`:

```tsx
import { Button } from "@/components/ui/button"
import { Circle, Square } from "lucide-react"

interface Props {
  isRecording: boolean
  onStart: () => void
  onStop: () => void
  disabled: boolean
}

export function RecordButton({ isRecording, onStart, onStop, disabled }: Props) {
  return (
    <Button
      variant={isRecording ? "destructive" : "default"}
      size="lg"
      onClick={isRecording ? onStop : onStart}
      disabled={disabled}
      className="gap-2"
    >
      {isRecording ? (
        <>
          <Square className="h-4 w-4" />
          Stop Recording
        </>
      ) : (
        <>
          <Circle className="h-4 w-4 fill-current" />
          Start Recording
        </>
      )}
    </Button>
  )
}
```

**Step 3: Create RecordingTimer**

Write `capturekit/src/components/recording/recording-timer.tsx`:

```tsx
import { useState, useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"

interface Props {
  isRecording: boolean
}

export function RecordingTimer({ isRecording }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    if (isRecording) {
      startRef.current = Date.now()
      const tick = () => {
        setElapsed(Date.now() - startRef.current)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(rafRef.current)
      setElapsed(0)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [isRecording])

  if (!isRecording) return null

  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const display = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`

  return (
    <Badge variant="destructive" className="gap-2 text-lg px-4 py-2 tabular-nums">
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      {display}
    </Badge>
  )
}
```

**Step 4: Add mic picker to SourcePicker**

Update `capturekit/src/components/recording/source-picker.tsx` to also list audio inputs:

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import type { DisplayInfo, AudioInputInfo } from "@/types"

interface Props {
  onDisplaySelected: (displayId: number) => void
  selectedDisplayId: number | null
  onMicSelected: (micId: string | null) => void
  selectedMicId: string | null
}

export function SourcePicker({
  onDisplaySelected,
  selectedDisplayId,
  onMicSelected,
  selectedMicId,
}: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [mics, setMics] = useState<AudioInputInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    invoke<DisplayInfo[]>("list_displays")
      .then((result) => {
        setDisplays(result)
        if (!selectedDisplayId) {
          const main = result.find((d) => d.is_main)
          if (main) onDisplaySelected(main.id)
        }
      })
      .catch((e) => setError(String(e)))

    invoke<AudioInputInfo[]>("list_audio_inputs")
      .then((result) => {
        setMics(result)
        if (!selectedMicId && result.length > 0) {
          onMicSelected(result[0].id)
        }
      })
      .catch(() => {})
  }, [])

  if (error) {
    return <p className="text-sm text-destructive">Error: {error}</p>
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Display</Label>
        <Select
          value={selectedDisplayId?.toString() ?? ""}
          onValueChange={(val) => onDisplaySelected(Number(val))}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select a display" />
          </SelectTrigger>
          <SelectContent>
            {displays.map((d) => (
              <SelectItem key={d.id} value={d.id.toString()}>
                Display {d.id} ({d.width}x{d.height})
                {d.is_main ? " — Main" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Microphone</Label>
        <Select
          value={selectedMicId ?? "none"}
          onValueChange={(val) => onMicSelected(val === "none" ? null : val)}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select a microphone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No microphone</SelectItem>
            {mics.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
```

**Step 5: Update App.tsx with full recording flow**

Replace `capturekit/src/App.tsx`:

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SourcePicker } from "@/components/recording/source-picker"
import { RecordButton } from "@/components/recording/record-button"
import { RecordingTimer } from "@/components/recording/recording-timer"
import type { ProjectState } from "@/types"

function App() {
  const [engineVersion, setEngineVersion] = useState("")
  const [selectedDisplay, setSelectedDisplay] = useState<number | null>(null)
  const [selectedMic, setSelectedMic] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [lastProject, setLastProject] = useState<ProjectState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    invoke<string>("get_engine_version").then(setEngineVersion)
  }, [])

  const handleStart = async () => {
    if (!selectedDisplay) return
    setIsLoading(true)
    setError(null)
    try {
      await invoke("start_recording", {
        config: {
          display_id: selectedDisplay,
          mic_id: selectedMic,
          capture_system_audio: true,
          fps: 60,
        },
      })
      setIsRecording(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleStop = async () => {
    setIsLoading(true)
    try {
      const project = await invoke<ProjectState>("stop_recording")
      setIsRecording(false)
      setLastProject(project)
    } catch (e) {
      setError(String(e))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">CaptureKit</h1>
        <p className="text-sm text-muted-foreground">Engine v{engineVersion}</p>
      </div>

      {error && (
        <Card className="mb-4 border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <SourcePicker
            onDisplaySelected={setSelectedDisplay}
            selectedDisplayId={selectedDisplay}
            onMicSelected={setSelectedMic}
            selectedMicId={selectedMic}
          />

          <Separator />

          <div className="flex items-center gap-4">
            <RecordButton
              isRecording={isRecording}
              onStart={handleStart}
              onStop={handleStop}
              disabled={!selectedDisplay || isLoading}
            />
            <RecordingTimer isRecording={isRecording} />
          </div>
        </CardContent>
      </Card>

      {lastProject && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Last Recording</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Name:</span> {lastProject.name}</p>
            <p><span className="text-muted-foreground">Duration:</span> {(lastProject.timeline.duration_ms / 1000).toFixed(1)}s</p>
            <p><span className="text-muted-foreground">Screen:</span> {lastProject.tracks.screen}</p>
            {lastProject.tracks.mic && (
              <p><span className="text-muted-foreground">Mic:</span> {lastProject.tracks.mic}</p>
            )}
            {lastProject.tracks.system_audio && (
              <p><span className="text-muted-foreground">System Audio:</span> {lastProject.tracks.system_audio}</p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}

export default App
```

**Step 6: Run and test the full recording flow**

```bash
cd /Users/ofekseroussi/Dev/reko/capturekit
npx tauri dev
```

Expected:
1. shadcn-styled UI with display and mic dropdowns
2. Click "Start Recording" — may prompt for permissions
3. Red recording badge with timer counts up
4. Click "Stop Recording" — card shows recording info
5. Check `~/Library/Application Support/com.capturekit.app/projects/` for files

**Step 7: Commit**

```bash
git add capturekit/src/
git commit -m "feat: full recording UI with shadcn/ui components"
```

---

**Phase 1 Complete.** Working deliverables:
- Screen capture via ScreenCaptureKit (60fps, Retina, H.264)
- Microphone capture via AVAudioEngine (48kHz PCM WAV)
- System audio capture via ScreenCaptureKit
- Project created on stop with `project.json` metadata
- shadcn/ui frontend with display picker, mic picker, record/stop, timer

---

## Verification Checklist

- [ ] `npx tauri dev` launches without errors
- [ ] Display dropdown lists connected displays (shadcn Select)
- [ ] Mic dropdown lists available microphones (shadcn Select)
- [ ] "Start Recording" begins capture (permissions prompted first time)
- [ ] Recording timer counts up with red badge
- [ ] "Stop Recording" stops capture, shows project info card
- [ ] `screen.mov` is playable in QuickTime
- [ ] `mic.wav` is playable with recorded voice
- [ ] `system_audio.wav` captures desktop audio
- [ ] `project.json` has correct metadata
- [ ] CPU usage during recording < 10% (Activity Monitor)
