# Export Panel + 4K Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the minimal export dropdown with a wider popover panel supporting 4K resolution, quality presets, and a configurable output destination.

**Architecture:** Expand the `ExportConfig` type across all three layers (TypeScript, Rust, Swift) to include `bitrate` and `"4k"` resolution. Rebuild the export-button component as a popover panel with pill-toggle selectors. Use Tauri's dialog plugin (already installed) for save-file picking.

**Tech Stack:** React + shadcn/ui popover, Tauri dialog plugin, Rust serde, Swift AVFoundation

---

### Task 1: Expand TypeScript types

**Files:**
- Modify: `src/types/editor.ts:160-163`

**Step 1: Update `ExportConfig` type**

Replace the current `ExportConfig` interface:

```ts
export type ExportResolution = "original" | "4k" | "1080p" | "720p"
export type ExportQuality = "low" | "medium" | "high" | "best"

export interface ExportConfig {
  resolution: ExportResolution
  quality: ExportQuality
  bitrate: number
  outputPath: string
}
```

**Step 2: Add bitrate lookup constant**

Add below `ExportConfig`:

```ts
export const BITRATE_MAP: Record<ExportQuality, Record<string, number>> = {
  low:    { "720p": 5_000_000,  "1080p": 10_000_000, "4k": 25_000_000 },
  medium: { "720p": 10_000_000, "1080p": 15_000_000, "4k": 35_000_000 },
  high:   { "720p": 15_000_000, "1080p": 20_000_000, "4k": 50_000_000 },
  best:   { "720p": 20_000_000, "1080p": 30_000_000, "4k": 80_000_000 },
}
```

The lookup logic: for `"original"` resolution, use the `"4k"` column if source height >= 1440, `"1080p"` column otherwise.

**Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit`
Expected: no errors (or only pre-existing ones)

**Step 4: Commit**

```bash
git add src/types/editor.ts
git commit -m "feat(export): add 4K resolution, quality presets, and bitrate to ExportConfig type"
```

---

### Task 2: Expand Rust `ExportConfig` struct

**Files:**
- Modify: `src-tauri/src/project.rs:169-174`

**Step 1: Update `ExportConfig`**

Replace the current struct:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    pub resolution: String,        // "original" | "4k" | "1080p" | "720p"
    pub quality: String,           // "low" | "medium" | "high" | "best"
    pub bitrate: u64,              // bits per second
    pub output_path: String,
}
```

**Step 2: Update the `test_export_config_serialization` test**

In `src-tauri/src/project.rs` tests section, update the test to include the new fields:

```rust
#[test]
fn test_export_config_serialization() {
    let config = ExportConfig {
        resolution: "4k".to_string(),
        quality: "high".to_string(),
        bitrate: 50_000_000,
        output_path: "/Users/test/Desktop/output.mp4".to_string(),
    };
    let json = serde_json::to_string(&config).unwrap();
    assert!(json.contains("\"resolution\":\"4k\""));
    assert!(json.contains("\"quality\":\"high\""));
    assert!(json.contains("\"bitrate\":50000000"));
    assert!(json.contains("\"outputPath\""));
    let parsed: ExportConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.resolution, "4k");
    assert_eq!(parsed.bitrate, 50_000_000);
}
```

**Step 3: Update the test in `src-tauri/src/commands/export.rs`**

Update `test_export_config_to_json`:

```rust
#[test]
fn test_export_config_to_json() {
    let config = ExportConfig {
        resolution: "1080p".to_string(),
        quality: "high".to_string(),
        bitrate: 20_000_000,
        output_path: "/Users/test/Desktop/output.mp4".to_string(),
    };
    let json = serde_json::to_string(&config).unwrap();
    assert!(json.contains("\"resolution\":\"1080p\""));
    assert!(json.contains("\"outputPath\""));
    assert!(json.contains("\"bitrate\":20000000"));
}
```

**Step 4: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass

**Step 5: Commit**

```bash
git add src-tauri/src/project.rs src-tauri/src/commands/export.rs
git commit -m "feat(export): add quality and bitrate fields to Rust ExportConfig"
```

---

### Task 3: Update Swift export pipeline for 4K + configurable bitrate

**Files:**
- Modify: `RekoEngine/Sources/RekoEngine/export/metal-compositor.swift:168-178` (LayoutMath.outputSize)
- Modify: `RekoEngine/Sources/RekoEngine/export/export-pipeline.swift:8-11` (ExportConfig struct)
- Modify: `RekoEngine/Sources/RekoEngine/export/export-pipeline.swift:546-554` (videoSettings bitrate)

