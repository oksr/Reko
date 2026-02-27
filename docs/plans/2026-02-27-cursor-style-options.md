# Cursor Style Options Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to choose from 8 preset cursor icons and control cursor size, replacing the system cursor baked into recordings with a custom-rendered one.

**Architecture:** Disable `showsCursor` in ScreenCaptureKit so new recordings exclude the system cursor. Add cursor icon textures to the WebGL compositor, rendered as textured quads at the tracked mouse position. A new `icon` field in `CursorConfig` selects the preset, and the existing `size` slider controls both icon size and highlight/spotlight effect radius.

**Tech Stack:** WebGL2 (textured quad shader), TypeScript, Rust (serde), Swift (ScreenCaptureKit), React (inspector UI)

---

### Task 1: Disable system cursor in ScreenCaptureKit

**Files:**
- Modify: `RekoEngine/Sources/RekoEngine/capture/screen-capture.swift:187,229`

**Step 1: Change showsCursor to false**

In `screen-capture.swift`, change both occurrences of `config.showsCursor = true` to `config.showsCursor = false`:

Line 187 (in `startCapture`):
```swift
config.showsCursor = false
```

Line 229 (in `startWindowCapture`):
```swift
config.showsCursor = false
```

**Step 2: Build Swift framework to verify**

Run: `cd RekoEngine && swift build -c release`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add RekoEngine/Sources/RekoEngine/capture/screen-capture.swift
git commit -m "feat(capture): disable system cursor in recordings for custom cursor rendering"
```

---

### Task 2: Update data model (TypeScript + Rust)

**Files:**
- Modify: `apps/app/src/types/editor.ts:149-156`
- Modify: `apps/tauri/src-tauri/src/project.rs:79-99`

**Step 1: Add CursorIcon type and icon field to TypeScript**

In `apps/app/src/types/editor.ts`, add the `CursorIcon` type before `CursorConfig` and add the `icon` field:

```typescript
export type CursorIcon =
  | "macos-default"
  | "macos-inverted"
  | "classic-mac"
  | "windows-default"
  | "circle-dot"
  | "crosshair"
  | "minimal-arrow"
  | "rounded-pointer"

export const CURSOR_ICONS: { id: CursorIcon; label: string }[] = [
  { id: "macos-default", label: "macOS Default" },
  { id: "macos-inverted", label: "macOS Inverted" },
  { id: "classic-mac", label: "Classic Mac" },
  { id: "windows-default", label: "Windows" },
  { id: "circle-dot", label: "Circle" },
  { id: "crosshair", label: "Crosshair" },
  { id: "minimal-arrow", label: "Minimal" },
  { id: "rounded-pointer", label: "Rounded" },
]

