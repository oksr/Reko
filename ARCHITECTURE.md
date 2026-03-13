# Architecture

## Overview

Reko is a macOS screen recording and video editing application built with Tauri v2. It uses a three-layer architecture:

1. **Swift static library** (`RekoEngine/`) — native macOS capture and export engine
2. **Rust/Tauri backend** (`apps/tauri/src-tauri/`) — thin IPC orchestration layer
3. **React frontend** (`apps/app/src/`, rendered by `apps/tauri/`) — the full UI

The repository is a **pnpm monorepo** with workspaces in `apps/`. The Swift framework lives at the repo root outside the pnpm workspace.

## Repository Layout

```
reko/
├── apps/
│   ├── app/          # @reko/app — platform-agnostic React UI
│   ├── tauri/        # @reko/tauri — Tauri shell + TauriPlatform impl
│   └── website/      # @reko/website — marketing website
├── RekoEngine/       # Swift static library (not in pnpm workspace)
│   ├── Package.swift
│   └── Sources/RekoEngine/
├── docs/plans/
├── scripts/
├── package.json      # workspace root
└── pnpm-workspace.yaml
```

---

## Layer 1: Swift Framework (RekoEngine)

**Minimum macOS:** 14.0
**Apple frameworks:** ScreenCaptureKit, AVFoundation, VideoToolbox, Metal, CoreMedia, CoreVideo, CoreGraphics, CoreAudio

### Source Structure

```
RekoEngine/Sources/RekoEngine/
├── reko-engine.swift          # RekoEngine class (version string)
├── capi.swift                 # C API — all @_cdecl exports (ck_ prefix)
├── include/                   # C header declarations
├── capture/
│   ├── screen-capture.swift   # ScreenCaptureKit display/window capture
│   ├── mic-capture.swift      # AVCaptureDevice microphone capture
│   ├── camera-capture.swift   # AVCaptureDevice camera capture
│   └── mouse-logger.swift     # CGEvent mouse tap + JSONL output
└── recording/
    ├── recording-pipeline.swift  # Orchestrates all capture tracks
    ├── video-writer.swift        # AVAssetWriter for screen/camera video
    ├── audio-file-writer.swift   # AVAssetWriter for system audio
    └── mic-writer.swift          # AVAudioFile for microphone audio
```

### C API (capi.swift)

All functions use `@_cdecl` with the `ck_` prefix. Strings are returned via `strdup()` using `UnsafeMutablePointer<CChar>?` and must be freed with `ck_free_string`.

Key functions: `ck_list_displays`, `ck_list_windows`, `ck_list_audio_inputs`, `ck_list_cameras`, `ck_prewarm_camera`, `ck_start_recording`, `ck_pause_recording`, `ck_resume_recording`, `ck_stop_recording`, `ck_get_audio_levels`, `ck_check_*_permission`, `ck_request_*_permission`.

### RecordingPipeline

Central recording coordinator. On `start()`:

1. Determines capture source (display, window, or area) and dimensions
2. Creates `VideoWriter` for `screen.mov`
3. Optionally creates `AudioFileWriter` for `system_audio.wav`
4. Optionally starts `MicCapture` + `MicWriter` for `mic.wav`
5. Optionally starts `CameraCapture` + `VideoWriter` for `camera.mov` (reuses pre-warmed camera if available)
6. Starts `MouseLogger` → `mouse_events.jsonl`
7. Sets `isRecording = true` then starts `SCStream`

All track callbacks guard on `isRecording && !isPaused`, so tracks start and stop in sync.

On `stop()`, all tracks finish writing, then duration is computed from `mach_absolute_time` minus total paused nanoseconds.

---

## Layer 2: Rust / Tauri Backend

### Build Process

`build.rs` automatically:

1. Detects target architecture from `CARGO_CFG_TARGET_ARCH`
2. Runs `swift build -c release --triple <arch>-apple-macosx` in `RekoEngine/`
3. Links the resulting static library via `rustc-link-lib=static=RekoEngine`
4. Links all required Apple frameworks

Building Rust automatically rebuilds Swift.

### Source Structure

```
apps/tauri/src-tauri/src/
├── main.rs            # binary entry point
├── lib.rs             # Tauri Builder setup, plugin registration, invoke_handler
├── swift_ffi.rs       # RekoEngine struct wrapping all C FFI calls
├── project.rs         # ProjectState, serde types, filesystem helpers
├── autozoom.rs        # Auto-zoom keyframe generation algorithm
├── tray.rs            # System tray icon and menu
└── commands/
    ├── sources.rs     # list_displays, list_audio_inputs, list_cameras, list_windows
    ├── recording.rs   # start/stop/pause/resume_recording, get_audio_levels
    ├── editor.rs      # open_editor, list/load/save_project, generate_auto_zoom, wallpapers
    ├── export.rs      # write_export_file, mux_audio (via ffmpeg)
    ├── permissions.rs # check/request_permission, open_permission_settings
    └── unsplash.rs    # unsplash_search_photos, unsplash_get_topic_photos
```

### Tauri Plugins

