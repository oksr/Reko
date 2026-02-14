# Timeline Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the timeline with a Screen Studio-style layout: gold clip track with duration/speed labels, interactive purple zoom segments with inline popover editing, pin-style playhead, and audio waveform visualization.

**Architecture:** Break the monolithic `timeline.tsx` into sub-components (TimeRuler, PlayheadPin, ClipTrack, ZoomTrack, AudioTrack). Reinterpret existing `ZoomKeyframe.durationMs` as segment length (not transition time) with ramp-in/hold/ramp-out interpolation. Add `use-audio-waveform` hook for Web Audio API peak extraction. Keep Rust `interpolate_zoom` in sync.

**Tech Stack:** React, Zustand, Radix Popover, Web Audio API, Canvas, Vitest, Tailwind CSS

**Design doc:** `docs/plans/2026-02-14-timeline-redesign.md`

---

## Task 1: Update Zoom Interpolation Model (TypeScript)

Change from point-to-point transitions to segment-based "ramp in → hold → ramp out" behavior.

**Files:**
- Modify: `src/lib/zoom-interpolation.ts` (full rewrite)
- Modify: `src/__tests__/zoom-interpolation.test.ts` (full rewrite)

**Step 1: Write new tests for segment-based interpolation**

Replace `src/__tests__/zoom-interpolation.test.ts` with:

```ts
import { describe, test, expect } from "vitest"
import { interpolateZoom } from "@/lib/zoom-interpolation"
import type { ZoomKeyframe } from "@/types/editor"

const RAMP_MS = 200 // fixed ramp duration

const seg = (timeMs: number, durationMs: number, scale = 2.0): ZoomKeyframe => ({
  timeMs, durationMs, scale, x: 0.3, y: 0.7, easing: "ease-in-out",
})

describe("interpolateZoom (segment model)", () => {
  test("empty keyframes returns default (no zoom)", () => {
    expect(interpolateZoom([], 1000)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("before segment returns no zoom", () => {
    expect(interpolateZoom([seg(1000, 1000)], 500)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("after segment returns no zoom", () => {
    expect(interpolateZoom([seg(1000, 1000)], 2500)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("during ramp-in phase: interpolates from 1x toward target scale", () => {
    const result = interpolateZoom([seg(1000, 1000)], 1100) // 100ms into 200ms ramp
    expect(result.scale).toBeGreaterThan(1)
    expect(result.scale).toBeLessThan(2)
  })

  test("during hold phase: returns full target values", () => {
    // hold starts at 1000+200=1200, ends at 1000+1000-200=1800
    const result = interpolateZoom([seg(1000, 1000)], 1500)
    expect(result.x).toBeCloseTo(0.3)
    expect(result.y).toBeCloseTo(0.7)
    expect(result.scale).toBe(2)
  })

  test("during ramp-out phase: interpolates from target toward 1x", () => {
    // ramp-out starts at 1800, ends at 2000
    const result = interpolateZoom([seg(1000, 1000)], 1900)
    expect(result.scale).toBeGreaterThan(1)
    expect(result.scale).toBeLessThan(2)
  })

  test("between two segments: returns no zoom", () => {
    const kfs = [seg(1000, 500), seg(3000, 500)]
    const result = interpolateZoom(kfs, 2000)
    expect(result.scale).toBe(1)
  })

  test("short segment (< 2*RAMP): ramp fills entire segment, peak may not reach full scale", () => {
    const result = interpolateZoom([seg(1000, 200, 2.0)], 1100) // midpoint of 200ms segment
    expect(result.scale).toBeGreaterThan(1)
    // with only 200ms total, ramp halves at 100ms each, so midpoint = peak
  })

  test("multiple segments: each is independent", () => {
    const kfs = [seg(1000, 500, 1.5), seg(3000, 500, 2.5)]
    // In hold of first segment
    const r1 = interpolateZoom(kfs, 1300)
    expect(r1.scale).toBe(1.5)
    // In hold of second segment
    const r2 = interpolateZoom(kfs, 3300)
    expect(r2.scale).toBe(2.5)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/zoom-interpolation.test.ts`
