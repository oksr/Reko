# Phase 3: Editor MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a separate editor window with preview canvas, timeline, playback controls, trim, effects inspector, undo/redo, and basic export — while making the recorder window minimal.

**Architecture:** Two-window Tauri app. The recorder is a compact window for capture. After recording, the editor opens automatically in a separate full-size window. The editor uses CSS-layered `<video>` elements for preview compositing (background + screen frame + camera bubble), with a zustand + zundo store for undo/redo. No WebGL in this phase — CSS compositing is sufficient for the effects needed.

**Tech Stack:** Tauri v2 multi-window, React 19, zustand + zundo, CSS video compositing, Tailwind CSS

> **Review Note:** This plan was reviewed by a Distinguished Engineer, Design Engineer, and Senior PM. All critical findings have been incorporated. Audio waveforms (wavesurfer.js) are deferred to Phase 3.5 to make room for basic export, which closes the user's workflow loop. See review notes inline marked with `[REVIEW FIX]`.

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install zustand and zundo**

Run: `cd /Users/ofekseroussi/Dev/reko && npm install zustand zundo`

> [REVIEW FIX] wavesurfer.js removed — deferred to Phase 3.5 per PM recommendation to reclaim time for export.

**Step 2: Verify**

Run: `npm ls zustand zundo`
Expected: Both packages listed with versions.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add zustand and zundo dependencies"
```

---

## Task 2: Multi-Window Tauri Infrastructure

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Create: `src-tauri/capabilities/editor.json`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/commands/editor.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/Cargo.toml` (dev-dependencies)

**Step 1: Update tauri.conf.json — make recorder window small, add label**

Replace the `app` section in `src-tauri/tauri.conf.json`:

```json
{
  "app": {
    "windows": [
      {
        "label": "recorder",
        "title": "CaptureKit",
        "width": 420,
        "height": 520,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": {
          "allow": ["$APPDATA/com.capturekit.app/**"]
        }
      }
    }
  }
}
```

> [REVIEW FIX] Asset protocol scope narrowed from `$HOME/**` to `$APPDATA/com.capturekit.app/**`. The broad scope was a security risk — any XSS could read arbitrary user files. Scope to just the projects directory.

The recorder window starts at 420x520 (compact). Editor windows are created dynamically.

**Step 2: Update default.json capabilities for recorder window**

Replace `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the recorder window",
  "windows": ["recorder"],
  "permissions": [
    "core:default",
    "opener:default",
    "core:window:allow-create",
    "core:window:allow-close",
    "core:window:allow-set-focus",
    "core:webview:allow-create-webview-window"
  ]
}
```

**Step 3: Create editor.json capabilities for editor windows**

Create `src-tauri/capabilities/editor.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "editor",
  "description": "Capability for editor windows",
  "windows": ["editor-*"],
  "permissions": [
    "core:default",
    "opener:default",
    "core:window:allow-close",
    "core:window:allow-set-focus",
    "core:window:allow-set-title"
  ]
}
```

The `editor-*` glob matches any window with label starting with "editor-".

**Step 4: Create Rust editor commands module**

Create `src-tauri/src/commands/editor.rs`:

> [REVIEW FIX] All commands changed from `async` to sync. In Tauri v2, `async` commands run on a tokio thread pool, but `WebviewWindowBuilder::build()` MUST run on the main thread (AppKit requirement on macOS). Non-async `#[tauri::command]` functions run on the main thread. The commands also use `std::fs` (blocking I/O), which should not run on async threads. This was a P0 showstopper.

```rust
use tauri::webview::WebviewWindowBuilder;
use tauri::Manager;

use crate::project;

#[tauri::command]
pub fn open_editor(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    // Use first 12 chars of UUID to reduce collision risk (was 8)
    let label = format!("editor-{}", &project_id[..12.min(project_id.len())]);

    // If window already exists, focus it
    if let Some(window) = app_handle.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Load project to get its name for the window title
    let project_path = project::project_dir(&project_id).join("project.json");
    let title = if let Ok(data) = std::fs::read_to_string(&project_path) {
        if let Ok(p) = serde_json::from_str::<project::ProjectState>(&data) {
            format!("CaptureKit — {}", p.name)
        } else {
            "CaptureKit Editor".to_string()
        }
    } else {
        "CaptureKit Editor".to_string()
    };

    let url = format!("/editor?project={}", project_id);
    WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title(&title)
    .inner_size(1400.0, 900.0)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<project::ProjectState>, String> {
    let dir = project::projects_dir();
    let mut projects = Vec::new();

    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let project_json = entry.path().join("project.json");
        if project_json.exists() {
            if let Ok(data) = std::fs::read_to_string(&project_json) {
                if let Ok(project) = serde_json::from_str::<project::ProjectState>(&data) {
                    projects.push(project);
                }
            }
        }
    }

    projects.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(projects)
}

#[tauri::command]
pub fn load_project(project_id: String) -> Result<project::ProjectState, String> {
    let path = project::project_dir(&project_id).join("project.json");
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_project_state(project: project::ProjectState) -> Result<(), String> {
    project::save_project(&project)
}
```

**Step 5: Register editor module and commands**

Add to `src-tauri/src/commands/mod.rs`:

```rust
pub mod editor;
pub mod recording;
pub mod sources;
```

Update `src-tauri/src/lib.rs` invoke_handler to include new commands:

```rust
.invoke_handler(tauri::generate_handler![
    get_engine_version,
    commands::sources::list_displays,
    commands::sources::list_audio_inputs,
    commands::sources::list_cameras,
    commands::recording::start_recording,
    commands::recording::stop_recording,
    commands::recording::pause_recording,
    commands::recording::resume_recording,
    commands::recording::get_audio_levels,
    commands::editor::open_editor,
    commands::editor::list_projects,
    commands::editor::load_project,
    commands::editor::save_project_state,
])
```

**Step 6: Write tests for new Rust commands**

> [REVIEW FIX] Tests no longer use `tokio::runtime::Runtime` since commands are sync. The original tests would fail to compile because tokio wasn't in dev-dependencies.

Add to `src-tauri/src/commands/editor.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_projects_returns_vec() {
        let result = list_projects();
        // Should not error even if dir is empty
        assert!(result.is_ok());
    }

    #[test]
    fn test_load_project_errors_on_missing() {
        let result = load_project("nonexistent-id".to_string());
        assert!(result.is_err());
    }
}
```

**Step 7: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: All tests pass.

**Step 8: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/ src-tauri/src/commands/editor.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: multi-window Tauri infrastructure with editor commands"
```

---

## Task 3: Frontend Window Routing

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/main.tsx`
- Create: `src/recorder-app.tsx`
- Create: `src/editor-app.tsx`
- Modify: `src/App.tsx` (delete)

> [REVIEW FIX] Added Vite SPA fallback configuration. Without this, navigating to `/editor?project=xxx` in dev mode (Vite dev server) returns a 404 because there is no `/editor/index.html`. The `appType: 'spa'` default handles this, but we need to be explicit since Tauri's dev URL points at Vite.

**Step 1: Verify Vite SPA fallback**

The current `vite.config.ts` defaults to `appType: 'spa'` which serves `index.html` for all routes. This is correct for our routing approach. No changes needed if it works, but verify during smoke testing that `/editor` routes resolve correctly. If they don't, add `appType: 'spa'` explicitly to the config.

**Step 2: Create RecorderApp**

Move the existing App.tsx logic into `src/recorder-app.tsx`. Key changes from existing App.tsx:
- Auto-open editor after recording stops (no extra click needed)
- Add recent projects list using `list_projects` command
- Add "Save to Desktop" quick-export for users who don't need to edit

Create `src/recorder-app.tsx`:

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SourcePicker } from "@/components/recording/source-picker"
import { RecordButton } from "@/components/recording/record-button"
import { RecordingTimer } from "@/components/recording/recording-timer"
import { AudioLevelMeter } from "@/components/recording/audio-level-meter"
import { FolderOpen, Pencil } from "lucide-react"
import type { ProjectState } from "@/types"

