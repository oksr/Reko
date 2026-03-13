# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Reko?

Reko is a macOS screen recording and video editing app built with Tauri v2. It records screen, microphone, system audio, camera, and mouse events, then provides a Premiere-style NLE editor for trimming, zoom keyframes, transitions, and export.

## Architecture

**Monorepo with pnpm workspaces** — packages live under `apps/`:

- `apps/app/` (`@reko/app`) — platform-agnostic React UI. Zero `@tauri-apps` imports. All platform I/O goes through the `Platform` interface (`apps/app/src/platform/types.ts`) injected via `PlatformProvider`. Tests live here.
- `apps/tauri/` (`@reko/tauri`) — Tauri shell. Implements `TauriPlatform` (`apps/tauri/src/platform/tauri-platform.ts`) and injects it via `PlatformProvider`. Imports `app/` source via `@app/*` alias.
- `apps/website/` (`@reko/website`) — marketing website.
- `RekoEngine/` — Swift static library (no pnpm package).

Three-layer stack:

1. **Swift framework** (`RekoEngine/`) — native macOS capture and export engine using ScreenCaptureKit, AVFoundation, VideoToolbox, CoreMedia, CoreVideo, CoreGraphics, and CoreAudio. Compiled as a static library and linked into the Rust binary via `build.rs`. Exposes a C API (`capi.swift` with `@_cdecl` functions prefixed `ck_`). Key subsystems: `capture/` (screen, mic, camera, mouse logger), `recording/` (video/audio writers, pipeline), `export/` (compositor, audio mixer, video decoder, pipeline).

2. **Rust/Tauri backend** (`apps/tauri/src-tauri/`) — thin orchestration layer. `swift_ffi.rs` wraps the C API calls. Tauri commands in `apps/tauri/src-tauri/src/commands/` (editor, export, permissions, recording, sources) are the IPC surface. `autozoom.rs` generates zoom keyframes from mouse click events. Tauri plugins: opener, global-shortcut, notification, dialog. Project data is stored as JSON in `~/Library/Application Support/com.reko.app/projects/{id}/project.json` with raw media in a `raw/` subdirectory.

3. **React frontend** (`apps/app/src/`) — single Vite entrypoint (`apps/app/src/main.tsx`) but rendered by `apps/tauri/src/main.tsx` which injects `TauriPlatform`. Routes by Tauri window label: `recorder` → `RecorderApp`, `editor*` → `EditorApp`, `window-picker` → `WindowPickerApp`, `onboarding` → `OnboardingApp`. State management via Zustand (`stores/editor-store.ts`) with Zundo for undo/redo. UI built with shadcn/ui + radix-ui + Tailwind CSS v4, icons via lucide-react, animations via motion (framer-motion).

### Platform interface
`apps/app/src/platform/types.ts` defines the `Platform` interface. Components call `usePlatform()` (from `apps/app/src/platform/PlatformContext.tsx`) instead of importing `@tauri-apps` directly. The `apps/tauri/` package provides `TauriPlatform` which implements the interface. Tests use `createMockPlatform()` from `apps/app/src/__tests__/mock-platform.ts`.

### Key IPC flow
Frontend `usePlatform().invoke("command_name", { args })` → `TauriPlatform.invoke` → Tauri command in Rust → `RekoEngine` (Swift FFI) → returns JSON string → Rust deserializes and returns to frontend.

### Data model
- `ProjectState` — defined in both Rust (`apps/tauri/src-tauri/src/project.rs`) and TypeScript (`apps/app/src/types/index.ts`). Nested structs in Rust use `#[serde(rename_all = "camelCase")]` to match the frontend; top-level `ProjectState` fields use field-level serde attributes.
- `EditorProject` — TypeScript only (`apps/app/src/types/editor.ts`), extends `ProjectState` with required `Effects` and `Sequence`.
- `Sequence` contains `Clip[]`, `Transition[]`, `OverlayTrack[]`, `Overlay[]` — the NLE timeline model. Defined in both Rust and TypeScript.
- `Effects` contains `BackgroundConfig`, `CameraBubbleConfig`, `FrameConfig`, `CursorConfig` — visual styling. Defined in both Rust and TypeScript.
- Zoom keyframes (`ZoomEvent[]`) are scoped per-clip in the sequence model.

