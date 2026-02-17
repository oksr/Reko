# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Reko?

Reko is a macOS screen recording and video editing app built with Tauri v2. It records screen, microphone, system audio, camera, and mouse events, then provides a Premiere-style NLE editor for trimming, zoom keyframes, transitions, and export.

## Architecture

Three-layer stack, all in one repo:

1. **Swift framework** (`RekoEngine/`) — native macOS capture and export engine using ScreenCaptureKit, AVFoundation, Metal, VideoToolbox, CoreMedia, CoreVideo, CoreGraphics, and CoreAudio. Compiled as a static library and linked into the Rust binary via `build.rs`. Exposes a C API (`capi.swift` with `@_cdecl` functions prefixed `ck_`). Key subsystems: `capture/` (screen, mic, camera, mouse logger), `recording/` (video/audio writers, pipeline), `export/` (Metal compositor, audio mixer, video decoder, pipeline).

2. **Rust/Tauri backend** (`src-tauri/`) — thin orchestration layer. `swift_ffi.rs` wraps the C API calls. Tauri commands in `src-tauri/src/commands/` (editor, export, permissions, recording, sources) are the IPC surface. `autozoom.rs` generates zoom keyframes from mouse click events. Tauri plugins: opener, global-shortcut, notification, dialog. Project data is stored as JSON in `~/Library/Application Support/com.reko.app/projects/{id}/project.json` with raw media in a `raw/` subdirectory.

3. **React frontend** (`src/`) — single Vite entrypoint (`main.tsx`) that routes by Tauri window label with `window.location.pathname` fallback: `recorder` → `RecorderApp`, `editor*` → `EditorApp`, `window-picker` → `WindowPickerApp`, `onboarding` → `OnboardingApp`. State management via Zustand (`stores/editor-store.ts`) with Zundo for undo/redo. UI built with shadcn/ui + radix-ui + Tailwind CSS v4, icons via lucide-react, animations via motion (framer-motion).

### Key IPC flow
Frontend calls `invoke("command_name", { args })` → Tauri command in Rust → `RekoEngine` (Swift FFI) → returns JSON string → Rust deserializes and returns to frontend.

### Data model
- `ProjectState` — defined in both Rust (`src-tauri/src/project.rs`) and TypeScript (`src/types/index.ts`). Nested structs in Rust use `#[serde(rename_all = "camelCase")]` to match the frontend; top-level `ProjectState` fields use field-level serde attributes.
- `EditorProject` — TypeScript only (`src/types/editor.ts`), extends `ProjectState` with required `Effects` and `Sequence`.
- `Sequence` contains `Clip[]`, `Transition[]`, `OverlayTrack[]`, `Overlay[]` — the NLE timeline model. Defined in both Rust and TypeScript.
- `Effects` contains `BackgroundConfig`, `CameraBubbleConfig`, `FrameConfig`, `CursorConfig` — visual styling. Defined in both Rust and TypeScript.
- Zoom keyframes (`ZoomEvent[]`) are scoped per-clip in the sequence model.

## Build Commands

```bash
# Frontend dev server (Vite on :5173)
npm run dev

# Full Tauri app (builds Swift + Rust + starts Vite)
npx tauri dev

# Swift framework only
cd RekoEngine && swift build -c release

# Rust only (also triggers Swift build via build.rs)
cargo build --manifest-path src-tauri/Cargo.toml

# Production build
npx tauri build

# Lint
npm run lint

# Tests — frontend (vitest)
npm test                    # run all once
npx vitest run src/__tests__/sequence.test.ts  # single test file
npx vitest --watch          # watch mode

# Tests — Rust
cargo test --manifest-path src-tauri/Cargo.toml

# Tests — Swift
cd RekoEngine && swift test
```

## Skills

- **Tauri v2**: When working on ANY Tauri-related code (commands, IPC, capabilities, permissions, tauri.conf.json, window management, plugins, or anything in `src-tauri/`), you MUST invoke the `tauri-v2` skill BEFORE making changes. Tauri v2 has significant API differences from v1 and the skill contains up-to-date patterns.

## Project Conventions

- **Path alias**: `@/` maps to `src/` (configured in vite.config.ts and tsconfig.json)
- **Tauri v2**: no `title` field in `app` config section — use window-level titles. Icons must be RGBA PNG.
- **Swift FFI**: `@_cdecl` functions returning `strdup()` must use `UnsafeMutablePointer<CChar>?` (not `UnsafePointer`). All returned strings must be freed with `ck_free_string`.
- **Rust toolchain**: installed via Homebrew (not rustup)
- **Vite dev asset serving**: a custom `serveLocalAssets` plugin in `vite.config.ts` serves local files via `/__asset__/` prefix during development (workaround for Tauri's `asset://` being cross-origin blocked in dev).
- **ScreenCaptureKit**: SCStream delivers frames with multiple statuses. Only `.complete` frames have pixel data. Always filter by status before writing to AVAssetWriter — non-complete frames corrupt its internal state.
- **Editor store**: uses `temporal` middleware from Zundo. Only `project` state is tracked for undo. Playback state (`currentTime`, `isPlaying`) is excluded. Use `pauseUndo()`/`resumeUndo()` during continuous drags.
- **Test setup**: vitest with jsdom, config in `vite.config.ts` (not a separate vitest config), setup file at `src/__tests__/setup.ts`. Setup mocks `@tauri-apps/api/core` `invoke` globally — individual tests override via `vi.mocked()`.
