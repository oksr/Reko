# Phase 6: Floating Recorder Toolbar

## Overview

Replace the current 420x520 card-based recorder window with a slim, horizontal floating toolbar inspired by macOS's native screenshot bar. The goal is minimal screen footprint, professional polish, and a simplified recording workflow.

## Design Decisions

- **Source types:** Display only for v1 (Window capture deferred to Phase 6.1)
- **Input toggles:** Click to toggle on/off (selects default device); chevron indicator opens device picker on click, right-click also opens picker
- **Window style:** Borderless, transparent, always-on-top panel with near-opaque dark background (native vibrancy deferred)
- **Record button:** Visible in toolbar + global keyboard shortcut (`Cmd+Shift+R`)
- **Countdown:** 3-second countdown before recording starts (togglable in settings)
- **Recent projects:** Moved into settings gear popover
- **Recording state:** Toolbar morphs to a compact recording bar via CSS-only animation (fixed window size)
- **Defaults:** Camera off, Microphone off, System Audio **on** (matches current behavior)

---

## Step 0 — Prerequisites & Permissions

**Files:**
- `src-tauri/Cargo.toml`
- `src/components/recording/permission-check.tsx` (new)

### Enable Transparent Windows

Tauri v2 requires the `macos-private-api` feature for transparent windows on macOS:

```toml
tauri = { version = "2", features = ["macos-private-api"] }
```

> **App Store risk:** `macos-private-api` uses Apple's private `NSVisualEffectView` APIs. Apple could reject App Store submissions. If App Store distribution is planned, fall back to an opaque dark background with rounded corners.

### First-Launch Permission Flow

On first launch, detect whether Screen Recording permission has been granted. If not:
- Replace the toolbar contents with a focused message: "Screen Recording permission required"
- Show a button that opens System Settings > Privacy & Security > Screen Recording
- Poll for permission grant and transition to the normal toolbar once granted

Similarly, Microphone and Camera permissions are requested on-demand when the user toggles those inputs on for the first time.

### Self-Exclusion from Recording

The recorder toolbar must not appear in its own recordings. Exclude the CaptureKit window from the capture via `SCContentFilter(display:excludingWindows:)` by passing the toolbar's `CGWindowID` to the Swift layer. This requires:
- A new Swift FFI function to accept an exclusion window ID
- Tauri provides the native window ID to the frontend, which passes it down during `start_recording`

---

## Step 1 — Tauri Window Configuration

**Files:** `src-tauri/tauri.conf.json`

Update the `recorder` window config:

```json
{
  "label": "recorder",
  "title": "CaptureKit",
  "width": 700,
  "height": 300,
  "resizable": false,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "center": true
}
```

**Notes:**
- `height: 300` — the toolbar renders at the bottom of the window (56px). The remaining ~244px above is transparent, providing space for popovers and device pickers to render without clipping.
- `decorations: false` removes native title bar
- `transparent: true` allows CSS-driven rounded corners and translucent background
- `alwaysOnTop: true` keeps toolbar floating above all content (uses `NSWindow.Level.floating`)
- After window creation, use `setPosition()` to place the toolbar ~80px from bottom of the current screen's work area, centered horizontally

---

## Step 2 — Toolbar Shell & Styling

**Files:**
- `src/recorder-app.tsx` (rewrite)
- `src/index.css` (add toolbar-specific styles)

### Layout

The 300px window is fully transparent. The toolbar pill renders anchored to the bottom:

```
[X] | [Display] | [No camera ▾] [No mic ▾] [No system audio ▾] | [⏺] [⚙▾]
```

Three groups separated by vertical dividers, inside a single horizontal flex row.

### CSS

```css
.recorder-toolbar {
  background: rgba(30, 30, 30, 0.95);
  border-radius: 12px;
  border: 0.5px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.3);
  height: 56px;
  padding: 0 8px;
  user-select: none;
  cursor: default;
}
```

