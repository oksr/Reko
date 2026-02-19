# WebGL Compositor + WebCodecs Export — Architecture Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create an implementation plan from this design.

**Goal:** Replace Metal-based preview and export with a unified WebGL compositor. One renderer powers both 60fps preview and hardware-accelerated export. Preview = export, guaranteed.

**Why:** The Metal preview pipeline (decode → Metal render → JPEG encode → IPC → JS decode) cannot achieve 60fps. The previous CSS preview didn't match Metal export output. A single WebGL compositor solves both problems.

**Tech Stack:** WebGL2 (compositing), WebCodecs (decode + encode), mp4box.js (demux), mp4-muxer (mux), fdk-aac-wasm (audio encoding)

**Min macOS:** 15+ (Sequoia) — WebCodecs VideoEncoder requires Safari 18+

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Editor Frontend                        │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │            WebGL Compositor (shared)                │  │
│  │  Background → Screen + Zoom → Camera Bubble        │  │
│  │  → Cursor → Click Animation → Motion Blur          │  │
│  └──────────┬──────────────────────────┬──────────────┘  │
│             │                          │                  │
│     ┌───────▼───────┐         ┌───────▼────────┐        │
│     │ Preview Mode  │         │  Export Mode    │        │
│     │               │         │                 │        │
│     │ <video> elem  │         │ VideoDecoder    │        │
│     │  ↓ texImage2D │         │  (frame-exact)  │        │
│     │ WebGL render  │         │  ↓ texImage2D   │        │
│     │  ↓ screen     │         │ WebGL render    │        │
│     │ 60fps RAF     │         │  ↓ VideoFrame() │        │
│     │               │         │  ↓ VideoEncoder │        │
│     │ <audio> elems │         │  ↓ mp4-muxer    │        │
│     │ (playback)    │         │ + WASM AAC      │        │
│     └───────────────┘         └─────────────────┘        │
│                                                          │
│  No Swift compositor. No IPC per frame.                  │
│  Swift retains: recording, permissions, file I/O         │
└──────────────────────────────────────────────────────────┘
```

**Core principle:** The WebGL compositor doesn't know if it's rendering for preview or export. It receives textures and effect parameters, renders to canvas. The caller decides what happens to the output.

---

## WebGL Compositor

A single TypeScript class managing a WebGL2 context with six shader programs.

### Class API

```typescript
class WebGLCompositor {
  private gl: WebGL2RenderingContext
  private programs: {
    background: WebGLProgram
    video: WebGLProgram
    cameraBubble: WebGLProgram
    cursor: WebGLProgram
    clickRipple: WebGLProgram
    motionBlur: WebGLProgram
  }

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas)
  configure(width: number, height: number): void
  loadBackgroundImage(imageUrl: string, blur: number): Promise<void>

  // Called every frame — both preview and export
  render(frame: {
    screenTexture: WebGLTexture
    cameraTexture?: WebGLTexture
    effects: Effects              // same JSON model as today
    screenWidth: number
    screenHeight: number
    zoom: { x: number, y: number, scale: number }
    cursor?: { x: number, y: number }
    click?: { x: number, y: number, progress: number }
    motionBlur?: { dx: number, dy: number, intensity: number }
  }): void

  // Texture upload from either source
  uploadTexture(source: HTMLVideoElement | VideoFrame): WebGLTexture

  destroy(): void
}
```

### Render Pass Order (back to front)

1. **Background** — solid color, gradient, or pre-blurred image texture
2. **Screen** — textured quad with UV zoom transform, SDF rounded corners, shadow
3. **Camera bubble** — textured quad with SDF circle/rounded-square clip + border
4. **Cursor** — small quad with radial gradient or ring shape
5. **Click ripple** — expanding ring that fades with progress
6. **Motion blur** — full-screen post-process, samples along velocity vector

Layers 1-5 render to a framebuffer texture (FBO). Layer 6 reads that texture and renders to the final canvas. When motion blur is disabled, layers render directly to canvas (skip the extra pass).

### Texture Upload

Both preview and export use the same upload path:

```typescript
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
// source accepts: HTMLVideoElement | VideoFrame — WebGL handles both
```

This is GPU-to-GPU on Safari/WebKit. No CPU readback.

---

## Shader Programs

All shaders share a single vertex shader (fullscreen quad). Each fragment shader handles one layer.

### Shared Vertex Shader (quad.vert)

Renders a fullscreen triangle or quad. Passes UV coordinates to fragment shader. Some shaders receive a model matrix uniform for positioning (camera bubble, cursor, click).

### 1. Background (background.frag)

```
Uniforms:
  u_type: int              // 0=solid, 1=gradient, 2=image
  u_color: vec4            // solid color
  u_gradientFrom: vec4     // gradient start
  u_gradientTo: vec4       // gradient end
  u_gradientAngle: float   // gradient rotation
  u_bgImage: sampler2D     // pre-blurred at load time (not per-frame)