export interface CursorConfig {
  enabled: boolean
  icon: CursorIcon
  type: "highlight" | "spotlight"
  size: number        // cursor icon size in px (16-64), effect radius derived as size * 1.5
  color: string       // hex, used for highlight ring
  opacity: number     // 0-1
  clickHighlight: ClickHighlightConfig
}
```

**Step 2: Add cursor_icon field to Rust CursorConfig**

In `apps/tauri/src-tauri/src/project.rs`, add a default function and the field to `CursorConfig`:

After line 6 (`fn default_one() -> f64 { 1.0 }`), add:
```rust
fn default_cursor_icon() -> String { "macos-default".to_string() }
```

In the `CursorConfig` struct, add between `enabled` and `cursor_type`:
```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CursorConfig {
    pub enabled: bool,
    #[serde(default = "default_cursor_icon")]
    pub icon: String,                 // cursor preset id
    #[serde(rename = "type")]
    pub cursor_type: String,
    pub size: f64,
    pub color: String,
    pub opacity: f64,
    #[serde(default)]
    pub click_highlight: Option<ClickHighlightConfig>,
}
```

**Step 3: Run Rust tests**

Run: `cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml`
Expected: All tests pass (existing tests with cursor configs will need `icon` field added, but `serde(default)` handles deserialization of old data).

**Step 4: Commit**

```bash
git add apps/app/src/types/editor.ts apps/tauri/src-tauri/src/project.rs
git commit -m "feat(cursor): add CursorIcon type and icon field to CursorConfig"
```

---

### Task 3: Update all three default locations

**Files:**
- Modify: `apps/app/src/stores/editor-store.ts:37-49`
- Modify: `apps/app/src/editor-app.tsx:137-149`

**Step 1: Update DEFAULT_EFFECTS in editor-store.ts**

Change the `cursor` section in `DEFAULT_EFFECTS` (lines 37-49):

```typescript
cursor: {
  enabled: false,
  icon: "macos-default",
  type: "highlight",
  size: 32,
  color: "#ffcc00",
  opacity: 0.6,
  clickHighlight: {
    enabled: true,
    color: "#ffffff",
    opacity: 0.5,
    size: 30,
  },
},
```

**Step 2: Update fallback defaults in editor-app.tsx**

Change the cursor fallback (lines 137-149):

```typescript
cursor: {
  enabled: false,
  icon: "macos-default",
  type: "highlight",
  size: 32,
  color: "#facc15",
  opacity: 0.5,
  clickHighlight: {
    enabled: true,
    color: "#ffffff",
    opacity: 0.5,
    size: 30,
  },
},
```

**Step 3: Run frontend tests**

Run: `pnpm --filter @reko/app test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add apps/app/src/stores/editor-store.ts apps/app/src/editor-app.tsx
git commit -m "feat(cursor): update default cursor config with icon field and new size range"
```

---

### Task 4: Create cursor icon PNG assets

**Files:**
- Create: `apps/app/src/assets/cursors/macos-default.png`
- Create: `apps/app/src/assets/cursors/macos-inverted.png`
- Create: `apps/app/src/assets/cursors/classic-mac.png`
- Create: `apps/app/src/assets/cursors/windows-default.png`
- Create: `apps/app/src/assets/cursors/circle-dot.png`
- Create: `apps/app/src/assets/cursors/crosshair.png`
- Create: `apps/app/src/assets/cursors/minimal-arrow.png`
- Create: `apps/app/src/assets/cursors/rounded-pointer.png`

**Step 1: Create the cursors directory**

```bash
mkdir -p apps/app/src/assets/cursors
```

**Step 2: Create cursor PNGs**

Each cursor PNG should be:
- 64x64 pixels (renders at the max size, downscaled for smaller settings)
- Transparent background (RGBA PNG)
- White/light design with a dark outline/shadow for visibility on any background
- Hotspot at top-left for arrow cursors, center for circle/crosshair

The PNGs need to be sourced or created. For now, create placeholder cursors programmatically using a canvas-based script, or source them from open-source cursor sets. The important thing is that they are 64x64 RGBA PNGs.

**NOTE FOR IMPLEMENTER:** This task requires creating actual cursor images. Options:
1. Use macOS system cursor images extracted programmatically
2. Create simple SVG cursors and convert to PNG
3. Source from an open-source cursor icon set

The simplest approach: create a small Node script or use ImageMagick to generate the geometric cursors (circle-dot, crosshair) and use screenshots/exports of system cursors for the realistic ones.

**Step 3: Create an index file for cursor assets**

Create `apps/app/src/assets/cursors/index.ts`:

```typescript
import macosDefault from "./macos-default.png"
import macosInverted from "./macos-inverted.png"
import classicMac from "./classic-mac.png"
import windowsDefault from "./windows-default.png"
import circleDot from "./circle-dot.png"
import crosshair from "./crosshair.png"
import minimalArrow from "./minimal-arrow.png"
import roundedPointer from "./rounded-pointer.png"
import type { CursorIcon } from "@/types/editor"

