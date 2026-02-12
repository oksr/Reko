# CaptureKit Architecture Design

> Validated architecture for CaptureKit, a ScreenStudio-style macOS screen recording and editing app.
> This document revises the original blueprint based on architectural review.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Native API layer | Swift framework ("CaptureKitEngine") | Eliminates ~3-5k lines of unsafe Rust FFI. ARC manages GPU surface lifetimes correctly. First-class Apple API support, docs, and tooling. |
| App shell | Tauri v2 (Rust) + React | Faster UI iteration, rich component ecosystem, cross-platform potential. |
| Swift-Rust bridge | Thin C API (~15-20 functions) | High-level commands + file paths + progress callbacks. No pixel data crosses the boundary. |
| Preview/export parity | Minimize drift | Share math (zoom interpolation, layout) between TypeScript and Metal shaders. Visual regression tests catch divergence. |
| Undo/redo | Must have for v1 | Zustand + temporal middleware. Immutable state updates designed in from day one. |

---

## Architecture

### Layer Diagram

```
+-----------------------------------------------------+
|  React + TypeScript + WebGL2 (Frontend)              |
|  - Editor UI (timeline, inspector, source picker)    |
|  - Preview compositor (WebGL2 shaders)               |
|  - Plays .mov/.wav files directly via <video>/<audio>|
|  - Zoom interpolation, layout math                   |
|  - Project state (Zustand + temporal undo/redo)      |
+-----------------------------------------------------+
|  Rust / Tauri (Middle Layer)                         |
|  - IPC bridge (frontend <-> Swift)                   |
|  - Project persistence (JSON read/write)             |
|  - Auto-zoom keyframe generator (pure math)          |
|  - File path management                              |
+-----------------------------------------------------+
|  C API boundary (~15-20 functions)                   |
|  - Commands: start/stop recording, start export      |
|  - Queries: list displays/cameras/mics, check perms  |
|  - Callbacks: progress, errors, recording status     |
|  - Data: config structs, file paths, JSON strings    |
|  - Never: raw pixel buffers or frame data            |
+-----------------------------------------------------+
|  Swift Framework - "CaptureKitEngine" (Native)       |
|  - ScreenCaptureKit capture                          |
|  - AVFoundation camera                               |
|  - Audio capture (AVAudioEngine)                     |
|  - CGEvent tap (mouse logging)                       |
|  - VideoToolbox encode (recording + export)          |
|  - Metal compositor (export only)                    |
|  - AVAssetWriter / AVAssetReader                     |
|  - Permission management                             |
+-----------------------------------------------------+
```

### Why This Split

**Swift handles everything that touches Apple APIs.** ScreenCaptureKit, AVFoundation, VideoToolbox, Metal, CoreGraphics — all have first-class Swift support with ARC memory management. The zero-copy GPU pipeline (CVPixelBuffer -> IOSurface -> MTLTexture -> VTCompressionSession) is memory-management-critical. ARC handles surface lifetimes automatically; manual retain/release from Rust is error-prone at 60fps.

**Rust handles everything that doesn't need platform APIs.** IPC, serialization, file I/O, project management, and pure-math operations like auto-zoom generation.

**The frontend is entirely self-sufficient during editing.** It reads .mov/.wav files from disk, composites via WebGL2, and plays audio natively. Swift is only active during recording and export.

---

## Data Flow

### Recording

```
User clicks Record
  -> Frontend sends config (display_id, mic_id, camera_id, fps) via Tauri IPC
  -> Rust passes config to Swift via C API
  -> Swift starts all capture sources internally
  -> Swift writes to disk continuously:
       raw/screen.mov         (H.264 via VideoToolbox hardware encoder)
       raw/camera.mov         (H.264 via VideoToolbox)
       raw/mic.wav            (PCM 48kHz)
       raw/system_audio.wav   (PCM 48kHz)
       raw/mouse_events.jsonl (from CGEvent tap)
  -> Swift sends status callbacks -> Rust -> Frontend
       (duration, dropped frames, disk usage)
  -> User clicks Stop
  -> Swift finalizes all files, returns file paths to Rust
  -> Rust creates project.json, returns ProjectState to frontend
```

### Editing (Swift is dormant)

```
Frontend loads project.json
  -> Mounts <video> elements pointing at screen.mov / camera.mov
  -> WebGL2 uses video elements as textures
  -> User adjusts effects -> Zustand updates -> WebGL2 re-renders preview
  -> User generates auto-zoom -> Rust does the math -> keyframes to frontend
  -> All edits stored as metadata in project.json (non-destructive)
  -> No IPC needed except project save
```

### Export

```
User clicks Export
  -> Frontend serializes full ProjectState (effects, keyframes, trim points)
  -> Rust passes project JSON + export config to Swift via C API
  -> Swift reads raw files from disk
  -> Swift decodes (VideoToolbox) -> composites (Metal) -> encodes (VideoToolbox)
  -> Swift reports progress via callback -> Rust -> Frontend
  -> Swift writes output.mp4, returns path
  -> Rust notifies frontend -> done
```