```

Background image blur is applied **once at load time** via multi-pass Gaussian blur to a texture. This matches the current Metal compositor behavior.

### 2. Video / Screen (video.frag)

The most complex shader. Handles:

```
Uniforms:
  u_screen: sampler2D
  u_zoomCenter: vec2       // normalized 0-1
  u_zoomScale: float       // 1.0 = no zoom
  u_borderRadius: float    // pixels
  u_shadowIntensity: float
  u_padding: float         // background padding around video
  u_outputSize: vec2       // output dimensions
  u_screenSize: vec2       // source recording dimensions
```

- **Zoom**: UV transform `uv = (uv - center) / scale + center`
- **Border radius**: SDF rounded rectangle `sdRoundedBox(pos, halfSize, radius)`, discard fragments outside
- **Shadow**: Rendered as separate pass behind video — blurred silhouette of rounded rect. Can use pre-computed shadow texture or separable Gaussian blur pass.
- **Padding**: Video is inset by padding percentage, with background visible around it.

### 3. Camera Bubble (camera-bubble.frag)

```
Uniforms:
  u_camera: sampler2D
  u_position: vec2         // screen-space position
  u_size: float            // diameter as fraction of output
  u_shape: int             // 0=circle, 1=rounded-square
  u_borderWidth: float
  u_borderColor: vec4
```

SDF circle or rounded-square clip. Border rendered by checking `abs(distance) < borderWidth`.

### 4. Cursor (cursor.frag)

```
Uniforms:
  u_cursorPos: vec2        // normalized to screen recording space, transformed through zoom
  u_cursorSize: float
  u_cursorColor: vec4
  u_cursorOpacity: float
  u_cursorType: int        // 0=highlight, 1=ring
```

Small quad positioned at cursor coordinates. Coordinates are transformed through the same zoom transform as the screen video so the cursor tracks correctly during zoom.

### 5. Click Ripple (click-ripple.frag)

```
Uniforms:
  u_clickPos: vec2
  u_clickProgress: float   // 0-1 animation progress
```

Expanding ring: `alpha = smoothstep(outer, inner, distance) * (1.0 - progress)`. Ring radius grows with progress, opacity fades.

### 6. Motion Blur (motion-blur.frag)

```
Uniforms:
  u_scene: sampler2D       // composited frame from FBO
  u_velocity: vec2         // direction + magnitude of motion
  u_samples: int           // 8-16 samples