export const CURSOR_ICON_ASSETS: Record<CursorIcon, string> = {
  "macos-default": macosDefault,
  "macos-inverted": macosInverted,
  "classic-mac": classicMac,
  "windows-default": windowsDefault,
  "circle-dot": circleDot,
  "crosshair": crosshair,
  "minimal-arrow": minimalArrow,
  "rounded-pointer": roundedPointer,
}
```

**Step 4: Commit**

```bash
git add apps/app/src/assets/cursors/
git commit -m "feat(cursor): add preset cursor icon PNG assets"
```

---

### Task 5: Add cursor icon shader and texture rendering to compositor

**Files:**
- Create: `apps/app/src/lib/webgl-compositor/shaders/cursor-icon.frag`
- Modify: `apps/app/src/lib/webgl-compositor/compositor.ts`

**Step 1: Create the cursor icon fragment shader**

Create `apps/app/src/lib/webgl-compositor/shaders/cursor-icon.frag`:

```glsl
#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_cursorIcon;
uniform vec2 u_cursorPos;       // center position in canvas UV
uniform vec2 u_cursorSize;      // width, height in canvas UV
uniform float u_canvasAspect;
uniform float u_hasCursorIcon;

void main() {
  fragColor = vec4(0.0);
  if (u_hasCursorIcon < 0.5) return;

  // Convert canvas UV to cursor-local UV
  // The cursor quad is positioned with its top-left at the cursor position
  // (hotspot at top-left for arrow cursors)
  vec2 offset = v_uv - u_cursorPos;
  offset.x *= u_canvasAspect;

  vec2 sizeAspect = u_cursorSize;
  sizeAspect.x *= u_canvasAspect;

  vec2 localUV = offset / sizeAspect;

  // Discard pixels outside the cursor quad
  if (localUV.x < 0.0 || localUV.x > 1.0 || localUV.y < 0.0 || localUV.y > 1.0) return;

  fragColor = texture(u_cursorIcon, localUV);
}
```

**Step 2: Add cursor icon texture and program to compositor**

In `apps/app/src/lib/webgl-compositor/compositor.ts`:

Add import at top (after other shader imports):
```typescript
import cursorIconFrag from "./shaders/cursor-icon.frag"
```

Add to class fields (after `private motionBlurProgram!: WebGLProgram`):
```typescript
private cursorIconProgram!: WebGLProgram
private cursorIconTexture: WebGLTexture | null = null
private currentCursorIcon: string | null = null
```

Add to `initPrograms()` (after `this.motionBlurProgram = ...`):
```typescript
this.cursorIconProgram = linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, cursorIconFrag))
```

Add to `destroy()` (after `gl.deleteProgram(this.motionBlurProgram)`):
```typescript
gl.deleteProgram(this.cursorIconProgram)
if (this.cursorIconTexture) gl.deleteTexture(this.cursorIconTexture)
```

**Step 3: Add loadCursorIcon method**

```typescript
async loadCursorIcon(imageUrl: string): Promise<void> {
  if (this.currentCursorIcon === imageUrl) return
  try {
    const img = new Image()
    img.crossOrigin = "anonymous"
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`Failed to load cursor icon: ${imageUrl}`))
      img.src = imageUrl
    })
    this.cursorIconTexture = this.uploadToTexture(this.cursorIconTexture, img)
    this.currentCursorIcon = imageUrl
  } catch (err) {
    console.warn("[WebGLCompositor] Cursor icon load failed:", err)
  }
}
```

**Step 4: Add renderCursorIcon method**

```typescript
private renderCursorIcon(
  scrRect: NRect,
  zoomScale: number,
  cursor: { x: number; y: number },
  cursorSizePx: number
): void {
  const gl = this.gl
  if (!this.cursorIconTexture) return
  gl.useProgram(this.cursorIconProgram)

  // Position: cursor UV maps into the zoomed screen rect
  const cx = scrRect.x + cursor.x * scrRect.w
  const cy = scrRect.y + cursor.y * scrRect.h

  // Size: convert pixel size to canvas UV space
  const sizeUV = cursorSizePx / this.canvasHeight * zoomScale

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, this.cursorIconTexture)
  gl.uniform1i(this.u(this.cursorIconProgram, "u_cursorIcon"), 0)
  gl.uniform1f(this.u(this.cursorIconProgram, "u_hasCursorIcon"), 1.0)
  gl.uniform2f(this.u(this.cursorIconProgram, "u_cursorPos"), cx, cy)
  gl.uniform2f(this.u(this.cursorIconProgram, "u_cursorSize"), sizeUV, sizeUV)
  gl.uniform1f(this.u(this.cursorIconProgram, "u_canvasAspect"), this.canvasWidth / this.canvasHeight)

  gl.drawArrays(gl.TRIANGLES, 0, 3)
}
```

**Step 5: Update render() method to draw cursor icon**

In the `render()` method, add cursor icon rendering BEFORE the cursor highlight/spotlight (between screen and cursor layers). Update the cursor section (around lines 148-151):

```typescript
// Layer 2: Cursor icon (custom cursor image)
if (effects.cursor.enabled && cursor && this.cursorIconTexture) {
  this.renderCursorIcon(zoomedScrRect, zoom.scale, cursor, effects.cursor.size)
}

