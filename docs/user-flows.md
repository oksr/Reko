# User Flows

Detailed step-by-step documentation of every functional user flow in Reko.

---

## 1. First Launch / Onboarding

**Entry:** App opens for the first time (no `onboarding_completed` flag in localStorage).

1. Recorder window opens and detects missing onboarding flag
2. Opens the **Onboarding window** (540x520, frameless, centered)
3. Displays 4 permission items with live status indicators:
   - **Screen Recording** (required) — click opens macOS System Settings → Privacy & Security → Screen Recording
   - **Microphone** (optional) — click triggers native permission dialog
   - **Camera** (optional) — click triggers native permission dialog
   - **Accessibility** (optional) — click opens macOS System Settings → Accessibility
4. Permission statuses poll every 2 seconds via `check_permission()` IPC
5. **"Get Started" button** stays disabled until Screen Recording is granted
6. On click: sets `localStorage.onboarding_completed = "true"`, closes onboarding window
7. Recorder window becomes active in **idle** state

---

## 2. Recording

### 2.1 Idle State (Main Toolbar)

**Entry:** Onboarding complete, or app re-opened after first use.

The recorder toolbar appears at the bottom-center of the screen, dynamically sized to its content.

**Left side — Input toggles:**
- **Camera** — toggle on/off. When enabled, auto-selects first available camera, calls `prewarm_camera()`, opens Camera Preview bubble
- **Microphone** — toggle on/off. When enabled, auto-selects first available mic. Dropdown to pick a different device
- **System Audio** — toggle on/off (default: on)

**Center — Source type selector:**
- **Display** (default) — records the entire primary display
- **Window** — opens Window Picker overlay (see 2.2)
- **Area** — opens Area Selection overlay (see 2.3)

**Right side — Actions:**
- **Record button** (red circle) — starts recording with current config
- **Settings popover** (gear icon) — shows up to 5 recent projects (click to open in editor)
- **Close button** (X) — quits the app, stops camera prewarm

**Global shortcut:** `Cmd+Shift+R` toggles recording on/off.

**Tray menu actions** (system menu bar icon):
- "New Recording" → starts recording with current config
- "Record Display" → starts display recording immediately
- "Record Window" → opens Window Picker
- "Record Area" → opens Area Selection
- "Show Projects" → opens most recent project in editor

### 2.2 Window Picker

1. Fullscreen transparent overlay opens on top of all windows
2. Displays thumbnails of all open application windows with labels
3. User clicks a window thumbnail
4. Emits `"window-selected"` event to recorder with `{ windowId }`
5. Overlay closes
6. Recording starts automatically for the selected window

### 2.3 Area Selection

1. Fullscreen transparent overlay opens
2. User clicks and drags to draw a rectangle on screen
3. On release/confirm: emits `"area-selected"` event with `{ displayId, x, y, width, height }`
4. Overlay closes
5. Recording starts automatically for the selected area

### 2.4 Camera Preview

- Opens as a separate small window (160x160px), positioned bottom-right of screen
- Receives camera name via URL search param (`?cameraName=...`)
- Uses WebRTC `getUserMedia` to stream camera feed (matches AVFoundation device by name since IDs differ)
- Auto-closes when camera is disabled or recording starts

### 2.5 Recording State

1. `start_recording()` is called with config:
   - `display_id` / `window_id` / `area` (mutually exclusive source)
   - `mic_id`, `camera_id`, `capture_system_audio` (input flags)
   - `fps: 60`
2. **Recording Bar** replaces the idle toolbar:
   - **Timer** — elapsed recording time, updates every frame
   - **Audio level meter** — polls `get_audio_levels()` every 100ms, shows mic level (red >80%, yellow >50%)
   - **Pause button** — calls `pause_recording()`, swaps to Resume button
   - **Resume button** — calls `resume_recording()`
   - **Stop button** — calls `stop_recording()`
3. On stop:
   - Rust returns `ProjectState` with all recorded track file paths (screen, mic, system audio, camera, mouse events)
   - Project auto-saved as JSON in `~/Library/Application Support/com.reko.app/projects/{id}/project.json`
   - Raw media stored in `projects/{id}/raw/`
   - Editor window opens automatically with the new project

---

## 3. Editor

### 3.1 Project Loading