```

Full-screen post-process pass:
```glsl
vec4 color = vec4(0.0);
for (int i = 0; i < u_samples; i++) {
    vec2 offset = u_velocity * (float(i) / float(u_samples) - 0.5);
    color += texture(u_scene, uv + offset);
}
color /= float(u_samples);
```

For zoom animations, velocity is **radial** from the zoom center — computed analytically from the `zoomScale` delta between current and previous frame. No velocity buffer pass needed since motion vectors are known.

---

## Preview Pipeline

Browser handles everything natively at 60fps:

```
<video> elements ──texImage2D──→ WebGL Compositor ──→ canvas (displayed)
<audio> elements ──────────────→ speakers (synced to timeline)
```

### Flow

1. **On project load**: Create `WebGLCompositor`, set canvas size, load background image texture if configured.
2. **Each `requestAnimationFrame`**:
   - Read current sequence time from editor store
   - Map to source time via existing `sequenceTimeToSourceTime()`
   - `compositor.uploadTexture(videoElement)` — GPU-to-GPU texture upload
   - Compute zoom/cursor/click state at current source time
   - `compositor.render(...)` — renders all layers
   - Browser displays canvas
3. **Scrubbing** (not playing): Seek `<video>` elements to target time, render one frame on `seeked` event.
4. **Playback**: RAF loop advances time via wall-clock delta (existing `usePlaybackClock`), video elements play in sync.

### What changes from current code

- `usePreviewRenderer` hook: remove all Tauri `invoke` calls, create and drive `WebGLCompositor` directly
- No IPC per frame, no JPEG encode/decode, no Swift involvement
- Video elements stay in the DOM (hidden) as texture sources, not for display
- Audio playback unchanged — hidden `<audio>` elements synced to sequence time

### Performance

`texImage2D` from a playing `<video>` is hardware-accelerated on Safari/WebKit. The entire pipeline (texture upload → WebGL render → display) stays on GPU. Expected: **solid 60fps**.

---

## Export Pipeline

Frame-accurate, faster-than-realtime, all in browser:

```
Source files              Compositing             Encoding            Output
┌──────────┐ VideoDecoder ┌──────────┐ VideoFrame ┌──────────┐
│ screen   │→ mp4box.js →│  WebGL   │→ (canvas) →│ Video    │
│ .mov     │  demux+dec  │ Composi- │  ~1ms      │ Encoder  │
├──────────┤             │ tor      │            │ (H.264)  │
│ camera   │→ demux+dec →│          │            └────┬─────┘
│ .mov     │             └──────────┘                 │
├──────────┤                                          │
│ mic.wav  │→ decodeAudioData()                       │
│          │  → trim per sequence                     │  mp4-muxer
│          │  → WASM AAC encoder ──────────────────→  ├─────────→ final.mp4
├──────────┤                                          │
│ sys.wav  │→ same as mic ─────────────────────────→  │
└──────────┘
```

### Step-by-step

**1. Demux source video** — `mp4box.js` reads the .mov/.mp4 file, extracts raw encoded packets (H.264/HEVC NAL units) without decoding. Provides `EncodedVideoChunk`-compatible data with precise timestamps.

**2. Decode frames** — `VideoDecoder` decodes each chunk sequentially. Produces `VideoFrame` objects with exact PTS. For trimmed clips, seek to nearest keyframe and decode forward to the target frame.

**3. Render** — For each frame in the sequence (respecting clips, speed, transitions):
  - Upload decoded `VideoFrame` as WebGL texture via `compositor.uploadTexture(videoFrame)`
  - Compute interpolated zoom/cursor/click state at this frame's timestamp
  - `compositor.render(...)` — same compositor, same shaders as preview
  - `new VideoFrame(canvas)` captures composited output (~1ms, GPU-resident)

**4. Encode video** — `VideoEncoder` encodes the composited `VideoFrame` to H.264 via hardware VideoToolbox. Produces `EncodedVideoChunk` objects. Configure with target bitrate, profile, etc.

**5. Encode audio** — In parallel with video:
  - `AudioContext.decodeAudioData()` decodes WAV/M4A source files to `AudioBuffer`
  - Trim and rearrange PCM samples per sequence clips (in/out points, speed)
  - Mix mic + system audio tracks (sum with gain control)
  - Feed final PCM to `fdk-aac-wasm` encoder → produces raw AAC frames

**6. Mux** — `mp4-muxer` JS library combines encoded video chunks + encoded audio frames into a single .mp4 file. Written to disk via Tauri `fs` plugin.

### Speed estimate at 1080p

| Step | Time per frame | Notes |
|------|---------------|-------|
| Demux | <0.1ms | Just reading packets, no decoding |
| Decode | ~1ms | Hardware VideoDecoder |
| WebGL render | ~2ms | GPU compositing |
| VideoFrame capture | ~1ms | GPU-resident, zero-copy |
| Encode | ~2ms | Hardware VideoToolbox |
| **Total** | **~6ms/frame** | **~160fps throughput** |

A 10-minute video at 30fps = 18,000 frames → ~108 seconds (~1.8 min) export time.

Audio encoding runs in parallel and is faster than video, so it doesn't add to total time.

### Sequence-aware frame iteration

The export pipeline iterates through the sequence model, not the raw source video:

```typescript
for (const clip of sequence.clips) {
  const sourceStartMs = clip.sourceOffset
  const sourceEndMs = clip.sourceOffset + (clip.durationMs / clip.speed)
  const frameInterval = 1000 / outputFps

  for (let t = sourceStartMs; t < sourceEndMs; t += frameInterval / clip.speed) {
    const sourceFrame = await decoder.getFrameAt(t)
    const zoomState = interpolateZoomEvents(clip.zoomEvents, t)
    const cursor = getCursorAt(mouseEvents, t)
    // ... render, capture, encode
  }
}
```

Transitions between clips: cross-fade by rendering both clips' frames and blending in the shader with a transition alpha uniform.

---

## Motion Blur

For zoom animations, motion blur is computed analytically (no velocity buffer needed):

1. **Compute velocity** from zoom delta:
   ```typescript
   const prevZoom = interpolateZoom(events, t - dt)
   const currZoom = interpolateZoom(events, t)
   const velocity = {
     dx: (currZoom.x - prevZoom.x) * currZoom.scale,
     dy: (currZoom.y - prevZoom.y) * currZoom.scale,
     intensity: Math.abs(currZoom.scale - prevZoom.scale) / prevZoom.scale
   }
   ```

2. **Pass to motion blur shader** — velocity vector determines blur direction and magnitude

3. **Radial component** — when zooming in/out, blur radiates from the zoom center. The shader applies radial blur proportional to `intensity`:
   ```glsl
   vec2 toCenter = uv - u_zoomCenter;
   vec2 radialVelocity = toCenter * u_intensity;
   // Sample along radialVelocity
   ```

This produces film-quality directional motion blur that responds to both pan (directional) and zoom (radial) simultaneously.

---

## File Structure

### New files

```
src/
  lib/
    webgl-compositor/
      compositor.ts            # WebGLCompositor class
      shaders/
        quad.vert              # Shared fullscreen quad vertex shader
        background.frag        # Solid/gradient/image background
        video.frag             # Screen recording + zoom + border-radius + shadow
        camera-bubble.frag     # Camera bubble with SDF clip + border
        cursor.frag            # Cursor highlight/ring
        click-ripple.frag      # Click animation
        motion-blur.frag       # Post-process velocity blur
      shader-utils.ts          # Compile, link, uniform helpers
    export/
      export-pipeline.ts       # Orchestrates demux → decode → render → encode → mux
      video-decoder.ts         # mp4box.js demux + VideoDecoder wrapper
      video-encoder.ts         # VideoEncoder + EncodedVideoChunk management
      audio-encoder.ts         # Web Audio decode + WASM AAC encode
      muxer.ts                 # mp4-muxer wrapper — combines video + audio → .mp4
  hooks/
    use-preview-renderer.ts    # Rewritten — WebGL compositor instead of Tauri invoke
    use-playback-clock.ts      # Keep as-is
    use-export.ts              # New — drives export pipeline, reports progress