// Layer 3: Cursor highlight/spotlight effect
if (effects.cursor.enabled && cursor) {
  this.renderCursor(effects, zoomedScrRect, zoom.scale, cursor, cursorVelocity ?? null)
}
```

**Step 6: Update renderCursor to use derived effect radius**

In `renderCursor()`, change the radius uniform (line 300) to derive from cursor size:

```typescript
gl.uniform1f(this.u(this.cursorProgram, "u_cursorRadius"), effects.cursor.size * 1.5 / this.canvasHeight * zoomScale)
```

**Step 7: Commit**

```bash
git add apps/app/src/lib/webgl-compositor/shaders/cursor-icon.frag apps/app/src/lib/webgl-compositor/compositor.ts
git commit -m "feat(cursor): add cursor icon texture rendering to WebGL compositor"
```

---

### Task 6: Wire cursor icon loading into preview renderer

**Files:**
- Modify: `apps/app/src/hooks/use-preview-renderer.ts`

**Step 1: Import cursor icon assets**

Add at top of `use-preview-renderer.ts`:
```typescript
import { CURSOR_ICON_ASSETS } from "@/assets/cursors"
import type { CursorIcon } from "@/types/editor"
```

**Step 2: Load cursor icon texture when icon setting changes**

Add a `useEffect` after the background image loading effect (after line 232):

```typescript
// Load cursor icon texture when cursor icon changes
useEffect(() => {
  const compositor = compositorRef.current
  if (!compositor || !effects?.cursor.icon) return

  const iconUrl = CURSOR_ICON_ASSETS[effects.cursor.icon as CursorIcon]
  if (!iconUrl) return

  compositor.loadCursorIcon(iconUrl)
    .then(() => {
      renderFrame(useEditorStore.getState().currentTime)
    })
    .catch(() => {})
}, [effects?.cursor.icon, renderFrame])
```

**Step 3: Commit**

```bash
git add apps/app/src/hooks/use-preview-renderer.ts
git commit -m "feat(cursor): load cursor icon texture in preview renderer"
```

---

### Task 7: Wire cursor icon loading into export pipeline

**Files:**
- Modify: `apps/app/src/lib/export/export-pipeline.ts`

**Step 1: Import cursor icon assets**

Add at top:
```typescript
import { CURSOR_ICON_ASSETS } from "@/assets/cursors"
import type { CursorIcon } from "@/types/editor"
```

**Step 2: Load cursor icon before export rendering loop**

In the export pipeline's setup phase (before the frame rendering loop begins), add cursor icon loading:

```typescript
// Load cursor icon if cursor effects are enabled
if (project.effects.cursor.enabled && project.effects.cursor.icon) {
  const iconUrl = CURSOR_ICON_ASSETS[project.effects.cursor.icon as CursorIcon]
  if (iconUrl) {
    await this.compositor.loadCursorIcon(iconUrl)
  }
}
```

**Step 3: Commit**

```bash
git add apps/app/src/lib/export/export-pipeline.ts
git commit -m "feat(cursor): load cursor icon texture in export pipeline"
```

---

### Task 8: Update cursor panel UI with icon picker

**Files:**
- Modify: `apps/app/src/components/editor/inspector/cursor-panel.tsx`

**Step 1: Add cursor icon picker grid**

Replace the contents of `cursor-panel.tsx`:

```typescript
import { MousePointer2 } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import { CURSOR_ICONS, type CursorIcon } from "@/types/editor"
import { CURSOR_ICON_ASSETS } from "@/assets/cursors"
import { SegmentedControl } from "./segmented-control"
import { StyledSlider } from "./styled-slider"
import { ToggleSwitch } from "./toggle-switch"