export function RecorderApp() {
  const [selectedDisplay, setSelectedDisplay] = useState<number | null>(null)
  const [selectedMic, setSelectedMic] = useState<string | null>(null)
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [recentProjects, setRecentProjects] = useState<ProjectState[]>([])
  const [error, setError] = useState<string | null>(null)

  // Load recent projects on mount
  useEffect(() => {
    invoke<ProjectState[]>("list_projects")
      .then((projects) => setRecentProjects(projects.slice(0, 5)))
      .catch(() => {}) // Silently fail if no projects yet
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
          camera_id: selectedCamera,
          capture_system_audio: true,
          fps: 60,
        },
      })
      setIsRecording(true)
      setIsPaused(false)
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
      setIsPaused(false)
      // [REVIEW FIX] Auto-open editor immediately after recording stops
      // This eliminates the dead moment between stop and edit
      setRecentProjects((prev) => [project, ...prev.slice(0, 4)])
      await invoke("open_editor", { projectId: project.id })
    } catch (e) {
      setError(String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handlePause = async () => {
    try {
      await invoke("pause_recording")
      setIsPaused(true)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleResume = async () => {
    try {
      await invoke("resume_recording")
      setIsPaused(false)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleOpenEditor = async (projectId: string) => {
    try {
      await invoke("open_editor", { projectId })
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <main className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">CaptureKit</h1>
        <RecordingTimer isRecording={isRecording} isPaused={isPaused} />
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
      )}

      <Card>
        <CardContent className="pt-4 space-y-4">
          <SourcePicker
            onDisplaySelected={setSelectedDisplay}
            selectedDisplayId={selectedDisplay}
            onMicSelected={setSelectedMic}
            selectedMicId={selectedMic}
            onCameraSelected={setSelectedCamera}
            selectedCameraId={selectedCamera}
          />

          <div className="flex items-center gap-3">
            <RecordButton
              isRecording={isRecording}
              isPaused={isPaused}
              onStart={handleStart}
              onStop={handleStop}
              onPause={handlePause}
              onResume={handleResume}
              disabled={!selectedDisplay || isLoading}
            />
          </div>

          {isRecording && (
            <AudioLevelMeter isRecording={isRecording} isPaused={isPaused} />
          )}
        </CardContent>
      </Card>

      {/* [REVIEW FIX] Recent projects list — users need to find past recordings */}
      {!isRecording && recentProjects.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-medium mb-2">Recent</h2>
            <div className="space-y-2">
              {recentProjects.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <div className="truncate flex-1 mr-2">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(p.timeline.duration_ms / 1000).toFixed(1)}s
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleOpenEditor(p.id)}
                  >
                    <Pencil className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
```

**Step 3: Create EditorApp shell**

Create `src/editor-app.tsx`:

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import type { ProjectState } from "@/types"

export function EditorApp() {
  const [project, setProject] = useState<ProjectState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const projectId = params.get("project")
    if (!projectId) {
      setError("No project ID provided")
      return
    }

    invoke<ProjectState>("load_project", { projectId })
      .then(setProject)
      .catch((e) => setError(String(e)))
  }, [])

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading project...</p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="h-12 border-b flex items-center px-4 justify-between shrink-0">
        <h1 className="text-sm font-medium">{project.name}</h1>
        <span className="text-xs text-muted-foreground">
          {(project.timeline.duration_ms / 1000).toFixed(1)}s
        </span>
      </header>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Preview canvas area */}
        <div className="flex-1 flex items-center justify-center bg-muted/20 p-4">
          <p className="text-muted-foreground">Preview Canvas (Task 8)</p>
        </div>

        {/* Inspector sidebar — widened from w-72 to w-80 for more comfortable controls */}
        <aside className="w-80 border-l overflow-y-auto p-4">
          <p className="text-sm text-muted-foreground">Inspector (Task 12)</p>
        </aside>
      </div>

      {/* Timeline */}
      <div className="min-h-48 border-t shrink-0 p-4">
        <p className="text-sm text-muted-foreground">Timeline (Task 10)</p>
      </div>
    </div>
  )
}
```

**Step 4: Update main.tsx to route by window**

Replace `src/main.tsx`:

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { RecorderApp } from "./recorder-app"
import { EditorApp } from "./editor-app"

function Root() {
  const path = window.location.pathname
  const isEditor = path.startsWith("/editor")

  if (isEditor) {
    return <EditorApp />
  }
  return <RecorderApp />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
```

**Step 5: Delete old App.tsx**

Delete `src/App.tsx` — its logic is now in `src/recorder-app.tsx`.

**Step 6: Update existing tests**

Run: `npm test`
Expected: All existing tests pass (they test individual components, not App.tsx).

If any tests import `App`, update them to import `RecorderApp` instead.

**Step 7: Build check**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles without errors.

**Step 8: Commit**

```bash
git add src/main.tsx src/recorder-app.tsx src/editor-app.tsx
git rm src/App.tsx
git add src-tauri/
git commit -m "feat: two-window routing — recorder and editor shells"
```

---

## Task 4: Add `convertFileSrc` Support for Local Video Playback

**Files:**
- Create: `src/lib/asset-url.ts`

The editor needs to load `.mov` and `.wav` files from the project directory into `<video>` and `<audio>` elements. Tauri's `convertFileSrc` converts absolute file paths to URLs the webview can load.

**Step 1: Create a utility for asset URLs**

Create `src/lib/asset-url.ts`:

> [REVIEW FIX] Removed silent fallback to raw path. Returning a raw absolute path (e.g., `/Users/foo/screen.mov`) as a `<video src>` will never work in a webview — it would be treated as a relative URL. Instead, log the error so developers can debug.

```ts
import { convertFileSrc } from "@tauri-apps/api/core"

/**
 * Convert an absolute file path to a URL the webview can load.
 */
export function assetUrl(absolutePath: string): string {
  try {
    return convertFileSrc(absolutePath)
  } catch (e) {
    console.error("Failed to convert file path to asset URL:", absolutePath, e)
    return absolutePath
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/asset-url.ts
git commit -m "feat: asset URL utility for local file playback"
```

---

## Task 5: Zustand Editor Store with Undo/Redo

**Files:**
- Create: `src/stores/editor-store.ts`
- Create: `src/types/editor.ts`
- Create: `src/__tests__/editor-store.test.ts`

**Step 1: Define editor types**

Create `src/types/editor.ts`:

```ts
export interface EditorProject {
  id: string
  name: string
  created_at: number
  tracks: {
    screen: string
    mic: string | null
    system_audio: string | null
    camera: string | null
  }
  timeline: {
    duration_ms: number
    in_point: number
    out_point: number
  }
  effects: Effects
}

export interface Effects {
  background: BackgroundConfig
  cameraBubble: CameraBubbleConfig
  frame: FrameConfig
}

export interface BackgroundConfig {
  type: "solid" | "gradient" | "preset"
  color: string
  gradientFrom: string
  gradientTo: string
  gradientAngle: number
  padding: number
  presetId: string | null
}

// [REVIEW FIX] Added preset gradient data
export interface GradientPreset {
  id: string
  name: string
  from: string
  to: string
  angle: number
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "midnight", name: "Midnight", from: "#1a1a2e", to: "#16213e", angle: 135 },
  { id: "ocean", name: "Ocean", from: "#0f3443", to: "#34e89e", angle: 135 },
  { id: "sunset", name: "Sunset", from: "#f12711", to: "#f5af19", angle: 135 },
  { id: "lavender", name: "Lavender", from: "#834d9b", to: "#d04ed6", angle: 135 },
  { id: "forest", name: "Forest", from: "#0b486b", to: "#416d3d", angle: 135 },
  { id: "slate", name: "Slate", from: "#2c3e50", to: "#4ca1af", angle: 135 },
  { id: "ember", name: "Ember", from: "#cb2d3e", to: "#ef473a", angle: 135 },
  { id: "arctic", name: "Arctic", from: "#2193b0", to: "#6dd5ed", angle: 135 },
]

export interface CameraBubbleConfig {
  visible: boolean
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  size: number // percentage of canvas width (5-30)
  shape: "circle" | "rounded"
  borderWidth: number
  borderColor: string
}

export interface FrameConfig {
  borderRadius: number
  shadow: boolean
  shadowIntensity: number // 0-1
}
```

**Step 2: Create the zustand store with zundo**

> [REVIEW FIX] Added `handleSet` with throttle to debounce undo entries. Without this, dragging a slider from 0 to 20 creates 20 undo states. With the throttle, rapid changes are coalesced into one undo entry per 500ms.

Create `src/stores/editor-store.ts`:

```ts
import { create } from "zustand"
import { temporal } from "zundo"
import type { EditorProject, Effects, BackgroundConfig, CameraBubbleConfig, FrameConfig } from "@/types/editor"

const DEFAULT_EFFECTS: Effects = {
  background: {
    type: "gradient",
    color: "#1a1a2e",
    gradientFrom: "#1a1a2e",
    gradientTo: "#16213e",
    gradientAngle: 135,
    padding: 8,
    presetId: "midnight",
  },
  cameraBubble: {
    visible: true,
    position: "bottom-right",
    size: 15,
    shape: "circle",
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  frame: {
    borderRadius: 12,
    shadow: true,
    shadowIntensity: 0.5,
  },
}

interface EditorState {
  // Project data
  project: EditorProject | null

  // Playback state (NOT tracked by undo)
  currentTime: number
  isPlaying: boolean

  // Actions
  loadProject: (project: EditorProject) => void
  setInPoint: (ms: number) => void
  setOutPoint: (ms: number) => void
  setBackground: (bg: Partial<BackgroundConfig>) => void
  setCameraBubble: (config: Partial<CameraBubbleConfig>) => void
  setFrame: (config: Partial<FrameConfig>) => void
  setCurrentTime: (ms: number) => void
  setIsPlaying: (playing: boolean) => void
}

// State that gets tracked for undo/redo
type TrackedState = Pick<EditorState, "project">

// Throttle helper for undo debouncing
function throttle<T extends (...args: any[]) => any>(fn: T, ms: number): T {
  let lastCall = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: any[]) => {
    const now = Date.now()
    if (timer) clearTimeout(timer)
    if (now - lastCall >= ms) {
      lastCall = now
      fn(...args)
    } else {
      timer = setTimeout(() => {
        lastCall = Date.now()
        fn(...args)
      }, ms - (now - lastCall))
    }
  }) as T
}

export const useEditorStore = create<EditorState>()(
  temporal(
    (set) => ({
      project: null,
      currentTime: 0,
      isPlaying: false,

      loadProject: (project) => {
        // Ensure project has effects
        const withEffects: EditorProject = {
          ...project,
          effects: project.effects ?? { ...DEFAULT_EFFECTS },
        }
        set({ project: withEffects, currentTime: 0, isPlaying: false })
      },

      setInPoint: (ms) =>
        set((s) => {
          if (!s.project) return s
          // [REVIEW FIX] Validate against out_point
          const clamped = Math.min(ms, s.project.timeline.out_point - 100)
          return {
            project: {
              ...s.project,
              timeline: { ...s.project.timeline, in_point: Math.max(0, clamped) },
            },
          }
        }),

      setOutPoint: (ms) =>
        set((s) => {
          if (!s.project) return s
          // [REVIEW FIX] Validate against in_point
          const clamped = Math.max(ms, s.project.timeline.in_point + 100)
          return {
            project: {
              ...s.project,
              timeline: {
                ...s.project.timeline,
                out_point: Math.min(s.project.timeline.duration_ms, clamped),
              },
            },
          }
        }),

      setBackground: (bg) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: {
                ...s.project.effects,
                background: { ...s.project.effects.background, ...bg },
              },
            },
          }
        }),

      setCameraBubble: (config) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: {
                ...s.project.effects,
                cameraBubble: { ...s.project.effects.cameraBubble, ...config },
              },
            },
          }
        }),

      setFrame: (config) =>
        set((s) => {
          if (!s.project) return s
          return {
            project: {
              ...s.project,
              effects: {
                ...s.project.effects,
                frame: { ...s.project.effects.frame, ...config },
              },
            },
          }
        }),

      setCurrentTime: (ms) => set({ currentTime: ms }),
      setIsPlaying: (playing) => set({ isPlaying: playing }),
    }),
    {
      // Only track project state for undo/redo (not playback)
      partialize: (state): TrackedState => ({
        project: state.project,
      }),
      limit: 100,
      // [REVIEW FIX] Throttle undo tracking so slider drags don't create
      // excessive history entries. Coalesces changes within 500ms.
      handleSet: (handleSet) => throttle(handleSet, 500),
    }
  )
)
```

**Step 3: Write tests for the editor store**

Create `src/__tests__/editor-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

