# Click Highlight in Export

## Context
Click highlights are configured in the editor (`cursor.clickHighlight.enabled = true`) but never appear in exported videos. The settings exist in TypeScript/Rust, but the Swift/Metal export pipeline has no implementation for click highlight rendering. Click events (`type: "click"`, `type: "rightClick"`) ARE already recorded in `mouse_events.jsonl` during capture — we just need to render them.

## Approach
Add click highlight rendering to the Metal compositor as a separate effect from the main cursor. A click renders as an expanding, fading ring at the click position, lasting ~300ms. Click highlights work independently of `cursor.enabled` — you can show clicks without showing the cursor.

## Changes

### 1. `RekoEngine/Sources/RekoEngine/export/metal-compositor.swift`

#### ExportEffects — add click highlight fields (after `cursorOpacity` at line 88)

```swift
// Click highlight
public var clickHighlightEnabled: Bool
public var clickHighlightColor: String    // hex
public var clickHighlightOpacity: Double  // 0-1
public var clickHighlightSize: Double     // max ripple radius in px
```

#### ExportEffects.init (memberwise) — add params with defaults

```swift
clickHighlightEnabled: Bool = false,
clickHighlightColor: String = "#ffffff",
clickHighlightOpacity: Double = 0.5,
clickHighlightSize: Double = 30
```

#### ExportEffects.init(from:) — parse from cursor dict (after line 156)

```swift
let click = cur["clickHighlight"] as? [String: Any] ?? [:]
self.clickHighlightEnabled = click["enabled"] as? Bool ?? false
self.clickHighlightColor = click["color"] as? String ?? "#ffffff"
self.clickHighlightOpacity = click["opacity"] as? Double ?? 0.5
self.clickHighlightSize = click["size"] as? Double ?? 30
```

#### CompositeUniforms — append click fields AFTER `cursorColor` (line 305)

Do NOT touch `_pad3`. Append after `cursorColor`:

```swift
// Click highlight
var hasClick: Float = 0          // 4  (0 or 1)
var clickX: Float = 0            // 4  (normalised 0..1 within screen)
var clickY: Float = 0            // 4
var clickProgress: Float = 0     // 4  (0 = just clicked → 1 = fully faded)
// ---- 16-byte boundary ----
var clickRadius: Float = 0       // 4  (pixels)
var clickOpacity: Float = 0      // 4
var _padClick: SIMD2<Float> = .zero // 8
// ---- 16-byte boundary ----
var clickColor: SIMD4<Float> = .zero // 16
// ---- 16-byte boundary ----
```

Total: 48 bytes, all rows 16-byte aligned.

#### Metal shader struct — mirror new fields after `cursorColor`

```metal
// Click highlight
float  hasClick;
float  clickX;
float  clickY;
float  clickProgress;
float  clickRadius;
float  clickOpacity;
float2 _padClick;
float4 clickColor;
```

#### Metal shader fragment — add click ring rendering AFTER cursor block (after line 532, before `return color`)

Key corrections vs original plan:
- Click position mapped through `scrOrigin + coord * scrSize` (same as cursor)
- Zoom transform applied identically to cursor
- Ring width scales with radius (not hardcoded pixels) for resolution independence
- Use `half` precision for ring math

```metal
// ---- Layer 6: Click highlight ----
if (u.hasClick > 0.5) {
    // Map click to screen-rect pixel space (same as cursor)
    float2 clickPx = scrOrigin + float2(u.clickX, u.clickY) * scrSize;

    // Apply same zoom transform as cursor
    if (u.zoomScale > 1.001) {
        float2 zoomCenter = scrOrigin + float2(u.zoomCenterX, u.zoomCenterY) * scrSize;
        clickPx = zoomCenter + (clickPx - zoomCenter) * u.zoomScale;
    }

    half clickDist = half(length(px - clickPx));
    half expandedRadius = half(u.clickRadius) * (0.5h + half(u.clickProgress) * 0.5h);
    half ringWidth = max(expandedRadius * 0.1h, 1.5h);
    half ring = smoothstep(expandedRadius - ringWidth, expandedRadius, clickDist)
              - smoothstep(expandedRadius, expandedRadius + ringWidth, clickDist);
    half fade = 1.0h - half(u.clickProgress);
    color = mix(color, u.clickColor, float(ring * half(u.clickOpacity) * fade));
}
```