No pixel data ever crosses the C boundary. Swift reads and writes files. Rust passes JSON and file paths.

---

## C API Surface

The Swift framework exposes a C-compatible API that Rust calls via FFI.

```c
// === Source Discovery ===
CKResult ck_list_displays(CKDisplayList *out);
CKResult ck_list_cameras(CKCameraList *out);
CKResult ck_list_audio_inputs(CKAudioInputList *out);

// === Permissions ===
CKResult ck_check_permissions(CKPermissionStatus *out);
CKResult ck_request_permission(CKPermissionKind kind);

// === Recording ===
CKResult ck_start_recording(
    const CKRecordingConfig *config,
    CKRecordingCallbacks callbacks,    // progress, error function pointers
    CKSessionId *out
);
CKResult ck_pause_recording(CKSessionId session);
CKResult ck_resume_recording(CKSessionId session);
CKResult ck_stop_recording(
    CKSessionId session,
    CKRecordingResult *out             // file paths, duration, frame count
);

// === Export ===
CKResult ck_start_export(
    const char *project_json,          // full ProjectState as JSON
    const CKExportConfig *config,
    CKExportCallbacks callbacks,       // progress, complete, error
    CKExportId *out
);
CKResult ck_cancel_export(CKExportId export_id);

// === Cleanup ===
void ck_free_display_list(CKDisplayList *list);
void ck_free_camera_list(CKCameraList *list);
void ck_free_string(char *str);
```

Approximately 15-20 functions. Config structs are simple C structs. Complex data (ProjectState for export) passed as JSON strings to avoid mirroring the full data model in C.

---

## Frontend State Management

### Zustand Store with Undo/Redo

```typescript
// Core store shape — all fields are immutable-update friendly
interface ProjectState {
    id: string;
    name: string;
    tracks: TrackPaths;
    timeline: { inPoint: number; outPoint: number; duration: number };
    effects: Effects;        // background, frame style, camera, cursor, zoom keyframes
    mouseEvents: MouseEvent[];
    exportConfig: ExportConfig;
}

// Temporal middleware wraps the store for undo/redo
const useProjectStore = create<ProjectState>()(
    temporal(
        (set) => ({
            // ... state and actions
            // Every action uses immutable updates:
            setBackground: (bg) => set((s) => ({
                effects: { ...s.effects, background: bg }
            })),
            addZoomKeyframe: (kf) => set((s) => ({
                effects: {
                    ...s.effects,
                    zoomKeyframes: [...s.effects.zoomKeyframes, kf].sort(byTimestamp)
                }
            })),
        })
    )
);

// Undo/redo from anywhere:
const { undo, redo } = useProjectStore.temporal.getState();
```

All effect changes, trim adjustments, and keyframe edits flow through Zustand with automatic history tracking. Ctrl+Z/Cmd+Z works out of the box.

---

## Preview/Export Parity Strategy

Two renderers exist: WebGL2 (preview) and Metal (export). To minimize visual drift:

**Shared math (TypeScript):**
- Zoom interpolation (`interpolateZoom`, `applyEasing`, `lerpRegion`)
- Layout calculations (content rect positioning, camera bubble placement, padding)
- Cursor position mapping

**Metal shaders replicate the visual logic** of the WebGL2 shaders. The compositing order is identical:
1. Background (gradient/solid/image)
2. Screen frame with zoom crop + border radius
3. Cursor effects (highlight/spotlight)
4. Camera bubble

**Visual regression tests:** After export, compare a frame from the Metal output against the same frame rendered by WebGL2 (captured via `canvas.toBlob()`). Flag differences above a threshold. Run in CI on a set of test projects.

Minor differences in anti-aliasing and color blending between WebGL2 and Metal are acceptable — users won't notice sub-pixel differences.

---

## Revised Development Phases

### Phase 0 — Foundation (1-2 weeks)

**Goal:** Full chain works end-to-end. Button in frontend triggers Swift code.

- Tauri v2 project scaffold (React + Rust + Vite)
- Swift framework "CaptureKitEngine" (Xcode project or SwiftPM)
- C API header with one test function (`ck_get_version`)
- Rust FFI bindings calling the C API
- Build system: Swift framework compiles and links into Tauri app
- Verify: Frontend button -> Tauri IPC -> Rust -> C API -> Swift -> returns string -> Frontend displays it

**Deliverable:** Hello-world across the full stack.

### Phase 1 — Core Recording (2-3 weeks)

**Goal:** Record screen + mic to .mov file. Minimal UI.

- ScreenCaptureKit wrapper in Swift (~100 lines)
- Permission handling (screen, mic) via Swift, exposed through C API
- Mic capture via AVAudioEngine (Swift)
- VideoToolbox recording encoder (realtime mode, H.264)
- AVAssetWriter -> screen.mov + mic.wav
- C API: `ck_list_displays`, `ck_start_recording`, `ck_stop_recording`, `ck_check_permissions`
- Frontend: source picker, record/stop button, timer, permission gate

**Deliverable:** Record screen + mic, produces a playable .mov.

### Phase 2 — Camera + System Audio (2 weeks)