const MOCK_PROJECT: EditorProject = {
  id: "test-123",
  name: "Test Recording",
  created_at: Date.now(),
  tracks: {
    screen: "/path/to/screen.mov",
    mic: "/path/to/mic.wav",
    system_audio: null,
    camera: "/path/to/camera.mov",
  },
  timeline: {
    duration_ms: 10000,
    in_point: 0,
    out_point: 10000,
  },
  effects: {
    background: {
      type: "solid",
      color: "#000000",
      gradientFrom: "#000",
      gradientTo: "#111",
      gradientAngle: 135,
      padding: 8,
      presetId: null,
    },
    cameraBubble: {
      visible: true,
      position: "bottom-right",
      size: 15,
      shape: "circle",
      borderWidth: 3,
      borderColor: "#ffffff",
    },
    frame: {
      borderRadius: 12,
      shadow: true,
      shadowIntensity: 0.5,
    },
  },
}

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
    useEditorStore.temporal.getState().clear()
  })

  it("loads a project", () => {
    const { project } = useEditorStore.getState()
    expect(project?.id).toBe("test-123")
    expect(project?.tracks.screen).toBe("/path/to/screen.mov")
  })

  it("sets in point with validation", () => {
    useEditorStore.getState().setInPoint(2000)
    expect(useEditorStore.getState().project?.timeline.in_point).toBe(2000)
  })

  it("clamps in point to not exceed out point", () => {
    useEditorStore.getState().setOutPoint(5000)
    useEditorStore.getState().setInPoint(6000) // past out_point
    expect(useEditorStore.getState().project?.timeline.in_point).toBeLessThan(5000)
  })

  it("sets out point with validation", () => {
    useEditorStore.getState().setOutPoint(8000)
    expect(useEditorStore.getState().project?.timeline.out_point).toBe(8000)
  })

  it("updates background", () => {
    useEditorStore.getState().setBackground({ color: "#ff0000", type: "solid" })
    const bg = useEditorStore.getState().project?.effects.background
    expect(bg?.color).toBe("#ff0000")
    expect(bg?.type).toBe("solid")
    expect(bg?.padding).toBe(8)
  })

  it("updates camera bubble", () => {
    useEditorStore.getState().setCameraBubble({ size: 20, position: "top-left" })
    const cam = useEditorStore.getState().project?.effects.cameraBubble
    expect(cam?.size).toBe(20)
    expect(cam?.position).toBe("top-left")
    expect(cam?.shape).toBe("circle")
  })

  it("updates frame config", () => {
    useEditorStore.getState().setFrame({ borderRadius: 24, shadow: false })
    const frame = useEditorStore.getState().project?.effects.frame
    expect(frame?.borderRadius).toBe(24)
    expect(frame?.shadow).toBe(false)
  })

  it("undo reverts last change", async () => {
    useEditorStore.getState().setBackground({ color: "#ff0000" })
    // Wait for throttle to flush
    await new Promise((r) => setTimeout(r, 600))
    expect(useEditorStore.getState().project?.effects.background.color).toBe("#ff0000")

    useEditorStore.temporal.getState().undo()
    expect(useEditorStore.getState().project?.effects.background.color).toBe("#000000")
  })

  it("redo restores undone change", async () => {
    useEditorStore.getState().setBackground({ color: "#ff0000" })
    await new Promise((r) => setTimeout(r, 600))
    useEditorStore.temporal.getState().undo()
    useEditorStore.temporal.getState().redo()
    expect(useEditorStore.getState().project?.effects.background.color).toBe("#ff0000")
  })

  it("playback state is NOT tracked by undo", () => {
    useEditorStore.getState().setCurrentTime(5000)
    useEditorStore.getState().setIsPlaying(true)

    const { pastStates } = useEditorStore.temporal.getState()
    expect(pastStates.length).toBe(0)
  })
})
```

**Step 4: Run tests**

Run: `npm test`
Expected: All editor store tests pass.

**Step 5: Commit**

```bash
git add src/types/editor.ts src/stores/editor-store.ts src/__tests__/editor-store.test.ts
git commit -m "feat: zustand editor store with zundo undo/redo"
```

---

## Task 6: Extend ProjectState to Include Effects

The Rust `ProjectState` needs an `effects` field so the editor's effect changes persist to disk.

**Files:**
- Modify: `src-tauri/src/project.rs`
- Modify: `src/types/index.ts`

**Step 1: Add Effects types to Rust project.rs**

> [REVIEW FIX] Use `#[serde(rename_all = "camelCase")]` on structs instead of individual `#[serde(rename)]` on each field. The per-field approach is error-prone — miss one rename and you get a silent deserialization failure.