**Key styling decisions (from review):**
- **No `backdrop-filter`** — CSS `backdrop-filter` in a WKWebView transparent window blurs the webview layer, not the desktop content behind it. Use near-opaque dark background instead. Native vibrancy (via `NSVisualEffectView`) is deferred to a follow-up.
- **`0.5px` border** — 1px looks chunky on Retina. 0.5px with `rgba(255,255,255,0.15)` matches macOS native panel borders.
- **Drop shadow** — Essential for the floating panel to look elevated rather than flat.
- **`user-select: none` + `cursor: default`** — Prevents text selection cursor and hand cursor, which are the #1 tell of "this is a webview." All buttons use `cursor: default` (not `pointer`) to match macOS native UI convention.
- **Dividers:** `1px` wide, `rgba(255,255,255,0.1)`, with `12px` vertical padding (not full height).

### Drag Region

The entire bar is draggable via `data-tauri-drag-region`. Interactive elements (buttons, popovers) stop mousedown propagation to prevent drag conflicts.

### Hover & Focus States

- **Hover:** `rgba(255, 255, 255, 0.08)` background, 100ms ease-out
- **Active/pressed:** `rgba(255, 255, 255, 0.12)` background
- **Focus ring:** `outline: 2px solid rgba(255, 255, 255, 0.4)` with `outline-offset: -2px` (inset, macOS convention)
- **No transition delay** on hover — native UI responds in 1 frame

### Keyboard Navigation

- Tab order follows left-to-right visual order: Close, Display, Camera, Mic, System Audio, Record, Settings
- Arrow keys navigate within button groups per WAI-ARIA toolbar pattern
- Toolbar has `role="toolbar"` with `aria-label="Recording controls"`

### Accessibility

- Input toggles use `aria-pressed` (true/false) for toggle state
- Audio level meters use `role="meter"` with `aria-valuenow/min/max`
- Recording timer uses `aria-live="polite"` (throttled)
- `prefers-reduced-motion: reduce` disables pulse animation and morph transitions (snap instead)
- Off-state icon/text contrast: minimum `rgba(255,255,255,0.6)` to ensure WCAG AA 4.5:1 ratio

### Animation Easing

All animations use `cubic-bezier(0.2, 0, 0, 1)` (macOS system spring-like curve).

---

## Step 3 — Source Type Button

**Files:** `src/components/recording/source-type-button.tsx` (new)

Icon-button component with a label below. **v1 ships Display only** — the Window button is added in Phase 6.1 when window capture is implemented.

- Selected state: subtle lighter background (`rgba(255,255,255,0.1)`)
- Display selected by default
- Uses `role="radio"` within a `role="radiogroup"` (prepared for multi-option when Window is added)

**Icons:** Lucide `Monitor` icon at 20x20, `strokeWidth: 2` (default 1.5 is too thin on dark backgrounds). Label below: 10px, font-weight 500, `rgba(255,255,255,0.6)`.

---

## Step 4 — Input Toggle Buttons

**Files:** `src/components/recording/input-toggle.tsx` (new)

Three toggles: Camera, Microphone, System Audio.

### States

| State | Icon | Label |
|-------|------|-------|
| Off | Crossed-out icon (18x18) | "No camera" / "No microphone" / "No system audio" |
| On | Normal icon (18x18) | Device name, truncated (e.g., "FaceTime HD") |
| Disabled | Dimmed icon, reduced opacity | "No camera detected" (tooltip) |
| Loading | Spinner replacing icon | Device name (activating hardware) |

### Default States
- Camera: **off**
- Microphone: **off**
- System Audio: **on** (matches current `capture_system_audio: true` behavior)

### Interactions

- **Click main area:** Toggle on/off. When turning on, auto-select the default device.
- **Click chevron:** Opens `DevicePickerPopover` above the button.
- **Right-click anywhere on toggle:** Also opens the device picker.
- **No long-press** — long-press conflicts with the drag region and is not a standard desktop pattern.

The chevron indicator (6x6) appears to the right of the label text, always visible. This is the standard desktop affordance for "more options" (matches CleanShot X pattern).

### Device Picker Popover

