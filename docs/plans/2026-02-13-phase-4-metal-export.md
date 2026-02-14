# Phase 4: Metal Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current file-copy `quick_export` with a full composited export pipeline that renders backgrounds, rounded frames, shadows, and camera bubbles via Metal, mixes audio tracks, trims to in/out points, and writes a polished .mp4 to disk with progress reporting.

**Architecture:** A new `ExportPipeline` in Swift reads the raw .mov/.wav files via `AVAssetReader`, composites each frame on the GPU via a Metal render pipeline (matching the CSS preview), mixes audio, and encodes via `AVAssetWriter` (non-realtime H.264). Three new `@_cdecl` functions (`ck_start_export`, `ck_get_export_progress`, `ck_cancel_export`) expose this to Rust. The frontend polls progress on a 200ms timer and shows a progress bar. The pipeline is cancellable.

**Tech Stack:** Metal (GPU compositing), AVAssetReader/Writer (decode/encode), VideoToolbox (hardware H.264), CVMetalTextureCache (zero-copy pixel buffer ↔ texture bridge)

---

## Export Data Flow

```
Frontend saves ProjectState → calls start_export(projectId, exportConfig)
  → Rust reads project.json, sends JSON to Swift via ck_start_export
  → Swift spawns ExportPipeline on background DispatchQueue:
      1. AVAssetReader opens screen.mov (+ camera.mov if present)
      2. Seek to in_point, compute total frames to out_point
      3. For each frame:
         a. Decode screen CVPixelBuffer → wrap as MTLTexture (zero-copy via CVMetalTextureCache)
         b. Decode camera CVPixelBuffer → wrap as MTLTexture (if camera track exists)
         c. Metal render pass → composite to output MTLTexture:
            - Layer 1: Background (gradient or solid)
            - Layer 2: Shadow (if enabled, SDF-based soft shadow)
            - Layer 3: Screen content (padded, rounded corners via SDF)
            - Layer 4: Camera bubble (circle/rounded clip, border)
         d. Output MTLTexture backs a CVPixelBuffer (zero-copy) → append to AVAssetWriter
         e. Update progress counter
      4. Read + mix mic.wav + system_audio.wav → trim → encode AAC → append to AVAssetWriter
      5. Finalize writer → return output path
  → Frontend polls ck_get_export_progress every 200ms → updates progress bar
  → On complete, shows success with output path
```

No pixel data crosses the C API boundary. Swift reads files, composites on GPU, writes output. Rust passes JSON config and receives JSON progress.

---

## Layout Math (Reference — matches CSS preview)

The CSS preview (`preview-canvas.tsx`) defines the visual spec. The Metal compositor must replicate it exactly:

```
Canvas: W × H (output resolution, 16:9)
Padding: p% of canvas width, applied to all 4 sides

padPx = p / 100.0 × W
contentRect = (padPx, padPx, W − 2×padPx, H − 2×padPx)

Screen video scaled to fit within contentRect (object-fit: contain):
  screenAspect = screenWidth / screenHeight
  contentAspect = contentRect.w / contentRect.h
  if screenAspect > contentAspect:
    fitW = contentRect.w
    fitH = fitW / screenAspect
  else:
    fitH = contentRect.h
    fitW = fitH × screenAspect
  screenRect.x = contentRect.x + (contentRect.w − fitW) / 2
  screenRect.y = contentRect.y + (contentRect.h − fitH) / 2
  screenRect.size = (fitW, fitH)

Shadow: 3 layers offset downward (matching CSS box-shadow):
  Layer 1: y=+4px,  blur≈6px,  opacity=intensity×0.10
  Layer 2: y=+12px, blur≈24px, opacity=intensity×0.15
  Layer 3: y=+24px, blur≈48px, opacity=intensity×0.20

Camera bubble:
  camSize = cameraBubble.size / 100.0 × W
  camOffset = 0.04 × W  (matches CSS 4% inset)
  Position:
    bottom-right: (W − camOffset − camSize, H − camOffset − camSize)
    bottom-left:  (camOffset, H − camOffset − camSize)
    top-right:    (W − camOffset − camSize, camOffset)
    top-left:     (camOffset, camOffset)

Gradient direction (matching CSS linear-gradient angles):
  CSS 0deg = bottom→top, angles increase clockwise
  UV direction = (sin(angle), −cos(angle))  where angle is in radians
  t = dot(uv − 0.5, direction) + 0.5
```

---

## Task 1: Export Data Model

**Files:**
- Modify: `src-tauri/src/project.rs` — add `ExportConfig`, `ExportProgress`, `ExportResult`
- Modify: `src/types/editor.ts` — add TypeScript equivalents
- Test: existing test module in `project.rs`

### Step 1: Write failing tests for new types

Add to `src-tauri/src/project.rs` tests module:

```rust
#[test]
fn test_export_config_serialization() {
    let config = ExportConfig {
        resolution: "1080p".to_string(),
        output_path: "/Users/test/Desktop/output.mp4".to_string(),
    };
    let json = serde_json::to_string(&config).unwrap();
    assert!(json.contains("resolution"));
    assert!(json.contains("outputPath"));
    let parsed: ExportConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.resolution, "1080p");
}

#[test]
fn test_export_progress_serialization() {
    let progress = ExportProgress {
        frames_rendered: 500,
        total_frames: 1000,
        percentage: 50.0,
        elapsed_ms: 5000,
        estimated_remaining_ms: Some(5000),
        phase: "compositing".to_string(),
    };
    let json = serde_json::to_string(&progress).unwrap();
    assert!(json.contains("framesRendered"));
    assert!(json.contains("estimatedRemainingMs"));
    let parsed: ExportProgress = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.percentage, 50.0);
}
```

### Step 2: Run tests to verify they fail

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL — `ExportConfig`, `ExportProgress` not found.

### Step 3: Implement the Rust types

Add to `src-tauri/src/project.rs` (after `FrameConfig`):

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    pub resolution: String,        // "original" | "1080p" | "720p"
    pub output_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub frames_rendered: u64,
    pub total_frames: u64,
    pub percentage: f64,
    pub elapsed_ms: u64,
    pub estimated_remaining_ms: Option<u64>,
    pub phase: String,             // "compositing" | "finalizing" | "done" | "cancelled" | "error"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output_path: String,
    pub duration_ms: u64,
    pub file_size_bytes: u64,
}
```

### Step 4: Run tests to verify they pass

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS

### Step 5: Add TypeScript types

Add to `src/types/editor.ts`:

```typescript
export interface ExportConfig {
  resolution: "original" | "1080p" | "720p"
  outputPath: string
}

export interface ExportProgress {
  framesRendered: number
  totalFrames: number
  percentage: number
  elapsedMs: number
  estimatedRemainingMs: number | null
  phase: "compositing" | "finalizing" | "done" | "cancelled" | "error"
}

export interface ExportResult {
  outputPath: string
  durationMs: number
  fileSizeBytes: number
}
```

### Step 6: Commit

```bash
git add src-tauri/src/project.rs src/types/editor.ts
git commit -m "feat(export): add ExportConfig, ExportProgress, ExportResult types"
```

---

## Task 2: Metal Compositor — Device, Shaders, Rendering

This is the core GPU compositing engine. It takes input textures + effects config and renders a composite frame.

**Files:**
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/export/metal-compositor.swift`
- Test: `CaptureKitEngine/Tests/CaptureKitEngineTests/LayoutMathTests.swift`

### Step 1: Write layout math tests

Create `CaptureKitEngine/Tests/CaptureKitEngineTests/LayoutMathTests.swift`:

```swift
import XCTest
@testable import CaptureKitEngine

final class LayoutMathTests: XCTestCase {

    func testScreenRectWithNoPadding() {
        // 1920x1080 canvas, 0% padding, 16:9 screen → screen fills canvas
        let rect = LayoutMath.screenRect(
            canvasWidth: 1920, canvasHeight: 1080,
            screenWidth: 1920, screenHeight: 1080,
            paddingPercent: 0
        )
        XCTAssertEqual(rect.origin.x, 0, accuracy: 0.1)
        XCTAssertEqual(rect.origin.y, 0, accuracy: 0.1)
        XCTAssertEqual(rect.size.width, 1920, accuracy: 0.1)
        XCTAssertEqual(rect.size.height, 1080, accuracy: 0.1)
    }

    func testScreenRectWith8PercentPadding() {
        // 1920x1080 canvas, 8% padding (8% of width = 153.6px each side)
        // Content area: (153.6, 153.6, 1612.8, 772.8)
        // Screen 1920x1080 (16:9) fitting in 1612.8x772.8 content area:
        //   contentAspect = 1612.8/772.8 ≈ 2.087 > screenAspect 1.778
        //   → fit to height: fitH=772.8, fitW=772.8*1.778=1374.1
        //   screenX = 153.6 + (1612.8-1374.1)/2 = 153.6 + 119.35 = 272.95
        let rect = LayoutMath.screenRect(
            canvasWidth: 1920, canvasHeight: 1080,
            screenWidth: 1920, screenHeight: 1080,
            paddingPercent: 8
        )
        XCTAssertEqual(rect.origin.x, 273.0, accuracy: 1.0)
        XCTAssertEqual(rect.origin.y, 153.6, accuracy: 0.1)
        XCTAssertEqual(rect.size.height, 772.8, accuracy: 0.1)
    }

    func testCameraPositionBottomRight() {
        // 1920x1080 canvas, 15% size, 4% offset
        // camSize = 0.15 * 1920 = 288
        // camOffset = 0.04 * 1920 = 76.8
        // x = 1920 - 76.8 - 288 = 1555.2
        // y = 1080 - 76.8 - 288 = 715.2
        let pos = LayoutMath.cameraOrigin(
            canvasWidth: 1920, canvasHeight: 1080,
            sizePercent: 15, position: "bottom-right"
        )
        XCTAssertEqual(pos.x, 1555.2, accuracy: 0.1)
        XCTAssertEqual(pos.y, 715.2, accuracy: 0.1)
    }

    func testCameraPositionTopLeft() {
        let pos = LayoutMath.cameraOrigin(
            canvasWidth: 1920, canvasHeight: 1080,
            sizePercent: 15, position: "top-left"
        )
        XCTAssertEqual(pos.x, 76.8, accuracy: 0.1)
        XCTAssertEqual(pos.y, 76.8, accuracy: 0.1)
    }

    func testOutputResolution() {
        // "original" with 2880x1800 recording → 2880x1800
        let orig = LayoutMath.outputSize(resolution: "original", recordingWidth: 2880, recordingHeight: 1800)
        XCTAssertEqual(orig.width, 2880)
        XCTAssertEqual(orig.height, 1800)

        // "1080p" → 1920x1080
        let hd = LayoutMath.outputSize(resolution: "1080p", recordingWidth: 2880, recordingHeight: 1800)
        XCTAssertEqual(hd.width, 1920)
        XCTAssertEqual(hd.height, 1080)

        // "720p" → 1280x720
        let sd = LayoutMath.outputSize(resolution: "720p", recordingWidth: 2880, recordingHeight: 1800)
        XCTAssertEqual(sd.width, 1280)
        XCTAssertEqual(sd.height, 720)
    }
}
```

### Step 2: Run tests to verify they fail

```bash
cd CaptureKitEngine && swift test --filter LayoutMathTests
```

Expected: FAIL — `LayoutMath` not found.

### Step 3: Create the Metal compositor with layout math and shaders

Create `CaptureKitEngine/Sources/CaptureKitEngine/export/metal-compositor.swift`:

```swift
import Foundation
import Metal
import CoreVideo
import simd

// MARK: - Layout Math (pure functions, easily testable)

public enum LayoutMath {
    public struct Size { public let width: Int; public let height: Int }

    public static func outputSize(resolution: String, recordingWidth: Int, recordingHeight: Int) -> Size {
        switch resolution {
        case "1080p": return Size(width: 1920, height: 1080)
        case "720p":  return Size(width: 1280, height: 720)
        default:      return Size(width: recordingWidth, height: recordingHeight)
        }
    }

    public static func screenRect(
        canvasWidth: CGFloat, canvasHeight: CGFloat,
        screenWidth: CGFloat, screenHeight: CGFloat,
        paddingPercent: CGFloat
    ) -> CGRect {
        let padPx = paddingPercent / 100.0 * canvasWidth
        let contentX = padPx
        let contentY = padPx
        let contentW = canvasWidth - 2 * padPx
        let contentH = canvasHeight - 2 * padPx

        let screenAspect = screenWidth / screenHeight
        let contentAspect = contentW / contentH

        let fitW: CGFloat, fitH: CGFloat
        if screenAspect > contentAspect {
            fitW = contentW
            fitH = fitW / screenAspect
        } else {
            fitH = contentH
            fitW = fitH * screenAspect
        }

        let x = contentX + (contentW - fitW) / 2
        let y = contentY + (contentH - fitH) / 2
        return CGRect(x: x, y: y, width: fitW, height: fitH)
    }

    public static func cameraOrigin(
        canvasWidth: CGFloat, canvasHeight: CGFloat,
        sizePercent: CGFloat, position: String
    ) -> CGPoint {
        let camSize = sizePercent / 100.0 * canvasWidth
        let camOffset = 0.04 * canvasWidth
        switch position {
        case "bottom-left":  return CGPoint(x: camOffset, y: canvasHeight - camOffset - camSize)
        case "top-right":    return CGPoint(x: canvasWidth - camOffset - camSize, y: camOffset)
        case "top-left":     return CGPoint(x: camOffset, y: camOffset)
        default:             return CGPoint(x: canvasWidth - camOffset - camSize, y: canvasHeight - camOffset - camSize)
        }
    }
}

// MARK: - Shader Source (embedded for SPM static library compatibility)

private let shaderSource = """
#include <metal_stdlib>
using namespace metal;

struct VertexOut {
    float4 position [[position]];
    float2 texCoord;
};

// Fullscreen triangle — 3 vertices, no vertex buffer needed
vertex VertexOut fullscreen_vertex(uint vid [[vertex_id]]) {
    float2 uv = float2((vid << 1) & 2, vid & 2);
    VertexOut out;
    out.position = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
    out.texCoord = uv;
    return out;
}

struct CompositeUniforms {
    float2 canvasSize;          // pixels

    // Background
    float4 bgColorFrom;        // linear RGB
    float4 bgColorTo;
    float bgAngleDeg;
    int bgIsSolid;

    // Screen frame
    float2 screenOrigin;        // pixels (top-left)
    float2 screenSize;          // pixels
    float screenBorderRadius;   // pixels
    int hasShadow;
    float shadowIntensity;      // 0-1

    // Camera
    int hasCameraBubble;
    float2 cameraOrigin;        // pixels (top-left)
    float cameraSize;           // pixels (width = height for square bubble)
    float cameraBorderRadius;   // pixels (camSize/2 for circle, 16 for rounded)
    float cameraBorderWidth;    // pixels
    float4 cameraBorderColor;   // linear RGB
};

// Signed distance function for a rounded rectangle
float roundedRectSDF(float2 p, float2 center, float2 halfSize, float radius) {
    float2 d = abs(p - center) - halfSize + radius;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

fragment float4 composite_fragment(
    VertexOut in [[stage_in]],
    texture2d<float> screenTex [[texture(0)]],
    texture2d<float> cameraTex [[texture(1)]],
    constant CompositeUniforms& u [[buffer(0)]]
) {
    constexpr sampler s(filter::linear, address::clamp_to_edge);
    float2 pixel = in.texCoord * u.canvasSize;

    // --- Layer 1: Background ---
    float4 color;
    if (u.bgIsSolid != 0) {
        color = u.bgColorFrom;
    } else {
        float angleRad = u.bgAngleDeg * M_PI_F / 180.0;
        float2 dir = float2(sin(angleRad), -cos(angleRad));
        float t = saturate(dot(in.texCoord - 0.5, dir) + 0.5);
        color = mix(u.bgColorFrom, u.bgColorTo, t);
    }

    // --- Layer 2: Shadow (SDF-based, 3 layers matching CSS) ---
    float2 screenCenter = u.screenOrigin + u.screenSize * 0.5;
    float2 screenHalf = u.screenSize * 0.5;

    if (u.hasShadow != 0 && u.shadowIntensity > 0.0) {
        // 3 shadow layers with increasing offset and blur
        float shadow = 0.0;
        // Layer 1: y+4, blur 6
        float d1 = roundedRectSDF(pixel, screenCenter + float2(0, 4), screenHalf, u.screenBorderRadius);
        shadow += 0.10 * (1.0 - smoothstep(0.0, 6.0, max(d1, 0.0)));
        // Layer 2: y+12, blur 24
        float d2 = roundedRectSDF(pixel, screenCenter + float2(0, 12), screenHalf, u.screenBorderRadius);
        shadow += 0.15 * (1.0 - smoothstep(0.0, 24.0, max(d2, 0.0)));
        // Layer 3: y+24, blur 48
        float d3 = roundedRectSDF(pixel, screenCenter + float2(0, 24), screenHalf, u.screenBorderRadius);
        shadow += 0.20 * (1.0 - smoothstep(0.0, 48.0, max(d3, 0.0)));
        shadow *= u.shadowIntensity;
        color = mix(color, float4(0, 0, 0, 1), shadow);
    }

    // --- Layer 3: Screen content (rounded corners via SDF) ---
    float screenDist = roundedRectSDF(pixel, screenCenter, screenHalf, u.screenBorderRadius);
    float screenMask = 1.0 - smoothstep(-0.5, 0.5, screenDist);
    if (screenMask > 0.001) {
        float2 screenUV = (pixel - u.screenOrigin) / u.screenSize;
        screenUV = clamp(screenUV, 0.0, 1.0);
        float4 screenColor = screenTex.sample(s, screenUV);
        color = mix(color, screenColor, screenMask);
    }

    // --- Layer 4: Camera bubble ---
    if (u.hasCameraBubble != 0) {
        float2 camCenter = u.cameraOrigin + u.cameraSize * 0.5;
        float2 camHalf = float2(u.cameraSize * 0.5);
        float camDist = roundedRectSDF(pixel, camCenter, camHalf, u.cameraBorderRadius);

        // Border
        float borderOuter = 1.0 - smoothstep(-0.5, 0.5, camDist);
        float borderInner = 1.0 - smoothstep(-0.5, 0.5, camDist + u.cameraBorderWidth);
        float borderMask = borderOuter - borderInner;
        if (borderMask > 0.001) {
            color = mix(color, u.cameraBorderColor, borderMask);
        }

        // Camera content (inside border)
        float camMask = borderInner;
        if (camMask > 0.001) {
            float2 camUV = (pixel - u.cameraOrigin) / u.cameraSize;
            camUV = clamp(camUV, 0.0, 1.0);
            float4 camColor = cameraTex.sample(s, camUV);
            // Camera uses object-cover (fill + crop center) — flip vertically if needed
            color = mix(color, camColor, camMask);
        }
    }

    return color;
}
"""

// MARK: - Hex Color Parser

private func parseHexColor(_ hex: String) -> SIMD4<Float> {
    var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if h.hasPrefix("#") { h = String(h.dropFirst()) }
    if h.count == 3 {
        h = h.map { "\($0)\($0)" }.joined()
    }
    guard h.count == 6, let val = UInt64(h, radix: 16) else {
        return SIMD4<Float>(0, 0, 0, 1)
    }
    let r = Float((val >> 16) & 0xFF) / 255.0
    let g = Float((val >> 8) & 0xFF) / 255.0
    let b = Float(val & 0xFF) / 255.0
    return SIMD4<Float>(r, g, b, 1)
}

// MARK: - Uniforms (must match Metal struct layout exactly)

struct CompositeUniforms {
    var canvasSize: SIMD2<Float> = .zero

    var bgColorFrom: SIMD4<Float> = .zero
    var bgColorTo: SIMD4<Float> = .zero
    var bgAngleDeg: Float = 0
    var bgIsSolid: Int32 = 0
    var _pad0: SIMD2<Float> = .zero  // alignment padding

    var screenOrigin: SIMD2<Float> = .zero
    var screenSize: SIMD2<Float> = .zero
    var screenBorderRadius: Float = 0
    var hasShadow: Int32 = 0
    var shadowIntensity: Float = 0
    var _pad1: Float = 0

    var hasCameraBubble: Int32 = 0
    var _pad2: Float = 0
    var cameraOrigin: SIMD2<Float> = .zero
    var cameraSize: Float = 0
    var cameraBorderRadius: Float = 0
    var cameraBorderWidth: Float = 0
    var _pad3: Float = 0
    var cameraBorderColor: SIMD4<Float> = .zero
}

// MARK: - Metal Compositor

public final class MetalCompositor {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let pipelineState: MTLRenderPipelineState
    private let textureCache: CVMetalTextureCache

    // Output pixel buffer pool (created once per export)
    private var outputPool: CVPixelBufferPool?
    private var outputWidth: Int = 0
    private var outputHeight: Int = 0

    public init() throws {
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw ExportError.metalNotAvailable
        }
        guard let queue = device.makeCommandQueue() else {
            throw ExportError.metalNotAvailable
        }
        self.device = device
        self.commandQueue = queue

        // Compile shaders from embedded source
        let library = try device.makeLibrary(source: shaderSource, options: nil)
        guard let vertexFunc = library.makeFunction(name: "fullscreen_vertex"),
              let fragmentFunc = library.makeFunction(name: "composite_fragment") else {
            throw ExportError.shaderCompilationFailed
        }

        let pipelineDesc = MTLRenderPipelineDescriptor()
        pipelineDesc.vertexFunction = vertexFunc
        pipelineDesc.fragmentFunction = fragmentFunc
        pipelineDesc.colorAttachments[0].pixelFormat = .bgra8Unorm
        // Enable alpha blending
        pipelineDesc.colorAttachments[0].isBlendingEnabled = false // single-pass, no blending needed
        self.pipelineState = try device.makeRenderPipelineState(descriptor: pipelineDesc)

        // Create texture cache for zero-copy CVPixelBuffer ↔ MTLTexture
        var cache: CVMetalTextureCache?
        CVMetalTextureCacheCreate(nil, nil, device, nil, &cache)
        guard let textureCache = cache else {
            throw ExportError.metalNotAvailable
        }
        self.textureCache = textureCache
    }

    /// Call once before rendering frames to set up the output pixel buffer pool.
    public func configure(width: Int, height: Int) {
        outputWidth = width
        outputHeight = height

        let poolAttrs: [String: Any] = [
            kCVPixelBufferPoolMinimumBufferCountKey as String: 3,
        ]
        let pixelBufferAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferMetalCompatibilityKey as String: true,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        CVPixelBufferPoolCreate(nil, poolAttrs as CFDictionary, pixelBufferAttrs as CFDictionary, &outputPool)
    }

    /// Render one composite frame. Returns a CVPixelBuffer ready for AVAssetWriter.
    public func renderFrame(
        screenPixelBuffer: CVPixelBuffer,
        cameraPixelBuffer: CVPixelBuffer?,
        effects: ExportEffects,
        screenWidth: Int, screenHeight: Int
    ) throws -> CVPixelBuffer {
        guard let pool = outputPool else { throw ExportError.notConfigured }

        // Get output pixel buffer from pool
        var outputBuffer: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outputBuffer)
        guard let output = outputBuffer else { throw ExportError.pixelBufferAllocationFailed }

        // Create Metal textures from pixel buffers (zero-copy via IOSurface)
        let screenTex = try metalTexture(from: screenPixelBuffer)
        let outputTex = try metalTexture(from: output)

        var cameraTex: MTLTexture?
        if let camBuf = cameraPixelBuffer {
            cameraTex = try metalTexture(from: camBuf)
        }

        // Build uniforms
        let canvasW = Float(outputWidth)
        let canvasH = Float(outputHeight)

        let screenRect = LayoutMath.screenRect(
            canvasWidth: CGFloat(canvasW), canvasHeight: CGFloat(canvasH),
            screenWidth: CGFloat(screenWidth), screenHeight: CGFloat(screenHeight),
            paddingPercent: CGFloat(effects.padding)
        )

        var uniforms = CompositeUniforms()
        uniforms.canvasSize = SIMD2<Float>(canvasW, canvasH)
        uniforms.bgColorFrom = effects.bgColorFrom
        uniforms.bgColorTo = effects.bgColorTo
        uniforms.bgAngleDeg = effects.bgAngleDeg
        uniforms.bgIsSolid = effects.bgIsSolid ? 1 : 0
        uniforms.screenOrigin = SIMD2<Float>(Float(screenRect.origin.x), Float(screenRect.origin.y))
        uniforms.screenSize = SIMD2<Float>(Float(screenRect.width), Float(screenRect.height))
        uniforms.screenBorderRadius = effects.borderRadius
        uniforms.hasShadow = effects.hasShadow ? 1 : 0
        uniforms.shadowIntensity = effects.shadowIntensity

        if let cam = effects.camera {
            uniforms.hasCameraBubble = 1
            let camSizePx = cam.sizePercent / 100.0 * canvasW
            let origin = LayoutMath.cameraOrigin(
                canvasWidth: CGFloat(canvasW), canvasHeight: CGFloat(canvasH),
                sizePercent: CGFloat(cam.sizePercent), position: cam.position
            )
            uniforms.cameraOrigin = SIMD2<Float>(Float(origin.x), Float(origin.y))
            uniforms.cameraSize = camSizePx
            uniforms.cameraBorderRadius = cam.isCircle ? camSizePx / 2.0 : 16.0
            uniforms.cameraBorderWidth = cam.borderWidth
            uniforms.cameraBorderColor = cam.borderColor
        }

        // Render
        guard let cmdBuf = commandQueue.makeCommandBuffer() else {
            throw ExportError.metalRenderFailed
        }

        let renderPassDesc = MTLRenderPassDescriptor()
        renderPassDesc.colorAttachments[0].texture = outputTex
        renderPassDesc.colorAttachments[0].loadAction = .clear
        renderPassDesc.colorAttachments[0].storeAction = .store
        renderPassDesc.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)

        guard let encoder = cmdBuf.makeRenderCommandEncoder(descriptor: renderPassDesc) else {
            throw ExportError.metalRenderFailed
        }

        encoder.setRenderPipelineState(pipelineState)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<CompositeUniforms>.size, index: 0)
        encoder.setFragmentTexture(screenTex, index: 0)

        // Use a 1x1 placeholder if no camera texture
        if let ct = cameraTex {
            encoder.setFragmentTexture(ct, index: 1)
        } else {
            encoder.setFragmentTexture(screenTex, index: 1) // unused, but must be bound
        }

        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
        encoder.endEncoding()
        cmdBuf.commit()
        cmdBuf.waitUntilCompleted()

        return output
    }

    private func metalTexture(from pixelBuffer: CVPixelBuffer) throws -> MTLTexture {
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)

        var cvTexture: CVMetalTexture?
        let status = CVMetalTextureCacheCreateTextureFromImage(
            nil, textureCache, pixelBuffer, nil,
            .bgra8Unorm, width, height, 0, &cvTexture
        )
        guard status == kCVReturnSuccess, let cvTex = cvTexture,
              let texture = CVMetalTextureGetTexture(cvTex) else {
            throw ExportError.textureCreationFailed
        }
        return texture
    }
}

// MARK: - Export Effects (parsed from ProjectState JSON)

public struct ExportEffects {
    public let bgColorFrom: SIMD4<Float>
    public let bgColorTo: SIMD4<Float>
    public let bgAngleDeg: Float
    public let bgIsSolid: Bool
    public let padding: Float
    public let borderRadius: Float
    public let hasShadow: Bool
    public let shadowIntensity: Float
    public let camera: CameraEffects?

    public struct CameraEffects {
        public let sizePercent: Float
        public let position: String
        public let isCircle: Bool
        public let borderWidth: Float
        public let borderColor: SIMD4<Float>
    }

    public init(from json: [String: Any]) {
        let bg = json["background"] as? [String: Any] ?? [:]
        let bgType = bg["type"] as? String ?? "solid"
        bgIsSolid = (bgType == "solid")
        if bgIsSolid {
            let color = parseHexColor(bg["color"] as? String ?? "#000000")
            bgColorFrom = color
            bgColorTo = color
        } else {
            bgColorFrom = parseHexColor(bg["gradientFrom"] as? String ?? "#1a1a2e")
            bgColorTo = parseHexColor(bg["gradientTo"] as? String ?? "#16213e")
        }
        bgAngleDeg = Float(bg["gradientAngle"] as? Double ?? 135.0)
        padding = Float(bg["padding"] as? Double ?? 8.0)

        let frame = json["frame"] as? [String: Any] ?? [:]
        borderRadius = Float(frame["borderRadius"] as? Double ?? 12.0)
        hasShadow = frame["shadow"] as? Bool ?? true
        shadowIntensity = Float(frame["shadowIntensity"] as? Double ?? 0.5)

        let cam = json["cameraBubble"] as? [String: Any] ?? [:]
        let camVisible = cam["visible"] as? Bool ?? false
        if camVisible {
            camera = CameraEffects(
                sizePercent: Float(cam["size"] as? Double ?? 15.0),
                position: cam["position"] as? String ?? "bottom-right",
                isCircle: (cam["shape"] as? String ?? "circle") == "circle",
                borderWidth: Float(cam["borderWidth"] as? Double ?? 3.0),
                borderColor: parseHexColor(cam["borderColor"] as? String ?? "#ffffff")
            )
        } else {
            camera = nil
        }
    }
}

// MARK: - Export Errors

public enum ExportError: Error, CustomStringConvertible {
    case metalNotAvailable
    case shaderCompilationFailed
    case notConfigured
    case pixelBufferAllocationFailed
    case metalRenderFailed
    case textureCreationFailed
    case videoDecoderFailed(String)
    case audioMixingFailed(String)
    case writerFailed(String)
    case cancelled
    case invalidProject(String)

    public var description: String {
        switch self {
        case .metalNotAvailable: return "Metal GPU is not available"
        case .shaderCompilationFailed: return "Failed to compile Metal shaders"
        case .notConfigured: return "Compositor not configured — call configure() first"
        case .pixelBufferAllocationFailed: return "Failed to allocate output pixel buffer"
        case .metalRenderFailed: return "Metal render command failed"
        case .textureCreationFailed: return "Failed to create Metal texture from pixel buffer"
        case .videoDecoderFailed(let s): return "Video decoder failed: \(s)"
        case .audioMixingFailed(let s): return "Audio mixing failed: \(s)"
        case .writerFailed(let s): return "Export writer failed: \(s)"
        case .cancelled: return "Export was cancelled"
        case .invalidProject(let s): return "Invalid project: \(s)"
        }
    }
}
```