Add to `src-tauri/src/project.rs`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Effects {
    pub background: BackgroundConfig,
    pub camera_bubble: CameraBubbleConfig,
    pub frame: FrameConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundConfig {
    #[serde(rename = "type")]
    pub bg_type: String,
    pub color: String,
    pub gradient_from: String,
    pub gradient_to: String,
    pub gradient_angle: f64,
    pub padding: f64,
    pub preset_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CameraBubbleConfig {
    pub visible: bool,
    pub position: String,
    pub size: f64,
    pub shape: String,
    pub border_width: f64,
    pub border_color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrameConfig {
    pub border_radius: f64,
    pub shadow: bool,
    pub shadow_intensity: f64,
}
```

Add `effects` field to `ProjectState`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectState {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub tracks: Tracks,
    pub timeline: Timeline,
    #[serde(default)]
    pub effects: Option<Effects>,
}
```

Use `Option<Effects>` with `#[serde(default)]` so existing projects without effects still deserialize.

**Step 2: Add serde round-trip test for Effects**

> [REVIEW FIX] The original tests were shallow. Add explicit serialization/deserialization test for `ProjectState` with effects to catch rename issues.

Add to the existing tests in `project.rs`:

```rust
#[test]
fn test_project_state_with_effects_roundtrip() {
    let project = ProjectState {
        id: "test".to_string(),
        name: "Test".to_string(),
        created_at: 12345,
        tracks: Tracks {
            screen: "screen.mov".to_string(),
            mic: None,
            system_audio: None,
            camera: None,
        },
        timeline: Timeline {
            duration_ms: 5000,
            in_point: 0,
            out_point: 5000,
        },
        effects: Some(Effects {
            background: BackgroundConfig {
                bg_type: "gradient".to_string(),
                color: "#000".to_string(),
                gradient_from: "#1a1a2e".to_string(),
                gradient_to: "#16213e".to_string(),
                gradient_angle: 135.0,
                padding: 8.0,
                preset_id: Some("midnight".to_string()),
            },
            camera_bubble: CameraBubbleConfig {
                visible: true,
                position: "bottom-right".to_string(),
                size: 15.0,
                shape: "circle".to_string(),
                border_width: 3.0,
                border_color: "#ffffff".to_string(),
            },
            frame: FrameConfig {
                border_radius: 12.0,
                shadow: true,
                shadow_intensity: 0.5,
            },
        }),
    };
    let json = serde_json::to_string(&project).unwrap();
    // Verify camelCase serialization
    assert!(json.contains("cameraBubble"));
    assert!(json.contains("gradientFrom"));
    assert!(json.contains("borderRadius"));
    assert!(json.contains("shadowIntensity"));
    // Round-trip
    let parsed: ProjectState = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.effects.unwrap().frame.border_radius, 12.0);
}

#[test]
fn test_project_state_without_effects_deserializes() {
    let json = r#"{"id":"t","name":"T","created_at":0,"tracks":{"screen":"s.mov","mic":null,"system_audio":null,"camera":null},"timeline":{"duration_ms":5000,"in_point":0,"out_point":5000}}"#;
    let parsed: ProjectState = serde_json::from_str(json).unwrap();
    assert!(parsed.effects.is_none());
}
```

**Step 3: Update recording stop to include default effects**

In `src-tauri/src/commands/recording.rs`, add `effects: None` to the `ProjectState` construction in `stop_recording`. The editor will add defaults when loading.

**Step 4: Update frontend ProjectState type**

Update `src/types/index.ts` to add optional effects:

```ts
import type { Effects } from "./editor"

export interface ProjectState {
  id: string
  name: string
  created_at: number
  tracks: {
    screen: string
    mic: string | null
    system_audio: string | null
    camera: string | null
  }
  timeline: {
    duration_ms: number
    in_point: number
    out_point: number
  }
  effects?: Effects
}
```

**Step 5: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src-tauri/src/project.rs src-tauri/src/commands/recording.rs src/types/index.ts
git commit -m "feat: add Effects types to ProjectState (Rust + TS)"
```

---

## Task 7: Video Playback Sync Hook

**Files:**
- Create: `src/hooks/use-video-sync.ts`
- Create: `src/__tests__/use-video-sync.test.ts`

**Step 1: Create the useVideoSync hook**

> [REVIEW FIX] Three bugs fixed from original:
> 1. Use a ref for `onTimeUpdate` to prevent stale closure in RAF loop
> 2. Add out-point stop — playback must pause when reaching the out-point
> 3. Cleanup now pauses videos and clears the array on unmount

Create `src/hooks/use-video-sync.ts`:

```ts
import { useRef, useCallback, useEffect } from "react"
import { useEditorStore } from "@/stores/editor-store"

interface VideoSyncOptions {
  onTimeUpdate?: (timeMs: number) => void
}

export function useVideoSync(options: VideoSyncOptions = {}) {
  const videosRef = useRef<HTMLVideoElement[]>([])
  const rafRef = useRef<number>(0)
  // [REVIEW FIX] Use ref for callback to avoid stale closure in RAF loop
  const onTimeUpdateRef = useRef(options.onTimeUpdate)
  onTimeUpdateRef.current = options.onTimeUpdate

  const register = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return
    if (!videosRef.current.includes(video)) {
      videosRef.current.push(video)
    }
  }, [])

  const unregister = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return
    videosRef.current = videosRef.current.filter((v) => v !== video)
  }, [])

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    videosRef.current.forEach((v) => v.pause())
  }, [])

  const play = useCallback(async () => {
    const promises = videosRef.current.map((v) => v.play().catch(() => {}))
    await Promise.all(promises)

    const tick = () => {
      const primary = videosRef.current[0]
      if (primary && !primary.paused) {
        const timeMs = primary.currentTime * 1000
        onTimeUpdateRef.current?.(timeMs)

        // [REVIEW FIX] Stop playback at out-point
        const project = useEditorStore.getState().project
        if (project && timeMs >= project.timeline.out_point) {
          pause()
          useEditorStore.getState().setIsPlaying(false)
          return
        }

        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [pause])

  const seek = useCallback((timeMs: number) => {
    const timeSec = timeMs / 1000
    videosRef.current.forEach((v) => {
      v.currentTime = timeSec
    })
    onTimeUpdateRef.current?.(timeMs)
  }, [])

  const getCurrentTime = useCallback((): number => {
    const primary = videosRef.current[0]
    return primary ? primary.currentTime * 1000 : 0
  }, [])

  // [REVIEW FIX] Cleanup pauses videos and clears array
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      videosRef.current.forEach((v) => v.pause())
      videosRef.current = []
    }
  }, [])

  return { register, unregister, play, pause, seek, getCurrentTime }
}
```

**Step 2: Write tests**

Create `src/__tests__/use-video-sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useVideoSync } from "@/hooks/use-video-sync"

function createMockVideo(currentTime = 0): HTMLVideoElement {
  const video = {
    currentTime,
    paused: true,
    play: vi.fn().mockImplementation(function(this: any) {
      this.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn().mockImplementation(function(this: any) {
      this.paused = true
    }),
  } as unknown as HTMLVideoElement
  return video
}

describe("useVideoSync", () => {
  it("registers and unregisters videos", () => {
    const { result } = renderHook(() => useVideoSync())
    const video = createMockVideo()

    act(() => result.current.register(video))
    act(() => result.current.unregister(video))
  })

  it("seek sets currentTime on all registered videos", () => {
    const onTimeUpdate = vi.fn()
    const { result } = renderHook(() => useVideoSync({ onTimeUpdate }))
    const video1 = createMockVideo()
    const video2 = createMockVideo()

    act(() => {
      result.current.register(video1)
      result.current.register(video2)
    })

    act(() => result.current.seek(5000))
    expect(video1.currentTime).toBe(5)
    expect(video2.currentTime).toBe(5)
    expect(onTimeUpdate).toHaveBeenCalledWith(5000)
  })

  it("pause pauses all videos", () => {
    const { result } = renderHook(() => useVideoSync())
    const video = createMockVideo()

    act(() => result.current.register(video))
    act(() => result.current.pause())
    expect(video.pause).toHaveBeenCalled()
  })
})
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/hooks/use-video-sync.ts src/__tests__/use-video-sync.test.ts
git commit -m "feat: useVideoSync hook with out-point stop and stable callbacks"
```

---

## Task 8: Preview Compositor (CSS-Layered)

**Files:**
- Create: `src/components/editor/preview-canvas.tsx`
- Create: `src/__tests__/preview-canvas.test.tsx`

The preview uses layered `<video>` elements with CSS transforms. No WebGL needed for this phase.

**Step 1: Create the preview canvas component**

> [REVIEW FIX] Changes from original:
> 1. Fix ref cleanup — capture ref values at setup time (classic React ref-in-cleanup issue)
> 2. Add CSS `transition` on background/camera changes for smooth updates
> 3. Use multi-layer box-shadow for realistic depth
> 4. Add `onError` handler on video elements for missing file recovery

Create `src/components/editor/preview-canvas.tsx`:

```tsx
import { useRef, useEffect } from "react"
import { assetUrl } from "@/lib/asset-url"
import { useEditorStore } from "@/stores/editor-store"
import type { useVideoSync } from "@/hooks/use-video-sync"

interface PreviewCanvasProps {
  videoSync: ReturnType<typeof useVideoSync>
}

export function PreviewCanvas({ videoSync }: PreviewCanvasProps) {
  const project = useEditorStore((s) => s.project)
  const screenRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)

  // [REVIEW FIX] Capture ref values at setup time for correct cleanup
  useEffect(() => {
    const screen = screenRef.current
    const camera = cameraRef.current
    if (screen) videoSync.register(screen)
    if (camera) videoSync.register(camera)
    return () => {
      if (screen) videoSync.unregister(screen)
      if (camera) videoSync.unregister(camera)
    }
  }, [videoSync, project])

  if (!project) return null

  const { effects, tracks } = project
  const { background, cameraBubble, frame } = effects

  const bgStyle: React.CSSProperties =
    background.type === "gradient" || background.type === "preset"
      ? {
          background: `linear-gradient(${background.gradientAngle}deg, ${background.gradientFrom}, ${background.gradientTo})`,
        }
      : { backgroundColor: background.color }

  // [REVIEW FIX] Multi-layer shadow for realistic depth
  const multiLayerShadow = frame.shadow
    ? [
        `0 4px 6px rgba(0,0,0,${frame.shadowIntensity * 0.1})`,
        `0 12px 24px rgba(0,0,0,${frame.shadowIntensity * 0.15})`,
        `0 24px 48px rgba(0,0,0,${frame.shadowIntensity * 0.2})`,
      ].join(", ")
    : "none"

  const cameraPosMap = {
    "bottom-right": { bottom: "4%", right: "4%" },
    "bottom-left": { bottom: "4%", left: "4%" },
    "top-right": { top: "4%", right: "4%" },
    "top-left": { top: "4%", left: "4%" },
  } as const

  const cameraPos = cameraPosMap[cameraBubble.position]

  return (
    <div
      className="relative w-full aspect-video overflow-hidden ring-1 ring-white/5"
      style={{
        ...bgStyle,
        borderRadius: 8,
        // [REVIEW FIX] Smooth transitions when inspector values change
        transition: "background 200ms ease",
      }}
    >
      {/* Screen recording */}
      <div
        className="absolute inset-0"
        style={{
          padding: `${background.padding}%`,
          transition: "padding 200ms ease",
        }}
      >
        <video
          ref={screenRef}
          src={assetUrl(tracks.screen)}
          className="w-full h-full object-contain"
          style={{
            borderRadius: frame.borderRadius,
            boxShadow: multiLayerShadow,
            transition: "border-radius 200ms ease, box-shadow 200ms ease",
          }}
          muted
          playsInline
          preload="auto"
          onError={() => console.error("Failed to load screen video:", tracks.screen)}
        />
      </div>

      {/* Camera bubble */}
      {cameraBubble.visible && tracks.camera && (
        <video
          ref={cameraRef}
          src={assetUrl(tracks.camera)}
          className="absolute object-cover"
          style={{
            ...cameraPos,
            width: `${cameraBubble.size}%`,
            aspectRatio: "1",
            borderRadius: cameraBubble.shape === "circle" ? "50%" : "16px",
            border: `${cameraBubble.borderWidth}px solid ${cameraBubble.borderColor}`,
            // [REVIEW FIX] Multi-layer shadow on camera bubble too
            boxShadow: "0 2px 4px rgba(0,0,0,0.1), 0 8px 16px rgba(0,0,0,0.2)",
            transition: "all 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          muted
          playsInline
          preload="auto"
          onError={() => console.error("Failed to load camera video:", tracks.camera)}
        />
      )}
    </div>
  )
}
```

**Step 2: Write tests**

Create `src/__tests__/preview-canvas.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { PreviewCanvas } from "@/components/editor/preview-canvas"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

const MOCK_PROJECT: EditorProject = {
  id: "test-1",
  name: "Test",
  created_at: 0,
  tracks: { screen: "/screen.mov", mic: null, system_audio: null, camera: "/camera.mov" },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: true, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: true, shadowIntensity: 0.5 },
  },
}

const mockVideoSync = {
  register: vi.fn(),
  unregister: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
}

describe("PreviewCanvas", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
  })

  it("renders screen video", () => {
    render(<PreviewCanvas videoSync={mockVideoSync} />)
    const videos = document.querySelectorAll("video")
    expect(videos.length).toBeGreaterThanOrEqual(1)
  })

  it("renders camera video when visible", () => {
    render(<PreviewCanvas videoSync={mockVideoSync} />)
    const videos = document.querySelectorAll("video")
    expect(videos.length).toBe(2)
  })

  it("hides camera when not visible", () => {
    useEditorStore.getState().setCameraBubble({ visible: false })
    render(<PreviewCanvas videoSync={mockVideoSync} />)
    const videos = document.querySelectorAll("video")
    expect(videos.length).toBe(1)
  })
})
```

**Step 3: Run tests**

Run: `npm test`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/components/editor/preview-canvas.tsx src/__tests__/preview-canvas.test.tsx
git commit -m "feat: CSS-layered preview compositor with transitions"
```