**Files:** `src/components/recording/device-picker-popover.tsx` (new)

- Renders upward into the transparent area above the toolbar (within the 300px window)
- Lists available devices for that input type
- Checkmark next to the selected device
- "None" option at the top
- Closes on selection or click-outside or Escape
- Styled dark to match toolbar theme
- Entry animation: scale 0.96->1.0 + opacity 0->1, 150ms, `cubic-bezier(0.2, 0, 0, 1)`, origin at bottom-center

Reuse the existing `invoke("list_microphones")` / `invoke("list_cameras")` commands for device enumeration.

### Edge Cases
- If no camera is detected: toggle is visually disabled (reduced opacity, no pointer events, tooltip: "No camera detected")
- Camera/mic activation can take 200-500ms: show a loading spinner in place of the icon during hardware init

---

## Step 5 — Record Button & Close Button

**Files:** Modify `src/components/recording/record-button.tsx`

### Close Button (left side)
- 16x16 X icon in a 28x28 circular hit target (matches macOS window control proportions)
- Closes/hides the recorder window

### Record Button (right side, before gear)
- 24x24 red filled circle — visually prominent, largest icon in the toolbar for clear hierarchy
- Disabled state when no display is selected (dimmed, reduced opacity)
- Tooltip: "Start Recording (Cmd+Shift+R)"
- Clicking triggers the 3-second countdown (Step 6), then starts recording

---

## Step 6 — Countdown Timer

**Files:** `src/components/recording/countdown.tsx` (new)

When the user clicks Record:

1. The toolbar content is replaced with a centered countdown: **3... 2... 1...**
2. Each number displays for 1 second with a subtle scale-down animation
3. After countdown completes, recording starts and the toolbar morphs to the recording bar (Step 8)

**Notes:**
- Countdown can be toggled off in the settings popover (default: on)
- If toggled off, recording starts immediately
- User can cancel the countdown by pressing Escape or clicking the close button
- The countdown runs inside the toolbar pill — no separate overlay

---

## Step 7 — Settings Popover

**Files:** `src/components/recording/settings-popover.tsx` (new)

Gear icon (16x16) + chevron (10x10) on the far right of the toolbar. Click opens a popover above the toolbar (renders into the transparent 244px space).

### Contents

1. **Recent Projects** — Last 5 projects, each row shows:
   - Project name (truncated)
   - Duration
   - "Edit" button that calls `invoke("open_editor", { projectId })`
2. **Divider**
3. **Preferences:**
   - Countdown toggle (on/off)
   - Global shortcut display (read-only for v1)
   - Placeholder for future settings (output format, save location)

Styled with dark background to match toolbar aesthetic. Uses shadcn/ui `Popover`.
Entry animation: same as device picker (scale + opacity, 150ms).

---

## Step 8 — Recording State (Compact Bar)

**Files:**
- `src/recorder-app.tsx` (conditional rendering based on recording state)
- `src/components/recording/recording-bar.tsx` (new)

When recording starts (after countdown), the toolbar morphs to:

```
[■ Stop] [⏸ Pause] | 00:42 ● | [mic ▬▬▬] [sys ▬▬▬]
```

### Behavior

- **Window stays at 700px** — no `setSize()` calls. The visible pill shrinks via CSS `max-width` transition. Transparent overflow is hidden. This avoids the native/web resize desync entirely.
- **Stop:** Red square icon, stops recording, morphs back to full toolbar, opens editor
- **Pause/Resume:** Toggle button
- **Timer:** MM:SS with pulsing red dot (reuse existing `RecordingTimer` logic). `font-variant-numeric: tabular-nums`, 14px, font-weight 600.
- **Audio levels:** Two mini horizontal bars for mic + system audio, only shown if those inputs are active. Transition: `50ms` or none (audio meters should snap, not ease).
- Pulsing red dot uses `animate-pulse` with `prefers-reduced-motion: reduce` override to static red dot.

### Morph Transition