Expected: Multiple failures (old interpolation logic doesn't match new segment model)

**Step 3: Implement new segment-based interpolation**

Replace `src/lib/zoom-interpolation.ts` with:

```ts
import type { ZoomKeyframe } from "@/types/editor"

const RAMP_MS = 200

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

/**
 * Segment-based zoom interpolation.
 * Each keyframe defines a zoom segment: ramp in → hold → ramp out.
 * Between segments, zoom is 1x (no zoom).
 * Must match Rust `interpolate_zoom` exactly for preview/export parity.
 */
export function interpolateZoom(
  keyframes: ZoomKeyframe[],
  timeMs: number
): { x: number; y: number; scale: number } {
  const none = { x: 0.5, y: 0.5, scale: 1 }
  if (keyframes.length === 0) return none

  for (const kf of keyframes) {
    const segEnd = kf.timeMs + kf.durationMs
    if (timeMs < kf.timeMs || timeMs >= segEnd) continue

    // We're inside this segment
    const elapsed = timeMs - kf.timeMs
    const ramp = Math.min(RAMP_MS, kf.durationMs / 2)

    let t: number
    if (elapsed < ramp) {
      // Ramp in
      t = easeInOut(elapsed / ramp)
    } else if (elapsed > kf.durationMs - ramp) {
      // Ramp out
      t = easeInOut((segEnd - timeMs) / ramp)
    } else {
      // Hold
      t = 1
    }

    return {
      x: none.x + (kf.x - none.x) * t,
      y: none.y + (kf.y - none.y) * t,
      scale: none.scale + (kf.scale - none.scale) * t,
    }
  }

  return none
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/zoom-interpolation.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/lib/zoom-interpolation.ts src/__tests__/zoom-interpolation.test.ts
git commit -m "feat: segment-based zoom interpolation (ramp in/hold/ramp out)"
```

---

## Task 2: Update Rust Zoom Interpolation for Parity

Keep Rust export pipeline in sync with the new segment model.

**Files:**
- Modify: `src-tauri/src/autozoom.rs:96-150` (rewrite `interpolate_zoom` + `ease_in_out`)
- Modify: `src-tauri/src/autozoom.rs:208-240` (update tests)

**Step 1: Update `interpolate_zoom` in Rust**

Replace `interpolate_zoom` function (line 96-142) and `ease_in_out` (line 144-150) with:

```rust
const RAMP_MS: u64 = 200;

pub fn interpolate_zoom(keyframes: &[ZoomKeyframe], time_ms: u64) -> (f64, f64, f64) {
    if keyframes.is_empty() {
        return (0.5, 0.5, 1.0);
    }

    for kf in keyframes {
        let seg_end = kf.time_ms + kf.duration_ms;
        if time_ms < kf.time_ms || time_ms >= seg_end {
            continue;
        }

        // Inside this segment
        let elapsed = time_ms - kf.time_ms;
        let ramp = RAMP_MS.min(kf.duration_ms / 2);

        let t = if elapsed < ramp {
            // Ramp in
            ease_in_out(elapsed as f64 / ramp as f64)
        } else if elapsed > kf.duration_ms - ramp {
            // Ramp out
            ease_in_out((seg_end - time_ms) as f64 / ramp as f64)
        } else {
            // Hold
            1.0
        };

        let x = 0.5 + (kf.x - 0.5) * t;
        let y = 0.5 + (kf.y - 0.5) * t;
        let s = 1.0 + (kf.scale - 1.0) * t;
        return (x, y, s);
    }

    (0.5, 0.5, 1.0)
}

fn ease_in_out(t: f64) -> f64 {
    if t < 0.5 {
        2.0 * t * t
    } else {
        -1.0 + (4.0 - 2.0 * t) * t
    }
}
```

**Step 2: Update Rust tests**

Replace the test functions (starting around line 208) with tests matching the new segment model:

```rust
#[test]
fn test_interpolate_empty() {
    assert_eq!(interpolate_zoom(&[], 1000), (0.5, 0.5, 1.0));
}

#[test]
fn test_interpolate_before_segment() {
    let kfs = vec![ZoomKeyframe {
        time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
        easing: "ease-in-out".to_string(), duration_ms: 1000,
    }];
    assert_eq!(interpolate_zoom(&kfs, 500), (0.5, 0.5, 1.0));
}

#[test]
fn test_interpolate_after_segment() {
    let kfs = vec![ZoomKeyframe {
        time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
        easing: "ease-in-out".to_string(), duration_ms: 1000,
    }];
    assert_eq!(interpolate_zoom(&kfs, 2500), (0.5, 0.5, 1.0));
}

#[test]
fn test_interpolate_hold_phase() {
    let kfs = vec![ZoomKeyframe {
        time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
        easing: "ease-in-out".to_string(), duration_ms: 1000,
    }];
    let (x, y, s) = interpolate_zoom(&kfs, 1500); // in hold phase
    assert!((x - 0.3).abs() < 0.001);
    assert!((y - 0.7).abs() < 0.001);
    assert!((s - 2.0).abs() < 0.001);
}

#[test]
fn test_interpolate_ramp_in() {
    let kfs = vec![ZoomKeyframe {
        time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
        easing: "ease-in-out".to_string(), duration_ms: 1000,
    }];
    let (_, _, s) = interpolate_zoom(&kfs, 1100); // 100ms into 200ms ramp
    assert!(s > 1.0 && s < 2.0);
}

#[test]
fn test_interpolate_between_segments() {
    let kfs = vec![
        ZoomKeyframe { time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0, easing: "ease-in-out".to_string(), duration_ms: 500 },
        ZoomKeyframe { time_ms: 3000, x: 0.5, y: 0.5, scale: 1.5, easing: "ease-in-out".to_string(), duration_ms: 500 },
    ];
    assert_eq!(interpolate_zoom(&kfs, 2000), (0.5, 0.5, 1.0));
}
```

**Step 3: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -- autozoom`
Expected: All PASS

**Step 4: Commit**

```bash
git add src-tauri/src/autozoom.rs
git commit -m "feat: update Rust zoom interpolation to segment model (parity with TS)"
```

---

## Task 3: Add Store State for Zoom Selection + Update Zoom Actions

Add `selectedZoomIndex` and `zoomPopoverOpen` to the store. Add `updateZoomKeyframe` and `moveZoomKeyframe` actions.

**Files:**
- Modify: `src/stores/editor-store.ts:38-59` (add state fields + actions to interface)
- Modify: `src/stores/editor-store.ts:83-242` (add implementations)
- Modify: `src/__tests__/editor-store.test.ts` (add new tests)

**Step 1: Write tests for new store actions**

Append to `src/__tests__/editor-store.test.ts`:

```ts
it("tracks selectedZoomIndex", () => {
  useEditorStore.getState().setSelectedZoomIndex(2)
  expect(useEditorStore.getState().selectedZoomIndex).toBe(2)
  useEditorStore.getState().setSelectedZoomIndex(null)
  expect(useEditorStore.getState().selectedZoomIndex).toBeNull()
})

it("updateZoomKeyframe updates properties at index", () => {
  useEditorStore.getState().addZoomKeyframe({
    timeMs: 1000, x: 0.5, y: 0.5, scale: 2.0, easing: "ease-in-out", durationMs: 500,
  })
  useEditorStore.getState().updateZoomKeyframe(0, { scale: 1.5, easing: "linear" })
  const kf = useEditorStore.getState().project!.effects.zoomKeyframes[0]
  expect(kf.scale).toBe(1.5)
  expect(kf.easing).toBe("linear")
  expect(kf.x).toBe(0.5) // unchanged
})

it("moveZoomKeyframe updates timeMs and re-sorts", () => {
  useEditorStore.getState().addZoomKeyframe({
    timeMs: 1000, x: 0.5, y: 0.5, scale: 2.0, easing: "ease-in-out", durationMs: 500,
  })
  useEditorStore.getState().addZoomKeyframe({
    timeMs: 3000, x: 0.3, y: 0.7, scale: 1.5, easing: "ease-in-out", durationMs: 500,
  })
  // Move first segment to after the second
  useEditorStore.getState().moveZoomKeyframe(0, 4000)
  const kfs = useEditorStore.getState().project!.effects.zoomKeyframes
  expect(kfs[0].timeMs).toBe(3000)
  expect(kfs[1].timeMs).toBe(4000)
})

it("selectedZoomIndex is NOT tracked by undo", () => {
  useEditorStore.getState().setSelectedZoomIndex(1)
  const { pastStates } = useEditorStore.temporal.getState()
  expect(pastStates.length).toBe(0)
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/editor-store.test.ts`
Expected: FAIL — `setSelectedZoomIndex`, `updateZoomKeyframe`, `moveZoomKeyframe` not defined

**Step 3: Add new state and actions to the store**

In `src/stores/editor-store.ts`, add to the `EditorState` interface (after line 58):

```ts
selectedZoomIndex: number | null
zoomPopoverOpen: boolean
setSelectedZoomIndex: (index: number | null) => void
setZoomPopoverOpen: (open: boolean) => void
updateZoomKeyframe: (index: number, updates: Partial<ZoomKeyframe>) => void
moveZoomKeyframe: (index: number, newTimeMs: number) => void
```

Add initial state (after line 88, alongside `currentTime` and `isPlaying`):

```ts
selectedZoomIndex: null,
zoomPopoverOpen: false,
```

Add action implementations (after `setZoomKeyframes` implementation, before `setCurrentTime`):

```ts
setSelectedZoomIndex: (index) => set({ selectedZoomIndex: index }),
setZoomPopoverOpen: (open) => set({ zoomPopoverOpen: open }),

updateZoomKeyframe: (index, updates) =>
  set((s) => {
    if (!s.project) return s
    const kfs = [...s.project.effects.zoomKeyframes]
    if (index < 0 || index >= kfs.length) return s
    kfs[index] = { ...kfs[index], ...updates }
    return {
      project: {
        ...s.project,
        effects: { ...s.project.effects, zoomKeyframes: kfs },
      },
    }
  }),

moveZoomKeyframe: (index, newTimeMs) =>
  set((s) => {
    if (!s.project) return s
    const kfs = [...s.project.effects.zoomKeyframes]
    if (index < 0 || index >= kfs.length) return s
    kfs[index] = { ...kfs[index], timeMs: newTimeMs }
    kfs.sort((a, b) => a.timeMs - b.timeMs)
    return {
      project: {
        ...s.project,
        effects: { ...s.project.effects, zoomKeyframes: kfs },
      },
    }
  }),
```

Update the `partialize` function to exclude the new non-tracked fields — no changes needed since `selectedZoomIndex` and `zoomPopoverOpen` are not on `project` and `partialize` only tracks `project`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/editor-store.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/stores/editor-store.ts src/__tests__/editor-store.test.ts
git commit -m "feat: add zoom selection state and segment manipulation actions to store"
```

---

## Task 4: Create `use-audio-waveform` Hook

Decode audio files via Web Audio API, extract peaks for waveform rendering.

**Files:**
- Create: `src/hooks/use-audio-waveform.ts`
- Create: `src/__tests__/use-audio-waveform.test.ts`

**Step 1: Write tests**

Create `src/__tests__/use-audio-waveform.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useAudioWaveform } from "@/hooks/use-audio-waveform"

// Mock Tauri's convertFileSrc
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}))

// Mock fetch + AudioContext
const mockDecodeAudioData = vi.fn()
const mockGetChannelData = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()

  // Mock AudioContext
  global.AudioContext = vi.fn().mockImplementation(() => ({
    decodeAudioData: mockDecodeAudioData,
  })) as any

  // Mock fetch
  global.fetch = vi.fn().mockResolvedValue({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  }) as any
})

describe("useAudioWaveform", () => {
  it("returns loading state initially", () => {
    mockDecodeAudioData.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useAudioWaveform("/path/to/audio.wav", 500))
    expect(result.current.loading).toBe(true)
    expect(result.current.peaks).toBeNull()
  })

  it("returns null peaks when path is null", () => {
    const { result } = renderHook(() => useAudioWaveform(null, 500))
    expect(result.current.loading).toBe(false)
    expect(result.current.peaks).toBeNull()
  })

  it("extracts peaks from decoded audio", async () => {
    const samples = new Float32Array(1000)
    // Create a simple pattern: alternating high/low
    for (let i = 0; i < 1000; i++) samples[i] = i % 2 === 0 ? 0.8 : -0.5

    mockGetChannelData.mockReturnValue(samples)
    mockDecodeAudioData.mockResolvedValue({
      numberOfChannels: 1,
      length: 1000,
      sampleRate: 44100,
      getChannelData: mockGetChannelData,
    })

    const { result } = renderHook(() => useAudioWaveform("/path/audio.wav", 100))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.peaks).not.toBeNull()
    expect(result.current.peaks!.length).toBe(100) // matches requested width
    // Each peak should be a positive number (max absolute value in bucket)
    result.current.peaks!.forEach((p) => {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/use-audio-waveform.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the hook**

Create `src/hooks/use-audio-waveform.ts`:

```ts
import { useState, useEffect, useRef } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"

interface WaveformResult {
  peaks: number[] | null
  loading: boolean
}

/**
 * Decode an audio file and extract peak amplitudes for waveform rendering.
 * @param audioPath - Absolute path to audio file, or null if not available
 * @param width - Number of peak samples to extract (typically timeline pixel width)
 */
export function useAudioWaveform(audioPath: string | null, width: number): WaveformResult {
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!audioPath || width <= 0) {
      setPeaks(null)
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)

    const decode = async () => {
      try {
        const url = convertFileSrc(audioPath)
        const response = await fetch(url, { signal: controller.signal })
        const arrayBuffer = await response.arrayBuffer()

        const audioCtx = new AudioContext()
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

        if (controller.signal.aborted) return

        // Extract peaks from first channel
        const channelData = audioBuffer.getChannelData(0)
        const samplesPerBucket = Math.floor(channelData.length / width)
        const result: number[] = []

        for (let i = 0; i < width; i++) {
          const start = i * samplesPerBucket
          const end = Math.min(start + samplesPerBucket, channelData.length)
          let max = 0
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j])
            if (abs > max) max = abs
          }
          result.push(max)
        }

        if (!controller.signal.aborted) {
          setPeaks(result)
          setLoading(false)
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          console.error("Waveform decode failed:", e)
          setPeaks(null)
          setLoading(false)
        }
      }
    }

    decode()

    return () => {
      controller.abort()
    }
  }, [audioPath, width])

  return { peaks, loading }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/use-audio-waveform.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/hooks/use-audio-waveform.ts src/__tests__/use-audio-waveform.test.ts