1. Editor window opens with `?project={projectId}` in URL
2. Calls `load_project(projectId)` → receives `ProjectState` from disk
3. Calls `list_wallpapers()` → loads available background wallpapers
4. Merges default `Effects` if project has none (new recordings start with `effects: null`)
5. Resolves wallpaper image URLs via `resolve_wallpaper_path()`
6. If mouse events track exists and no clips have zoom events: auto-generates zoom keyframes via `generate_auto_zoom(projectId, zoomScale)`
7. Initializes Zustand editor store with undo/redo (Zundo middleware, 100 snapshot limit)

### 3.2 Layout

```
+----------------------------------------------+
| Header: Project Name | Playback | Undo/Redo | Export
+-------------+--------------------------------+
| Inspector   | Preview Canvas                 |
| (320px)     | (live preview of edited video)  |
| - Background|                                |
| - Frame     |                                |
| - Camera    |                                |
| - Cursor    |                                |
| - Zoom      |                                |
+-------------+--------------------------------+
| Timeline (clips, transitions, overlays, zoom)|
+----------------------------------------------+
```

### 3.3 Inspector Panels

Each panel is a tab in the left sidebar (icon-based tab column):

**Background**
- Type selector: wallpaper, gradient, solid color, image, Unsplash search
- Wallpaper: dropdown of bundled wallpapers
- Gradient: two color pickers + angle slider
- Solid: color picker
- Image: file upload dialog or Unsplash search & select
- Padding slider (space between frame and edges)

**Frame**
- Border radius slider (0–32px)
- Shadow toggle + intensity slider

**Camera Bubble**
- Visibility toggle (show/hide webcam overlay)
- Position: bottom-right, bottom-left, top-right, top-left
- Size slider (5–30% of canvas)
- Shape: circle or rounded square
- Border width + color picker
- Shadow toggle + intensity

**Cursor**
- Icon selector (5 styles including filled arrow)
- Size slider (16–64px)
- Highlight toggle → sub-options:
  - Type: highlight or spotlight
  - Size, color, opacity sliders
- Click Highlight sub-section:
  - Enabled toggle
  - Color picker, opacity, max ripple size

**Zoom**
- Auto-zoom scale slider (controls `generate_auto_zoom` zoom level)
- Per-clip zoom event list with add/edit/delete
- Each event: time position, duration, center position, scale factor

### 3.4 Timeline

**Tracks displayed top-to-bottom:**
- **Time ruler** — marks time intervals, current playhead position
- **Sequence track** — shows clip blocks with:
  - Drag to reorder clips
  - Drag edges to trim (min 500ms clip duration)
  - Transition indicators between clips (click to change)
- **Zoom track** — visual zoom keyframe markers per clip
- **Overlay tracks** (up to 5) — webcam, text, or image overlays with position/duration handles
- **Audio track** — waveform visualization of mic/system audio

**Transitions** (between clips):
- Cut (default, no transition)
- Crossfade
- Dissolve
- Fade through black

**Playhead:**
- Click anywhere on ruler to seek
- Drag playhead pin to scrub

### 3.5 Editing Tools

| Tool | Key | Behavior |
|------|-----|----------|
| Select | `V` | Click to select clips, drag edges to trim, drag to reorder |
| Razor | `C` | Click on timeline to split clip at that point |
| Zoom | `Z` | Click on timeline to add zoom keyframe at that point |

### 3.6 Keyboard Shortcuts

| Keys | Action |
|------|--------|
| `Space` | Play / Pause (restarts from beginning if at end) |
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |
| `←` | Seek back 1 second |
| `→` | Seek forward 1 second |
| `I` | Set in-point at current time |
| `O` | Set out-point at current time |
| `Cmd+K` | Split clip at playhead |
| `V` | Select tool |
| `C` | Razor tool |
| `Z` | Zoom tool (only without modifiers) |
| `Delete` / `Backspace` | Ripple delete selected clip |
| `Shift+Delete` | Lift delete selected clip |

### 3.7 Playback

- **Play/Pause** via header controls or `Space`
- **Seek** by clicking timeline ruler or dragging playhead
- **Frame-by-frame** via left/right arrow keys (±1 second)
- **Preview canvas** renders the video with all effects applied in real-time

### 3.8 Auto-Save

- Debounced at 2 seconds after any project state change
- Calls `save_project_state()` via platform IPC
- Sanitizes all millisecond values to integers (Rust expects `u64`)
- Flushes on `beforeunload` event (window close)

---

## 4. Export

**Entry:** Click the **Export** button in the editor header.

### 4.1 Configuration

1. Export dialog opens with settings:
   - **Resolution:** Original, 4K, 1080p, 720p
   - **Quality:** Low, Medium, High, Best (maps to bitrate)