### Step 4: Run layout math tests

```bash
cd CaptureKitEngine && swift test --filter LayoutMathTests
```

Expected: PASS

### Step 5: Build Swift framework to verify Metal shader compiles

```bash
cd CaptureKitEngine && swift build -c release
```

Expected: BUILD SUCCEEDED. The shader source is compiled at init-time, but the SPM build verifies the Swift code compiles.

### Step 6: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/export/metal-compositor.swift \
        CaptureKitEngine/Tests/CaptureKitEngineTests/LayoutMathTests.swift
git commit -m "feat(export): Metal compositor with shaders and layout math"
```

---

## Task 3: Video Decoder (AVAssetReader)

Wraps `AVAssetReader` to decode screen.mov and camera.mov frame-by-frame into `CVPixelBuffer` for Metal compositing.

**Files:**
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/export/video-decoder.swift`

### Step 1: Implement the video decoder

Create `CaptureKitEngine/Sources/CaptureKitEngine/export/video-decoder.swift`:

```swift
import Foundation
import AVFoundation
import CoreMedia
import CoreVideo

/// Reads video frames from a .mov file as CVPixelBuffer, seeking to a time range.
public final class VideoDecoder {
    private let asset: AVAsset
    private var reader: AVAssetReader?
    private var trackOutput: AVAssetReaderTrackOutput?
    public let naturalWidth: Int
    public let naturalHeight: Int
    public let fps: Float
    public let totalFrames: Int

    /// Frames that will be decoded (considering trim range).
    public let trimmedFrameCount: Int

    public init(url: URL, inPointMs: UInt64, outPointMs: UInt64) throws {
        asset = AVAsset(url: url)

        guard let videoTrack = asset.tracks(withMediaType: .video).first else {
            throw ExportError.videoDecoderFailed("No video track in \(url.lastPathComponent)")
        }

        let size = videoTrack.naturalSize.applying(videoTrack.preferredTransform)
        naturalWidth = Int(abs(size.width))
        naturalHeight = Int(abs(size.height))
        fps = videoTrack.nominalFrameRate

        let duration = CMTimeGetSeconds(asset.duration)
        totalFrames = Int(duration * Double(fps))

        let inTime = CMTime(value: Int64(inPointMs), timescale: 1000)
        let outTime = CMTime(value: Int64(outPointMs), timescale: 1000)
        let timeRange = CMTimeRange(start: inTime, end: outTime)

        let trimDuration = CMTimeGetSeconds(outTime) - CMTimeGetSeconds(inTime)
        trimmedFrameCount = max(1, Int(trimDuration * Double(fps)))

        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = timeRange

        let outputSettings: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ]
        let output = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: outputSettings)
        output.alwaysCopiesSampleData = false // zero-copy when possible
        reader.add(output)

        guard reader.startReading() else {
            throw ExportError.videoDecoderFailed("Failed to start reader: \(reader.error?.localizedDescription ?? "unknown")")
        }

        self.reader = reader
        self.trackOutput = output
    }

    /// Returns the next decoded frame, or nil if at end of range.
    public func nextFrame() -> CVPixelBuffer? {
        guard let output = trackOutput,
              let sampleBuffer = output.copyNextSampleBuffer(),
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return nil
        }
        return pixelBuffer
    }

    /// Presentation time of the most recently decoded frame.
    public func cancel() {
        reader?.cancelReading()
    }
}
```

### Step 2: Build to verify

```bash
cd CaptureKitEngine && swift build -c release
```

Expected: BUILD SUCCEEDED

### Step 3: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/export/video-decoder.swift
git commit -m "feat(export): AVAssetReader video decoder for frame-by-frame reading"
```

---

## Task 4: Audio Mixer

Reads mic.wav and system_audio.wav, mixes them, trims to in/out points, and writes to an `AVAssetWriterInput` as AAC.

**Files:**
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/export/audio-mixer.swift`
- Test: `CaptureKitEngine/Tests/CaptureKitEngineTests/AudioMixerTests.swift`

### Step 1: Write failing test for audio sample mixing

Create `CaptureKitEngine/Tests/CaptureKitEngineTests/AudioMixerTests.swift`:

```swift
import XCTest
@testable import CaptureKitEngine

final class AudioMixerTests: XCTestCase {

    func testMixSamplesAddition() {
        // Two buffers with known values → mixed = sum, clamped to [-1, 1]
        let a: [Float] = [0.3, -0.5, 0.8, 0.9]
        let b: [Float] = [0.2, -0.3, 0.4, 0.5]
        let result = AudioMixingMath.mixSamples(a, b)
        XCTAssertEqual(result[0], 0.5, accuracy: 0.001)
        XCTAssertEqual(result[1], -0.8, accuracy: 0.001)
        XCTAssertEqual(result[2], 1.0, accuracy: 0.001) // clamped from 1.2
        XCTAssertEqual(result[3], 1.0, accuracy: 0.001) // clamped from 1.4
    }

    func testMixSamplesDifferentLengths() {
        // Shorter buffer treated as silence beyond its length
        let a: [Float] = [0.5, 0.5, 0.5]
        let b: [Float] = [0.3]
        let result = AudioMixingMath.mixSamples(a, b)
        XCTAssertEqual(result.count, 3)
        XCTAssertEqual(result[0], 0.8, accuracy: 0.001)
        XCTAssertEqual(result[1], 0.5, accuracy: 0.001) // only a
        XCTAssertEqual(result[2], 0.5, accuracy: 0.001) // only a
    }

    func testMixSamplesClampingNegative() {
        let a: [Float] = [-0.9]
        let b: [Float] = [-0.5]
        let result = AudioMixingMath.mixSamples(a, b)
        XCTAssertEqual(result[0], -1.0, accuracy: 0.001) // clamped from -1.4
    }
}
```

### Step 2: Run tests to verify they fail

```bash
cd CaptureKitEngine && swift test --filter AudioMixerTests
```

Expected: FAIL — `AudioMixingMath` not found.

### Step 3: Implement audio mixer

Create `CaptureKitEngine/Sources/CaptureKitEngine/export/audio-mixer.swift`:

```swift
import Foundation
import AVFoundation
import CoreMedia

// MARK: - Mixing Math (testable)

public enum AudioMixingMath {
    /// Mix two float sample arrays by addition with clamping to [-1, 1].
    public static func mixSamples(_ a: [Float], _ b: [Float]) -> [Float] {
        let count = max(a.count, b.count)
        var result = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let va = i < a.count ? a[i] : 0
            let vb = i < b.count ? b[i] : 0
            result[i] = min(max(va + vb, -1.0), 1.0)
        }
        return result
    }
}

// MARK: - Audio Mixer

/// Reads and mixes audio files, providing mixed CMSampleBuffers for the export writer.
public final class AudioMixer {
    private var readers: [AVAssetReader] = []
    private var outputs: [AVAssetReaderTrackOutput] = []
    private let sampleRate: Double = 48000
    private let channels: Int = 2

    /// Audio format for the mixed output (AAC encoding settings for AVAssetWriterInput).
    public var outputSettings: [String: Any] {
        return [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: 192_000,
        ]
    }

    /// Linear PCM format for reading + mixing (intermediate format).
    private var readSettings: [String: Any] {
        return [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
        ]
    }

    public init() {}

    /// Add an audio file to the mix. Call this for mic.wav and/or system_audio.wav.
    public func addTrack(url: URL, inPointMs: UInt64, outPointMs: UInt64) throws {
        let asset = AVAsset(url: url)
        guard let track = asset.tracks(withMediaType: .audio).first else { return }

        let reader = try AVAssetReader(asset: asset)
        let inTime = CMTime(value: Int64(inPointMs), timescale: 1000)
        let outTime = CMTime(value: Int64(outPointMs), timescale: 1000)
        reader.timeRange = CMTimeRange(start: inTime, end: outTime)

        let output = AVAssetReaderTrackOutput(track: track, outputSettings: readSettings)
        reader.add(output)
        reader.startReading()

        readers.append(reader)
        outputs.append(output)
    }

    public var hasAudio: Bool { !outputs.isEmpty }

    /// Read the next chunk of mixed audio as a CMSampleBuffer.
    /// Returns nil when all sources are exhausted.
    public func nextMixedSample() -> CMSampleBuffer? {
        // Read one buffer from each source
        var buffers: [CMSampleBuffer] = []
        for output in outputs {
            if let buf = output.copyNextSampleBuffer() {
                buffers.append(buf)
            }
        }
        guard !buffers.isEmpty else { return nil }

        // If only one source, return it directly (no mixing needed)
        if buffers.count == 1 { return buffers[0] }

        // Mix multiple buffers
        return mixBuffers(buffers)
    }

    private func mixBuffers(_ buffers: [CMSampleBuffer]) -> CMSampleBuffer? {
        // Extract float samples from each buffer
        var allSamples: [[Float]] = []
        for buf in buffers {
            guard let blockBuffer = CMSampleBufferGetDataBuffer(buf) else { continue }
            let length = CMBlockBufferGetDataLength(blockBuffer)
            var data = Data(count: length)
            data.withUnsafeMutableBytes { ptr in
                CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: length, destination: ptr.baseAddress!)
            }
            let floats = data.withUnsafeBytes {
                Array($0.bindMemory(to: Float.self))
            }
            allSamples.append(floats)
        }

        guard allSamples.count >= 2 else {
            return buffers.first
        }

        // Mix all tracks together
        var mixed = allSamples[0]
        for i in 1..<allSamples.count {
            mixed = AudioMixingMath.mixSamples(mixed, allSamples[i])
        }

        // Create a new CMSampleBuffer from mixed data
        let timing = CMSampleTimingInfo(
            duration: CMSampleBufferGetDuration(buffers[0]),
            presentationTimeStamp: CMSampleBufferGetPresentationTimeStamp(buffers[0]),
            decodeTimeStamp: .invalid
        )
        return createSampleBuffer(from: mixed, timing: timing)
    }

    private func createSampleBuffer(from samples: [Float], timing: CMSampleTimingInfo) -> CMSampleBuffer? {
        let byteCount = samples.count * MemoryLayout<Float>.size
        var blockBuffer: CMBlockBuffer?
        CMBlockBufferCreateWithMemoryBlock(
            allocator: nil, memoryBlock: nil, blockLength: byteCount,
            blockAllocator: nil, customBlockSource: nil, offsetToData: 0,
            dataLength: byteCount, flags: 0, blockBufferOut: &blockBuffer
        )
        guard let block = blockBuffer else { return nil }

        samples.withUnsafeBytes { ptr in
            CMBlockBufferReplaceDataBytes(
                with: ptr.baseAddress!, blockBuffer: block,
                offsetIntoDestination: 0, dataLength: byteCount
            )
        }

        var formatDesc: CMAudioFormatDescription?
        var asbd = AudioStreamBasicDescription(
            mSampleRate: sampleRate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: UInt32(channels * MemoryLayout<Float>.size),
            mFramesPerPacket: 1,
            mBytesPerFrame: UInt32(channels * MemoryLayout<Float>.size),
            mChannelsPerFrame: UInt32(channels),
            mBitsPerChannel: 32,
            mReserved: 0
        )
        CMAudioFormatDescriptionCreate(
            allocator: nil, asbd: &asbd, layoutSize: 0,
            layout: nil, magicCookieSize: 0, magicCookie: nil,
            extensions: nil, formatDescriptionOut: &formatDesc
        )
        guard let fmt = formatDesc else { return nil }

        let frameCount = samples.count / channels
        var timing = timing
        var sampleBuffer: CMSampleBuffer?
        CMAudioSampleBufferCreateReadyWithPacketDescriptions(
            allocator: nil, dataBuffer: block, formatDescription: fmt,
            sampleCount: frameCount, presentationTimeStamp: timing.presentationTimeStamp,
            packetDescriptions: nil, sampleBufferOut: &sampleBuffer
        )
        return sampleBuffer
    }

    public func cancel() {
        readers.forEach { $0.cancelReading() }
    }
}
```

### Step 4: Run tests to verify they pass

```bash
cd CaptureKitEngine && swift test --filter AudioMixerTests
```

Expected: PASS

### Step 5: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/export/audio-mixer.swift \
        CaptureKitEngine/Tests/CaptureKitEngineTests/AudioMixerTests.swift
git commit -m "feat(export): audio mixer with sample addition and clamping"
```

---

## Task 5: Export Pipeline (Orchestration)

The main pipeline that ties everything together: decode → composite → encode, with progress tracking and cancellation.

**Files:**
- Create: `CaptureKitEngine/Sources/CaptureKitEngine/export/export-pipeline.swift`

### Step 1: Implement the export pipeline

Create `CaptureKitEngine/Sources/CaptureKitEngine/export/export-pipeline.swift`:

```swift
import Foundation
import AVFoundation
import CoreMedia
import CoreVideo

// MARK: - Export Config (decoded from JSON)

public struct ExportConfig: Codable {
    public let resolution: String   // "original" | "1080p" | "720p"
    public let outputPath: String
}

// MARK: - Export Progress (thread-safe, polled by C API)

public final class ExportProgress {
    private let lock = NSLock()
    private var _framesRendered: Int = 0
    private var _totalFrames: Int = 0
    private var _phase: String = "compositing"
    private var _startTime: UInt64 = 0
    private var _error: String?