1. Idle controls fade out: opacity 1->0, 120ms
2. 40ms overlap
3. Recording controls fade in: opacity 0->1, 120ms
4. Pill width transitions via CSS `max-width` from 700px to ~400px, 250ms, `cubic-bezier(0.2, 0, 0, 1)`

No `setSize()` needed — the window remains 700x300 at all times.

---

## Step 9 — Global Keyboard Shortcut

**Files:**
- `src-tauri/Cargo.toml` (add `global-shortcut` plugin)
- `src-tauri/src/lib.rs` (register plugin)
- `src/recorder-app.tsx` (listen for shortcut events)

### Implementation

- Register `Cmd+Shift+R` as the global shortcut for start/stop recording
- During recording, the same shortcut stops recording
- Shortcut works even when CaptureKit is not focused
- Show the shortcut in the Record button tooltip and in the Settings popover

### Tauri Plugin

```toml
[dependencies]
tauri-plugin-global-shortcut = "2"
```

---

## Step 10 — Wire It All Together

**Files:** `src/recorder-app.tsx`

Rewrite `RecorderApp` to orchestrate all new components:

1. Manage state: `selectedDisplay`, input toggles (camera/mic/system audio + selected device IDs), recording state, countdown state
2. Render the 300px transparent window with the toolbar pill anchored at the bottom
3. Render `RecorderToolbar` (idle state), `Countdown` (countdown state), or `RecordingBar` (recording state)
4. Preserve all existing recording logic (start/stop/pause/resume handlers)
5. Move recent projects loading into `SettingsPopover`
6. Pass self-exclusion window ID to `start_recording`

### Cleanup

- Delete `src/components/recording/source-picker.tsx` (replaced by source-type-button + input-toggle)

---

## Error Handling

The 56px toolbar has no room for inline error messages. Errors are surfaced via:

- **System notifications** (`tauri-plugin-notification`) for recording failures (e.g., permission revoked mid-recording, display disconnected)
- **Tooltip on affected element** for non-critical issues (e.g., "No camera detected" on disabled toggle)
- **Permission check screen** (Step 0) for first-launch setup

Edge cases to handle:
- Display disconnects during recording: stop recording gracefully, show notification
- Device enumeration returns empty arrays: disable affected toggles with tooltip
- `start_recording` fails: show notification, morph back to idle toolbar

---

## What Stays the Same

- All Rust/Swift recording pipeline code (start, stop, pause, resume, audio levels)
- Editor window and all editor components
- Project management commands
- Asset loading / video streaming

## New Files Summary

| File | Purpose |
|------|---------|
| `src/components/recording/permission-check.tsx` | First-launch permission detection & guidance |
| `src/components/recording/source-type-button.tsx` | Display selector icon (Window added in 6.1) |
| `src/components/recording/input-toggle.tsx` | Camera/Mic/System Audio toggle buttons with chevron |
| `src/components/recording/device-picker-popover.tsx` | Chevron/right-click device selection dropdown |
| `src/components/recording/settings-popover.tsx` | Gear menu with recent projects + preferences |
| `src/components/recording/countdown.tsx` | 3-2-1 countdown before recording |
| `src/components/recording/recording-bar.tsx` | Compact recording-state toolbar |

## Deleted Files

| File | Reason |
|------|--------|
| `src/components/recording/source-picker.tsx` | Replaced by source-type-button + input-toggle |

## Dependencies

- `tauri-plugin-global-shortcut = "2"` — for global keyboard shortcut
- `tauri-plugin-notification = "2"` — for error notifications (if not already present)
- `macos-private-api` Tauri feature flag — for transparent windows
- No new npm packages needed (Lucide icons + shadcn/ui already available)

## Deferred to Phase 6.1

- **Window capture mode** — `ck_list_windows` Swift FFI, window filtering, `RecordingConfig` changes, `SCContentFilter(desktopIndependentWindow:)`, window thumbnails, failure modes (window closed/minimized during recording)
- **Native vibrancy** — `NSVisualEffectView` integration via Tauri plugin for true macOS material blur
- **Area selection** — custom overlay for region capture
- **Device capture** — iOS device mirroring
