# CaptureKit — macOS Screen Recording Tool Blueprint

> A ScreenStudio-style desktop screen recording and editing app built with Tauri.
> macOS-first. Captures screen, camera, and audio. Edits with auto-zoom, backgrounds, and overlays. Exports with VideoToolbox hardware acceleration.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture](#2-architecture)
3. [Module Design](#3-module-design)
   - 3.1 Capture Engine
   - 3.2 Recording Encoder
   - 3.3 Editor & Compositor (Frontend)
   - 3.4 Auto-Zoom Engine
   - 3.5 Export Pipeline (VideoToolbox + Metal)
4. [Data Model](#4-data-model)
5. [IPC Contract](#5-ipc-contract)
6. [File & Project Structure](#6-file--project-structure)
7. [macOS Platform Details](#7-macos-platform-details)
8. [Performance Targets](#8-performance-targets)
9. [Development Phases](#9-development-phases)
10. [Risk Register](#10-risk-register)
11. [Dependency Inventory](#11-dependency-inventory)
12. [Appendix: Key Code Sketches](#12-appendix-key-code-sketches)

---

## 1. Product Overview

### Vision

A local-first macOS app that lets creators record their screen, camera, and microphone — then produce polished, studio-quality video exports with smooth zoom animations, cursor effects, camera overlays, and styled backgrounds. No cloud dependency. Hardware-accelerated exports via Apple Silicon / VideoToolbox.

### Core User Flow

```
[Select sources] → [Record] → [Edit in timeline] → [Export] → [Share]
```

### Feature Set

| Feature | Priority | Description |
|---------|----------|-------------|
| Screen capture | P0 | Full screen or single window via ScreenCaptureKit |
| Microphone audio | P0 | Record mic input |
| System audio | P0 | Capture desktop audio via ScreenCaptureKit |
| Camera overlay | P1 | Webcam feed as circular/rounded bubble |
| Timeline editor | P0 | Trim, cut, split clips |
| Auto-zoom | P1 | Click-driven zoom keyframes with easing |
| Backgrounds | P1 | Gradients, images, device frames around recording |
| Cursor effects | P2 | Highlight, enlarge, spotlight cursor |
| HW-accelerated export | P0 | VideoToolbox encoding, Metal compositing |
| Multiple export formats | P2 | MP4 (H.264/H.265), ProRes, GIF |
| Intro/outro | P3 | Title cards and end screens |

### Target Platform

- **macOS 14.0+ (Sonoma)**
- Apple Silicon primary, Intel supported
- Distributed as DMG (outside App Store initially to avoid sandbox restrictions)

Why macOS 14+: Stable ScreenCaptureKit API with audio capture, presenter overlay support, and better permission UX. Covers ~85%+ of active macOS users.

---

## 2. Architecture

### High-Level Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        Tauri App Shell                        │
│                                                              │
│  ┌────────────────────┐       ┌────────────────────────────┐ │
│  │   Rust Backend      │◄─IPC─►│   WebView Frontend         │ │
│  │                    │       │   (React + TypeScript)      │ │
│  │  ┌──────────────┐ │       │                            │ │
│  │  │ Screen       │ │       │  ┌────────────────────┐   │ │
│  │  │ ScreenCaptureKit       │  │ Recording Controls  │   │ │
│  │  └──────────────┘ │       │  └────────────────────┘   │ │
│  │  ┌──────────────┐ │       │  ┌────────────────────┐   │ │
│  │  │ Camera       │ │       │  │ Timeline Editor     │   │ │
│  │  │ AVFoundation │ │       │  └────────────────────┘   │ │
│  │  └──────────────┘ │       │  ┌────────────────────┐   │ │
│  │  ┌──────────────┐ │       │  │ Preview Canvas      │   │ │
│  │  │ Audio        │ │       │  │ (WebGL2)            │   │ │
│  │  │ SCKit + cpal │ │       │  └────────────────────┘   │ │
│  │  └──────────────┘ │       │  ┌────────────────────┐   │ │
│  │  ┌──────────────┐ │       │  │ Export Panel        │   │ │
│  │  │ Mouse Logger │ │       │  └────────────────────┘   │ │
│  │  │ CGEvent tap  │ │       │                            │ │
│  │  └──────────────┘ │       └────────────────────────────┘ │
│  │  ┌──────────────┐ │                                      │
│  │  │ GPU Export   │ │                                      │
│  │  │ Metal +      │ │                                      │
│  │  │ VideoToolbox │ │                                      │
│  │  └──────────────┘ │                                      │
│  └────────────────────┘                                      │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              macOS Native Layer                        │   │
│  │  ScreenCaptureKit  │  AVFoundation  │  CoreAudio      │   │
│  │  VideoToolbox      │  Metal         │  CoreGraphics   │   │
│  │  IOSurface         │  CVPixelBuffer │  CMSampleBuffer │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Design Principles

- **macOS-native**: Use Apple APIs directly. No cross-platform abstractions for capture/encode.
- **Non-destructive editing**: Raw tracks are never modified. Edits are stored as metadata.
- **GPU-first export**: Metal compositor → IOSurface → VideoToolbox. Zero CPU pixel work.
- **Separate tracks**: Screen, camera, mic, system audio stored independently.
- **Apple Silicon optimized**: Leverage unified memory, hardware encoder, Neural Engine where applicable.

### Apple Media Pipeline Overview

Understanding how Apple's media types flow is critical:

```
ScreenCaptureKit → CMSampleBuffer → CVPixelBuffer → IOSurface → Metal texture
                                                  ↓
AVFoundation     → CMSampleBuffer → CVPixelBuffer → IOSurface → Metal texture
                                                  ↓
                                    VideoToolbox (VTCompressionSession)
                                                  ↓
                                            CMSampleBuffer (encoded)
                                                  ↓
                                        AVAssetWriter → .mp4/.mov

All of these share the same backing IOSurface in GPU memory.
CVPixelBuffer is just a wrapper around IOSurface.
This means: screen capture → Metal composite → encode is ZERO COPY.
```

---

## 3. Module Design

### 3.1 Capture Engine

#### 3.1.1 Screen Capture (ScreenCaptureKit)

ScreenCaptureKit (SCKit) is macOS's modern screen capture API. It provides:
- Per-display or per-window capture
- Hardware-accelerated, low-overhead
- System audio capture built-in (no virtual audio driver needed)
- Cursor rendering control
- Configurable pixel format and resolution

**Key classes:**
```
SCShareableContent     → enumerate displays, windows, apps
SCContentFilter        → what to capture (display, window, region)
SCStreamConfiguration  → resolution, FPS, pixel format, audio
SCStream               → the capture session
SCStreamOutput         → delegate that receives frames
```

**Configuration decisions:**
```
Pixel format:  kCVPixelFormatType_32BGRA
               - Compatible with Metal textures directly
               - Slight overhead vs NV12 but simplifies compositor pipeline
               - NV12 requires color conversion before Metal can use it

Frame rate:    Match target export FPS (30 or 60)
               - SCKit handles frame timing internally

Resolution:    Native display resolution (Retina)
               - Downscale during export, not capture
               - Preserves quality for zoom effects

Cursor:        SCStreamConfiguration.showsCursor = true during recording
               - But also log mouse events separately for effects
               - Can re-render cursor with effects during export

Audio:         SCStreamConfiguration.capturesAudio = true
               - Delivers system audio as separate CMSampleBuffers
               - Channel count: 2 (stereo)
               - Sample rate: 48000 Hz
```

**Permissions:**
```
Info.plist keys:
  NSScreenCaptureUsageDescription  → "CaptureKit needs to record your screen"

Entitlements (for non-sandboxed DMG distribution):
  com.apple.security.device.audio-input     → mic access

No special entitlement needed for screen capture — SCKit handles its own
permission prompt via the system dialog.
```

#### 3.1.2 Camera Capture (AVFoundation)

```
AVCaptureSession
  └── AVCaptureDeviceInput (camera)
  └── AVCaptureVideoDataOutput → delegate receives CMSampleBuffer
```

**Configuration:**
```
Device:         AVCaptureDevice.default(for: .video)
                Or let user pick from AVCaptureDevice.DiscoverySession
Preset:         .hd1280x720 (720p is plenty for a small overlay bubble)
Pixel format:   kCVPixelFormatType_32BGRA (match screen capture)
Frame rate:     30 FPS (don't need 60 for camera bubble)
```

#### 3.1.3 Audio Capture

**System audio**: Delivered by ScreenCaptureKit alongside screen frames. No additional setup.

**Microphone**: Via `cpal` crate (Rust) or AVAudioEngine.
```
cpal is simpler from Rust:
  - Default input device
  - 48000 Hz, f32 samples, mono or stereo
  - Low latency buffer (512-1024 samples)
```

#### 3.1.4 Mouse Event Logger

Uses a `CGEvent` tap to capture all mouse events system-wide during recording.

```
Event types to capture:
  - kCGEventLeftMouseDown, kCGEventRightMouseDown → clicks (for auto-zoom)
  - kCGEventMouseMoved, kCGEventLeftMouseDragged  → movement (for cursor trail)
  - kCGEventScrollWheel → scroll events

Each event is timestamped with mach_absolute_time() converted to nanoseconds,
matching the same clock used by CMSampleBuffer timestamps.

Stored as: mouse_events.jsonl (newline-delimited JSON, appended in real-time)
```

**Permission**: Requires Accessibility permission (`AXIsProcessTrusted()`). App should check on launch and guide user to System Settings → Privacy & Security → Accessibility.

#### 3.1.5 Frame Synchronization

All Apple media APIs use the same `CMTime` / `mach_absolute_time` clock. This makes sync straightforward:

```rust
pub struct CaptureSession {
    screen_stream: SCStream,
    camera_session: AVCaptureSession,
    mic_engine: cpal::Stream,

    // All sources write to a shared timeline buffer
    frame_queue: Arc<FrameQueue>,

    // Recording start time (mach_absolute_time)
    epoch: u64,
}

pub struct FrameQueue {
    screen_frames: SegQueue<TimestampedFrame>,   // lock-free queue
    camera_frames: SegQueue<TimestampedFrame>,
    audio_buffers: SegQueue<TimestampedAudio>,   // mic
    system_audio:  SegQueue<TimestampedAudio>,   // from SCKit
    mouse_events:  SegQueue<MouseEvent>,
}

pub struct TimestampedFrame {
    pub sample_buffer: CMSampleBuffer,   // contains CVPixelBuffer + timing
    pub pts_ns: u64,                     // nanoseconds since epoch
}
```

The recording encoder reads from these queues and writes each track to its own file. No complex sync logic needed because Apple's timestamps are already aligned.

---

### 3.2 Recording Encoder

During recording, priority is **zero dropped frames** and **crash resilience**.

#### Strategy: Separate Files Per Track

```
screen.mov     ← H.264 via VideoToolbox (realtime mode)
camera.mov     ← H.264 via VideoToolbox (realtime mode)
mic.wav        ← PCM (lossless, trivial CPU cost)
system.wav     ← PCM (lossless)
mouse.jsonl    ← Newline-delimited JSON
```

Using `.mov` (not `.mkv`) because AVAssetWriter produces `.mov` natively and it's resilient to unclean shutdowns (the `moov` atom issue is handled by AVAssetWriter's internal journaling).

#### VideoToolbox for Recording

Even during recording, we use VideoToolbox — it's effectively free on Apple Silicon since the encode runs on the dedicated media engine, not CPU or GPU cores.

```
VTCompressionSession configuration for recording:
  Codec:              kCMVideoCodecType_H264
  Profile:            kVTProfileLevel_H264_Main_AutoLevel
  Realtime:           true (kVTCompressionPropertyKey_RealTime)
  AllowFrameReorder:  false (no B-frames, lower latency)
  ExpectedFrameRate:  60
  AverageBitRate:     20_000_000 (20 Mbps — generous for quality)
  MaxKeyFrameInterval: 60 (1 keyframe per second at 60fps)

This produces a recording-quality file with:
  - Near-zero CPU usage (hardware media engine)
  - Low latency (no frame reordering)
  - Excellent quality at 20 Mbps
  - Good seeking (frequent keyframes)
```

#### AVAssetWriter Pipeline

```
CMSampleBuffer (from SCKit) → VTCompressionSession → compressed CMSampleBuffer → AVAssetWriter

AVAssetWriter handles:
  - Container format (.mov)
  - Timing/sync
  - Crash-safe writing
  - Proper finalization on stop
```

```rust
pub struct RecordingPipeline {
    screen_writer: AVAssetWriter,      // → screen.mov
    camera_writer: Option<AVAssetWriter>, // → camera.mov
    mic_writer: WavWriter,             // → mic.wav
    system_audio_writer: WavWriter,    // → system.wav
    mouse_logger: MouseEventLogger,    // → mouse.jsonl
    is_recording: Arc<AtomicBool>,
}

impl RecordingPipeline {
    pub fn on_screen_frame(&self, sample: CMSampleBuffer) {
        // Already comes from SCKit in BGRA
        // Compress via VTCompressionSession (hardware)
        // Write to AVAssetWriter
        self.screen_writer.append(sample);
    }

    pub fn on_camera_frame(&self, sample: CMSampleBuffer) {
        if let Some(writer) = &self.camera_writer {
            writer.append(sample);
        }
    }

    pub fn on_mic_audio(&self, buffer: &[f32], timestamp_ns: u64) {
        self.mic_writer.write_samples(buffer, timestamp_ns);
    }

    pub fn on_system_audio(&self, sample: CMSampleBuffer) {
        // System audio from SCKit, write as PCM
        self.system_audio_writer.write_from_sample_buffer(sample);
    }

    pub fn on_mouse_event(&self, event: MouseEvent) {
        self.mouse_logger.append(event);
    }
}
```

---

### 3.3 Editor & Compositor (Frontend)

#### Tech Stack

- **React 18+** with TypeScript
- **Zustand** for state management
- **WebGL2** for preview canvas
- **wavesurfer.js** for audio waveform display

#### UI Layout

```
┌─────────────────────────────────────────────────────┐
│  ← [Projects]     CaptureKit        [⚙ Settings]   │
├────────────────────────────────┬────────────────────┤
│                                │                    │
│                                │  Inspector Panel   │
│    Preview Canvas (WebGL2)     │                    │
│                                │  ┌──────────────┐ │
│    ┌──────────────────────┐    │  │ Background   │ │
│    │                      │    │  │ ○ Gradient   │ │
│    │    Screen recording  │    │  │ ○ Solid      │ │
│    │    with zoom applied │    │  │ ○ Image      │ │
│    │                      │    │  │ Padding: 32  │ │
│    │           ┌────┐     │    │  │ Radius: 12   │ │
│    │           │cam │     │    │  └──────────────┘ │
│    │           └────┘     │    │  ┌──────────────┐ │
│    └──────────────────────┘    │  │ Camera       │ │
│                                │  │ Shape: ●     │ │
│    [◀] [▶ Play] [▶▶] 02:34    │  │ Position: BR │ │
│                                │  │ Size: 120    │ │
├────────────────────────────────┤  └──────────────┘ │
│  Timeline                      │  ┌──────────────┐ │
│  ┌─────────────────────────┐   │  │ Cursor       │ │
│  │ ──●─────────────────    │   │  │ ○ Default    │ │
│  │ Screen ████████████████ │   │  │ ○ Highlight  │ │
│  │ Camera ████████████████ │   │  │ ○ Spotlight  │ │
│  │ Mic    ▁▃▅▇▅▃▁▁▃▅▇▆▃▁ │   │  └──────────────┘ │
│  │ Sys    ▁▁▃▅▃▁▁▁▁▁▃▅▃▁ │   │  ┌──────────────┐ │
│  │ Zoom   ◆────◆──◆────── │   │  │ Auto-Zoom    │ │
│  └─────────────────────────┘   │  │ [Generate]   │ │
│                                │  │ Level: 2.0x  │ │
│  [Trim Start] [Trim End]      │  │ Speed: Fast   │ │
│  [Split] [Delete]             │  └──────────────┘ │
├────────────────────────────────┴────────────────────┤
│  Export: [1080p ▾] [H.264 ▾] [High ▾]  [Export →] │
└─────────────────────────────────────────────────────┘
```

#### Preview Renderer (WebGL2)

The preview uses `<video>` elements as textures for real-time playback in the editor. No decoding overhead — the browser handles video decode natively.

```typescript
class PreviewRenderer {
    private gl: WebGL2RenderingContext;
    private screenVideo: HTMLVideoElement;     // plays screen.mov
    private cameraVideo: HTMLVideoElement;     // plays camera.mov

    // Shader programs
    private backgroundShader: WebGLProgram;
    private screenShader: WebGLProgram;        // with zoom UV mapping
    private cameraShader: WebGLProgram;        // with circular mask
    private cursorShader: WebGLProgram;        // highlight/spotlight

    render(time: number, effects: FrameEffects): void {
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        // 1. Background
        this.renderBackground(effects.background);

        // 2. Screen with zoom
        const zoom = interpolateZoom(time, effects.zoomKeyframes);
        gl.useProgram(this.screenShader);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.screenTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.screenVideo);
        this.setZoomUniforms(zoom, effects.frameStyle);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // 3. Cursor effect (if enabled)
        if (effects.cursorStyle.enabled) {
            const cursorPos = getCursorAtTime(time, effects.mouseEvents, zoom);
            this.renderCursor(cursorPos, effects.cursorStyle);
        }

        // 4. Camera bubble (if enabled)
        if (this.cameraVideo && effects.cameraOverlay.enabled) {
            gl.useProgram(this.cameraShader);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.cameraTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cameraVideo);
            this.setCameraUniforms(effects.cameraOverlay);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }
}
```

#### Zoom Interpolation (TypeScript — shared with preview)

```typescript
interface ZoomKeyframe {
    timestampMs: number;
    region: { x: number; y: number; width: number; height: number }; // normalized 0-1
    easing: 'ease-in-out' | 'ease-in' | 'ease-out' | 'linear';
    transitionMs: number;
}

const FULL_VIEW: ZoomRegion = { x: 0, y: 0, width: 1, height: 1 };

function interpolateZoom(timeMs: number, keyframes: ZoomKeyframe[]): ZoomRegion {
    if (keyframes.length === 0) return FULL_VIEW;

    // Find surrounding keyframes
    let prev: ZoomKeyframe | null = null;
    let next: ZoomKeyframe | null = null;

    for (const kf of keyframes) {
        if (kf.timestampMs <= timeMs) prev = kf;
        if (kf.timestampMs > timeMs && !next) next = kf;
    }

    if (!prev && !next) return FULL_VIEW;
    if (prev && !next) return prev.region;
    if (!prev && next) return next.region;

    // Interpolate between prev and next
    const elapsed = timeMs - prev!.timestampMs;
    const duration = next!.timestampMs - prev!.timestampMs;
    const t = Math.min(elapsed / duration, 1.0);
    const easedT = applyEasing(t, next!.easing);

    return lerpRegion(prev!.region, next!.region, easedT);
}

function applyEasing(t: number, easing: string): number {
    switch (easing) {
        case 'ease-in-out':
            return t < 0.5
                ? 4 * t * t * t
                : 1 - Math.pow(-2 * t + 2, 3) / 2;
        case 'ease-in':
            return t * t * t;
        case 'ease-out':
            return 1 - Math.pow(1 - t, 3);
        default:
            return t;
    }
}

function lerpRegion(a: ZoomRegion, b: ZoomRegion, t: number): ZoomRegion {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        width: a.width + (b.width - a.width) * t,
        height: a.height + (b.height - a.height) * t,
    };
}
```

---

### 3.4 Auto-Zoom Engine

Runs post-recording. Analyzes mouse click events and generates zoom keyframes.

#### Algorithm

```
For each click event:
  1. Skip if within cooldown period of previous zoom
  2. Calculate zoom region centered on click position
     - Region size = 1/zoom_level (e.g., 2x zoom → 0.5 x 0.5 region)
     - Clamp to screen bounds
  3. Generate zoom-in keyframe at click time
  4. Generate zoom-out keyframe at click_time + hold_duration
  5. Both keyframes use cubic ease-in-out for smooth motion
```

```rust
pub struct AutoZoomConfig {
    pub zoom_level: f64,             // default: 2.0
    pub transition_ms: u64,          // default: 400
    pub hold_ms: u64,                // default: 1500
    pub cooldown_ms: u64,            // default: 2000
    pub easing: Easing,              // default: EaseInOut
    pub padding: f64,                // default: 0.1 (10% extra space)
}

impl Default for AutoZoomConfig {
    fn default() -> Self {
        Self {
            zoom_level: 2.0,
            transition_ms: 400,
            hold_ms: 1500,
            cooldown_ms: 2000,
            easing: Easing::EaseInOut,
            padding: 0.1,
        }
    }
}

pub fn generate_zoom_keyframes(
    events: &[MouseEvent],
    screen_size: (u32, u32),
    config: &AutoZoomConfig,
) -> Vec<ZoomKeyframe> {
    let clicks: Vec<&MouseEvent> = events
        .iter()
        .filter(|e| matches!(e.kind, MouseEventKind::Click { .. }))
        .collect();

    let mut keyframes = Vec::new();
    let mut last_zoom_end_ms: u64 = 0;
    let full_region = NormalizedRegion { x: 0.0, y: 0.0, width: 1.0, height: 1.0 };

    for click in &clicks {
        let click_ms = click.timestamp_ns / 1_000_000;

        // Cooldown check
        if click_ms < last_zoom_end_ms + config.cooldown_ms {
            continue;
        }

        let zoom_region = calculate_zoom_region(
            click.position, screen_size, config.zoom_level, config.padding,
        );

        // Zoom IN
        keyframes.push(ZoomKeyframe {
            timestamp_ms: click_ms,
            region: zoom_region,
            easing: config.easing,
            transition_ms: config.transition_ms,
        });

        // Zoom OUT
        let zoom_out_ms = click_ms + config.transition_ms + config.hold_ms;
        keyframes.push(ZoomKeyframe {
            timestamp_ms: zoom_out_ms,
            region: full_region,
            easing: config.easing,
            transition_ms: config.transition_ms,
        });

        last_zoom_end_ms = zoom_out_ms + config.transition_ms;
    }

    keyframes
}

fn calculate_zoom_region(
    click: (f64, f64),
    screen: (u32, u32),
    zoom: f64,
    padding: f64,
) -> NormalizedRegion {
    let view_w = (1.0 / zoom) * (1.0 + padding);
    let view_h = (1.0 / zoom) * (1.0 + padding);

    let norm_x = click.0 / screen.0 as f64;
    let norm_y = click.1 / screen.1 as f64;

    let x = (norm_x - view_w / 2.0).clamp(0.0, 1.0 - view_w);
    let y = (norm_y - view_h / 2.0).clamp(0.0, 1.0 - view_h);

    NormalizedRegion { x, y, width: view_w.min(1.0), height: view_h.min(1.0) }
}
```

Users can then tweak, delete, or add zoom keyframes manually in the timeline UI.

---

### 3.5 Export Pipeline (VideoToolbox + Metal)

This is the performance-critical path. Everything stays on GPU.

#### The Zero-Copy Pipeline

```
Decode (VideoToolbox)        Composite (Metal)          Encode (VideoToolbox)
─────────────────          ─────────────────          ─────────────────
screen.mov                 Metal render pass           VTCompressionSession
  → VTDecompressionSession   1. Background gradient      → encoded H.264/H.265
  → CVPixelBuffer            2. Screen + zoom crop        → CMSampleBuffer
  → IOSurface ─────────────► 3. Cursor effects           → AVAssetWriter
  → MTLTexture               4. Camera bubble              → output.mp4
                              ↓
camera.mov                  Output MTLTexture
  → VTDecompressionSession    → IOSurface (same backing)
  → CVPixelBuffer             → CVPixelBuffer
  → IOSurface ─────────────►  → VTCompressionSession
  → MTLTexture

Key insight: CVPixelBuffer, IOSurface, and MTLTexture all share the same
GPU memory. There is NO copy at any stage on Apple Silicon.
On Intel Macs, there may be a GPU→GPU copy between discrete/integrated,
but still no CPU involvement.
```

#### Metal Compositor

The compositor renders the final frame with all effects applied in a single render pass.

```rust
pub struct MetalCompositor {
    device: metal::Device,
    command_queue: metal::CommandQueue,
    pipeline_state: metal::RenderPipelineState,
    // Samplers, vertex buffers, uniform buffers
}

pub struct CompositeParams {
    pub output_size: (u32, u32),
    pub background: BackgroundConfig,
    pub zoom_region: NormalizedRegion,
    pub border_radius: f32,
    pub padding: f32,
    pub camera: Option<CameraOverlayParams>,
    pub cursor: Option<CursorParams>,
}

impl MetalCompositor {
    pub fn composite_frame(
        &self,
        screen_texture: &metal::TextureRef,      // from decoded CVPixelBuffer
        camera_texture: Option<&metal::TextureRef>,
        params: &CompositeParams,
    ) -> CVPixelBuffer {
        // 1. Create output CVPixelBuffer backed by IOSurface
        let output_buffer = create_pixel_buffer(
            params.output_size.0,
            params.output_size.1,
            kCVPixelFormatType_32BGRA,
            IOSurfaceBacked,  // GPU-accessible
        );

        // 2. Wrap as MTLTexture (zero-copy — same IOSurface)
        let output_texture = self.texture_from_pixel_buffer(&output_buffer);

        // 3. Render
        let command_buffer = self.command_queue.new_command_buffer();
        let render_pass = metal::RenderPassDescriptor::new();
        render_pass.color_attachments().object_at(0).unwrap()
            .set_texture(Some(&output_texture));
        render_pass.color_attachments().object_at(0).unwrap()
            .set_load_action(metal::MTLLoadAction::Clear);

        let encoder = command_buffer.new_render_command_encoder(&render_pass);

        // Draw calls:
        self.draw_background(encoder, &params.background);
        self.draw_screen(encoder, screen_texture, &params.zoom_region, params);
        if let Some(cursor) = &params.cursor {
            self.draw_cursor(encoder, cursor);
        }
        if let Some((cam_tex, cam_params)) = camera_texture.zip(params.camera.as_ref()) {
            self.draw_camera(encoder, cam_tex, cam_params);
        }

        encoder.end_encoding();
        command_buffer.commit();
        command_buffer.wait_until_completed();

        // 4. Return the CVPixelBuffer — it now contains the composited frame
        //    AND it's already in the right format for VTCompressionSession
        output_buffer
    }

    fn texture_from_pixel_buffer(&self, buffer: &CVPixelBuffer) -> metal::Texture {
        // CVPixelBuffer → IOSurface → MTLTexture
        // This is zero-copy on Apple Silicon
        let surface = CVPixelBufferGetIOSurface(buffer);
        let desc = metal::TextureDescriptor::new();
        desc.set_pixel_format(metal::MTLPixelFormat::BGRA8Unorm);
        desc.set_width(CVPixelBufferGetWidth(buffer) as u64);
        desc.set_height(CVPixelBufferGetHeight(buffer) as u64);
        self.device.new_texture_with_iosurface(&surface, &desc)
    }
}
```

#### Metal Shader (MSL)

```metal
#include <metal_stdlib>
using namespace metal;

struct Uniforms {
    float2 output_size;
    float4 zoom_rect;           // x, y, w, h (normalized 0-1)
    float4 content_rect;        // screen frame rect in output space (pixels)
    float border_radius;
    float4 bg_color_a;
    float4 bg_color_b;
    float bg_angle;
    float4 cam_rect;            // camera position (pixels)
    float cam_radius;
    float2 cursor_pos;          // in content UV space
    float cursor_highlight_radius;
    float4 cursor_color;
    float spotlight_dim;
};

fragment float4 composite_fragment(
    float4 position [[position]],
    texture2d<float> screen_tex [[texture(0)]],
    texture2d<float> camera_tex [[texture(1)]],
    sampler tex_sampler [[sampler(0)]],
    constant Uniforms& u [[buffer(0)]]
) {
    float2 uv = position.xy / u.output_size;
    float2 pixel = position.xy;

    // 1. Background gradient
    float grad_t = dot(uv - 0.5, float2(cos(u.bg_angle), sin(u.bg_angle))) + 0.5;
    float4 color = mix(u.bg_color_a, u.bg_color_b, saturate(grad_t));

    // 2. Screen frame
    float2 content_min = u.content_rect.xy;
    float2 content_max = u.content_rect.xy + u.content_rect.zw;

    // Rounded rect SDF
    float2 center = (content_min + content_max) * 0.5;
    float2 half_size = u.content_rect.zw * 0.5;
    float2 d = abs(pixel - center) - half_size + u.border_radius;
    float dist = length(max(d, 0.0)) - u.border_radius;

    if (dist < 0.0) {
        // Inside screen frame — sample screen texture with zoom
        float2 content_uv = (pixel - content_min) / u.content_rect.zw;
        float2 screen_uv = u.zoom_rect.xy + content_uv * u.zoom_rect.zw;
        float4 screen_color = screen_tex.sample(tex_sampler, screen_uv);

        // 3. Cursor effects
        float2 cursor_screen_uv = (u.cursor_pos - u.zoom_rect.xy) / u.zoom_rect.zw;
        float cursor_dist = distance(content_uv, cursor_screen_uv);

        if (cursor_dist < u.cursor_highlight_radius) {
            float t = 1.0 - (cursor_dist / u.cursor_highlight_radius);
            screen_color = mix(screen_color, u.cursor_color, t * 0.3);
        } else if (u.spotlight_dim > 0.0) {
            screen_color.rgb *= (1.0 - u.spotlight_dim * 0.4);
        }

        // Anti-aliased edge
        float aa = smoothstep(0.0, -1.0, dist);
        color = mix(color, screen_color, aa);
    }

    // 4. Camera bubble
    float cam_dist = distance(pixel, u.cam_rect.xy + u.cam_rect.zw * 0.5);
    if (cam_dist < u.cam_radius + 3.0) { // +3 for border
        if (cam_dist < u.cam_radius) {
            float2 cam_uv = (pixel - u.cam_rect.xy) / u.cam_rect.zw;
            float4 cam_color = camera_tex.sample(tex_sampler, cam_uv);
            float edge = smoothstep(u.cam_radius, u.cam_radius - 2.0, cam_dist);
            color = mix(color, cam_color, edge);
        } else {
            // Border ring
            float ring = smoothstep(u.cam_radius + 3.0, u.cam_radius, cam_dist);
            color = mix(color, float4(1.0), ring * 0.8);
        }
    }

    return color;
}
```

#### VideoToolbox Encoder (Export Mode)

```rust
pub struct ExportEncoder {
    session: VTCompressionSession,
    asset_writer: AVAssetWriter,
    codec: VideoCodec,
}

impl ExportEncoder {
    pub fn new(config: &ExportConfig) -> Result<Self> {
        let session = VTCompressionSession::new(
            config.width,
            config.height,
            match config.codec {
                VideoCodec::H264 => kCMVideoCodecType_H264,
                VideoCodec::H265 => kCMVideoCodecType_HEVC,
                VideoCodec::ProRes => kCMVideoCodecType_AppleProRes422,
            },
        )?;

        // Export-quality settings (not realtime — maximize quality)
        session.set_property(kVTCompressionPropertyKey_RealTime, false);
        session.set_property(kVTCompressionPropertyKey_AllowFrameReordering, true); // B-frames OK
        session.set_property(kVTCompressionPropertyKey_ProfileLevel,
            kVTProfileLevel_H264_High_AutoLevel);

        match config.quality {
            ExportQuality::Draft => {
                session.set_property(kVTCompressionPropertyKey_Quality, 0.5);
            }
            ExportQuality::Balanced => {
                session.set_property(kVTCompressionPropertyKey_Quality, 0.7);
            }
            ExportQuality::High => {
                session.set_property(kVTCompressionPropertyKey_Quality, 0.85);
            }
            ExportQuality::Lossless => {
                session.set_property(kVTCompressionPropertyKey_Quality, 1.0);
            }
        }

        // MaxKeyFrameIntervalDuration: 2 seconds
        session.set_property(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, 2.0);

        // Use hardware encoder (Apple Silicon media engine)
        session.set_property(
            kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder, true
        );

        Ok(Self { session, asset_writer, codec: config.codec })
    }

    /// Accepts a CVPixelBuffer (from Metal compositor) and encodes it.
    /// Zero-copy: the pixel buffer's IOSurface is read directly by the hardware encoder.
    pub fn encode_frame(&self, pixel_buffer: &CVPixelBuffer, pts: CMTime) -> Result<()> {
        VTCompressionSessionEncodeFrame(
            self.session,
            pixel_buffer,
            pts,
            kCMTimeInvalid,  // duration
            std::ptr::null(),
            std::ptr::null_mut(),
        )?;
        Ok(())
    }
}
```

#### Full Export Pipeline

```rust
pub struct ExportPipeline {
    compositor: MetalCompositor,
    encoder: ExportEncoder,
    audio_mixer: AudioMixer,
}

impl ExportPipeline {
    pub async fn export(
        &mut self,
        project: &ProjectState,
        on_progress: impl Fn(ExportProgress),
    ) -> Result<PathBuf> {
        let fps = project.export_config.fps;
        let in_ms = project.timeline.in_point;
        let out_ms = project.timeline.out_point;
        let total_frames = ((out_ms - in_ms) as f64 / 1000.0 * fps as f64) as u64;

        // Open decoders
        let screen_decoder = VideoToolboxDecoder::open(&project.tracks.screen)?;
        let camera_decoder = project.tracks.camera.as_ref()
            .map(|t| VideoToolboxDecoder::open(t)).transpose()?;

        // Pre-compute zoom timeline
        let zoom_timeline = ZoomTimeline::new(&project.effects.zoom_keyframes);
        let cursor_timeline = CursorTimeline::new(
            &project.mouse_events, &project.effects.cursor_style
        );

        for frame_idx in 0..total_frames {
            let time_ms = in_ms + (frame_idx as f64 / fps as f64 * 1000.0) as u64;

            // Decode → CVPixelBuffer → MTLTexture (zero-copy via IOSurface)
            let screen_pb = screen_decoder.decode_frame_at(time_ms)?;
            let screen_tex = self.compositor.texture_from_pixel_buffer(&screen_pb);

            let camera_tex = camera_decoder.as_mut()
                .map(|d| {
                    let pb = d.decode_frame_at(time_ms)?;
                    Ok(self.compositor.texture_from_pixel_buffer(&pb))
                })
                .transpose()?;

            // Composite on Metal → output CVPixelBuffer (still zero-copy)
            let params = CompositeParams {
                output_size: project.export_config.resolution(),
                background: project.effects.background.clone(),
                zoom_region: zoom_timeline.sample(time_ms),
                border_radius: project.effects.frame_style.border_radius,
                padding: project.effects.frame_style.padding,
                camera: project.effects.camera_overlay.as_ref().map(Into::into),
                cursor: cursor_timeline.sample(time_ms),
            };
            let composited = self.compositor.composite_frame(
                &screen_tex, camera_tex.as_ref(), &params
            );

            // Encode via VideoToolbox hardware encoder (zero-copy — reads IOSurface)
            let pts = CMTimeMake(frame_idx as i64, fps as i32);
            self.encoder.encode_frame(&composited, pts)?;

            on_progress(ExportProgress {
                frame: frame_idx,
                total_frames,
                percent: frame_idx as f64 / total_frames as f64,
            });
        }

        // Mix audio tracks and write
        let audio = self.audio_mixer.mix(
            project.tracks.mic.as_ref(),
            project.tracks.system_audio.as_ref(),
            in_ms,
            out_ms,
        )?;
        self.encoder.write_audio(audio)?;

        // Finalize
        self.encoder.finalize()?;
        Ok(self.encoder.output_path().to_owned())
    }
}
```

#### Performance Expectations (Apple Silicon M1+)

| Recording | Export (5min, 1080p60) |
|-----------|----------------------|
| Screen: ~2% CPU (media engine) | GPU composite + HW encode: **~5-8 seconds** |
| Camera: ~1% CPU | CPU usage during export: **~5%** |
| Audio: ~0.5% CPU | GPU usage during export: ~40% (compositor) + media engine |
| Total: **~3.5% CPU** | Memory: ~300 MB |

On Intel Macs with discrete GPU: ~12-15 seconds for the same export (VideoToolbox still uses hardware encoder but may have GPU↔GPU transfer overhead).

---

## 4. Data Model

### TypeScript (Frontend State)

```typescript
// === Project State (Zustand store) ===

interface ProjectState {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;

    // Source tracks (file paths)
    tracks: {
        screen: string;              // path to screen.mov
        camera: string | null;       // path to camera.mov
        mic: string | null;          // path to mic.wav
        systemAudio: string | null;  // path to system.wav
    };

    // Timeline
    timeline: {
        inPoint: number;             // ms — trim start
        outPoint: number;            // ms — trim end
        duration: number;            // ms — total recording duration
    };

    // Effects
    effects: {
        background: BackgroundConfig;
        frameStyle: FrameStyleConfig;
        cameraOverlay: CameraOverlayConfig;
        cursorStyle: CursorStyleConfig;
        zoomKeyframes: ZoomKeyframe[];
    };

    // Raw mouse events (for auto-zoom generation)
    mouseEvents: MouseEvent[];

    // Export settings
    exportConfig: ExportConfig;
}

// === Background ===

type BackgroundConfig =
    | { type: 'gradient'; from: string; to: string; angle: number }
    | { type: 'solid'; color: string }
    | { type: 'image'; path: string }
    | { type: 'transparent' };

// Common across all:
interface BackgroundBase {
    padding: number;       // px padding around screen frame in output
}

// === Frame Style ===

interface FrameStyleConfig {
    borderRadius: number;  // px for rounded corners on screen
    shadow: boolean;       // drop shadow behind screen frame
    shadowBlur: number;
    shadowColor: string;
    deviceFrame: 'none' | 'macbook' | 'imac' | 'iphone' | 'browser';
}

// === Camera Overlay ===

interface CameraOverlayConfig {
    enabled: boolean;
    shape: 'circle' | 'rounded-rect';
    position: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
    size: number;              // px diameter/width relative to output
    borderWidth: number;       // px
    borderColor: string;
    shadow: boolean;
}

// === Cursor ===

interface CursorStyleConfig {
    enabled: boolean;
    style: 'default' | 'highlight' | 'spotlight' | 'enlarged';
    highlightColor: string;
    highlightRadius: number;   // px
    spotlightDim: number;      // 0-1
}

// === Zoom ===

interface ZoomKeyframe {
    timestampMs: number;
    region: { x: number; y: number; width: number; height: number }; // 0-1
    easing: 'ease-in-out' | 'ease-in' | 'ease-out' | 'linear';
    transitionMs: number;
}

// === Mouse Event ===

interface MouseEvent {
    timestampNs: number;
    kind: 'click' | 'move' | 'scroll' | 'drag-start' | 'drag-end';
    button?: 'left' | 'right' | 'middle';
    position: { x: number; y: number };
    screenSize: { width: number; height: number };
}

// === Export ===

interface ExportConfig {
    resolution: { width: number; height: number };
    fps: 30 | 60;
    codec: 'h264' | 'h265' | 'prores';
    quality: 'draft' | 'balanced' | 'high' | 'lossless';
    format: 'mp4' | 'mov';
}

// Preset resolutions
const RESOLUTION_PRESETS = {
    '720p':  { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '1440p': { width: 2560, height: 1440 },
    '4k':    { width: 3840, height: 2160 },
} as const;
```

### Rust (Backend Types — mirrors frontend)

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectState {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub tracks: Tracks,
    pub timeline: Timeline,
    pub effects: Effects,
    pub mouse_events: Vec<MouseEvent>,
    pub export_config: ExportConfig,
}

// ... (mirrors TypeScript types above via serde)
```

---

## 5. IPC Contract

### Tauri Commands

```rust
// ===== Source Discovery =====

#[tauri::command]
async fn list_displays() -> Result<Vec<DisplayInfo>, AppError> {
    // Returns available displays via SCShareableContent
    // { id, name, width, height, is_main }
}

#[tauri::command]
async fn list_windows() -> Result<Vec<WindowInfo>, AppError> {
    // Returns capturable windows via SCShareableContent
    // { id, title, app_name, bounds }
}

#[tauri::command]
async fn list_cameras() -> Result<Vec<CameraInfo>, AppError> {
    // Returns available cameras via AVCaptureDevice.DiscoverySession
    // { id, name, position }
}

#[tauri::command]
async fn list_audio_inputs() -> Result<Vec<AudioInputInfo>, AppError> {
    // Returns mic devices via cpal
    // { id, name, channels, sample_rate }
}

// ===== Recording =====

#[tauri::command]
async fn start_recording(config: RecordingConfig) -> Result<SessionId, AppError> {
    // config: { display_id?, window_id?, camera_id?, mic_id?,
    //           capture_system_audio, fps }
    // Starts all capture sources, returns session ID
}

#[tauri::command]
async fn pause_recording(session: SessionId) -> Result<(), AppError>;

#[tauri::command]
async fn resume_recording(session: SessionId) -> Result<(), AppError>;

#[tauri::command]
async fn stop_recording(session: SessionId) -> Result<ProjectState, AppError> {
    // Stops all sources, finalizes files, creates project, returns full state
}

// ===== Project Management =====

#[tauri::command]
async fn list_projects() -> Result<Vec<ProjectSummary>, AppError>;

#[tauri::command]
async fn load_project(id: String) -> Result<ProjectState, AppError>;

#[tauri::command]
async fn save_project(state: ProjectState) -> Result<(), AppError>;

#[tauri::command]
async fn delete_project(id: String) -> Result<(), AppError>;

// ===== Auto-Zoom =====

#[tauri::command]
async fn generate_zoom_keyframes(
    mouse_events: Vec<MouseEvent>,
    screen_size: (u32, u32),
    config: AutoZoomConfig,
) -> Result<Vec<ZoomKeyframe>, AppError>;

// ===== Export =====

#[tauri::command]
async fn start_export(
    project_id: String,
    config: ExportConfig,
) -> Result<ExportId, AppError>;

#[tauri::command]
async fn cancel_export(export_id: String) -> Result<(), AppError>;

// ===== Permissions =====

#[tauri::command]
async fn check_permissions() -> Result<PermissionStatus, AppError> {
    // { screen_capture: bool, camera: bool, mic: bool, accessibility: bool }
}

#[tauri::command]
async fn request_permission(kind: PermissionKind) -> Result<bool, AppError>;
```

### Tauri Events (Backend → Frontend)

```typescript
// Recording status (emitted every 500ms during recording)
type RecordingStatusEvent = {
    session_id: string;
    state: 'recording' | 'paused' | 'error';
    duration_ms: number;
    frame_count: number;
    dropped_frames: number;
    disk_usage_bytes: number;
};

// Export progress (emitted per frame during export)
type ExportProgressEvent = {
    export_id: string;
    progress: number;          // 0.0 - 1.0
    current_frame: number;
    total_frames: number;
    eta_ms: number;            // estimated time remaining
    fps: number;               // current export FPS (for debugging)
};

// Export complete
type ExportCompleteEvent = {
    export_id: string;
    output_path: string;
    file_size_bytes: number;
    duration_ms: number;       // video duration
    export_time_ms: number;    // how long export took
};
```

Listen from frontend:
```typescript
import { listen } from '@tauri-apps/api/event';

listen<RecordingStatusEvent>('recording:status', (e) => { ... });
listen<ExportProgressEvent>('export:progress', (e) => { ... });
listen<ExportCompleteEvent>('export:complete', (e) => { ... });
```

---

## 6. File & Project Structure

### Application Data

```
~/Library/Application Support/com.capturekit.app/
├── config.json                          # App preferences
└── projects/
    └── {uuid}/
        ├── project.json                 # Full ProjectState
        ├── raw/
        │   ├── screen.mov               # Screen recording (H.264 via VT)
        │   ├── camera.mov               # Camera recording (H.264 via VT)
        │   ├── mic.wav                  # Mic audio (PCM 48kHz)
        │   ├── system_audio.wav         # System audio (PCM 48kHz)
        │   └── mouse_events.jsonl       # Mouse event log
        ├── cache/
        │   ├── thumbnails/              # Timeline thumbnail strip (JPEG)
        │   └── waveforms/               # Pre-computed waveform data (JSON)
        └── exports/
            ├── export_001.mp4
            └── export_002.mov
```

### Codebase Structure

```
capturekit/
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs                         # FFmpeg linking (for muxing/audio)
│   ├── Info.plist                       # macOS permissions
│   ├── Entitlements.plist               # Signing entitlements
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── error.rs                     # AppError types
│   │   │
│   │   ├── commands/                    # Tauri command handlers
│   │   │   ├── mod.rs
│   │   │   ├── sources.rs              # list_displays, list_cameras, etc.
│   │   │   ├── recording.rs            # start/stop/pause recording
│   │   │   ├── project.rs             # CRUD projects
│   │   │   ├── autozoom.rs            # generate_zoom_keyframes
│   │   │   ├── export.rs             # start/cancel export
│   │   │   └── permissions.rs         # check/request permissions
│   │   │
│   │   ├── capture/                    # Capture engine (macOS native)
│   │   │   ├── mod.rs
│   │   │   ├── screen.rs             # ScreenCaptureKit wrapper
│   │   │   ├── camera.rs             # AVFoundation camera wrapper
│   │   │   ├── audio.rs              # Mic capture via cpal
│   │   │   ├── mouse.rs              # CGEvent tap mouse logger
│   │   │   └── session.rs            # CaptureSession orchestrator
│   │   │
│   │   ├── recording/                  # Recording pipeline
│   │   │   ├── mod.rs
│   │   │   ├── pipeline.rs           # RecordingPipeline
│   │   │   ├── video_writer.rs       # AVAssetWriter + VT wrapper
│   │   │   └── audio_writer.rs       # WAV file writer
│   │   │
│   │   ├── autozoom/                   # Auto-zoom engine
│   │   │   ├── mod.rs
│   │   │   ├── generator.rs          # Click → keyframe generation
│   │   │   └── interpolation.rs      # Zoom easing math
│   │   │
│   │   ├── export/                     # Export pipeline
│   │   │   ├── mod.rs
│   │   │   ├── pipeline.rs           # ExportPipeline orchestrator
│   │   │   ├── compositor.rs         # MetalCompositor
│   │   │   ├── shaders/
│   │   │   │   └── composite.metal   # Metal shader source
│   │   │   ├── encoder.rs            # VTCompressionSession wrapper
│   │   │   ├── decoder.rs            # VTDecompressionSession wrapper
│   │   │   └── audio_mixer.rs        # Mix mic + system audio
│   │   │
│   │   ├── project/                    # Project persistence
│   │   │   ├── mod.rs
│   │   │   ├── storage.rs            # Load/save project.json
│   │   │   └── thumbnails.rs         # Generate timeline thumbnails
│   │   │
│   │   └── platform/                   # macOS platform utilities
│   │       ├── mod.rs
│   │       ├── permissions.rs         # Permission checking/requesting
│   │       ├── pixel_buffer.rs        # CVPixelBuffer helpers
│   │       └── metal_utils.rs         # Metal device/texture helpers
│   │
│   └── metal/
│       └── composite.metal             # Compiled Metal shader
│
├── src/                                 # Frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── global.css
│   │
│   ├── stores/
│   │   ├── projectStore.ts            # Zustand — project state
│   │   ├── recordingStore.ts          # Zustand — recording UI state
│   │   └── uiStore.ts                # Zustand — panels, view mode
│   │
│   ├── components/
│   │   ├── Layout.tsx                 # App shell layout
│   │   ├── recording/
│   │   │   ├── SourcePicker.tsx       # Display/window/camera selector
│   │   │   ├── RecordButton.tsx       # Start/stop button
│   │   │   ├── RecordingTimer.tsx     # Duration display
│   │   │   └── PermissionGate.tsx     # Permission check/request UI
│   │   ├── editor/
│   │   │   ├── PreviewCanvas.tsx      # WebGL preview wrapper
│   │   │   ├── Timeline.tsx           # Main timeline component
│   │   │   ├── TimelineTrack.tsx      # Individual track (screen/camera)
│   │   │   ├── WaveformTrack.tsx      # Audio waveform display
│   │   │   ├── ZoomTrack.tsx          # Zoom keyframe markers
│   │   │   ├── TrimHandles.tsx        # In/out trim controls
│   │   │   └── PlaybackControls.tsx   # Play/pause/seek
│   │   ├── inspector/
│   │   │   ├── InspectorPanel.tsx     # Right sidebar container
│   │   │   ├── BackgroundSection.tsx
│   │   │   ├── FrameStyleSection.tsx
│   │   │   ├── CameraSection.tsx
│   │   │   ├── CursorSection.tsx
│   │   │   └── ZoomSection.tsx
│   │   ├── export/
│   │   │   ├── ExportBar.tsx          # Bottom export controls
│   │   │   └── ExportProgress.tsx     # Progress overlay
│   │   └── projects/
│   │       └── ProjectList.tsx        # Project browser
│   │
│   ├── renderer/
│   │   ├── WebGLPreview.ts            # WebGL2 compositor
│   │   ├── shaders/
│   │   │   ├── background.frag.glsl
│   │   │   ├── screen.frag.glsl
│   │   │   ├── camera.frag.glsl
│   │   │   └── cursor.frag.glsl
│   │   └── interpolation.ts          # Shared zoom/easing math
│   │
│   ├── hooks/
│   │   ├── useRecording.ts           # Recording lifecycle hook
│   │   ├── useExport.ts              # Export lifecycle hook
│   │   ├── useKeyboardShortcuts.ts
│   │   └── useTauriEvent.ts          # Generic Tauri event listener
│   │
│   └── types/
│       └── index.ts                   # Shared TypeScript types
│
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
├── tauri.conf.json
└── README.md
```

---

## 7. macOS Platform Details

### Required Permissions

| Permission | API | When Prompted | Info.plist Key |
|-----------|-----|---------------|----------------|
| Screen Recording | ScreenCaptureKit | First capture attempt | `NSScreenCaptureUsageDescription` |
| Camera | AVFoundation | First camera access | `NSCameraUsageDescription` |
| Microphone | cpal / AVAudioEngine | First mic access | `NSMicrophoneUsageDescription` |
| Accessibility | CGEvent tap | First recording (for mouse events) | Must be granted in System Settings |

**Onboarding flow:**
```
1. App launch → check all permissions via check_permissions()
2. Show permission setup screen with status indicators
3. Guide user through each permission:
   - Screen Recording: triggers on first SCStream.startCapture()
   - Camera/Mic: trigger via AVCaptureDevice.requestAccess()
   - Accessibility: open System Settings deep link, poll AXIsProcessTrusted()
4. All green → proceed to main app
```

### Code Signing & Distribution

**Initial distribution: DMG (outside App Store)**
```
Why: App Store sandbox prevents:
  - CGEvent tap (mouse logger needs Accessibility)
  - Unrestricted file system access for project storage
  - Some ScreenCaptureKit behaviors

Signing:
  Developer ID Application certificate
  Notarized with Apple

Distribution:
  DMG with drag-to-Applications
  Sparkle for auto-updates
```

### macOS API Version Requirements

| API | Minimum macOS | Notes |
|-----|--------------|-------|
| ScreenCaptureKit | 12.3 | Basic capture |
| SCKit audio capture | 13.0 | `.capturesAudio` property |
| SCKit presenter overlay | 14.0 | Better performance, cleaner API |
| VideoToolbox | 10.8 | Always available |
| Metal | 10.14 | Always available on supported hardware |
| AVFoundation | 10.7 | Always available |

**We target macOS 14.0+** to get the best SCKit experience and cover ~85% of active users.

### Apple Silicon vs Intel

| Feature | Apple Silicon (M1+) | Intel Mac |
|---------|-------------------|-----------|
| Hardware encoder | Media Engine (dedicated) | Intel Quick Sync or VideoToolbox (GPU-based) |
| Metal compositor | Unified memory (zero-copy) | Discrete GPU may need copy |
| Recording overhead | ~3% CPU | ~8-10% CPU |
| Export speed (5min 1080p60) | ~5-8 seconds | ~12-15 seconds |
| Memory model | Unified (CPU/GPU share) | Split (CPU ↔ GPU copies) |

The unified memory on Apple Silicon is the key advantage: CVPixelBuffer, Metal texture, and VideoToolbox encoder all access the same physical memory. No copies.

---

## 8. Performance Targets

| Metric | Target (Apple Silicon) | Target (Intel) |
|--------|----------------------|----------------|
| Recording CPU usage | < 5% | < 12% |
| Dropped frames during recording | 0 | 0 |
| Editor preview FPS | 60 | 60 |
| Export: 5min 1080p60, high quality | < 10s | < 20s |
| Export: 5min 4K60, high quality | < 25s | < 50s |
| App launch → ready | < 1.5s | < 2s |
| Project load time | < 300ms | < 500ms |
| Memory: recording | < 400 MB | < 500 MB |
| Memory: editing | < 800 MB | < 1 GB |
| Disk: app bundle | < 80 MB | < 80 MB |
| Disk: 5min 1080p60 recording (raw) | ~750 MB | ~750 MB |

---

## 9. Development Phases

### Phase 1 — Core Recording (3-4 weeks)

**Goal**: Record screen + mic to .mov file. Minimal UI.

```
Week 1-2: Capture engine
  [ ] Tauri v2 project scaffold (React + Rust + Vite)
  [ ] ScreenCaptureKit wrapper in Rust (via objc2)
      - Enumerate displays
      - Start/stop screen capture
      - Receive CMSampleBuffers
  [ ] Permission handling (screen recording, mic)
  [ ] Mic capture via cpal

Week 2-3: Recording pipeline
  [ ] VideoToolbox recording encoder (realtime mode)
  [ ] AVAssetWriter → screen.mov
  [ ] WAV writer for mic audio
  [ ] Frame queue + timestamp sync

Week 3-4: UI
  [ ] Source picker (display dropdown, mic dropdown)
  [ ] Record/stop button
  [ ] Recording timer + status
  [ ] Project creation on stop
  [ ] Project list view
```

**Deliverable**: Record screen + mic, produces a playable .mov.

### Phase 2 — Camera + System Audio (2 weeks)

```
Week 5: Camera
  [ ] AVFoundation camera capture wrapper
  [ ] Camera device picker in UI
  [ ] Separate camera.mov recording track

Week 6: System audio + polish
  [ ] ScreenCaptureKit audio stream → system_audio.wav
  [ ] Audio level meters in recording UI
  [ ] Recording indicator (red dot in menu bar or floating window)
  [ ] Pause/resume support
```

**Deliverable**: Full capture suite — screen, camera, mic, system audio.

### Phase 3 — Editor MVP (3-4 weeks)

```
Week 7-8: Preview + timeline
  [ ] WebGL2 preview canvas
  [ ] Load screen.mov + camera.mov as <video> textures
  [ ] Basic composite render (screen + background)
  [ ] Timeline component (scrubber, duration)
  [ ] Playback controls (play/pause/seek)
  [ ] Trim handles (in/out points)

Week 9-10: Styling
  [ ] Background config (gradient, solid, padding)
  [ ] Camera bubble overlay (circle, position, size)
  [ ] Frame style (border radius, shadow)
  [ ] Inspector panel UI
  [ ] Audio waveform display (wavesurfer.js)
  [ ] Project auto-save
```

**Deliverable**: Can preview the styled composition. Trim. Adjust visual effects.

### Phase 4 — HW-Accelerated Export (3 weeks)

```
Week 11: Metal compositor
  [ ] Metal device + command queue setup
  [ ] Composite shader (background + screen zoom + camera + cursor)
  [ ] CVPixelBuffer → MTLTexture zero-copy bridge
  [ ] Output CVPixelBuffer from Metal render

Week 12: VideoToolbox export encoder
  [ ] VTCompressionSession (non-realtime, quality-optimized)
  [ ] CVPixelBuffer → VTCompressionSession (zero-copy)
  [ ] AVAssetWriter for output .mp4/.mov
  [ ] Audio mixing (mic + system → stereo output)

Week 13: Pipeline + UI
  [ ] Full export pipeline (decode → composite → encode loop)
  [ ] Export progress events → frontend
  [ ] Export panel UI (resolution, codec, quality presets)
  [ ] Progress bar + ETA
  [ ] Export presets (720p/1080p/4K, H.264/H.265/ProRes)
```

**Deliverable**: One-click export producing polished video in seconds.

### Phase 5 — Auto-Zoom + Cursor Effects (2-3 weeks)

```
Week 14: Mouse logger
  [ ] CGEvent tap setup (with Accessibility permission check)
  [ ] Log clicks/moves/scrolls with timestamps → mouse_events.jsonl
  [ ] Accessibility permission onboarding UI

Week 15: Auto-zoom
  [ ] Auto-zoom generator (clicks → keyframes)
  [ ] Zoom interpolation with easing
  [ ] Zoom keyframe track in timeline UI
  [ ] Manual keyframe add/edit/delete

Week 16: Cursor effects
  [ ] Cursor highlight effect in compositor (Metal + WebGL preview)
  [ ] Spotlight effect
  [ ] Enlarged cursor option
  [ ] Cursor style panel in inspector
```

**Deliverable**: Auto-zoom + cursor effects. The "wow factor."

### Phase 6 — Polish + Distribution (2 weeks)

```
Week 17-18:
  [ ] Keyboard shortcuts (R to record, Space to play, etc.)
  [ ] Onboarding flow (permissions + quick tutorial)
  [ ] Error handling + crash recovery
  [ ] Developer ID code signing
  [ ] Notarization
  [ ] DMG builder
  [ ] Sparkle auto-updater integration
  [ ] Crash reporting (Sentry)
  [ ] Analytics (PostHog)
  [ ] Landing page
```

### Total: ~16-18 weeks

---

## 10. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| ScreenCaptureKit Rust bindings immature | High | Medium | Use raw objc2 FFI if crate is insufficient; contribute upstream |
| CGEvent tap requires Accessibility permission (user friction) | Medium | High | Clear onboarding flow; fallback: record without mouse events, disable auto-zoom |
| Metal ↔ VideoToolbox zero-copy edge cases on Intel | Medium | Low | Test on Intel; have CPU fallback for compositing |
| AVAssetWriter crash on unclean quit | Medium | Low | Use MKV for recording if needed; AVAssetWriter handles most cases |
| Large recordings fill disk quickly (20 Mbps × 60 min = 9 GB) | Medium | Medium | Show disk space warning; allow quality/bitrate config |
| WebGL preview doesn't match Metal export output | Low | Medium | Share shader logic; verify with screenshot comparison tests |
| Tauri v2 WebView limitations on macOS | Low | Low | WKWebView is solid on macOS; fallback to native window if needed |
| Code signing / notarization issues | Medium | Medium | Set up CI/CD early; use Apple's notarytool |

---

## 11. Dependency Inventory

### Rust Crates

| Crate | Purpose | Notes |
|-------|---------|-------|
| `tauri` 2.x | App framework | WebView + native bridge |
| `objc2` | Objective-C FFI | For all Apple framework calls |
| `objc2-foundation` | Foundation types | NSArray, NSString, etc. |
| `objc2-avfoundation` | AVFoundation | Camera capture |
| `objc2-core-media` | CMSampleBuffer, CMTime | Media pipeline types |
| `objc2-core-video` | CVPixelBuffer, CVImageBuffer | Pixel buffer management |
| `objc2-metal` | Metal API | GPU compositor |
| `block2` | Objective-C blocks | Callbacks for Apple APIs |
| `cpal` | Audio I/O | Mic capture |
| `hound` | WAV file I/O | Write mic/system audio |
| `serde` + `serde_json` | Serialization | Project files, IPC |
| `tokio` | Async runtime | Async commands |
| `crossbeam` | Lock-free queues | Frame sync queue |
| `uuid` | Project IDs | |
| `tracing` | Structured logging | |
| `anyhow` | Error handling | |
| `chrono` | Timestamps | |

**Note on ScreenCaptureKit**: As of writing, there's no mature `objc2-screen-capture-kit` crate. We'll need to write raw bindings using `objc2::extern_class!` and `objc2::extern_methods!` macros. This is ~500-800 lines of FFI boilerplate but straightforward.

### Frontend (npm)

| Package | Purpose |
|---------|---------|
| `react` + `react-dom` | UI framework |
| `@tauri-apps/api` v2 | Tauri IPC bridge |
| `zustand` | State management |
| `wavesurfer.js` | Audio waveform rendering |
| `tailwindcss` | Styling |
| `lucide-react` | Icons |
| `framer-motion` | UI transitions |
| `vite` | Build tool |

### System Requirements

| Requirement | Details |
|------------|---------|
| macOS | 14.0+ (Sonoma) |
| Xcode | 15+ (for Metal shader compiler, code signing) |
| Rust | 1.75+ (for `objc2` support) |
| Node.js | 18+ |

---

## 12. Appendix: Key Code Sketches

### A. ScreenCaptureKit FFI Bindings (Rust)

Since there's no official crate, here's the minimal FFI surface:

```rust
use objc2::runtime::*;
use objc2::{extern_class, extern_methods, ClassType, msg_send_id};
use objc2_foundation::*;

// --- SCShareableContent ---
extern_class!(
    pub struct SCShareableContent;
    unsafe impl ClassType for SCShareableContent {
        type Super = NSObject;
    }
);

extern_methods!(
    unsafe impl SCShareableContent {
        #[method(getShareableContentExcludingDesktopWindows:onScreenWindowsOnly:completionHandler:)]
        pub unsafe fn get_shareable_content(
            excluding_desktop: bool,
            on_screen_only: bool,
            handler: &block2::Block<dyn Fn(*mut SCShareableContent, *mut NSError)>,
        );
    }
);

// --- SCDisplay ---
extern_class!(
    pub struct SCDisplay;
    unsafe impl ClassType for SCDisplay {
        type Super = NSObject;
    }
);

extern_methods!(
    unsafe impl SCDisplay {
        #[method(displayID)]
        pub fn display_id(&self) -> u32;

        #[method(width)]
        pub fn width(&self) -> usize;

        #[method(height)]
        pub fn height(&self) -> usize;
    }
);

// --- SCStreamConfiguration ---
extern_class!(
    pub struct SCStreamConfiguration;
    unsafe impl ClassType for SCStreamConfiguration {
        type Super = NSObject;
    }
);

extern_methods!(
    unsafe impl SCStreamConfiguration {
        #[method_id(new)]
        pub fn new() -> Id<Self>;

        #[method(setWidth:)]
        pub fn set_width(&self, width: usize);

        #[method(setHeight:)]
        pub fn set_height(&self, height: usize);

        #[method(setMinimumFrameInterval:)]
        pub fn set_minimum_frame_interval(&self, interval: CMTime);

        #[method(setPixelFormat:)]
        pub fn set_pixel_format(&self, format: u32);

        #[method(setCapturesAudio:)]
        pub fn set_captures_audio(&self, captures: bool);

        #[method(setShowsCursor:)]
        pub fn set_shows_cursor(&self, shows: bool);
    }
);

// --- SCContentFilter ---
extern_class!(
    pub struct SCContentFilter;
    unsafe impl ClassType for SCContentFilter {
        type Super = NSObject;
    }
);

extern_methods!(
    unsafe impl SCContentFilter {
        #[method_id(initWithDisplay:excludingWindows:)]
        pub fn init_with_display(
            this: Allocated<Self>,
            display: &SCDisplay,
            excluding: &NSArray<SCWindow>,
        ) -> Id<Self>;
    }
);

// --- SCStream ---
extern_class!(
    pub struct SCStream;
    unsafe impl ClassType for SCStream {
        type Super = NSObject;
    }
);

extern_methods!(
    unsafe impl SCStream {
        #[method_id(initWithFilter:configuration:delegate:)]
        pub fn init(
            this: Allocated<Self>,
            filter: &SCContentFilter,
            config: &SCStreamConfiguration,
            delegate: Option<&ProtocolObject<dyn SCStreamDelegate>>,
        ) -> Id<Self>;

        #[method(addStreamOutput:type:sampleHandlerQueue:error:)]
        pub fn add_stream_output(
            &self,
            output: &ProtocolObject<dyn SCStreamOutput>,
            output_type: isize, // SCStreamOutputType
            queue: Option<&dispatch::Queue>,
        ) -> Result<(), Id<NSError>>;

        #[method(startCaptureWithCompletionHandler:)]
        pub fn start_capture(
            &self,
            handler: &block2::Block<dyn Fn(*mut NSError)>,
        );

        #[method(stopCaptureWithCompletionHandler:)]
        pub fn stop_capture(
            &self,
            handler: &block2::Block<dyn Fn(*mut NSError)>,
        );
    }
);
```

### B. CGEvent Tap for Mouse Logging

```rust
use core_graphics::event::*;

pub struct MouseLogger {
    tap: Option<CGEventTap>,
    events: Arc<Mutex<Vec<MouseEvent>>>,
    epoch_ns: u64,
}

impl MouseLogger {
    pub fn start(epoch_ns: u64) -> Result<Self> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();

        let mask = CGEventMaskBit(CGEventType::LeftMouseDown)
            | CGEventMaskBit(CGEventType::RightMouseDown)
            | CGEventMaskBit(CGEventType::MouseMoved)
            | CGEventMaskBit(CGEventType::LeftMouseDragged)
            | CGEventMaskBit(CGEventType::ScrollWheel);

        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly, // passive, don't block events
            mask,
            move |_proxy, event_type, event| {
                let location = event.location();
                let timestamp_ns = mach_absolute_time_ns();

                let kind = match event_type {
                    CGEventType::LeftMouseDown => MouseEventKind::Click { button: MouseButton::Left },
                    CGEventType::RightMouseDown => MouseEventKind::Click { button: MouseButton::Right },
                    CGEventType::MouseMoved => MouseEventKind::Move,
                    CGEventType::LeftMouseDragged => MouseEventKind::Move,
                    CGEventType::ScrollWheel => MouseEventKind::Scroll,
                    _ => return None,
                };

                let event = MouseEvent {
                    timestamp_ns: timestamp_ns - epoch_ns, // relative to recording start
                    kind,
                    position: (location.x, location.y),
                    screen_size: get_main_display_size(),
                };

                events_clone.lock().unwrap().push(event);
                None // don't modify the event
            },
        )?;

        tap.enable();

        Ok(Self { tap: Some(tap), events, epoch_ns })
    }

    pub fn stop(&mut self) -> Vec<MouseEvent> {
        if let Some(tap) = self.tap.take() {
            tap.disable();
        }
        std::mem::take(&mut self.events.lock().unwrap())
    }
}
```

### C. CVPixelBuffer → Metal Texture (Zero-Copy)

```rust
use objc2_metal as metal;
use objc2_core_video::*;

pub fn metal_texture_from_pixel_buffer(
    device: &metal::Device,
    pixel_buffer: &CVPixelBuffer,
    texture_cache: &CVMetalTextureCache,
) -> metal::Texture {
    let width = CVPixelBufferGetWidth(pixel_buffer);
    let height = CVPixelBufferGetHeight(pixel_buffer);

    // CVMetalTextureCache creates a Metal texture that shares
    // the same IOSurface as the CVPixelBuffer — zero copy!
    let mut cv_texture: CVMetalTexture = std::ptr::null_mut();
    let status = CVMetalTextureCacheCreateTextureFromImage(
        std::ptr::null(),       // allocator
        texture_cache,
        pixel_buffer,
        std::ptr::null(),       // texture attributes
        metal::MTLPixelFormat::BGRA8Unorm,
        width,
        height,
        0,                      // plane index
        &mut cv_texture,
    );
    assert_eq!(status, 0, "Failed to create Metal texture from CVPixelBuffer");

    // Extract the MTLTexture from the CVMetalTexture wrapper
    let metal_texture = CVMetalTextureGetTexture(cv_texture);
    metal_texture
}

pub fn create_output_pixel_buffer(width: u32, height: u32) -> CVPixelBuffer {
    let mut pixel_buffer: CVPixelBuffer = std::ptr::null_mut();

    // Key: kCVPixelBufferIOSurfacePropertiesKey ensures the buffer
    // is backed by an IOSurface, making it zero-copy accessible to
    // both Metal and VideoToolbox
    let attrs = NSDictionary::from_keys_and_objects(
        &[kCVPixelBufferIOSurfacePropertiesKey],
        &[NSDictionary::new()],
    );

    CVPixelBufferCreate(
        std::ptr::null(),
        width as usize,
        height as usize,
        kCVPixelFormatType_32BGRA,
        attrs.as_ptr(),
        &mut pixel_buffer,
    );

    pixel_buffer
}
```

---

*This blueprint is scoped to macOS. Windows/Linux support would be a future phase
building on the same frontend and project format, with platform-specific capture
and encoder implementations.*