    public func start(totalFrames: Int) {
        lock.lock()
        _totalFrames = totalFrames
        _framesRendered = 0
        _phase = "compositing"
        _startTime = mach_absolute_time()
        _error = nil
        lock.unlock()
    }

    public func updateFrame(_ count: Int) {
        lock.lock()
        _framesRendered = count
        lock.unlock()
    }

    public func setPhase(_ phase: String) {
        lock.lock()
        _phase = phase
        lock.unlock()
    }

    public func setError(_ error: String) {
        lock.lock()
        _phase = "error"
        _error = error
        lock.unlock()
    }

    public func toJSON() -> String {
        lock.lock()
        defer { lock.unlock() }

        var timebaseInfo = mach_timebase_info_data_t()
        mach_timebase_info(&timebaseInfo)
        let elapsedNano = (mach_absolute_time() - _startTime) * UInt64(timebaseInfo.numer) / UInt64(timebaseInfo.denom)
        let elapsedMs = elapsedNano / 1_000_000

        let percentage = _totalFrames > 0 ? Double(_framesRendered) / Double(_totalFrames) * 100.0 : 0
        let msPerFrame = _framesRendered > 0 ? Double(elapsedMs) / Double(_framesRendered) : 0
        let remaining = _framesRendered > 0 ? UInt64(msPerFrame * Double(_totalFrames - _framesRendered)) : 0

        if let error = _error {
            return """
            {"framesRendered":\(_framesRendered),"totalFrames":\(_totalFrames),\
            "percentage":\(percentage),"elapsedMs":\(elapsedMs),\
            "estimatedRemainingMs":null,"phase":"error","error":"\(error)"}
            """
        }

        return """
        {"framesRendered":\(_framesRendered),"totalFrames":\(_totalFrames),\
        "percentage":\(String(format: "%.1f", percentage)),"elapsedMs":\(elapsedMs),\
        "estimatedRemainingMs":\(remaining),"phase":"\(_phase)"}
        """
    }
}

// MARK: - Export Result

public struct ExportResult: Codable {
    public let outputPath: String
    public let durationMs: UInt64
    public let fileSizeBytes: UInt64
}

// MARK: - Export Pipeline

public final class ExportPipeline {
    public let progress = ExportProgress()
    private var isCancelled = false

    public init() {}

    public func cancel() {
        isCancelled = true
    }

    /// Run the full export pipeline. Call from a background thread.
    public func run(projectJSON: String, exportConfigJSON: String) throws -> ExportResult {
        // Parse project
        guard let projectData = projectJSON.data(using: .utf8),
              let project = try? JSONSerialization.jsonObject(with: projectData) as? [String: Any] else {
            throw ExportError.invalidProject("Failed to parse project JSON")
        }

        // Parse export config
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let configData = exportConfigJSON.data(using: .utf8),
              let exportConfig = try? decoder.decode(ExportConfig.self, from: configData) else {
            throw ExportError.invalidProject("Failed to parse export config JSON")
        }

        // Extract project fields
        guard let tracks = project["tracks"] as? [String: Any],
              let screenPath = tracks["screen"] as? String else {
            throw ExportError.invalidProject("Missing screen track path")
        }

        let timeline = project["timeline"] as? [String: Any] ?? [:]
        let inPointMs = (timeline["in_point"] as? UInt64) ?? 0
        let outPointMs = (timeline["out_point"] as? UInt64) ?? 0

        let effectsDict = project["effects"] as? [String: Any] ?? [:]
        let effects = ExportEffects(from: effectsDict)

        let cameraPath = tracks["camera"] as? String
        let micPath = tracks["mic"] as? String
        let systemAudioPath = tracks["system_audio"] as? String

        // --- Set up video decoder ---
        let screenURL = URL(fileURLWithPath: screenPath)
        let screenDecoder = try VideoDecoder(url: screenURL, inPointMs: inPointMs, outPointMs: outPointMs)

        var cameraDecoder: VideoDecoder?
        if let camPath = cameraPath {
            cameraDecoder = try VideoDecoder(url: URL(fileURLWithPath: camPath), inPointMs: inPointMs, outPointMs: outPointMs)
        }

        // --- Set up Metal compositor ---
        let compositor = try MetalCompositor()
        let outSize = LayoutMath.outputSize(
            resolution: exportConfig.resolution,
            recordingWidth: screenDecoder.naturalWidth,
            recordingHeight: screenDecoder.naturalHeight
        )
        compositor.configure(width: outSize.width, height: outSize.height)

        // --- Set up audio mixer ---
        let audioMixer = AudioMixer()
        if let micURL = micPath {
            try? audioMixer.addTrack(url: URL(fileURLWithPath: micURL), inPointMs: inPointMs, outPointMs: outPointMs)
        }
        if let sysURL = systemAudioPath {
            try? audioMixer.addTrack(url: URL(fileURLWithPath: sysURL), inPointMs: inPointMs, outPointMs: outPointMs)
        }

        // --- Set up AVAssetWriter ---
        let outputURL = URL(fileURLWithPath: exportConfig.outputPath)
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

        // Video input (from Metal pixel buffers)
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: outSize.width,
            AVVideoHeightKey: outSize.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 20_000_000,
                AVVideoMaxKeyFrameIntervalKey: Int(screenDecoder.fps),
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ] as [String: Any],
        ]
        let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = false // non-realtime = quality optimized
        let pixelBufferAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: outSize.width,
                kCVPixelBufferHeightKey as String: outSize.height,
                kCVPixelBufferMetalCompatibilityKey as String: true,
            ]
        )
        writer.add(videoInput)

        // Audio input (AAC encoded)
        var audioInput: AVAssetWriterInput?
        if audioMixer.hasAudio {
            let aInput = AVAssetWriterInput(mediaType: .audio, outputSettings: audioMixer.outputSettings)
            aInput.expectsMediaDataInRealTime = false
            writer.add(aInput)
            audioInput = aInput
        }

        writer.startWriting()
        let startTime = CMTime(value: Int64(inPointMs), timescale: 1000)
        writer.startSession(atSourceTime: startTime)

        // --- Frame loop ---
        let totalFrames = screenDecoder.trimmedFrameCount
        progress.start(totalFrames: totalFrames)
        var frameIndex = 0
        let frameDuration = CMTime(value: 1, timescale: CMTimeScale(screenDecoder.fps))

        while let screenBuffer = screenDecoder.nextFrame() {
            if isCancelled {
                writer.cancelWriting()
                screenDecoder.cancel()
                cameraDecoder?.cancel()
                audioMixer.cancel()
                throw ExportError.cancelled
            }

            // Get camera frame (advance camera decoder in lockstep)
            let cameraBuffer = cameraDecoder?.nextFrame()

            // Composite
            let composited = try compositor.renderFrame(
                screenPixelBuffer: screenBuffer,
                cameraPixelBuffer: cameraBuffer,
                effects: effects,
                screenWidth: screenDecoder.naturalWidth,
                screenHeight: screenDecoder.naturalHeight
            )

            // Append video
            let presentationTime = CMTimeAdd(startTime, CMTimeMultiply(frameDuration, multiplier: Int32(frameIndex)))
            while !videoInput.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.001)
            }
            pixelBufferAdaptor.append(composited, withPresentationTime: presentationTime)

            // Append audio (feed audio samples to keep up with video)
            if let aInput = audioInput {
                while aInput.isReadyForMoreMediaData, let audioSample = audioMixer.nextMixedSample() {
                    aInput.append(audioSample)
                }
            }

            frameIndex += 1
            progress.updateFrame(frameIndex)
        }

        // --- Finalize ---
        progress.setPhase("finalizing")
        videoInput.markAsFinished()
        audioInput?.markAsFinished()

        let semaphore = DispatchSemaphore(value: 0)
        writer.finishWriting { semaphore.signal() }
        semaphore.wait()

        guard writer.status == .completed else {
            throw ExportError.writerFailed(writer.error?.localizedDescription ?? "Unknown writer error")
        }

        // Get output file size
        let attrs = try FileManager.default.attributesOfItem(atPath: outputURL.path)
        let fileSize = attrs[.size] as? UInt64 ?? 0

        let durationMs = outPointMs - inPointMs
        progress.setPhase("done")

        return ExportResult(
            outputPath: exportConfig.outputPath,
            durationMs: durationMs,
            fileSizeBytes: fileSize
        )
    }
}
```

### Step 2: Build to verify

```bash
cd CaptureKitEngine && swift build -c release
```

Expected: BUILD SUCCEEDED

### Step 3: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/export/export-pipeline.swift
git commit -m "feat(export): export pipeline with decode-composite-encode loop"
```

---

## Task 6: C API for Export

Add three new `@_cdecl` functions to expose the export pipeline to Rust, following the same session management pattern as recording.

**Files:**
- Modify: `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift`

### Step 1: Add export C API functions