## Build Commands

```bash
# Install all workspace dependencies
pnpm install

# Full Tauri app (builds Swift + Rust + starts Vite)
pnpm dev                    # delegates to @reko/tauri dev
# or:
pnpm --filter @reko/tauri tauri:dev

# Frontend only (apps/app/ dev server at :5173)
pnpm --filter @reko/app dev

# Build apps/app/ standalone
pnpm --filter @reko/app build

# Swift framework only
cd RekoEngine && swift build -c release

# Rust only (also triggers Swift build via build.rs)
cargo build --manifest-path apps/tauri/src-tauri/Cargo.toml

# Production build
pnpm build                  # builds app/ then tauri/
# or:
pnpm --filter @reko/tauri tauri:build

# Website
pnpm --filter @reko/website dev
pnpm --filter @reko/website build

# Lint
pnpm --filter @reko/app lint

# Tests — frontend (vitest, run from apps/app/)
pnpm --filter @reko/app test               # run all once
pnpm --filter @reko/app exec vitest run src/__tests__/sequence.test.ts  # single file
pnpm --filter @reko/app exec vitest --watch  # watch mode

# Tests — Rust
cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml

# Tests — Swift
cd RekoEngine && swift test
```

## Skills

- **Tauri v2**: When working on ANY Tauri-related code (commands, IPC, capabilities, permissions, tauri.conf.json, window management, plugins, or anything in `apps/tauri/src-tauri/`), you MUST invoke the `tauri-v2` skill BEFORE making changes. Tauri v2 has significant API differences from v1 and the skill contains up-to-date patterns.

## Project Conventions

- **Path alias**: `@/` maps to `apps/app/src/` in the app package; `@app/*` maps to `apps/app/src/*` in the tauri package.
- **No direct Tauri imports in apps/app/**: `apps/app/src/` must have zero `@tauri-apps` imports. Use `usePlatform()` instead.
- **Asset URLs**: Use `useAssetUrl()` hook (from `@/lib/asset-url`) inside React components/hooks. For non-hook contexts (e.g. class instances), pass `assetUrl` as a constructor parameter.
- **Tauri v2**: no `title` field in `app` config section — use window-level titles. Icons must be RGBA PNG.
- **Swift FFI**: `@_cdecl` functions returning `strdup()` must use `UnsafeMutablePointer<CChar>?` (not `UnsafePointer`). All returned strings must be freed with `ck_free_string`.
- **Rust toolchain**: installed via Homebrew (not rustup)
- **Vite dev asset serving**: a custom `serveLocalAssets` plugin in `apps/tauri/vite.config.ts` serves local files via `/__asset__/` prefix during development (workaround for Tauri's `asset://` being cross-origin blocked in dev).
- **ScreenCaptureKit**: SCStream delivers frames with multiple statuses. Only `.complete` frames have pixel data. Always filter by status before writing to AVAssetWriter — non-complete frames corrupt its internal state.
- **Editor store**: uses `temporal` middleware from Zundo. Only `project` state is tracked for undo. Playback state (`currentTime`, `isPlaying`) is excluded. Use `pauseUndo()`/`resumeUndo()` during continuous drags.
- **Test setup**: vitest with jsdom, config in `apps/app/vite.config.ts`, setup file at `apps/app/src/__tests__/setup.ts`. Tests use `renderWithPlatform()` / `renderHookWithPlatform()` from `apps/app/src/__tests__/render-with-platform.tsx` and `createMockPlatform()` from `mock-platform.ts` — no global `@tauri-apps` mocks.
- **Player app** (`apps/player/`): Public shareable video link viewer deployed to Cloudflare Pages (`reko-player.pages.dev`). Uses Tailwind CSS v4 for all styling — **no inline styles**. Custom theme tokens defined in `index.css` via `@theme` (colors: `surface`, `surface-dark`, `border`, `reko-red`). CSS custom properties for easing (`--ease-out-quint`, `--ease-out-cubic`). Utility classes like `.shadow-border`, `.player-input`, `.progress-bar`/`.progress-thumb` are defined in `index.css` for patterns Tailwind can't express natively. API base URL comes from `VITE_API_URL` env var (empty in dev — Vite proxy handles it via `vite.config.ts`).