- AVFoundation camera capture in Swift
- Camera device picker in UI
- Separate camera.mov recording track
- ScreenCaptureKit system audio -> system_audio.wav
- Audio level meters in recording UI
- Pause/resume support
- Recording indicator

**Deliverable:** Full capture suite — screen, camera, mic, system audio.

### Phase 3 — Editor MVP (4 weeks)

- WebGL2 preview canvas
- Load screen.mov + camera.mov as `<video>` textures
- Basic composite render (screen + background)
- Timeline component (scrubber, tracks, duration)
- Playback controls (play/pause/seek)
- Trim handles (in/out points)
- Background config (gradient, solid, padding)
- Camera bubble overlay (circle, position, size)
- Frame style (border radius, shadow)
- Inspector panel UI
- Audio waveform display (wavesurfer.js)
- Zustand store with temporal undo/redo
- Keyboard shortcuts (Space = play, Cmd+Z = undo)
- Project auto-save

**Deliverable:** Preview styled composition. Trim. Adjust effects. Undo/redo.

### Phase 4 — Metal Export (3 weeks)

- Metal compositor in Swift (background + screen zoom + camera + cursor)
- VideoToolbox export encoder (non-realtime, quality-optimized)
- CVPixelBuffer -> MTLTexture zero-copy pipeline
- Audio mixer (mic + system -> stereo output)
- Full export pipeline (decode -> composite -> encode loop)
- C API: `ck_start_export`, `ck_cancel_export`, progress callbacks
- Export panel UI (resolution, codec, quality presets)
- Progress bar + ETA

**Deliverable:** One-click export producing polished video in seconds.

### Phase 5 — Auto-Zoom + Cursor Effects (2-3 weeks)

- CGEvent tap mouse logging in Swift (during recording)
- Mouse events written to mouse_events.jsonl
- Accessibility permission onboarding
- Auto-zoom generator in Rust (clicks -> keyframes, pure math)
- Zoom keyframe track in timeline UI
- Manual keyframe add/drag/delete
- Cursor highlight + spotlight in Metal compositor + WebGL2 preview
- Cursor style panel in inspector

**Deliverable:** Auto-zoom + cursor effects.

### Phase 6 — Polish + Distribution (2 weeks)

- Full keyboard shortcuts
- Onboarding flow (permissions + quick tutorial)
- Error handling + crash recovery
- Developer ID code signing + notarization
- DMG builder
- Sparkle auto-updater
- Crash reporting (Sentry)
- Analytics (PostHog)

### Total: ~16-18 weeks

---

## Risk Register (Revised)

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Swift framework + Tauri build integration | High | Medium | Solve in Phase 0. Use SwiftPM or Xcode project with a build script. Tauri's `beforeBuildCommand` can trigger `xcodebuild`. |
| WebGL2 preview drift from Metal export | Medium | Medium | Shared math in TypeScript. Visual regression tests. Minor sub-pixel differences acceptable. |
| CGEvent tap Accessibility permission friction | Medium | High | Clear onboarding flow. Fallback: record without mouse events, disable auto-zoom. |
| Timeline editor UI complexity | High | High | Budget 4 weeks. Start with minimal timeline, iterate. No off-the-shelf solution exists. |
| Large recordings fill disk (20 Mbps x 60 min = 9 GB) | Medium | Medium | Show disk space warning. Allow quality/bitrate config. |
| Undo/redo state bugs in complex editor | Medium | Medium | Temporal middleware handles history automatically. Test undo for every action type. |
| Code signing / notarization issues | Medium | Medium | Set up CI/CD early. Use Apple's notarytool. |

**Eliminated risk:** "ScreenCaptureKit Rust bindings immature" — no longer applicable with Swift.

---

## Tech Stack Summary

### Swift Framework (CaptureKitEngine)

| Framework | Purpose |
|-----------|---------|
| ScreenCaptureKit | Screen capture |
| AVFoundation | Camera capture |
| AVAudioEngine | Mic capture |
| VideoToolbox | H.264/H.265/ProRes encode and decode |
| Metal | GPU compositor (export) |
| CoreGraphics | CGEvent tap (mouse logging) |
| AVAssetWriter/Reader | .mov container I/O |

### Rust / Tauri

| Crate | Purpose |
|-------|---------|
| tauri 2.x | App framework |
| serde + serde_json | Serialization |
| tokio | Async runtime |
| uuid | Project IDs |
| tracing | Logging |
| anyhow | Error handling |

### Frontend (React)

| Package | Purpose |
|---------|---------|
| react + react-dom | UI |
| @tauri-apps/api v2 | Tauri IPC |
| zustand + temporal | State + undo/redo |
| wavesurfer.js | Audio waveforms |
| tailwindcss | Styling |
| lucide-react | Icons |
| vite | Build |

---

## What This Document Does Not Cover

- Detailed Metal shader code (see original blueprint appendix)
- Detailed data model types (see original blueprint section 4)
- IPC command signatures (see original blueprint section 5)
- Codebase file structure (see original blueprint section 6, adjust for Swift framework)

These remain valid from the original blueprint with the understanding that Rust capture/encode code becomes Swift.