Add to `capi.swift` (after the existing recording functions), plus new session storage:

```swift
// At the top, add alongside activeSessions:
private var activeExports: [UInt64: ExportPipeline] = [:]
private var nextExportId: UInt64 = 1
private let exportsLock = NSLock()

// === Export API ===

@_cdecl("ck_start_export")
public func ck_start_export(
    projectJson: UnsafePointer<CChar>,
    exportConfigJson: UnsafePointer<CChar>,
    outExportId: UnsafeMutablePointer<UInt64>
) -> Int32 {
    let projectStr = String(cString: projectJson)
    let configStr = String(cString: exportConfigJson)

    let pipeline = ExportPipeline()

    exportsLock.lock()
    let exportId = nextExportId
    nextExportId += 1
    activeExports[exportId] = pipeline
    exportsLock.unlock()

    outExportId.pointee = exportId

    // Run export on background queue
    DispatchQueue.global(qos: .userInitiated).async {
        do {
            let result = try pipeline.run(projectJSON: projectStr, exportConfigJSON: configStr)
            print("Export completed: \(result.outputPath)")
        } catch {
            pipeline.progress.setError("\(error)")
            print("Export error: \(error)")
        }
    }

    return 0
}

@_cdecl("ck_get_export_progress")
public func ck_get_export_progress(
    exportId: UInt64,
    outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    exportsLock.lock()
    guard let pipeline = activeExports[exportId] else {
        exportsLock.unlock()
        return -1
    }
    exportsLock.unlock()

    outJson.pointee = strdup(pipeline.progress.toJSON())
    return 0
}

@_cdecl("ck_cancel_export")
public func ck_cancel_export(exportId: UInt64) -> Int32 {
    exportsLock.lock()
    guard let pipeline = activeExports.removeValue(forKey: exportId) else {
        exportsLock.unlock()
        return -1
    }
    exportsLock.unlock()

    pipeline.cancel()
    return 0
}

// Call when export is done to clean up the session
@_cdecl("ck_finish_export")
public func ck_finish_export(exportId: UInt64) -> Int32 {
    exportsLock.lock()
    activeExports.removeValue(forKey: exportId)
    exportsLock.unlock()
    return 0
}
```

### Step 2: Build to verify

```bash
cd CaptureKitEngine && swift build -c release
```

Expected: BUILD SUCCEEDED

### Step 3: Commit

```bash
git add CaptureKitEngine/Sources/CaptureKitEngine/capi.swift
git commit -m "feat(export): C API functions for start/progress/cancel/finish export"
```

---

## Task 7: Rust FFI + Tauri Commands

Wire the Swift C API to the frontend through Rust.

**Files:**
- Modify: `src-tauri/src/swift_ffi.rs` — add extern declarations + wrapper methods
- Modify: `src-tauri/src/commands/export.rs` — replace `quick_export` with composited export commands
- Modify: `src-tauri/src/lib.rs` — register new commands, add `ExportState`

### Step 1: Add FFI declarations

Add to `src-tauri/src/swift_ffi.rs` in the `extern "C"` block:

```rust
fn ck_start_export(
    project_json: *const c_char,
    export_config_json: *const c_char,
    out_export_id: *mut u64,
) -> i32;
fn ck_get_export_progress(export_id: u64, out_json: *mut *const c_char) -> i32;
fn ck_cancel_export(export_id: u64) -> i32;
fn ck_finish_export(export_id: u64) -> i32;
```

Add wrapper methods to `impl CaptureKitEngine`:

```rust
pub fn start_export(project_json: &str, export_config_json: &str) -> Result<u64, String> {
    let p = CString::new(project_json).map_err(|e| e.to_string())?;
    let c = CString::new(export_config_json).map_err(|e| e.to_string())?;
    let mut export_id: u64 = 0;
    unsafe {
        let result = ck_start_export(p.as_ptr(), c.as_ptr(), &mut export_id);
        if result != 0 {
            return Err("Failed to start export".into());
        }
    }
    Ok(export_id)
}

pub fn get_export_progress(export_id: u64) -> Result<String, String> {
    unsafe { call_json(|p| ck_get_export_progress(export_id, p)) }
}

pub fn cancel_export(export_id: u64) -> Result<(), String> {
    unsafe {
        if ck_cancel_export(export_id) != 0 {
            return Err("Failed to cancel export".into());
        }
    }
    Ok(())
}

pub fn finish_export(export_id: u64) -> Result<(), String> {
    unsafe {
        if ck_finish_export(export_id) != 0 {
            return Err("Failed to finish export".into());
        }
    }
    Ok(())
}
```

### Step 2: Rewrite export commands

Replace `src-tauri/src/commands/export.rs` entirely:

```rust
use crate::project::{self, ExportConfig, ExportProgress};
use crate::swift_ffi::CaptureKitEngine;
use std::sync::Mutex;

pub struct ExportState {
    pub active_export_id: Mutex<Option<u64>>,
}

/// Start a composited export. Returns the export session ID.
/// The export runs in the background on the Swift side.
/// Frontend should poll get_export_progress() until done.
#[tauri::command]
pub fn start_export(
    project_id: String,
    export_config: ExportConfig,
    state: tauri::State<ExportState>,
) -> Result<u64, String> {
    // Read project from disk
    let project_path = project::project_dir(&project_id).join("project.json");
    let project_json = std::fs::read_to_string(&project_path).map_err(|e| e.to_string())?;

    // Serialize export config to JSON
    let config_json = serde_json::to_string(&export_config).map_err(|e| e.to_string())?;

    // Start export in Swift
    let export_id = CaptureKitEngine::start_export(&project_json, &config_json)?;

    let mut active = state.active_export_id.lock().unwrap();
    *active = Some(export_id);

    Ok(export_id)
}

/// Poll export progress. Returns ExportProgress JSON.
#[tauri::command]
pub fn get_export_progress(state: tauri::State<ExportState>) -> Result<ExportProgress, String> {
    let active = state.active_export_id.lock().unwrap();
    let export_id = active.ok_or("No active export")?;
    let json = CaptureKitEngine::get_export_progress(export_id)?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

/// Cancel the active export.
#[tauri::command]
pub fn cancel_export(state: tauri::State<ExportState>) -> Result<(), String> {
    let mut active = state.active_export_id.lock().unwrap();
    if let Some(export_id) = active.take() {
        CaptureKitEngine::cancel_export(export_id)?;
    }
    Ok(())
}

/// Clean up after export completes (call after progress shows "done").
#[tauri::command]
pub fn finish_export(state: tauri::State<ExportState>) -> Result<(), String> {
    let mut active = state.active_export_id.lock().unwrap();
    if let Some(export_id) = active.take() {
        CaptureKitEngine::finish_export(export_id)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_export_config_to_json() {
        let config = ExportConfig {
            resolution: "1080p".to_string(),
            output_path: "/Users/test/Desktop/output.mp4".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"resolution\":\"1080p\""));
        assert!(json.contains("\"outputPath\""));
    }
}
```

### Step 3: Update lib.rs

Replace the `quick_export` handler with the new export commands and add `ExportState`:

In `src-tauri/src/lib.rs`, add:

```rust
use commands::export::ExportState;
```

Add to the builder chain (after `.manage(RecordingState { ... })`):

```rust
.manage(ExportState {
    active_export_id: Mutex::new(None),
})
```

Replace `commands::export::quick_export` in the handler list with:

```rust
commands::export::start_export,
commands::export::get_export_progress,
commands::export::cancel_export,
commands::export::finish_export,
```

### Step 4: Build to verify

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: BUILD SUCCEEDED (Swift framework builds first via build.rs, then Rust links it).

### Step 5: Run Rust tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. Note that the old `test_quick_export_errors_on_missing_project` test is removed with the `quick_export` function.

### Step 6: Commit

```bash
git add src-tauri/src/swift_ffi.rs src-tauri/src/commands/export.rs src-tauri/src/lib.rs
git commit -m "feat(export): Rust FFI + Tauri commands for composited export"
```

---

## Task 8: Frontend Export Panel + Progress

Replace the simple export button with a full export panel that shows resolution options, a progress bar, and cancel support.

**Files:**
- Rewrite: `src/components/editor/export-button.tsx` → full export panel component
- Modify: `src/stores/editor-store.ts` — add `saveProject` action (ensure project saved before export)
- Test: `src/components/editor/__tests__/export-panel.test.tsx` (if test framework is set up)

### Step 1: Add save-before-export helper to the store

Add to `src/stores/editor-store.ts` — a helper that saves the current project to disk before exporting:

```typescript
// Add this action alongside existing actions:
saveProject: async () => {
    const project = get().project
    if (!project) return
    // Convert EditorProject back to ProjectState format for Rust
    const state = {
        id: project.id,
        name: project.name,
        created_at: project.created_at,
        tracks: project.tracks,
        timeline: project.timeline,
        effects: project.effects,
    }
    await invoke("save_project_state", { project: state })
},
```

