# Settings Window Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated macOS-style Settings window (Cmd+,) with three sections: General, Export defaults, and Reko Pro license management. Fast to build, immediately useful.

**Architecture:** New Tauri window created dynamically from Rust (like editor windows), rendering a `SettingsApp` component. Settings persisted as JSON on disk via Rust commands exposed through the Platform interface. License key stays in localStorage (already wired). One new API endpoint for key validation.

---

## Layout

```
┌─────────────────────────────────────────────┐
│  Settings                                   │
├──────────┬──────────────────────────────────┤
│          │                                  │
│ General  │  (content for selected section)  │
│ Export   │                                  │
│ Reko Pro │                                  │
│          │                                  │
│          │                                  │
│          │                                  │
├──────────┴──────────────────────────────────┤
```

- Window: ~600x400, non-resizable, title "Settings"
- Left sidebar: ~160px, subtle bg tint, vertical list, highlight active
- Right content: padded area with section fields
- Default selection: "General"
- State: simple `useState` for active section — no routing

---

## Sections

### General
- **Launch at login** — toggle (uses `tauri-plugin-autostart`)
- **Show in Dock** — toggle (reuses existing `set_dock_visible` logic from `tray.rs`)
- **Default save location** — folder picker button showing current path, click opens native dialog

### Export
- **Default resolution** — dropdown: Original, 4K, 1080p, 720p (default: 1080p)
- **Default quality** — dropdown: Low, Medium, High, Best (default: High)

### Reko Pro
- **License key** — masked input showing `rk_live_••••••••` if saved, with paste/clear buttons
- **Status** — pill: "Active" (green), "Expired" (red), "No license" (gray), validated via API on open
- **Plan info** — "Free" or "Pro ($8/mo)" with associated email
- **Actions:**
  - No key → "Get Pro" button → opens `reko.video/#pricing` in browser
  - Active → "Manage Subscription" link (Lemon Squeezy portal)
  - Expired/canceled → "Resubscribe" link

---

## Data Model

### Settings file

Path: `~/Library/Application Support/com.reko.app/settings.json`

```json
{
  "launchAtLogin": false,
  "showInDock": true,
  "defaultSavePath": "~/Desktop",
  "defaultExportResolution": "1080p",
  "defaultExportQuality": "high"
}
```

### TypeScript types

```typescript
interface AppSettings {
  launchAtLogin: boolean
  showInDock: boolean
  defaultSavePath: string
  defaultExportResolution: "original" | "4k" | "1080p" | "720p"
  defaultExportQuality: "low" | "medium" | "high" | "best"
}
```

License key stays in `localStorage` under `reko-license-key` (already used by `share-api.ts`).

---

## New API Endpoint

### `GET /api/billing/status`

Query param: `key` (the raw license key)

Response:
```json
{
  "tier": "pro",
  "status": "active",
  "email": "user@example.com"
}
```

If key is invalid/missing: `{ "tier": "free", "status": "none", "email": null }`

Uses the existing `hashToken` + DB lookup from `license.ts`. Read-only, no mutations.

---

## Tauri v2 Notes

These are critical implementation details identified during review:

1. **Dynamic window creation** — Settings window must NOT be in `tauri.conf.json`. Create it on demand from `tray.rs` using `WebviewWindowBuilder`, same pattern as editor windows. Focus existing window if already open.

2. **Capabilities file required** — Create `capabilities/settings.json` granting `core:default`, `dialog:default`, and `autostart:allow-is-enabled`/`autostart:allow-enable`/`autostart:allow-disable` to the `settings` window. Without this, all commands silently fail.

3. **`tauri-plugin-autostart` registration** — Must specify `MacosLauncher::LaunchAgent` variant:
   ```rust
   .plugin(tauri_plugin_autostart::init(
       tauri_plugin_autostart::MacosLauncher::LaunchAgent,
       None,
   ))
   ```

4. **`set_dock_visible` must use `run_on_main_thread`** — `NSApplication::setActivationPolicy` must run on the main thread. The Tauri command needs `app: AppHandle` and must call `app.run_on_main_thread()`.