---

## Task 9: Playback Controls

**Files:**
- Create: `src/components/editor/playback-controls.tsx`
- Create: `src/__tests__/playback-controls.test.tsx`

**Step 1: Create the playback controls component**

> [REVIEW FIX] Time display changed from `MM:SS` to `MM:SS.s` (one decimal) for more precise editing feedback. Added `tabular-nums` for stable digit widths.

Create `src/components/editor/playback-controls.tsx`:

```tsx
import { Button } from "@/components/ui/button"
import { Play, Pause, SkipBack, SkipForward } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import type { useVideoSync } from "@/hooks/use-video-sync"

interface PlaybackControlsProps {
  videoSync: ReturnType<typeof useVideoSync>
}

function formatTime(ms: number): string {
  const totalSeconds = ms / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${pad(minutes)}:${pad(Math.floor(seconds))}.${Math.floor((seconds % 1) * 10)}`
}

export function PlaybackControls({ videoSync }: PlaybackControlsProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying)

  if (!project) return null

  const { in_point, out_point } = project.timeline

  const handlePlayPause = async () => {
    if (isPlaying) {
      videoSync.pause()
      setIsPlaying(false)
    } else {
      await videoSync.play()
      setIsPlaying(true)
    }
  }

  const handleSkipBack = () => {
    videoSync.seek(in_point)
    setCurrentTime(in_point)
  }

  const handleSkipForward = () => {
    videoSync.seek(out_point)
    setCurrentTime(out_point)
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={handleSkipBack} title="Go to start">
        <SkipBack className="w-4 h-4" />
      </Button>

      <Button variant="ghost" size="icon" onClick={handlePlayPause} title={isPlaying ? "Pause" : "Play"}>
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>

      <Button variant="ghost" size="icon" onClick={handleSkipForward} title="Go to end">
        <SkipForward className="w-4 h-4" />
      </Button>

      {/* [REVIEW FIX] tabular-nums for stable digit widths */}
      <span className="text-xs font-mono text-muted-foreground ml-2" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatTime(currentTime)} / {formatTime(out_point - in_point)}
      </span>
    </div>
  )
}
```

**Step 2: Write tests**

Create `src/__tests__/playback-controls.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PlaybackControls } from "@/components/editor/playback-controls"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}))

const MOCK_PROJECT: EditorProject = {
  id: "t", name: "T", created_at: 0,
  tracks: { screen: "/s.mov", mic: null, system_audio: null, camera: null },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: false, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: false, shadowIntensity: 0 },
  },
}

const mockVideoSync = {
  register: vi.fn(), unregister: vi.fn(),
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(), seek: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
}

describe("PlaybackControls", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
    useEditorStore.getState().setIsPlaying(false)
  })

  it("renders play button when paused", () => {
    render(<PlaybackControls videoSync={mockVideoSync} />)
    expect(screen.getByTitle("Play")).toBeTruthy()
  })

  it("calls videoSync.play on play click", async () => {
    render(<PlaybackControls videoSync={mockVideoSync} />)
    await userEvent.click(screen.getByTitle("Play"))
    expect(mockVideoSync.play).toHaveBeenCalled()
  })
})
```

**Step 3: Run tests & Commit**

Run: `npm test`

```bash
git add src/components/editor/playback-controls.tsx src/__tests__/playback-controls.test.tsx
git commit -m "feat: playback controls with precise time display"
```

---

## Task 10: Timeline Component

**Files:**
- Create: `src/components/editor/timeline.tsx`
- Create: `src/__tests__/timeline.test.tsx`

> [REVIEW FIX] Changes from original:
> 1. Added time ruler with markers (0:00, 0:05, 0:10...)
> 2. Added dimmed overlay on trimmed-out regions (before in-point / after out-point)
> 3. Increased track color opacity from `/30` to `/40` for better visibility on dark bg
> 4. Trim handles widened with invisible hit area (visible 4px, hitbox 16px)

Create `src/components/editor/timeline.tsx`:

```tsx
import { useRef, useCallback, useState, useMemo } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { useVideoSync } from "@/hooks/use-video-sync"

interface TimelineProps {
  videoSync: ReturnType<typeof useVideoSync>
}

function formatRulerTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