2. Click "Export" opens a **save dialog** to choose output path (MP4)
3. Project state auto-saved to disk before export begins

### 4.2 Progress

1. **Compositing phase** — progress bar (0–100%) with ETA countdown
   - ExportPipeline renders each frame on canvas with all effects, encodes via WebCodecs
   - Cancel button available throughout
2. **Finalizing phase** — spinner while audio muxing runs
   - If audio tracks exist: writes video-only MP4 to temp file, then calls `mux_audio()` (ffmpeg via Rust) to blend mic + system audio into final MP4
   - If no audio tracks: writes MP4 directly to chosen path

### 4.3 Completion

- **Success:** "Saved!" confirmation with checkmark
  - "Share Link" button → starts Share flow (see section 5)
  - "Done" button → closes export dialog
- **Error:** Error message displayed with option to retry

---

## 5. Share

**Entry:** Click "Share Link" after export completes, or from project with existing share.

### 5.1 Create Share

1. `POST /api/videos` with: title, file size, duration, content type
2. Server returns: `videoId`, `ownerToken` (one-time), `uploadUrl` (presigned R2 PUT), `shareUrl`

### 5.2 Upload Video

1. PUT video data to presigned `uploadUrl`
2. Progress tracking via XMLHttpRequest: shows bytes uploaded / total bytes + percentage

### 5.3 Finalize

1. `POST /api/videos/{videoId}/finalize` with Bearer token auth
2. Server verifies file in R2, sets status to "ready"
3. Returns final `shareUrl` and optional `thumbnailUrl`

### 5.4 Result

- Displays the share URL
- **"Copy Link"** button — copies URL to clipboard
- **"Open"** button — opens share URL in default browser
- `shareVideoId` and `shareOwnerToken` persisted in project state (auto-saved)

### 5.5 Share Settings

Configured during share creation:

| Setting | Default | Description |
|---------|---------|-------------|
| Allow Comments | true | Viewers can leave comments |
| Allow Download | false | Show download button on player |
| Show Badge | true | Display "Made with Reko" badge |
| Password Protected | false | (Future) Require password to view |

---

## 6. Viewer / Player (Web)

**Entry:** Visitor opens a share URL (`https://reko.video/{videoId}`).

### 6.1 Video Page

1. Fetches video metadata from API (`GET /api/videos/{videoId}`)
2. Displays:
   - Video title
   - View count and duration
   - Creation date
3. Action buttons: **Copy Link**, **Embed Code**
4. "Made with Reko" badge (if enabled by creator)

### 6.2 Video Player

- HTML5 `<video>` element with custom controls
- Streams video via range requests (`GET /api/videos/{videoId}/stream`)
- Controls: play/pause, seek bar with scrubber, volume slider, mute, fullscreen
- **Download button** visible if creator enabled `allowDownload`

**Player keyboard shortcuts:**

| Keys | Action |
|------|--------|
| `Space` / `K` | Play / Pause |
| `F` | Toggle fullscreen |
| `M` | Toggle mute |
| `←` | Seek back 5 seconds |
| `→` | Seek forward 5 seconds |

### 6.3 Comments Section

- Shown if creator enabled `allowComments`
- Collapsible list (up to 200 comments)
- **Add comment form:**
  - Author name (saved to localStorage for convenience)
  - Comment text (max 2000 characters)
  - Optional timestamp link (clicking jumps video to that point)
- Comments load from `GET /api/videos/{videoId}/comments`
- New comment submitted via `POST /api/videos/{videoId}/comments`

### 6.4 Embed Mode

- Append `?embed=1` to share URL
- Shows only the video player (no page chrome, no comments, no badge)
- Suitable for iframe embedding

### 6.5 Analytics

- View events sent every 30 seconds via `navigator.sendBeacon` (survives page close)
- Tracks: watch time (ms), completion percentage, referrer URL
- Creator can view analytics: total views, unique viewers, total watch time

---

## 7. Project Management

### 7.1 Recent Projects

- Recorder settings popover (gear icon) shows up to 5 most recent projects
- Each entry shows project name
- Click → opens editor window with that project

### 7.2 Tray Menu

- "Show Projects" action in system tray menu → opens most recent project in editor

### 7.3 Project Storage

- Each project stored at `~/Library/Application Support/com.reko.app/projects/{id}/`
  - `project.json` — project state (metadata, timeline, effects, sequence, share info)
  - `raw/` — recorded media files (screen MP4, mic WAV, system audio, camera, mouse events)