**Step 1: Add `bitrate` and `quality` to Swift `ExportConfig`**

Update the struct in `export-pipeline.swift`:

```swift
public struct ExportConfig: Codable {
    public let resolution: String
    public let quality: String
    public let bitrate: Int
    public let outputPath: String
}
```

**Step 2: Add `"4k"` case to `LayoutMath.outputSize`**

In `metal-compositor.swift`, add a case inside the switch:

```swift
case "4k":
    let w = Int(round(2160.0 * Double(recordingWidth) / Double(recordingHeight)))
    return (width: w & ~1, height: 2160)
```

Add this case before the `"1080p"` case.

**Step 3: Use config bitrate instead of hardcoded value**

In `export-pipeline.swift`, replace `AVVideoAverageBitRateKey: 20_000_000` with:

```swift
AVVideoAverageBitRateKey: exportConfig.bitrate,
```

The `exportConfig` is already in scope at that point in the `run()` method.

**Step 4: Run Swift tests**

Run: `cd RekoEngine && swift test`
Expected: all tests pass

**Step 5: Commit**

```bash
git add RekoEngine/Sources/RekoEngine/export/export-pipeline.swift RekoEngine/Sources/RekoEngine/export/metal-compositor.swift
git commit -m "feat(export): support 4K resolution and configurable bitrate in Swift pipeline"
```

---

### Task 4: Rebuild the Export panel UI

**Files:**
- Modify: `src/components/editor/export-button.tsx` (full rewrite)

**Step 1: Rewrite the ExportButton component**

Replace the entire file with a popover-based panel. Key elements:

- Use shadcn `Popover` / `PopoverContent` / `PopoverTrigger` (or a simple absolutely-positioned div toggled by state, matching existing pattern)
- **Resolution row**: Four pill buttons — Original, 4K, 1080p, 720p. Default: `"1080p"`
- **Quality row**: Four pill buttons — Low, Medium, High, Best. Default: `"high"`
- **Destination row**: Truncated path display + folder icon button. Default: `~/Desktop/{name}.mp4`
  - Folder button calls `save()` from `@tauri-apps/plugin-dialog` with `defaultPath` and `filters: [{ name: "MP4 Video", extensions: ["mp4"] }]`
- **Export button**: Full-width, triggers export
- **Progress state**: Same progress bar as current, but inside the popover panel
- **Completion state**: "Saved!" text with Reveal in Finder link (uses `revealItemInDir` from `@tauri-apps/plugin-opener`)

Pill button styling (reusable inline or as small component):
```tsx
function PillGroup<T extends string>({ options, value, onChange }: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 text-muted-foreground hover:bg-muted"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
```

Bitrate resolution logic in `handleExport`:
```tsx
import { BITRATE_MAP, type ExportResolution, type ExportQuality } from "@/types/editor"

function resolveBitrate(resolution: ExportResolution, quality: ExportQuality): number {
  const column = resolution === "original" ? "4k" : resolution
  return BITRATE_MAP[quality][column] ?? BITRATE_MAP[quality]["1080p"]
}
```

The `handleExport` function builds:
```tsx
const config: ExportConfig = {
  resolution,
  quality,
  bitrate: resolveBitrate(resolution, quality),
  outputPath,
}
```

**Step 2: Verify it renders without errors**

Run: `npm run dev` (Vite should compile without errors)

**Step 3: Commit**

```bash
git add src/components/editor/export-button.tsx
git commit -m "feat(export): rebuild export panel with 4K, quality presets, and file destination picker"
```

---

### Task 5: Integration test — full build

**Step 1: Run full Tauri build to verify FFI boundary**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles successfully (Swift FFI + Rust)

**Step 2: Run all test suites**

Run: `npm test && cargo test --manifest-path src-tauri/Cargo.toml && cd RekoEngine && swift test`
Expected: all pass

**Step 3: Manual smoke test**

Run: `npx tauri dev`
- Open an existing project in the editor
- Click Export button — popover should open
- Toggle resolution pills (Original / 4K / 1080p / 720p)
- Toggle quality pills (Low / Medium / High / Best)
- Click folder icon — native save dialog should appear
- Start an export — progress bar should appear in the panel
- Verify exported file exists at chosen path

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(export): complete export panel redesign with 4K support and quality presets"
```