git commit -m "feat: add use-audio-waveform hook for Web Audio peak extraction"
```

---

## Task 5: Create TimeRuler Component

Extract and restyle the time ruler as a standalone component with dot markers and click-to-seek.

**Files:**
- Create: `src/components/editor/timeline/time-ruler.tsx`
- Create: `src/components/editor/timeline/types.ts` (shared types)

**Step 1: Create shared timeline types**

Create `src/components/editor/timeline/types.ts`:

```ts
import type { useVideoSync } from "@/hooks/use-video-sync"

export interface TimelineContext {
  durationMs: number
  inPoint: number
  outPoint: number
  currentTime: number
  videoSync: ReturnType<typeof useVideoSync>
  /** Convert ms to percentage of total duration */
  msToPercent: (ms: number) => number
  /** Ref for the shared timeline container (for coordinate calculations) */
  containerRef: React.RefObject<HTMLDivElement | null>
}
```

**Step 2: Build TimeRuler component**

Create `src/components/editor/timeline/time-ruler.tsx`:

```tsx
import { useMemo, useCallback } from "react"
import type { TimelineContext } from "./types"

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, "0")}`
}

interface TimeRulerProps {
  ctx: TimelineContext
}

export function TimeRuler({ ctx }: TimeRulerProps) {
  const { durationMs, msToPercent } = ctx

  const marks = useMemo(() => {
    const stepMs = durationMs <= 10000 ? 1000
      : durationMs <= 30000 ? 5000
      : durationMs <= 120000 ? 10000
      : 30000
    const result: { ms: number; pct: number; label: string; isMajor: boolean }[] = []
    const subStep = stepMs / 4
    for (let ms = 0; ms <= durationMs; ms += subStep) {
      const isMajor = ms % stepMs === 0
      result.push({ ms, pct: msToPercent(ms), label: formatTime(ms), isMajor })
    }
    return result
  }, [durationMs, msToPercent])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const timeMs = pct * durationMs
      ctx.videoSync.seek(timeMs)
    },
    [ctx, durationMs]
  )

  return (
    <div
      className="relative h-6 cursor-pointer select-none"
      onClick={handleClick}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {marks.map((m) =>
        m.isMajor ? (
          <span
            key={m.ms}
            className="absolute -translate-x-1/2 text-[10px] text-muted-foreground/70 top-0"
            style={{ left: `${m.pct}%` }}
          >
            {m.label}
          </span>
        ) : (
          <span
            key={m.ms}
            className="absolute top-2 w-1 h-1 rounded-full bg-muted-foreground/30 -translate-x-1/2"
            style={{ left: `${m.pct}%` }}
          />
        )
      )}
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add src/components/editor/timeline/types.ts src/components/editor/timeline/time-ruler.tsx
git commit -m "feat: add TimeRuler component with dot markers and click-to-seek"
```