```

### Modified files

```
src/
  components/editor/
    preview-canvas.tsx         # Canvas becomes WebGL canvas, remove Tauri invoke
  editor-app.tsx               # Wire up new export, remove Metal export invokes
src-tauri/
  src/commands/
    preview.rs                 # DELETE
    export.rs                  # Simplify to file I/O only (no Swift render calls)
  src/swift_ffi.rs             # Remove preview + export FFI wrappers
  src/lib.rs                   # Remove preview + export command registrations
```

### Unchanged files

```
src/
  stores/editor-store.ts       # Effects model unchanged
  lib/sequence.ts              # Time mapping unchanged
  types/editor.ts              # Types unchanged
RekoEngine/
  Sources/RekoEngine/
    capture/                    # Recording stays in Swift
    recording/                  # Recording stays in Swift
```

### New npm dependencies

```
mp4box       # ~80KB  — demux source videos for VideoDecoder
mp4-muxer    # ~50KB  — mux encoded video + audio into .mp4
fdk-aac-wasm # ~200KB — AAC audio encoding
```

---

## What Swift/Rust Retains

After migration, Swift handles only:
- **Screen recording** — ScreenCaptureKit capture, AVAssetWriter for raw tracks
- **Microphone/system audio recording** — AVAudioEngine, raw WAV/M4A output
- **Camera recording** — AVCaptureSession, raw video output
- **Mouse event logging** — CGEvent tap, NDJSON output
- **Permissions** — screen recording, microphone, camera permission checks

Rust/Tauri handles only:
- **Project file I/O** — read/write project.json, manage project directories
- **Autozoom generation** — mouse click analysis for auto zoom keyframes
- **Window management** — Tauri window creation, global shortcuts
- **File dialogs** — save location picker for export

All rendering, compositing, and video encoding moves to the frontend.

---

## What Gets Deleted (After Migration)

```
RekoEngine/Sources/RekoEngine/
  preview/preview-renderer.swift     # Replaced by WebGL compositor
  export/export-pipeline.swift       # Replaced by web export pipeline
  export/metal-compositor.swift      # Replaced by WebGL shaders
  export/metal-compositor.metal      # Replaced by GLSL shaders
  export/audio-mixer.swift           # Replaced by Web Audio + WASM AAC
  export/video-decoder.swift         # Replaced by WebCodecs VideoDecoder