If `saveProject` already exists via auto-save, skip this step. Just ensure it's callable as `useEditorStore.getState().saveProject()` before starting an export.

### Step 2: Rewrite the export button as export panel

Rewrite `src/components/editor/export-button.tsx`:

```tsx
import { useState, useEffect, useRef, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Download, X, Check, Loader2 } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import type { ExportConfig, ExportProgress } from "@/types/editor"

type Resolution = "original" | "1080p" | "720p"

export function ExportButton() {
    const project = useEditorStore((s) => s.project)
    const [showPanel, setShowPanel] = useState(false)
    const [resolution, setResolution] = useState<Resolution>("1080p")
    const [exporting, setExporting] = useState(false)
    const [progress, setProgress] = useState<ExportProgress | null>(null)
    const [result, setResult] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
        }
    }, [])

    // Clean up polling on unmount
    useEffect(() => stopPolling, [stopPolling])

    if (!project) return null

    const handleExport = async () => {
        setExporting(true)
        setError(null)
        setResult(null)
        setProgress(null)

        try {
            // Save project state first
            await invoke("save_project_state", {
                project: {
                    id: project.id,
                    name: project.name,
                    created_at: project.created_at,
                    tracks: project.tracks,
                    timeline: project.timeline,
                    effects: project.effects,
                },
            })

            // Build output path
            const home = await invoke<string>("get_home_dir")
            const filename = project.name.replace(/[/\\:"]/g, "_")
            const outputPath = `${home}/Desktop/${filename}.mp4`

            const config: ExportConfig = { resolution, outputPath }
            await invoke<number>("start_export", {
                projectId: project.id,
                exportConfig: config,
            })

            // Start polling progress
            pollRef.current = setInterval(async () => {
                try {
                    const prog = await invoke<ExportProgress>("get_export_progress")
                    setProgress(prog)

                    if (prog.phase === "done") {
                        stopPolling()
                        setExporting(false)
                        setResult(config.outputPath)
                        await invoke("finish_export")
                        setTimeout(() => setResult(null), 5000)
                    } else if (prog.phase === "error") {
                        stopPolling()
                        setExporting(false)
                        setError("Export failed")
                        await invoke("finish_export")
                    }
                } catch {
                    // polling error — might be transient
                }
            }, 200)
        } catch (e) {
            setError(String(e))
            setExporting(false)
        }
    }

    const handleCancel = async () => {
        stopPolling()
        try {
            await invoke("cancel_export")
        } catch { /* ignore */ }
        setExporting(false)
        setProgress(null)
    }

    // Simple inline panel
    if (exporting && progress) {
        const pct = Math.round(progress.percentage)
        const eta = progress.estimatedRemainingMs
            ? `${Math.ceil(progress.estimatedRemainingMs / 1000)}s remaining`
            : "Estimating..."
        return (
            <div className="flex items-center gap-3">
                <div className="flex-1 min-w-[160px]">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{progress.phase === "finalizing" ? "Finalizing..." : `${pct}%`}</span>
                        <span>{eta}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-200"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>
                <Button size="sm" variant="ghost" onClick={handleCancel}>
                    <X className="w-4 h-4" />
                </Button>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2">
            {error && <span className="text-xs text-destructive">{error}</span>}
            {result && (
                <span className="text-xs text-green-400 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Saved to Desktop
                </span>
            )}

            {showPanel ? (
                <div className="flex items-center gap-2">
                    <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value as Resolution)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                        <option value="original">Original</option>
                        <option value="1080p">1080p</option>
                        <option value="720p">720p</option>
                    </select>
                    <Button size="sm" onClick={handleExport} disabled={exporting}>
                        {exporting ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                            <Download className="w-4 h-4 mr-1" />
                        )}
                        Export
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowPanel(false)}>
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            ) : (
                <Button size="sm" onClick={() => setShowPanel(true)}>
                    <Download className="w-4 h-4 mr-1" />
                    Export
                </Button>
            )}
        </div>
    )
}
```

### Step 3: Add `get_home_dir` Tauri command

This is a tiny helper needed for the output path. Add to `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or("Could not find home directory".to_string())
}
```

Register it in the invoke handler list:

```rust
get_home_dir,
```

### Step 4: Build and test the full app

```bash
npx tauri dev
```

Manual test:
1. Open a recording in the editor
2. Click "Export" → resolution picker appears
3. Select "1080p" → click "Export"
4. Progress bar animates with percentage and ETA
5. "Saved to Desktop" appears on completion
6. Open the .mp4 — verify background, rounded corners, shadow, camera bubble match the preview

### Step 5: Commit

```bash
git add src/components/editor/export-button.tsx src-tauri/src/lib.rs
git commit -m "feat(export): export panel with resolution picker, progress bar, and cancel"
```

---

## Edge Cases & Gotchas

### Metal Uniform Alignment
Metal struct alignment must match between Swift and .metal. The `CompositeUniforms` struct uses explicit padding fields (`_pad0`, `_pad1`, etc.) to ensure correct alignment. If visual output is wrong, check struct layout with `MemoryLayout<CompositeUniforms>.size` and ensure it matches the Metal side.

### Camera object-cover vs object-contain
The CSS preview uses `object-cover` for the camera (fills the bubble, crops overflow). The Metal shader samples the camera texture with UV coordinates mapped to the bubble rect. If the camera aspect ratio doesn't match 1:1, the image will be stretched. To match `object-cover`, compute UV mapping that centers and crops:
```swift
// In the shader: adjust camUV for object-cover
let camAspect = float(cameraWidth) / float(cameraHeight)
if camAspect > 1 { // wider than tall — crop sides
    camUV.x = (camUV.x - 0.5) / camAspect + 0.5
} else { // taller than wide — crop top/bottom
    camUV.y = (camUV.y - 0.5) * camAspect + 0.5
}
```
Add this to the fragment shader if camera aspect doesn't match. May need camera dimensions passed via uniforms.

### Pixel Format Consistency
Recording uses `kCVPixelFormatType_32BGRA`. AVAssetReader output settings must also request BGRA. Metal texture format must be `.bgra8Unorm`. All three must match or you'll get color channel swaps.

### Non-realtime Encoding
Setting `videoInput.expectsMediaDataInRealTime = false` tells AVAssetWriter to optimize for quality over latency. This means it may buffer frames internally. Always check `isReadyForMoreMediaData` before appending, and spin-wait if not ready.

### Audio Sync
Audio and video are independent AVAssetReaderTrackOutput instances reading from different files. They use the same `timeRange` so they should be in sync. The audio mixer reads PCM samples while the video loop processes frames. Since audio sample rate (48000 Hz) and video frame rate (30/60 fps) are independent, the audio may finish slightly before or after video. The writer handles this — just mark both inputs as finished when done.

### Export of Projects Without Effects
If `effects` is `None` (pre-Phase-3 projects), the Swift pipeline uses `ExportEffects(from: [:])` which applies sensible defaults (gradient background, 8% padding, 12px border radius, shadow on). This matches what the frontend shows for old projects.

---

## Files Summary

### New Files (6)
| File | Purpose |
|------|---------|
| `CaptureKitEngine/Sources/CaptureKitEngine/export/metal-compositor.swift` | Metal device, shaders, compositing, layout math |
| `CaptureKitEngine/Sources/CaptureKitEngine/export/video-decoder.swift` | AVAssetReader wrapper for frame-by-frame decoding |
| `CaptureKitEngine/Sources/CaptureKitEngine/export/audio-mixer.swift` | Audio track mixing with sample addition + clamping |
| `CaptureKitEngine/Sources/CaptureKitEngine/export/export-pipeline.swift` | Export orchestration, progress tracking, cancellation |
| `CaptureKitEngine/Tests/CaptureKitEngineTests/LayoutMathTests.swift` | Unit tests for layout calculations |
| `CaptureKitEngine/Tests/CaptureKitEngineTests/AudioMixerTests.swift` | Unit tests for audio mixing math |

### Modified Files (6)
| File | Changes |
|------|---------|
| `CaptureKitEngine/Sources/CaptureKitEngine/capi.swift` | Add `ck_start_export`, `ck_get_export_progress`, `ck_cancel_export`, `ck_finish_export` |
| `src-tauri/src/swift_ffi.rs` | Add extern declarations + wrapper methods for 4 export functions |
| `src-tauri/src/commands/export.rs` | Replace `quick_export` with `start_export`, `get_export_progress`, `cancel_export`, `finish_export` |
| `src-tauri/src/lib.rs` | Register new commands, add `ExportState`, add `get_home_dir` |
| `src-tauri/src/project.rs` | Add `ExportConfig`, `ExportProgress`, `ExportResult` types |
| `src/types/editor.ts` | Add `ExportConfig`, `ExportProgress`, `ExportResult` interfaces |
| `src/components/editor/export-button.tsx` | Rewrite as export panel with resolution picker + progress bar |