---

## Task 6: Create PlayheadPin Component

Draggable playhead pin with vertical line through all tracks.

**Files:**
- Create: `src/components/editor/timeline/playhead-pin.tsx`

**Step 1: Build PlayheadPin**

Create `src/components/editor/timeline/playhead-pin.tsx`:

```tsx
import { useCallback, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { TimelineContext } from "./types"

interface PlayheadPinProps {
  ctx: TimelineContext
}

export function PlayheadPin({ ctx }: PlayheadPinProps) {
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const [dragging, setDragging] = useState(false)
  const pct = ctx.msToPercent(ctx.currentTime)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      setDragging(true)

      const onMove = (ev: MouseEvent) => {
        const p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
        const timeMs = p * ctx.durationMs
        ctx.videoSync.seek(timeMs)
        setCurrentTime(timeMs)
      }

      const onUp = () => {
        setDragging(false)
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [ctx, setCurrentTime]
  )

  return (
    <>
      {/* Pin handle on the ruler */}
      <div
        className="absolute top-0 z-20 -translate-x-1/2 cursor-grab active:cursor-grabbing"
        style={{ left: `${pct}%` }}
        onMouseDown={handleMouseDown}
      >
        <div
          className={`w-3 h-3 rounded-full border-2 ${
            dragging ? "bg-primary border-primary" : "bg-primary/90 border-primary hover:bg-primary"
          }`}
        />
      </div>
      {/* Vertical line through tracks */}
      <div
        className="absolute top-6 bottom-0 w-[1.5px] bg-primary/80 z-10 pointer-events-none"
        style={{ left: `${pct}%`, boxShadow: "0 0 4px rgba(var(--primary), 0.3)" }}
      />
    </>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/editor/timeline/playhead-pin.tsx
git commit -m "feat: add PlayheadPin component with drag-to-scrub"
```

---

## Task 7: Create ClipTrack Component

Gold bar with duration/speed label and styled trim handles.

**Files:**
- Create: `src/components/editor/timeline/clip-track.tsx`

**Step 1: Build ClipTrack**

Create `src/components/editor/timeline/clip-track.tsx`:

```tsx
import { useCallback, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { TimelineContext } from "./types"

interface ClipTrackProps {
  ctx: TimelineContext
}

function formatDuration(ms: number): string {
  const s = ms / 1000
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s * 10) / 10}s`
}