opener, global-shortcut, notification, dialog, updater (GitHub releases), process, cli

### swift_ffi.rs

Wraps all `extern "C"` function declarations and provides safe Rust methods on `struct RekoEngine`. The `call_json` helper handles the `out_ptr: *mut *const c_char` pattern: calls the Swift function, reads the null-terminated JSON string, calls `ck_free_string`, and returns a `String`.

### autozoom.rs

Pure algorithmic module (no FFI, no I/O). Takes `Vec<MouseEvent>` and a `zoom_scale`, produces `Vec<ZoomEvent>`.

Four-pass algorithm:

1. **Filter noise** — discard non-click events and rapid double-clicks
2. **Group into sessions** — cluster clicks by spatial proximity and time gap
3. **Sessions → ZoomEvents** — each session becomes a zoom with lead-in and hold-after
4. **Merge nearby events** — close events are merged, blending centers by duration weight

### Export Flow

1. Frontend renders frames via WebCodecs + WebGL → video-only MP4 in memory
2. `write_export_file` — writes bytes to a temp path
3. `mux_audio` — invokes `ffmpeg` to combine video with mic/system audio into final MP4

---

## Layer 3: React Frontend

### Package Split


| Package       | Description                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------- |
| `apps/app/`   | Platform-agnostic React UI. Zero `@tauri-apps` imports. All I/O through `Platform` interface. |
| `apps/tauri/` | Tauri shell. Implements `TauriPlatform`. Imports `app/` source via `@app/`* alias.            |


### Entry Point and Window Routing

`apps/tauri/src/main.tsx` injects `tauriPlatform` into `PlatformProvider` and mounts `Root`. The `Root` component routes by Tauri window label:


| Window Label     | Component          |
| ---------------- | ------------------ |
| `recorder`       | `RecorderApp`      |
| `editor-*`       | `EditorApp`        |
| `window-picker`  | `WindowPickerApp`  |
| `area-selection` | `AreaSelectionApp` |
| `onboarding`     | `OnboardingApp`    |
| `camera-preview` | `CameraPreviewApp` |


### Platform Abstraction

The `Platform` interface (`apps/app/src/platform/types.ts`) is the single abstraction barrier between `@reko/app` and Tauri:

```typescript
interface Platform {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  window: PlatformWindow
  navigation: PlatformNavigation
  filesystem: PlatformFilesystem
  events: PlatformEvents
  shortcuts: PlatformShortcuts
  monitor: PlatformMonitor
  menu: PlatformMenu
  isTauri: boolean
}
```

`TauriPlatform` (`apps/tauri/src/platform/tauri-platform.ts`) implements this using `@tauri-apps/api/*`. Components access it via `usePlatform()`. Tests use `createMockPlatform()`.

### Frontend Source Structure

```
apps/app/src/
├── root.tsx                   # Window label router
├── recorder-app.tsx           # Recording UI
├── editor-app.tsx             # Editor UI
├── platform/
│   ├── types.ts               # Platform interface
│   └── PlatformContext.tsx    # usePlatform() hook + PlatformProvider
├── types/
│   ├── index.ts               # ProjectState, RecordingConfig, DisplayInfo, etc.
│   └── editor.ts              # EditorProject, Effects, Sequence, Clip, ZoomEvent, etc.
├── stores/
│   └── editor-store.ts        # Zustand store with Zundo undo/redo
├── hooks/
│   ├── use-preview-renderer.ts  # WebGL compositor render loop
│   ├── use-export.ts           # Export pipeline orchestration
│   ├── use-video-sync.ts       # <video> element seek/play sync
│   ├── use-playback-clock.ts   # Software playback clock
│   ├── use-keyboard-shortcuts.ts
│   ├── use-auto-save.ts        # Debounced project auto-save
│   ├── use-audio-waveform.ts   # Audio waveform data from WAV files
│   └── use-mouse-events.ts     # Loads mouse_events.jsonl
├── components/
│   ├── editor/
│   │   ├── preview-canvas.tsx  # WebGL canvas + video elements
│   │   ├── playback-controls.tsx
│   │   ├── export-button.tsx
│   │   ├── inspector/          # Right-panel settings
│   │   └── timeline/           # Timeline tracks, clips, zoom track, transitions
│   ├── recording/              # Recording bar, source pickers, permissions
│   └── ui/                     # shadcn/ui primitives
├── lib/
│   ├── sequence.ts             # Clip/sequence time math
│   ├── zoom-interpolation.ts   # ZoomEvent lerp/easing
│   ├── snap.ts                 # Timeline snapping
│   ├── asset-url.ts            # useAssetUrl() hook
│   ├── cursor-smoothing.ts     # Cursor position smoothing
│   ├── export/
│   │   ├── export-pipeline.ts  # Frame-by-frame WebCodecs export
│   │   ├── video-encoder.ts    # VideoEncoder wrapper
│   │   └── muxer.ts            # mp4-muxer wrapper
│   └── webgl-compositor/
│       ├── compositor.ts       # WebGLCompositor (WebGL2 multi-pass)
│       ├── layout.ts           # screenRect, cameraRect, applyZoomToRect
│       └── shaders/            # GLSL shaders (background, video, camera, cursor, etc.)
└── __tests__/
```