#### renderFrame — add click parameters (line 656 signature)

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
    cursorY: Double? = nil,
    clickX: Double? = nil,
    clickY: Double? = nil,
    clickProgress: Double = 0.0
) throws -> CVPixelBuffer
```

#### Populate click uniforms — after cursor uniform block (~line 745)

```swift
if effects.clickHighlightEnabled, let cx = clickX, let cy = clickY {
    uniforms.hasClick = 1.0
    uniforms.clickX = Float(cx)
    uniforms.clickY = Float(cy)
    uniforms.clickProgress = Float(clickProgress)
    uniforms.clickRadius = Float(effects.clickHighlightSize)
    uniforms.clickOpacity = Float(effects.clickHighlightOpacity)
    uniforms.clickColor = parseHexColor(effects.clickHighlightColor)
}
```

### 2. `RekoEngine/Sources/RekoEngine/export/export-pipeline.swift`

#### Add click detection helper (near `cursorPosition` at ~line 771)

Uses binary search to find the scan start position, then scans backwards within the 300ms window. Mouse events are sorted by `timeMs`.

```swift
private let clickDurationMs: UInt64 = 300

private func activeClick(_ events: [MouseEvt], at timeMs: UInt64) -> (x: Double, y: Double, progress: Double)? {
    guard !events.isEmpty else { return nil }

    // Binary search for last event at or before timeMs
    var lo = 0, hi = events.count - 1
    while lo < hi {
        let mid = (lo + hi + 1) / 2
        if events[mid].timeMs <= timeMs { lo = mid } else { hi = mid - 1 }
    }
    if events[lo].timeMs > timeMs { return nil }

    // Scan backwards from lo within clickDurationMs window
    for i in stride(from: lo, through: 0, by: -1) {
        let e = events[i]
        if timeMs - e.timeMs > clickDurationMs { break }
        if e.type == "click" || e.type == "rightClick" {
            let progress = Double(timeMs - e.timeMs) / Double(clickDurationMs)
            return (e.x, e.y, progress)
        }
    }
    return nil
}
```

#### In frame loop (~line 663, before `compositor.renderFrame` call)

```swift
let click = activeClick(mouseEvents, at: sourceTimeMs)

let composited = try compositor.renderFrame(
    screenPixelBuffer: screenBuffer,
    cameraPixelBuffer: cameraBuffer,
    effects: effects,
    screenWidth: naturalWidth,
    screenHeight: naturalHeight,
    zoomX: zx,
    zoomY: zy,
    zoomScale: zs,
    cursorX: cursorPos?.x,
    cursorY: cursorPos?.y,
    clickX: click?.x,
    clickY: click?.y,
    clickProgress: click?.progress ?? 0.0
)
```

### 3. `RekoEngine/Tests/RekoEngineTests/ExportSequenceTests.swift`

Existing `renderFrame` calls should compile since the new parameters have defaults (`nil`/`0.0`). Verify compilation — no test logic changes expected.

## Key Details
- Mouse events contain `type: "click"` and `type: "rightClick"` (confirmed in `src/types/editor.ts:89` and `src-tauri/src/autozoom.rs:48`)
- Coordinates are normalised 0-1 (fraction of screen width/height)
- Click highlight is independent of `cursor.enabled` — gated only by `clickHighlightEnabled`
- The expanding ring: starts at 50% of configured size, expands to 100% over 300ms while fading out
- Ring width = `max(radius * 0.1, 1.5px)` — scales with output resolution
- Click position goes through the same `scrOrigin + coord * scrSize` mapping and zoom transform as cursor
- CompositeUniforms: new fields appended after `cursorColor`, 48 bytes, all 16-byte aligned
- Shader uses `half` precision for ring math (sufficient for color-space work, halves register pressure)

## Verification
1. `cd RekoEngine && swift build -c release` — must compile
2. `cd RekoEngine && swift test` — tests must pass
3. `cargo build --manifest-path src-tauri/Cargo.toml` — Rust must compile
4. `npx tauri dev` → record a short clip with clicks → export → verify click rings appear at click locations and fade out smoothly
5. Test with `cursor.enabled = false` + `clickHighlight.enabled = true` — clicks should still render
6. Test with `cursor.enabled = true` + `clickHighlight.enabled = true` — both cursor and clicks visible
7. Test at different export resolutions (720p, 1080p, 4K) — ring should look proportionally consistent