export function ClipTrack({ ctx }: ClipTrackProps) {
  const { durationMs, inPoint, outPoint, msToPercent, containerRef, videoSync } = ctx
  const [dragging, setDragging] = useState<"in" | "out" | null>(null)

  const inPct = msToPercent(inPoint)
  const outPct = msToPercent(outPoint)
  const clipDuration = outPoint - inPoint

  const handleTrimDrag = useCallback(
    (e: React.MouseEvent, type: "in" | "out") => {
      e.stopPropagation()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      setDragging(type)

      const onMove = (ev: MouseEvent) => {
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
        const timeMs = Math.round(pct * durationMs)
        const state = useEditorStore.getState()

        if (type === "in") {
          const clamped = Math.max(0, Math.min(timeMs, state.project!.timeline.out_point - 500))
          state.setInPoint(clamped)
          videoSync.seek(clamped)
          state.setCurrentTime(clamped)
        } else {
          const clamped = Math.min(durationMs, Math.max(timeMs, state.project!.timeline.in_point + 500))
          state.setOutPoint(clamped)
          videoSync.seek(clamped)
          state.setCurrentTime(clamped)
        }
      }

      const onUp = () => {
        setDragging(null)
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, videoSync]
  )

  return (
    <div className="relative h-10">
      {/* Dimmed region before in-point */}
      {inPct > 0 && (
        <div
          className="absolute top-0 bottom-0 left-0 rounded-l-md overflow-hidden"
          style={{ width: `${inPct}%` }}
        >
          <div className="w-full h-full bg-amber-700/20 rounded-l-md" />
        </div>
      )}

      {/* Active clip bar */}
      <div
        className="absolute top-0 bottom-0 rounded-md"
        style={{
          left: `${inPct}%`,
          width: `${outPct - inPct}%`,
          background: "linear-gradient(to bottom, #d4a054, #c4903e)",
        }}
      >
        {/* Label */}
        <div className="flex flex-col items-center justify-center h-full text-black/70 pointer-events-none">
          <span className="text-[10px] font-medium leading-tight">Clip</span>
          <span className="text-[11px] font-semibold leading-tight">
            {formatDuration(clipDuration)} &middot; 1x
          </span>
        </div>

        {/* In-point trim handle */}
        <div
          className={`absolute top-0 bottom-0 left-0 w-2 cursor-col-resize rounded-l-md transition-colors ${
            dragging === "in" ? "bg-amber-900/60" : "bg-amber-900/30 hover:bg-amber-900/50"
          }`}
          onMouseDown={(e) => handleTrimDrag(e, "in")}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-3 bg-amber-900/40 rounded-full" />
        </div>

        {/* Out-point trim handle */}
        <div
          className={`absolute top-0 bottom-0 right-0 w-2 cursor-col-resize rounded-r-md transition-colors ${
            dragging === "out" ? "bg-amber-900/60" : "bg-amber-900/30 hover:bg-amber-900/50"
          }`}
          onMouseDown={(e) => handleTrimDrag(e, "out")}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-3 bg-amber-900/40 rounded-full" />
        </div>
      </div>

      {/* Dimmed region after out-point */}
      {outPct < 100 && (
        <div
          className="absolute top-0 bottom-0 right-0 rounded-r-md overflow-hidden"
          style={{ width: `${100 - outPct}%` }}
        >
          <div className="w-full h-full bg-amber-700/20 rounded-r-md" />
        </div>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/editor/timeline/clip-track.tsx
git commit -m "feat: add ClipTrack component with gold styling and trim handles"
```

---

## Task 8: Create ZoomTrack + ZoomSegment + ZoomPopover Components

Interactive zoom segments with drag/resize and inline popover editing.

**Files:**
- Create: `src/components/editor/timeline/zoom-track.tsx`
- Create: `src/components/editor/timeline/zoom-segment.tsx`
- Create: `src/components/editor/timeline/zoom-popover.tsx`

**Step 1: Create ZoomPopover**

Create `src/components/editor/timeline/zoom-popover.tsx`:

```tsx
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useEditorStore } from "@/stores/editor-store"
import { Trash2 } from "lucide-react"
import type { ZoomKeyframe } from "@/types/editor"

interface ZoomPopoverProps {
  segment: ZoomKeyframe
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: React.RefObject<HTMLDivElement | null>
}

export function ZoomPopover({ segment, index, open, onOpenChange, anchorRef }: ZoomPopoverProps) {
  const updateZoomKeyframe = useEditorStore((s) => s.updateZoomKeyframe)
  const removeZoomKeyframe = useEditorStore((s) => s.removeZoomKeyframe)

  const handleDelete = () => {
    removeZoomKeyframe(segment.timeMs)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent side="top" align="center" className="w-56 p-3 space-y-3">
        {/* Scale slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Scale</Label>
            <span className="text-xs font-mono text-muted-foreground">{segment.scale.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={1.1}
            max={3.0}
            step={0.1}
            value={segment.scale}
            onChange={(e) => updateZoomKeyframe(index, { scale: parseFloat(e.target.value) })}
            className="w-full h-1.5 accent-primary"
          />
        </div>

        {/* Easing select */}
        <div className="space-y-1">
          <Label className="text-xs">Easing</Label>
          <select
            value={segment.easing}
            onChange={(e) => updateZoomKeyframe(index, { easing: e.target.value as ZoomKeyframe["easing"] })}
            className="w-full text-xs bg-muted border border-border rounded px-2 py-1"
          >
            <option value="ease-in-out">Ease In-Out</option>
            <option value="ease-in">Ease In</option>
            <option value="ease-out">Ease Out</option>
            <option value="linear">Linear</option>
          </select>
        </div>

        {/* Delete */}
        <Button size="sm" variant="destructive" className="w-full h-7 text-xs" onClick={handleDelete}>
          <Trash2 className="w-3 h-3 mr-1" /> Delete Segment
        </Button>
      </PopoverContent>
    </Popover>
  )
}
```

**Step 2: Create ZoomSegment**

Create `src/components/editor/timeline/zoom-segment.tsx`:

```tsx
import { useCallback, useRef, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { Mouse, Lock } from "lucide-react"
import { ZoomPopover } from "./zoom-popover"
import type { ZoomKeyframe } from "@/types/editor"
import type { TimelineContext } from "./types"

interface ZoomSegmentProps {
  segment: ZoomKeyframe
  index: number
  ctx: TimelineContext
  isSelected: boolean
  onSelect: (index: number) => void
}

export function ZoomSegment({ segment, index, ctx, isSelected, onSelect }: ZoomSegmentProps) {
  const { durationMs, msToPercent, containerRef } = ctx
  const moveZoomKeyframe = useEditorStore((s) => s.moveZoomKeyframe)
  const updateZoomKeyframe = useEditorStore((s) => s.updateZoomKeyframe)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const segmentRef = useRef<HTMLDivElement>(null)

  const leftPct = msToPercent(segment.timeMs)
  const widthPct = msToPercent(segment.timeMs + segment.durationMs) - leftPct
  const isAuto = segment.x !== 0.5 || segment.y !== 0.5

  // Drag to move the whole segment
  const handleBodyDrag = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const startX = e.clientX
      const startTimeMs = segment.timeMs

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dtMs = (dx / rect.width) * durationMs
        const newTime = Math.max(0, Math.min(durationMs - segment.durationMs, Math.round(startTimeMs + dtMs)))
        moveZoomKeyframe(index, newTime)
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, segment, index, moveZoomKeyframe]
  )

  // Drag to resize from edge
  const handleEdgeDrag = useCallback(
    (e: React.MouseEvent, edge: "left" | "right") => {
      e.stopPropagation()
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const MIN_DURATION = 200

      const onMove = (ev: MouseEvent) => {
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
        const timeMs = Math.round(pct * durationMs)

        if (edge === "left") {
          const maxStart = segment.timeMs + segment.durationMs - MIN_DURATION
          const newStart = Math.max(0, Math.min(timeMs, maxStart))
          const newDuration = segment.timeMs + segment.durationMs - newStart
          moveZoomKeyframe(index, newStart)
          updateZoomKeyframe(index, { durationMs: newDuration })
        } else {
          const minEnd = segment.timeMs + MIN_DURATION
          const newEnd = Math.max(minEnd, Math.min(timeMs, durationMs))
          updateZoomKeyframe(index, { durationMs: newEnd - segment.timeMs })
        }
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [containerRef, durationMs, segment, index, moveZoomKeyframe, updateZoomKeyframe]
  )

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(index)
    setPopoverOpen(true)
  }

  return (
    <>
      <div
        ref={segmentRef}
        className={`absolute top-0 bottom-0 rounded-md cursor-grab active:cursor-grabbing transition-shadow ${
          isSelected
            ? "ring-2 ring-primary shadow-lg shadow-primary/20"
            : "hover:ring-1 hover:ring-primary/50"
        }`}
        style={{
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          background: "linear-gradient(to bottom, #7c5df5, #6344e0)",
        }}
        onMouseDown={handleBodyDrag}
        onClick={handleClick}
      >
        {/* Labels */}
        <div className="flex flex-col items-center justify-center h-full text-white/90 pointer-events-none overflow-hidden px-1">
          <span className="text-[9px] font-medium leading-tight opacity-70">Zoom</span>
          <div className="flex items-center gap-1 text-[10px] font-semibold leading-tight">
            <span>{segment.scale.toFixed(1)}x</span>
            {isAuto ? <Mouse className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
          </div>
        </div>

        {/* Left resize handle */}
        <div
          className="absolute top-0 bottom-0 left-0 w-1.5 cursor-col-resize rounded-l-md hover:bg-white/20"
          onMouseDown={(e) => handleEdgeDrag(e, "left")}
          onClick={(e) => e.stopPropagation()}
        />

        {/* Right resize handle */}
        <div
          className="absolute top-0 bottom-0 right-0 w-1.5 cursor-col-resize rounded-r-md hover:bg-white/20"
          onMouseDown={(e) => handleEdgeDrag(e, "right")}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <ZoomPopover
        segment={segment}
        index={index}
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        anchorRef={segmentRef}
      />
    </>
  )
}
```

**Step 3: Create ZoomTrack**

Create `src/components/editor/timeline/zoom-track.tsx`:

```tsx
import { useCallback, useRef } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { ZoomSegment } from "./zoom-segment"
import type { TimelineContext } from "./types"

interface ZoomTrackProps {
  ctx: TimelineContext
}

export function ZoomTrack({ ctx }: ZoomTrackProps) {
  const project = useEditorStore((s) => s.project)
  const selectedZoomIndex = useEditorStore((s) => s.selectedZoomIndex)
  const setSelectedZoomIndex = useEditorStore((s) => s.setSelectedZoomIndex)
  const addZoomKeyframe = useEditorStore((s) => s.addZoomKeyframe)
  const removeZoomKeyframe = useEditorStore((s) => s.removeZoomKeyframe)
  const dragStartRef = useRef<{ x: number; timeMs: number } | null>(null)

  const keyframes = project?.effects.zoomKeyframes ?? []

  // Check if a time overlaps any existing segment
  const isOverlapping = (timeMs: number, durationMs: number): boolean => {
    const end = timeMs + durationMs
    return keyframes.some((kf) => {
      const kfEnd = kf.timeMs + kf.durationMs
      return timeMs < kfEnd && end > kf.timeMs
    })
  }

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const timeMs = Math.round(pct * ctx.durationMs)
      dragStartRef.current = { x: e.clientX, timeMs }
    },
    [ctx]
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ctx.containerRef.current || !dragStartRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const endPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const endTimeMs = Math.round(endPct * ctx.durationMs)
      const startTimeMs = dragStartRef.current.timeMs

      const dx = Math.abs(e.clientX - dragStartRef.current.x)
      dragStartRef.current = null

      // Click (< 5px drag): create default segment
      if (dx < 5) {
        const defaultDuration = 500
        const segStart = Math.max(0, timeMs - defaultDuration / 2)
        const timeMs2 = Math.round(endPct * ctx.durationMs)
        const newStart = Math.max(0, timeMs2 - defaultDuration / 2)
        if (!isOverlapping(newStart, defaultDuration)) {
          addZoomKeyframe({
            timeMs: newStart,
            durationMs: defaultDuration,
            x: 0.5,
            y: 0.5,
            scale: 1.5,
            easing: "ease-in-out",
          })
        }
        return
      }

      // Drag: create segment spanning the dragged range
      const segStart = Math.min(startTimeMs, endTimeMs)
      const segEnd = Math.max(startTimeMs, endTimeMs)
      const duration = Math.max(200, segEnd - segStart)
      if (!isOverlapping(segStart, duration)) {
        addZoomKeyframe({
          timeMs: segStart,
          durationMs: duration,
          x: 0.5,
          y: 0.5,
          scale: 1.5,
          easing: "ease-in-out",
        })
      }
    },
    [ctx, keyframes, addZoomKeyframe]
  )

  // Delete selected segment on Delete/Backspace
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedZoomIndex !== null) {
        const kf = keyframes[selectedZoomIndex]
        if (kf) {
          removeZoomKeyframe(kf.timeMs)
          setSelectedZoomIndex(null)
        }
      }
    },
    [selectedZoomIndex, keyframes, removeZoomKeyframe, setSelectedZoomIndex]
  )

  const isEmpty = keyframes.length === 0

  return (
    <div
      className={`relative h-9 rounded-md ${
        isEmpty ? "bg-indigo-950/40 border border-dashed border-indigo-500/30" : "bg-indigo-950/20"
      }`}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {isEmpty ? (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-indigo-400/60">Click or drag to add zoom on cursor</span>
        </div>
      ) : (
        keyframes.map((kf, i) => (
          <ZoomSegment
            key={`${kf.timeMs}-${i}`}
            segment={kf}
            index={i}
            ctx={ctx}
            isSelected={selectedZoomIndex === i}
            onSelect={setSelectedZoomIndex}
          />
        ))
      )}
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add src/components/editor/timeline/zoom-popover.tsx src/components/editor/timeline/zoom-segment.tsx src/components/editor/timeline/zoom-track.tsx
git commit -m "feat: add ZoomTrack with draggable segments and inline popover editing"
```

---

## Task 9: Create AudioTrack Component

Canvas-based waveform renderer using the `use-audio-waveform` hook.

**Files:**
- Create: `src/components/editor/timeline/audio-track.tsx`

**Step 1: Build AudioTrack**

Create `src/components/editor/timeline/audio-track.tsx`:

```tsx
import { useRef, useEffect, useCallback } from "react"
import { useAudioWaveform } from "@/hooks/use-audio-waveform"
import type { TimelineContext } from "./types"

interface AudioTrackProps {
  ctx: TimelineContext
  audioPath: string
  type: "mic" | "system"
}

export function AudioTrack({ ctx, audioPath, type }: AudioTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { peaks, loading } = useAudioWaveform(audioPath, 800)

  const { inPoint, outPoint, durationMs, msToPercent } = ctx
  const inPct = msToPercent(inPoint) / 100
  const outPct = msToPercent(outPoint) / 100

  // Render waveform to canvas
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !peaks) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr

    const c = canvas.getContext("2d")!
    c.scale(dpr, dpr)
    c.clearRect(0, 0, rect.width, rect.height)

    const barWidth = rect.width / peaks.length
    const midY = rect.height / 2
    const maxAmp = rect.height / 2 - 2

    const activeColor = type === "mic" ? "rgba(217, 175, 80, 0.7)" : "rgba(148, 163, 184, 0.5)"
    const dimColor = type === "mic" ? "rgba(217, 175, 80, 0.2)" : "rgba(148, 163, 184, 0.15)"

    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth
      const pctPos = i / peaks.length
      const isDimmed = pctPos < inPct || pctPos > outPct

      c.fillStyle = isDimmed ? dimColor : activeColor
      const h = peaks[i] * maxAmp
      // Round cap effect via rounded rect
      const bw = Math.max(1, barWidth - 1)
      c.beginPath()
      c.roundRect(x, midY - h, bw, h * 2, 1)
      c.fill()
    }
  }, [peaks, inPct, outPct, type])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!ctx.containerRef.current) return
      const rect = ctx.containerRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      ctx.videoSync.seek(pct * ctx.durationMs)
    },
    [ctx]
  )

  return (
    <div ref={containerRef} className="relative h-8 rounded-md cursor-pointer" onClick={handleClick}>
      {loading ? (
        <div className="w-full h-full bg-muted/30 rounded-md animate-pulse" />
      ) : peaks ? (
        <canvas ref={canvasRef} className="w-full h-full" />
      ) : null}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/editor/timeline/audio-track.tsx
git commit -m "feat: add AudioTrack component with canvas waveform rendering"
```

---

## Task 10: Assemble New Timeline and Replace Old One

Wire all sub-components into a new `timeline/index.tsx`, update imports in `editor-app.tsx`, delete old `timeline.tsx`.

**Files:**
- Create: `src/components/editor/timeline/index.tsx`
- Modify: `src/editor-app.tsx:13` (update import path)
- Delete: `src/components/editor/timeline.tsx` (old monolithic component)

**Step 1: Create the new Timeline wrapper**

Create `src/components/editor/timeline/index.tsx`:

```tsx
import { useRef, useCallback, useMemo } from "react"
import { useEditorStore } from "@/stores/editor-store"
import type { useVideoSync } from "@/hooks/use-video-sync"
import { TimeRuler } from "./time-ruler"
import { PlayheadPin } from "./playhead-pin"
import { ClipTrack } from "./clip-track"
import { ZoomTrack } from "./zoom-track"
import { AudioTrack } from "./audio-track"
import type { TimelineContext } from "./types"

interface TimelineProps {
  videoSync: ReturnType<typeof useVideoSync>
}

export function Timeline({ videoSync }: TimelineProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const containerRef = useRef<HTMLDivElement>(null)

  const ctx: TimelineContext | null = useMemo(() => {
    if (!project) return null
    const { duration_ms, in_point, out_point } = project.timeline
    return {
      durationMs: duration_ms,
      inPoint: in_point,
      outPoint: out_point,
      currentTime,
      videoSync,
      msToPercent: (ms: number) => (ms / duration_ms) * 100,
      containerRef,
    }
  }, [project, currentTime, videoSync])

  if (!project || !ctx) return null

  const audioPath = project.tracks.mic ?? project.tracks.system_audio
  const audioType = project.tracks.mic ? "mic" : "system"

  return (
    <div className="space-y-1.5 select-none">
      <div ref={containerRef} className="relative">
        {/* Time ruler + Playhead pin */}
        <TimeRuler ctx={ctx} />
        <PlayheadPin ctx={ctx} />

        {/* Tracks */}
        <div className="space-y-1 mt-1">
          <ClipTrack ctx={ctx} />
          <ZoomTrack ctx={ctx} />
          {audioPath && <AudioTrack ctx={ctx} audioPath={audioPath} type={audioType} />}
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Update editor-app import**

In `src/editor-app.tsx` line 13, the import already points to `@/components/editor/timeline` — since we're creating `timeline/index.tsx`, the import path `@/components/editor/timeline` will resolve to the new `index.tsx` automatically. Delete the old `src/components/editor/timeline.tsx` file.

**Step 3: Update tests**

Replace `src/__tests__/timeline.test.tsx`:

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

// Mock AudioContext for AudioTrack
global.AudioContext = vi.fn().mockImplementation(() => ({
  decodeAudioData: vi.fn().mockResolvedValue({
    numberOfChannels: 1,
    length: 1000,
    sampleRate: 44100,
    getChannelData: () => new Float32Array(1000),
  }),
})) as any

global.fetch = vi.fn().mockResolvedValue({
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
}) as any

const MOCK_PROJECT: EditorProject = {
  id: "t", name: "T", created_at: 0,
  tracks: { screen: "/s.mov", mic: "/m.wav", system_audio: null, camera: "/c.mov", mouse_events: null },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: true, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: false, shadowIntensity: 0 },
    cursor: { enabled: false, type: "highlight", size: 40, color: "#ffcc00", opacity: 0.6 },
    zoomKeyframes: [],
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

  it("renders clip track with duration label", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("Clip")).toBeTruthy()
  })

  it("renders time ruler", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("0:00")).toBeTruthy()
  })

  it("renders empty zoom track with hint text", () => {
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("Click or drag to add zoom on cursor")).toBeTruthy()
  })

  it("renders zoom segments when keyframes exist", () => {
    useEditorStore.getState().addZoomKeyframe({
      timeMs: 1000, x: 0.5, y: 0.5, scale: 2.0, easing: "ease-in-out", durationMs: 500,
    })
    render(<Timeline videoSync={mockVideoSync} />)
    expect(screen.getByText("2.0x")).toBeTruthy()
  })
})
```

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 5: Delete old file and commit**

```bash
rm src/components/editor/timeline.tsx
git add -A src/components/editor/timeline/ src/components/editor/timeline.tsx src/__tests__/timeline.test.tsx src/editor-app.tsx
git commit -m "feat: assemble new multi-track timeline, replace monolithic component"
```

---

## Task 11: Update Zoom Panel to Sync with Timeline Selection

When a zoom segment is selected on the timeline, highlight it in the inspector panel. Keep the panel functional as a secondary way to manage zoom.

**Files:**
- Modify: `src/components/editor/inspector/zoom-panel.tsx`

**Step 1: Update ZoomPanel to read selection state**

Modify `src/components/editor/inspector/zoom-panel.tsx` to:
- Read `selectedZoomIndex` from store
- Highlight the selected keyframe in the list
- Scrolling to the selected item
- Update default duration when adding via "+" button to 500ms (matching new segment model)

Replace the `handleAddKeyframe` function to use 500ms duration:

```ts
const handleAddKeyframe = () => {
  addZoomKeyframe({
    timeMs: Math.round(currentTime),
    x: 0.5,
    y: 0.5,
    scale: 1.5,
    easing: "ease-in-out",
    durationMs: 500,
  })
}
```

In the keyframe list rendering, add selection highlight:

```tsx
const selectedZoomIndex = useEditorStore((s) => s.selectedZoomIndex)
const setSelectedZoomIndex = useEditorStore((s) => s.setSelectedZoomIndex)