src-tauri/src/commands/
  preview.rs                         # Deleted entirely
  export.rs                          # Gutted to file I/O only
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Safari WebCodecs VideoEncoder bugs | Test on multiple macOS 15.x versions early. Keep Swift export as fallback until validated. |
| `fdk-aac-wasm` issues in WKWebView | Test early. Fallback: ship minimal ffmpeg sidecar (~15MB) for audio encoding + muxing only. |
| WebGL shader parity with Metal | Visual regression tests: render same frame in both, pixel-diff. Catch drift before deleting Metal code. |
| Memory pressure on long exports | Process frames in batches, `VideoFrame.close()` eagerly, monitor memory via `performance.memory`. |
| `mp4box.js` demuxing edge cases | Test with all source formats (H.264, HEVC, ProRes from ScreenCaptureKit). Fallback: use ffmpeg for demuxing only. |

---

## Migration Strategy

Incremental — each step is independently testable and shippable:

1. **WebGL Compositor** — build and test with static images, then video textures. Unit test shader outputs.
2. **Preview pipeline** — replace Metal preview with WebGL. Validate 60fps, visual correctness.
3. **Export video encoding** — VideoDecoder + WebGL + VideoEncoder, output video-only .mp4. Compare with Metal export frame-by-frame.
4. **Export audio** — WASM AAC encoder, merge with video via mp4-muxer. Validate A/V sync.
5. **Motion blur** — add post-process shader, wire up velocity from zoom deltas.
6. **Cleanup** — delete Swift export/preview code, remove Rust FFI wrappers, remove unused dependencies.

Each step can be tested against the existing Metal pipeline for correctness before moving forward. Metal code is deleted only after the web pipeline is fully validated.