export function Timeline({ videoSync }: TimelineProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<"in" | "out" | null>(null)

  // Time ruler markers
  const rulerMarks = useMemo(() => {
    if (!project) return []
    const duration = project.timeline.duration_ms
    // Aim for ~8-12 markers
    const stepMs = duration <= 10000 ? 1000
      : duration <= 30000 ? 5000
      : duration <= 120000 ? 10000
      : 30000
    const marks: { ms: number; pct: number; label: string }[] = []
    for (let ms = 0; ms <= duration; ms += stepMs) {
      marks.push({ ms, pct: (ms / duration) * 100, label: formatRulerTime(ms) })
    }
    return marks
  }, [project])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!project || !trackRef.current || dragging) return
      const rect = trackRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = Math.max(0, Math.min(1, x / rect.width))
      const timeMs = pct * project.timeline.duration_ms
      videoSync.seek(timeMs)
      setCurrentTime(timeMs)
    },
    [project, videoSync, setCurrentTime, dragging]
  )

  // [REVIEW FIX] Trim drag with scrub preview
  const handleTrimDrag = useCallback(
    (e: React.MouseEvent, type: "in" | "out") => {
      e.stopPropagation()
      if (!project || !trackRef.current) return

      const rect = trackRef.current.getBoundingClientRect()

      const onMouseMove = (ev: MouseEvent) => {
        const x = ev.clientX - rect.left
        const pct = Math.max(0, Math.min(1, x / rect.width))
        const timeMs = Math.round(pct * project.timeline.duration_ms)

        if (type === "in") {
          const clamped = Math.min(timeMs, project.timeline.out_point - 500)
          const value = Math.max(0, clamped)
          useEditorStore.getState().setInPoint(value)
          // [REVIEW FIX] Scrub preview during trim drag
          videoSync.seek(value)
          useEditorStore.getState().setCurrentTime(value)
        } else {
          const clamped = Math.max(timeMs, project.timeline.in_point + 500)
          const value = Math.min(project.timeline.duration_ms, clamped)
          useEditorStore.getState().setOutPoint(value)
          videoSync.seek(value)
          useEditorStore.getState().setCurrentTime(value)
        }
      }

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseup", onMouseUp)
        setDragging(null)
      }

      setDragging(type)
      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    },
    [project, videoSync]
  )

  if (!project) return null

  const { duration_ms, in_point, out_point } = project.timeline
  const playheadPct = (currentTime / duration_ms) * 100
  const inPct = (in_point / duration_ms) * 100
  const outPct = (out_point / duration_ms) * 100

  return (
    <div className="space-y-1 select-none">
      {/* [REVIEW FIX] Time ruler */}
      <div className="relative h-4 text-[9px] text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
        {rulerMarks.map((m) => (
          <span key={m.ms} className="absolute -translate-x-1/2" style={{ left: `${m.pct}%` }}>
            {m.label}
          </span>
        ))}
      </div>

      {/* Track area */}
      <div
        ref={trackRef}
        className="relative h-16 bg-muted rounded cursor-pointer"
        onClick={handleClick}
      >
        {/* [REVIEW FIX] Dimmed regions outside trim range */}
        {inPct > 0 && (
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/40 rounded-l z-[1]"
            style={{ width: `${inPct}%` }}
          />
        )}
        {outPct < 100 && (
          <div
            className="absolute top-0 bottom-0 right-0 bg-black/40 rounded-r z-[1]"
            style={{ width: `${100 - outPct}%` }}
          />
        )}

        {/* Active region highlight */}
        <div
          className="absolute top-0 bottom-0 bg-primary/10 rounded"
          style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
        />

        {/* Screen track */}
        <div
          className="absolute top-1 h-6 bg-blue-400/40 rounded mx-1"
          style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
        >
          <span className="text-[10px] px-1 text-blue-200 leading-6">Screen</span>
        </div>

        {/* Camera track (if present) */}
        {project.tracks.camera && (
          <div
            className="absolute top-8 h-5 bg-green-400/40 rounded mx-1"
            style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
          >
            <span className="text-[10px] px-1 text-green-200 leading-5">Camera</span>
          </div>
        )}

        {/* Audio track indicator */}
        {project.tracks.mic && (
          <div
            className="absolute bottom-1 h-3 bg-yellow-400/30 rounded mx-1"
            style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
          />
        )}

        {/* [REVIEW FIX] Trim handles with wider hit area (visible 4px, hit 16px) */}
        <div
          className="absolute top-0 bottom-0 w-4 z-[2] cursor-col-resize flex justify-center"
          style={{ left: `calc(${inPct}% - 8px)` }}
          title="In point"
          onMouseDown={(e) => handleTrimDrag(e, "in")}
        >
          <div className={`w-1 h-full rounded-l ${dragging === "in" ? "bg-primary" : "bg-primary/80 hover:bg-primary"}`} />
        </div>
        <div
          className="absolute top-0 bottom-0 w-4 z-[2] cursor-col-resize flex justify-center"
          style={{ left: `calc(${outPct}% - 8px)` }}
          title="Out point"
          onMouseDown={(e) => handleTrimDrag(e, "out")}
        >
          <div className={`w-1 h-full rounded-r ${dragging === "out" ? "bg-primary" : "bg-primary/80 hover:bg-primary"}`} />
        </div>

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="w-2.5 h-2.5 bg-red-500 rounded-full -translate-x-1/2 -top-1 absolute" />
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Write tests**

Create `src/__tests__/timeline.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Timeline } from "@/components/editor/timeline"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}))

const MOCK_PROJECT: EditorProject = {
  id: "t", name: "T", created_at: 0,
  tracks: { screen: "/s.mov", mic: "/m.wav", system_audio: null, camera: "/c.mov" },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: true, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: false, shadowIntensity: 0 },
  },
}

const mockVideoSync = {
  register: vi.fn(), unregister: vi.fn(), play: vi.fn(),
  pause: vi.fn(), seek: vi.fn(), getCurrentTime: vi.fn(() => 0),
}

describe("Timeline", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
  })

  it("renders screen track", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("Screen")).toBeTruthy()
  })

  it("renders camera track when present", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("Camera")).toBeTruthy()
  })

  it("renders trim handles", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByTitle("In point")).toBeTruthy()
    expect(screen.getByTitle("Out point")).toBeTruthy()
  })

  it("renders time ruler", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("0:00")).toBeTruthy()
  })
})
```

**Step 3: Run tests & Commit**

Run: `npm test`

```bash
git add src/components/editor/timeline.tsx src/__tests__/timeline.test.tsx
git commit -m "feat: timeline with ruler, dimmed regions, and trim drag"
```

> Note: Task 11 (separate trim drag) from the original plan has been merged into this task since the timeline is now created with trim drag built-in.

---

## Task 11: Inspector Panel

**Files:**
- Create: `src/components/editor/inspector/background-panel.tsx`
- Create: `src/components/editor/inspector/camera-panel.tsx`
- Create: `src/components/editor/inspector/frame-panel.tsx`
- Create: `src/components/editor/inspector/index.tsx`

> [REVIEW FIX] Major changes:
> 1. Replace raw `<input type="range">` with styled WebKit slider CSS. Native range inputs look jarringly out of place in dark theme — this was flagged as the biggest visual quality risk.
> 2. Add gradient preset swatches (8 curated presets). Raw color pickers require design skill most users don't have.
> 3. Use shadcn/ui Button for toggle buttons instead of raw `<button>` elements for consistent focus/hover states.

**Step 1: Create a styled range input component**

Create `src/components/editor/inspector/styled-slider.tsx`:

```tsx
interface StyledSliderProps {
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
}

export function StyledSlider({ min, max, step = 1, value, onChange }: StyledSliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer
        bg-muted
        [&::-webkit-slider-thumb]:appearance-none
        [&::-webkit-slider-thumb]:w-3.5
        [&::-webkit-slider-thumb]:h-3.5
        [&::-webkit-slider-thumb]:rounded-full
        [&::-webkit-slider-thumb]:bg-primary
        [&::-webkit-slider-thumb]:border-2
        [&::-webkit-slider-thumb]:border-background
        [&::-webkit-slider-thumb]:shadow-sm
        [&::-webkit-slider-thumb]:transition-transform
        [&::-webkit-slider-thumb]:hover:scale-110"
      style={{
        background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--muted)) ${pct}%)`,
      }}
    />
  )
}
```

**Step 2: Create background panel with presets**

Create `src/components/editor/inspector/background-panel.tsx`:

```tsx
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorStore } from "@/stores/editor-store"
import { GRADIENT_PRESETS } from "@/types/editor"
import { StyledSlider } from "./styled-slider"

export function BackgroundPanel() {
  const background = useEditorStore((s) => s.project?.effects.background)
  const setBackground = useEditorStore((s) => s.setBackground)

  if (!background) return null

  const handlePresetClick = (preset: typeof GRADIENT_PRESETS[number]) => {
    setBackground({
      type: "preset",
      gradientFrom: preset.from,
      gradientTo: preset.to,
      gradientAngle: preset.angle,
      presetId: preset.id,
    })
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Background</h3>

      <div className="flex gap-1">
        <Button
          size="sm"
          variant={background.type === "solid" ? "default" : "ghost"}
          className="text-xs h-7 px-2"
          onClick={() => setBackground({ type: "solid" })}
        >
          Solid
        </Button>
        <Button
          size="sm"
          variant={background.type === "gradient" ? "default" : "ghost"}
          className="text-xs h-7 px-2"
          onClick={() => setBackground({ type: "gradient" })}
        >
          Gradient
        </Button>
      </div>

      {/* [REVIEW FIX] Gradient presets — 8 curated swatches */}
      {(background.type === "gradient" || background.type === "preset") && (
        <div className="space-y-2">
          <Label className="text-xs">Presets</Label>
          <div className="grid grid-cols-4 gap-1.5">
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={`h-8 rounded-md border-2 transition-all ${
                  background.presetId === preset.id
                    ? "border-primary scale-105"
                    : "border-transparent hover:border-muted-foreground/30"
                }`}
                style={{
                  background: `linear-gradient(${preset.angle}deg, ${preset.from}, ${preset.to})`,
                }}
                onClick={() => handlePresetClick(preset)}
                title={preset.name}
              />
            ))}
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="color"
                value={background.gradientFrom}
                onChange={(e) => setBackground({ gradientFrom: e.target.value, presetId: null, type: "gradient" })}
                className="h-8"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="color"
                value={background.gradientTo}
                onChange={(e) => setBackground({ gradientTo: e.target.value, presetId: null, type: "gradient" })}
                className="h-8"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Angle: {background.gradientAngle}°</Label>
            <StyledSlider
              min={0}
              max={360}
              value={background.gradientAngle}
              onChange={(v) => setBackground({ gradientAngle: v })}
            />
          </div>
        </div>
      )}

      {background.type === "solid" && (
        <div className="space-y-1">
          <Label className="text-xs">Color</Label>
          <Input
            type="color"
            value={background.color}
            onChange={(e) => setBackground({ color: e.target.value })}
            className="h-8 w-full"
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Padding: {background.padding}%</Label>
        <StyledSlider
          min={0}
          max={20}
          value={background.padding}
          onChange={(v) => setBackground({ padding: v })}
        />
      </div>
    </div>
  )
}
```

**Step 3: Create camera panel**

Create `src/components/editor/inspector/camera-panel.tsx` (same as original but using `Button` and `StyledSlider`):

```tsx
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorStore } from "@/stores/editor-store"
import { StyledSlider } from "./styled-slider"