### Editor Store (Zustand + Zundo)

`useEditorStore` is the single source of truth for editor state with undo/redo via Zundo's `temporal` middleware.

- **Tracked for undo:** `project` only
- **Not tracked:** `currentTime`, `isPlaying`, `hoverTime`, `selectedClipIndex`, `activeTool`
- **Undo limit:** 100 entries
- **Drag handling:** `pauseUndo()` / `resumeUndo()` prevent flooding history during continuous drags

### WebGL Compositor

Multi-pass WebGL2 rendering pipeline:

1. **Background** — solid color, gradient, or image texture
2. **Video** — screen recording with zoom transform
3. **Motion blur** — screen-space blur based on pan/scale velocity
4. **Camera bubble** — PiP overlay with configurable shape, border, shadow
5. **Cursor** — spotlight or highlight ring
6. **Cursor icon** — custom cursor sprite
7. **Click ripple** — expanding ring animation on clicks

Used in both preview (`requestAnimationFrame`) and export (`OffscreenCanvas`).

---

## IPC Flow

```
React component
  └─ usePlatform().invoke("command_name", { args })
       └─ TauriPlatform.invoke
            └─ Tauri IPC bridge
                 └─ Rust #[tauri::command]
                      └─ RekoEngine::<method>()  (swift_ffi.rs)
                           └─ ck_<function>()   (Swift C API)
                                └─ native macOS API
```

Events flow in reverse: Swift → Rust → `app.emit_to(window_label, event, payload)` → `platform.events.listen()` in React.

---

## Data Model

### ProjectState

Defined in both Rust (`project.rs`) and TypeScript (`types/index.ts`). Stored at `~/Library/Application Support/com.reko.app/projects/{id}/project.json`.

```
ProjectState
├── id: string (UUID)
├── name: string
├── created_at: number (Unix ms)
├── tracks: { screen, mic?, system_audio?, camera?, mouse_events? }
├── timeline: { duration_ms, in_point, out_point }
├── effects: Effects | null
├── sequence: Sequence | null
└── autoZoomSettings: AutoZoomSettings | null
```

### Effects

```
Effects
├── background: BackgroundConfig  (type, color, gradient, padding, image, wallpaper)
├── cameraBubble: CameraBubbleConfig  (visible, position, size, shape, border, shadow)
├── frame: FrameConfig  (borderRadius, shadow, shadowIntensity)
└── cursor: CursorConfig  (enabled, icon, size, highlight, clickHighlight)
```

### Sequence (NLE Timeline)

```
Sequence
├── clips: Clip[]
│   └── Clip { id, sourceStart, sourceEnd, speed, zoomEvents: ZoomEvent[] }
├── transitions: (Transition | null)[]
│   └── Transition { type: "cut"|"crossfade"|"dissolve"|"fade-through-black", durationMs }
├── overlayTracks: OverlayTrack[]
└── overlays: Overlay[]
```

### Serde Conventions

Nested structs use `#[serde(rename_all = "camelCase")]`. Top-level `ProjectState` uses field-level serde attributes. New optional fields use `#[serde(default)]` for backward compatibility.

---

## Window Architecture


| Window         | Label            | Purpose                | Decorations       | Transparent |
| -------------- | ---------------- | ---------------------- | ----------------- | ----------- |
| Recorder       | `recorder`       | Floating recording bar | Frameless         | Yes         |
| Editor         | `editor-{uuid}`  | NLE editor             | Title bar overlay | No          |
| Window Picker  | `window-picker`  | Pick app window        | No                | Yes         |
| Area Selection | `area-selection` | Drag-to-select area    | No                | Yes         |
| Onboarding     | `onboarding`     | First-run flow         | Standard          | No          |
| Camera Preview | `camera-preview` | Floating camera PiP    | No                | Yes         |


The recorder window hides on close (app stays alive in menu bar). Editor windows re-show the recorder when destroyed.

---

## Testing


| Layer    | Command                                                      | Framework      |
| -------- | ------------------------------------------------------------ | -------------- |
| Frontend | `pnpm --filter @reko/app test`                               | Vitest + jsdom |
| Rust     | `cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml` | cargo test     |
| Swift    | `cd RekoEngine && swift test`                                | swift test     |


Frontend tests use `renderWithPlatform()` and `createMockPlatform()` — no global `@tauri-apps` mocks needed thanks to the Platform abstraction.

---

## Build System


| Command                                                       | Description                                     |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `pnpm dev`                                                    | Full Tauri app (Swift + Rust + Vite dev server) |
| `pnpm --filter @reko/app dev`                                 | Frontend only at localhost:5173                 |
| `pnpm build`                                                  | Production build (app + tauri)                  |
| `cd RekoEngine && swift build -c release`                     | Swift framework only                            |
| `cargo build --manifest-path apps/tauri/src-tauri/Cargo.toml` | Rust + Swift                                    |


Rust toolchain is installed via Homebrew (not rustup).