export function CursorPanel() {
  const cursor = useEditorStore((s) => s.project?.effects.cursor)
  const hasMouseEvents = useEditorStore((s) => !!s.project?.tracks.mouse_events)
  const setCursor = useEditorStore((s) => s.setCursor)
  const setClickHighlight = useEditorStore((s) => s.setClickHighlight)

  if (!cursor) return null

  const clickHighlight = cursor.clickHighlight

  return (
    <>
      {/* Cursor section */}
      <div className="px-4 pt-4 pb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <MousePointer2 className="size-3.5 text-white/60 shrink-0" />
            <span className="text-[13px] font-semibold text-white leading-none">Cursor</span>
          </div>
          {hasMouseEvents && (
            <ToggleSwitch checked={cursor.enabled} onChange={(v) => setCursor({ enabled: v })} />
          )}
        </div>

        {!hasMouseEvents && (
          <p className="text-[12px] text-white/30 leading-relaxed">
            Re-record with Accessibility permission enabled.
          </p>
        )}

        {hasMouseEvents && cursor.enabled && (
          <>
            {/* Cursor icon picker */}
            <div className="space-y-2">
              <span className="text-[11px] text-white/40">Style</span>
              <div className="grid grid-cols-4 gap-2">
                {CURSOR_ICONS.map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => setCursor({ icon: id })}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-colors ${
                      cursor.icon === id
                        ? "border-white/30 bg-white/[0.08]"
                        : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"
                    }`}
                  >
                    <img
                      src={CURSOR_ICON_ASSETS[id]}
                      alt={label}
                      className="size-6 object-contain"
                    />
                    <span className="text-[10px] text-white/50 leading-none">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Size slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/40">Size</span>
                <span className="text-[11px] tabular-nums">{cursor.size}px</span>
              </div>
              <StyledSlider min={16} max={64} step={1} value={cursor.size} onChange={(v) => setCursor({ size: v })} />
            </div>

            {/* Highlight/Spotlight effect */}
            <div className="border-t border-white/[0.07] pt-4 space-y-4">
              <span className="text-[11px] text-white/40 font-medium">Effect</span>
              <SegmentedControl
                options={[
                  { value: "highlight", label: "Highlight" },
                  { value: "spotlight", label: "Spotlight" },
                ]}
                value={cursor.type}
                onChange={(v) => setCursor({ type: v })}
              />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/40">Opacity</span>
                  <span className="text-[11px] tabular-nums">{Math.round(cursor.opacity * 100)}%</span>
                </div>
                <StyledSlider min={0} max={100} step={5} value={cursor.opacity * 100} onChange={(v) => setCursor({ opacity: v / 100 })} />
              </div>

              {cursor.type === "highlight" && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/40">Color</span>
                  <input
                    type="color"
                    value={cursor.color}
                    onChange={(e) => setCursor({ color: e.target.value })}
                    className="w-9 h-9 rounded-[8px] cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Click highlight section */}
      {hasMouseEvents && (
        <>
          <div className="border-t border-white/[0.07] mx-4" />
          <div className="px-4 pt-4 pb-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-white leading-none">Click highlight</span>
              <ToggleSwitch
                checked={!!clickHighlight?.enabled}
                onChange={(v) => setClickHighlight({ enabled: v })}
              />
            </div>

            {clickHighlight?.enabled && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">Ring size</span>
                    <span className="text-[11px] tabular-nums">{clickHighlight.size}px</span>
                  </div>
                  <StyledSlider min={5} max={100} step={1} value={clickHighlight.size} onChange={(v) => setClickHighlight({ size: v })} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/40">Opacity</span>
                    <span className="text-[11px] tabular-nums">{Math.round(clickHighlight.opacity * 100)}%</span>
                  </div>
                  <StyledSlider min={0} max={100} step={5} value={clickHighlight.opacity * 100} onChange={(v) => setClickHighlight({ opacity: v / 100 })} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/40">Color</span>
                  <input
                    type="color"
                    value={clickHighlight.color}
                    onChange={(e) => setClickHighlight({ color: e.target.value })}
                    className="w-9 h-9 rounded-[8px] cursor-pointer border border-white/[0.08] bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
```

**Step 2: Run lint**

Run: `pnpm --filter @reko/app lint`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/app/src/components/editor/inspector/cursor-panel.tsx
git commit -m "feat(cursor): add icon picker grid and updated controls to cursor panel"
```

---

### Task 9: Update Rust test fixtures

**Files:**
- Modify: `apps/tauri/src-tauri/src/project.rs:334-348`

**Step 1: Add icon field to cursor config test**

Update `test_cursor_config_serialization` to include the `icon` field:

```rust
#[test]
fn test_cursor_config_serialization() {
    let config = CursorConfig {
        enabled: true,
        icon: "macos-default".to_string(),
        cursor_type: "highlight".to_string(),
        size: 32.0,
        color: "#ffcc00".to_string(),
        opacity: 0.6,
        click_highlight: None,
    };
    let json = serde_json::to_string(&config).unwrap();
    assert!(json.contains("\"type\":\"highlight\""));
    assert!(json.contains("\"icon\":\"macos-default\""));
    let parsed: CursorConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.icon, "macos-default");
}
```

**Step 2: Add test for deserializing old cursor config without icon field**

```rust
#[test]
fn test_cursor_config_without_icon_defaults() {
    let json = r#"{"enabled":true,"type":"highlight","size":40,"color":"#ffcc00","opacity":0.6}"#;
    let parsed: CursorConfig = serde_json::from_str(json).unwrap();
    assert_eq!(parsed.icon, "macos-default");
}
```

**Step 3: Run Rust tests**

Run: `cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml`
Expected: All tests pass

**Step 4: Commit**

```bash
git add apps/tauri/src-tauri/src/project.rs
git commit -m "test(cursor): update Rust test fixtures for cursor icon field"
```

---

### Task 10: End-to-end verification

**Step 1: Build the full app**

Run: `pnpm dev`

**Step 2: Verify in the editor**

1. Open an existing project in the editor
2. Go to the Cursor tab in the inspector
3. Verify the icon picker grid shows 8 cursor presets
4. Verify selecting a cursor icon updates the preview
5. Verify the size slider (16-64px) controls both icon and effect size
6. Verify highlight/spotlight effects still work on top of the cursor icon
7. Verify click ripple still works

**Step 3: Verify export**

1. Export a short clip with cursor effects enabled
2. Verify the cursor icon appears in the exported video
3. Verify effects (highlight/spotlight) render correctly in export

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `RekoEngine/.../screen-capture.swift` | Modify | `showsCursor = false` |
| `apps/app/src/types/editor.ts` | Modify | Add `CursorIcon` type, `icon` field, `CURSOR_ICONS` |
| `apps/tauri/src-tauri/src/project.rs` | Modify | Add `icon` field to Rust `CursorConfig` |
| `apps/app/src/stores/editor-store.ts` | Modify | Update `DEFAULT_EFFECTS` cursor defaults |
| `apps/app/src/editor-app.tsx` | Modify | Update fallback cursor defaults |
| `apps/app/src/assets/cursors/*.png` | Create | 8 cursor icon PNGs |
| `apps/app/src/assets/cursors/index.ts` | Create | Asset map from icon ID → import path |
| `apps/app/src/lib/webgl-compositor/shaders/cursor-icon.frag` | Create | Textured quad shader for cursor icon |
| `apps/app/src/lib/webgl-compositor/compositor.ts` | Modify | Cursor icon program, texture, render method |
| `apps/app/src/hooks/use-preview-renderer.ts` | Modify | Load cursor icon texture on icon change |
| `apps/app/src/lib/export/export-pipeline.ts` | Modify | Load cursor icon before export render loop |
| `apps/app/src/components/editor/inspector/cursor-panel.tsx` | Modify | Icon picker grid + updated layout |