5. **Window close behavior** — The existing `on_window_event` only prevents close for `"recorder"`. Settings window will close normally — no extra code needed.

---

## Implementation Tasks

### Task 1: Rust — Settings commands + window + capabilities

**Files:**
- Create: `apps/tauri/src-tauri/src/commands/settings.rs`
- Create: `apps/tauri/src-tauri/capabilities/settings.json`
- Modify: `apps/tauri/src-tauri/src/commands/mod.rs`
- Modify: `apps/tauri/src-tauri/src/lib.rs` (register commands, add autostart plugin)
- Modify: `apps/tauri/src-tauri/src/tray.rs` (create settings window dynamically instead of showing recorder)
- Modify: `apps/tauri/src-tauri/Cargo.toml` (add `tauri-plugin-autostart`)

**Commands:**
- `get_settings` — reads `settings.json` from app support dir, returns defaults if file missing
- `save_settings` — writes `settings.json` to app support dir
- `get_autostart_enabled` — calls `app.autolaunch().is_enabled()`
- `set_autostart_enabled` — calls `app.autolaunch().enable()` / `.disable()`
- `set_dock_visible` — extracted from `tray.rs`, uses `app.run_on_main_thread()` for `NSApplication::setActivationPolicy`
- `pick_folder` — opens native folder dialog via `tauri-plugin-dialog`, returns selected path

**Window (dynamic, in tray.rs):**
```rust
"tray:show-settings" => {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.set_focus();
    } else {
        let _ = tauri::WebviewWindowBuilder::new(
            app, "settings", tauri::WebviewUrl::App(Default::default())
        )
            .title("Settings")
            .inner_size(600.0, 400.0)
            .resizable(false)
            .build();
    }
}
```

**Capabilities (settings.json):**
```json
{
  "identifier": "settings",
  "windows": ["settings"],
  "permissions": [
    "core:default",
    "dialog:default",
    "autostart:allow-is-enabled",
    "autostart:allow-enable",
    "autostart:allow-disable"
  ]
}
```

### Task 2: Platform interface

**Files:**
- Modify: `apps/app/src/platform/types.ts`
- Modify: `apps/tauri/src/platform/tauri-platform.ts`
- Modify: `apps/app/src/__tests__/mock-platform.ts`

Add to Platform interface:
```typescript
getSettings(): Promise<AppSettings>
saveSettings(settings: AppSettings): Promise<void>
getAutoStartEnabled(): Promise<boolean>
setAutoStartEnabled(enabled: boolean): Promise<void>
setDockVisible(visible: boolean): Promise<void>
pickFolder(defaultPath?: string): Promise<string | null>
```

### Task 3: Settings UI components

**Files:**
- Create: `apps/app/src/settings-app.tsx` — main settings component with sidebar + content
- Create: `apps/app/src/components/settings/general-settings.tsx`
- Create: `apps/app/src/components/settings/export-settings.tsx`
- Create: `apps/app/src/components/settings/pro-settings.tsx`
- Modify: `apps/app/src/root.tsx` — add `if (label === "settings") return <SettingsApp />`

Each section is a simple component with controlled form fields. On change, debounce and call `platform.saveSettings()`. Load settings on mount via `platform.getSettings()`.

### Task 4: Export defaults integration

**Files:**
- Modify: `apps/app/src/components/editor/export-button.tsx`

On mount, read settings via `usePlatform().getSettings()` and use `defaultExportResolution` / `defaultExportQuality` as initial state instead of hardcoded values.

### Task 5: API — billing status endpoint

**Files:**
- Modify: `apps/api/src/routes/billing.ts`

Add `GET /api/billing/status?key=xxx` that hashes the key, looks up the row, returns `{ tier, status, email }`.

### Task 6: Wire up + test

- Open settings via Cmd+, and tray menu
- Toggle each setting and verify persistence across app restarts
- Enter a license key and verify status validation
- Change export defaults and verify they apply in the export dialog
- Test with no `settings.json` (first launch) — defaults should apply