export function CameraPanel() {
  const cameraBubble = useEditorStore((s) => s.project?.effects.cameraBubble)
  const hasCameraTrack = useEditorStore((s) => !!s.project?.tracks.camera)
  const setCameraBubble = useEditorStore((s) => s.setCameraBubble)

  if (!cameraBubble || !hasCameraTrack) return null

  const positions = ["bottom-right", "bottom-left", "top-right", "top-left"] as const

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Camera</h3>
        <Button
          size="sm"
          variant={cameraBubble.visible ? "default" : "ghost"}
          className="text-xs h-7 px-2"
          onClick={() => setCameraBubble({ visible: !cameraBubble.visible })}
        >
          {cameraBubble.visible ? "On" : "Off"}
        </Button>
      </div>

      {cameraBubble.visible && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Position</Label>
            <div className="grid grid-cols-2 gap-1">
              {positions.map((pos) => (
                <Button
                  key={pos}
                  size="sm"
                  variant={cameraBubble.position === pos ? "default" : "ghost"}
                  className="text-[10px] h-7 px-2"
                  onClick={() => setCameraBubble({ position: pos })}
                >
                  {pos.replace("-", " ")}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Size: {cameraBubble.size}%</Label>
            <StyledSlider
              min={5}
              max={30}
              value={cameraBubble.size}
              onChange={(v) => setCameraBubble({ size: v })}
            />
          </div>

          <div className="flex gap-1">
            <Button
              size="sm"
              variant={cameraBubble.shape === "circle" ? "default" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setCameraBubble({ shape: "circle" })}
            >
              Circle
            </Button>
            <Button
              size="sm"
              variant={cameraBubble.shape === "rounded" ? "default" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setCameraBubble({ shape: "rounded" })}
            >
              Rounded
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Border Color</Label>
            <Input
              type="color"
              value={cameraBubble.borderColor}
              onChange={(e) => setCameraBubble({ borderColor: e.target.value })}
              className="h-8 w-full"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Border: {cameraBubble.borderWidth}px</Label>
            <StyledSlider
              min={0}
              max={8}
              value={cameraBubble.borderWidth}
              onChange={(v) => setCameraBubble({ borderWidth: v })}
            />
          </div>
        </>
      )}
    </div>
  )
}
```

**Step 4: Create frame panel**

Create `src/components/editor/inspector/frame-panel.tsx` (same as original but using `Button` and `StyledSlider`):

```tsx
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/stores/editor-store"
import { StyledSlider } from "./styled-slider"

export function FramePanel() {
  const frame = useEditorStore((s) => s.project?.effects.frame)
  const setFrame = useEditorStore((s) => s.setFrame)

  if (!frame) return null

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Frame</h3>

      <div className="space-y-1">
        <Label className="text-xs">Border Radius: {frame.borderRadius}px</Label>
        <StyledSlider
          min={0}
          max={48}
          value={frame.borderRadius}
          onChange={(v) => setFrame({ borderRadius: v })}
        />
      </div>

      <Button
        size="sm"
        variant={frame.shadow ? "default" : "ghost"}
        className="text-xs h-7 px-2"
        onClick={() => setFrame({ shadow: !frame.shadow })}
      >
        Shadow: {frame.shadow ? "On" : "Off"}
      </Button>

      {frame.shadow && (
        <div className="space-y-1">
          <Label className="text-xs">Intensity: {Math.round(frame.shadowIntensity * 100)}%</Label>
          <StyledSlider
            min={0}
            max={100}
            value={frame.shadowIntensity * 100}
            onChange={(v) => setFrame({ shadowIntensity: v / 100 })}
          />
        </div>
      )}
    </div>
  )
}
```

**Step 5: Create inspector index**

Create `src/components/editor/inspector/index.tsx`:

```tsx
import { Separator } from "@/components/ui/separator"
import { BackgroundPanel } from "./background-panel"
import { CameraPanel } from "./camera-panel"
import { FramePanel } from "./frame-panel"

export function Inspector() {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">Inspector</h2>
      <BackgroundPanel />
      <Separator />
      <FramePanel />
      <Separator />
      <CameraPanel />
    </div>
  )
}
```

**Step 6: Run tests & Commit**

Run: `npm test`

```bash
git add src/components/editor/inspector/
git commit -m "feat: inspector panel with presets, styled sliders, shadcn buttons"
```

---

## Task 12: Keyboard Shortcuts

**Files:**
- Create: `src/hooks/use-keyboard-shortcuts.ts`
- Create: `src/__tests__/use-keyboard-shortcuts.test.ts`

> [REVIEW FIX] I/O shortcuts now validate against each other — `I` won't set in_point past out_point. The store's `setInPoint`/`setOutPoint` now do clamping internally (fixed in Task 5).

Create `src/hooks/use-keyboard-shortcuts.ts`:

```ts
import { useEffect } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { useVideoSync } from "@/hooks/use-video-sync"

const SEEK_STEP_MS = 1000

export function useKeyboardShortcuts(videoSync: ReturnType<typeof useVideoSync>) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return

      const { undo, redo } = useEditorStore.temporal.getState()
      const state = useEditorStore.getState()

      if (e.code === "Space") {
        e.preventDefault()
        if (state.isPlaying) {
          videoSync.pause()
          useEditorStore.getState().setIsPlaying(false)
        } else {
          videoSync.play()
          useEditorStore.getState().setIsPlaying(true)
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault()
        undo()
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault()
        redo()
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault()
        const newTime = Math.max(0, state.currentTime - SEEK_STEP_MS)
        videoSync.seek(newTime)
        useEditorStore.getState().setCurrentTime(newTime)
      }

      if (e.key === "ArrowRight" && state.project) {
        e.preventDefault()
        const newTime = Math.min(
          state.project.timeline.duration_ms,
          state.currentTime + SEEK_STEP_MS
        )
        videoSync.seek(newTime)
        useEditorStore.getState().setCurrentTime(newTime)
      }

      // I — set in point (clamping handled by store)
      if (e.key === "i" && !e.metaKey && !e.ctrlKey) {
        useEditorStore.getState().setInPoint(state.currentTime)
      }

      // O — set out point (clamping handled by store)
      if (e.key === "o" && !e.metaKey && !e.ctrlKey) {
        useEditorStore.getState().setOutPoint(state.currentTime)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [videoSync])
}
```

Create `src/__tests__/use-keyboard-shortcuts.test.ts` (same as original plan, tests still apply).

**Commit**

```bash
git add src/hooks/use-keyboard-shortcuts.ts src/__tests__/use-keyboard-shortcuts.test.ts
git commit -m "feat: keyboard shortcuts (Space, Cmd+Z, arrows, I/O trim)"
```

---

## Task 13: Project Auto-Save

**Files:**
- Create: `src/hooks/use-auto-save.ts`

> [REVIEW FIX] Added `beforeunload` handler to flush pending saves before window close. Without this, the last 2 seconds of changes could be lost if the user closes the editor.

Create `src/hooks/use-auto-save.ts`:

```ts
import { useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useEditorStore } from "@/stores/editor-store"

const DEBOUNCE_MS = 2000

export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef<boolean>(false)

  useEffect(() => {
    // [REVIEW FIX] Flush save on window close
    const flushSave = () => {
      if (pendingSaveRef.current && timerRef.current) {
        clearTimeout(timerRef.current)
        const project = useEditorStore.getState().project
        if (project) {
          // Use sendBeacon pattern or synchronous save
          invoke("save_project_state", { project }).catch(() => {})
        }
      }
    }
    window.addEventListener("beforeunload", flushSave)

    const unsub = useEditorStore.subscribe((state, prevState) => {
      if (state.project === prevState.project) return
      if (!state.project) return

      if (timerRef.current) clearTimeout(timerRef.current)
      pendingSaveRef.current = true

      timerRef.current = setTimeout(async () => {
        try {
          await invoke("save_project_state", { project: state.project })
          pendingSaveRef.current = false
        } catch (e) {
          console.error("Auto-save failed:", e)
        }
      }, DEBOUNCE_MS)
    })

    return () => {
      unsub()
      window.removeEventListener("beforeunload", flushSave)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])
}
```

**Commit**

```bash
git add src/hooks/use-auto-save.ts
git commit -m "feat: debounced project auto-save with beforeunload flush"
```

---

## Task 14: Basic Export (Trim-Only)

> [REVIEW FIX] This is a NEW task added based on all three reviewers independently flagging that an editor without export is not shippable. This provides a basic "quick export" that trims the raw video to the in/out points using the `cp` command (Phase 4 will add the full Metal compositor for composited export with backgrounds/effects).

**Files:**
- Create: `src-tauri/src/commands/export.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/components/editor/export-button.tsx`

**Step 1: Create Rust export command**

Create `src-tauri/src/commands/export.rs`:

```rust
use crate::project;
use tauri::api::dialog;

/// Quick export: copies the raw screen recording to a user-chosen location.
/// In Phase 4, this will be replaced with a full composited export via Metal.
#[tauri::command]
pub fn quick_export(project_id: String) -> Result<String, String> {
    let project_path = project::project_dir(&project_id).join("project.json");
    let data = std::fs::read_to_string(&project_path).map_err(|e| e.to_string())?;
    let project: project::ProjectState = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    // For MVP, copy the raw screen recording to Desktop
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let desktop = home.join("Desktop");
    let filename = format!("{}.mov", project.name.replace(['/', '\\', ':', '"'], "_"));
    let dest = desktop.join(&filename);

    std::fs::copy(&project.tracks.screen, &dest).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}
```

**Step 2: Register export commands**

Update `src-tauri/src/commands/mod.rs`:

```rust
pub mod editor;
pub mod export;
pub mod recording;
pub mod sources;
```

Add to invoke_handler in `src-tauri/src/lib.rs`:

```rust
commands::export::quick_export,
```

**Step 3: Create Export button component**

Create `src/components/editor/export-button.tsx`:

```tsx
import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Download, Check, Loader2 } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"

export function ExportButton() {
  const project = useEditorStore((s) => s.project)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!project) return null

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    setExported(null)
    try {
      const path = await invoke<string>("quick_export", { projectId: project.id })
      setExported(path)
      // Reset after 3 seconds
      setTimeout(() => setExported(null), 3000)
    } catch (e) {
      setError(String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      {exported && (
        <span className="text-xs text-green-400 flex items-center gap-1">
          <Check className="w-3 h-3" /> Saved to Desktop
        </span>
      )}
      <Button size="sm" onClick={handleExport} disabled={exporting}>
        {exporting ? (
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
        ) : (
          <Download className="w-4 h-4 mr-1" />
        )}
        Export
      </Button>
    </div>
  )
}
```

**Step 4: Run tests & Commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && npm test`