// In the map:
<div
  key={kf.timeMs}
  className={`flex items-center justify-between text-xs rounded px-2 py-1 cursor-pointer ${
    selectedZoomIndex === i ? "bg-primary/20 ring-1 ring-primary" : "bg-muted/50 hover:bg-muted"
  }`}
  onClick={() => setSelectedZoomIndex(i)}
>
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/components/editor/inspector/zoom-panel.tsx
git commit -m "feat: sync zoom panel with timeline segment selection"
```

---

## Task 12: Visual Polish and Final Integration Testing

Fine-tune spacing, colors, and test the full flow end-to-end.

**Files:**
- Modify: `src/editor-app.tsx:128` (adjust timeline container height)
- Various minor tweaks to timeline components

**Step 1: Adjust timeline container**

In `src/editor-app.tsx`, update the timeline container div (line 128) to give more room:

```tsx
<div className="border-t shrink-0 px-4 py-3">
  <Timeline videoSync={videoSync} />
</div>
```

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 3: Manual smoke test**

Run: `npx tauri dev`
Verify:
- [ ] Time ruler shows with dot markers between time labels
- [ ] Playhead pin is draggable and line extends through all tracks
- [ ] Clip track shows gold bar with "Clip" label and duration
- [ ] Trim handles work with live scrub preview
- [ ] Empty zoom track shows hint text
- [ ] Click on zoom track creates a segment
- [ ] Drag on zoom track creates a segment spanning the range
- [ ] Zoom segments are draggable (move) and resizable (edges)
- [ ] Click a segment opens inline popover with scale/easing/delete
- [ ] Audio waveform renders (if mic/system audio present)
- [ ] Undo/redo works for all zoom operations
- [ ] Preview canvas shows correct zoom behavior (ramp in/hold/ramp out)

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: timeline redesign - visual polish and integration"
```