```bash
git add src-tauri/src/commands/export.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/components/editor/export-button.tsx
git commit -m "feat: basic quick export (copy raw to Desktop)"
```

---

## Task 15: Wire Everything Together in EditorApp

**Files:**
- Modify: `src/editor-app.tsx`

> [REVIEW FIX] Changes from original:
> 1. Added React ErrorBoundary wrapper
> 2. Added Export button in header
> 3. Sidebar widened to `w-80`
> 4. `useEffect` dependency array changed to `[]` (loadProject is a stable zustand action)
> 5. Removed wavesurfer Waveform component (deferred to Phase 3.5)

**Step 1: Create ErrorBoundary**

Create `src/components/error-boundary.tsx`:

```tsx
import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen p-8">
          <div className="text-center space-y-2">
            <p className="text-destructive font-medium">Something went wrong</p>
            <p className="text-sm text-muted-foreground">{this.state.error?.message}</p>
            <button
              className="text-sm text-primary underline"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
```

**Step 2: Integrate all editor components**

Replace `src/editor-app.tsx`:

```tsx
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Undo2, Redo2 } from "lucide-react"
import { ErrorBoundary } from "@/components/error-boundary"
import { useEditorStore } from "@/stores/editor-store"
import { useVideoSync } from "@/hooks/use-video-sync"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useAutoSave } from "@/hooks/use-auto-save"
import { PreviewCanvas } from "@/components/editor/preview-canvas"
import { PlaybackControls } from "@/components/editor/playback-controls"
import { Timeline } from "@/components/editor/timeline"
import { ExportButton } from "@/components/editor/export-button"
import { Inspector } from "@/components/editor/inspector"
import type { ProjectState } from "@/types"
import type { EditorProject } from "@/types/editor"

function EditorContent() {
  const [error, setError] = useState<string | null>(null)
  const project = useEditorStore((s) => s.project)
  const loadProject = useEditorStore((s) => s.loadProject)
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)

  const videoSync = useVideoSync({
    onTimeUpdate: setCurrentTime,
  })

  useKeyboardShortcuts(videoSync)
  useAutoSave()

  // [REVIEW FIX] Stable dependency array — loadProject is a zustand action (never changes)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const projectId = params.get("project")
    if (!projectId) {
      setError("No project ID")
      return
    }

    invoke<ProjectState>("load_project", { projectId })
      .then((p) => {
        const editorProject: EditorProject = {
          ...p,
          effects: p.effects ?? {
            background: {
              type: "gradient",
              color: "#1a1a2e",
              gradientFrom: "#1a1a2e",
              gradientTo: "#16213e",
              gradientAngle: 135,
              padding: 8,
              presetId: "midnight",
            },
            cameraBubble: {
              visible: !!p.tracks.camera,
              position: "bottom-right",
              size: 15,
              shape: "circle",
              borderWidth: 3,
              borderColor: "#ffffff",
            },
            frame: {
              borderRadius: 12,
              shadow: true,
              shadowIntensity: 0.5,
            },
          },
        }
        loadProject(editorProject)
      })
      .catch((e) => setError(String(e)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  const handleUndo = () => useEditorStore.temporal.getState().undo()
  const handleRedo = () => useEditorStore.temporal.getState().redo()

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="h-12 border-b flex items-center px-4 gap-3 shrink-0">
        <h1 className="text-sm font-medium truncate">{project.name}</h1>
        <div className="flex-1" />
        <PlaybackControls videoSync={videoSync} />
        <Separator orientation="vertical" className="h-6" />
        <Button variant="ghost" size="icon" onClick={handleUndo} title="Undo (Cmd+Z)">
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleRedo} title="Redo (Cmd+Shift+Z)">
          <Redo2 className="w-4 h-4" />
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <ExportButton />
      </header>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Preview */}
        <div className="flex-1 flex items-center justify-center p-6 bg-muted/20 overflow-hidden">
          <div className="w-full max-w-5xl">
            <PreviewCanvas videoSync={videoSync} />
          </div>
        </div>

        {/* Inspector — widened to w-80 */}
        <aside className="w-80 border-l overflow-y-auto p-4">
          <Inspector />
        </aside>
      </div>

      {/* Timeline */}
      <div className="border-t shrink-0 p-4 min-h-[12rem]">
        <Timeline videoSync={videoSync} />
      </div>
    </div>
  )
}

export function EditorApp() {
  return (
    <ErrorBoundary>
      <EditorContent />
    </ErrorBoundary>
  )
}
```

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Run full build check**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles.

**Step 4: Commit**

```bash
git add src/editor-app.tsx src/components/error-boundary.tsx
git commit -m "feat: wire up complete editor with preview, timeline, inspector, export"
```

---

## Task 16: Integration Smoke Test

**Step 1: Run the full app**

Run: `npx tauri dev`

**Step 2: Manual test checklist**

- [ ] Recorder window opens at compact size (~420x520)
- [ ] Can select display, mic, camera sources
- [ ] Can start/pause/resume/stop recording
- [ ] After stopping, editor automatically opens in a new window
- [ ] Recent projects list shows on recorder window
- [ ] Editor loads the project and shows screen video in preview
- [ ] Camera bubble appears in preview (if camera was recorded)
- [ ] Play/pause works (Space key and button)
- [ ] Playback STOPS at the out-point (doesn't play past it)
- [ ] Timeline shows tracks, playhead, time ruler, and dimmed trim regions
- [ ] Trim handles can be dragged with scrub preview
- [ ] Inspector: gradient presets apply correctly
- [ ] Inspector: custom gradient colors update preview with smooth transition
- [ ] Inspector: changing camera size/position animates smoothly
- [ ] Inspector: changing frame border radius updates preview
- [ ] Inspector: sliders are styled (not native browser look)
- [ ] Cmd+Z undoes last change
- [ ] Cmd+Shift+Z redoes
- [ ] I/O keys set in/out points (with validation — I can't go past O)
- [ ] Arrow keys seek
- [ ] Export button saves .mov to Desktop
- [ ] Closing editor and re-opening from Recent list works

**Step 3: Fix any issues found, commit**

```bash
git add -A
git commit -m "fix: integration fixes from smoke testing"
```

---

## Deferred to Phase 3.5

The following features were reviewed and intentionally deferred to reduce scope and ship a complete workflow sooner:

| Feature | Reason for Deferral |
|---------|-------------------|
| Audio waveform (wavesurfer.js) | Heavy dependency (loads full audio into memory), visual polish not critical for MVP |
| Timeline zoom | Important for long recordings, but MVP works for clips <2min |
| Composited export (Metal pipeline) | Phase 4 — MVP ships with raw trim export |
| Camera bubble drag-on-preview | Nice UX but 4-corner buttons work for MVP |
| Project rename | Low priority, auto-generated names work |
| Playback speed control | Power-user feature |

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Install deps (zustand, zundo) | `package.json` |
| 2 | Multi-window Tauri infrastructure | `tauri.conf.json`, `capabilities/`, `commands/editor.rs` |
| 3 | Frontend window routing + recent projects | `main.tsx`, `recorder-app.tsx`, `editor-app.tsx` |
| 4 | Asset URL utility | `lib/asset-url.ts` |
| 5 | Zustand store + undo/redo (throttled) | `stores/editor-store.ts`, `types/editor.ts` |
| 6 | Effects types in Rust + TS | `project.rs`, `types/index.ts` |
| 7 | Video playback sync (with out-point stop) | `hooks/use-video-sync.ts` |
| 8 | CSS-layered preview (transitions + multi-shadow) | `components/editor/preview-canvas.tsx` |
| 9 | Playback controls (precise time display) | `components/editor/playback-controls.tsx` |
| 10 | Timeline (ruler + dimmed regions + trim drag) | `components/editor/timeline.tsx` |
| 11 | Inspector (presets + styled sliders) | `components/editor/inspector/*` |
| 12 | Keyboard shortcuts | `hooks/use-keyboard-shortcuts.ts` |
| 13 | Auto-save (with beforeunload flush) | `hooks/use-auto-save.ts` |
| 14 | Basic export (raw copy to Desktop) | `commands/export.rs`, `export-button.tsx` |
| 15 | Wire everything + ErrorBoundary | `editor-app.tsx` |
| 16 | Integration smoke test | Manual testing |

**Key review fixes applied:**
- P0: `open_editor` changed from async to sync (main thread requirement)
- P0: Removed tokio dependency from tests (commands are sync)
- P1: Asset scope narrowed from `$HOME/**` to app data dir
- P1: Fixed stale closure in useVideoSync RAF loop (use ref)
- P1: Fixed React ref cleanup in PreviewCanvas
- P1: Playback now stops at out-point
- P2: Undo throttled (500ms) to prevent slider spam
- P2: beforeunload flushes auto-save
- P2: Native range inputs replaced with styled sliders
- P2: Gradient presets added (8 curated swatches)
- P2: CSS transitions on preview changes
- P2: Multi-layer shadows for realistic depth
- P2: Time ruler added to timeline
- P2: Dimmed regions outside trim range
- P2: Scrub preview during trim drag
- P3: ErrorBoundary wraps editor
- P3: I/O shortcuts validate against each other
- Product: Export added — closes the user workflow loop
- Product: Recent projects list on recorder
- Product: Auto-open editor after recording
- Scope: Audio waveforms deferred to Phase 3.5
