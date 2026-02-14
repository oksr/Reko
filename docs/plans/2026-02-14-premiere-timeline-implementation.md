# Premiere-Style Timeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the fixed three-track timeline into a Premiere Pro-inspired NLE with razor cuts, clip rearranging, transitions, and overlay tracks.

**Architecture:** Replace the current `{ in_point, out_point }` trim model with a Sequence of Clips. Zoom keyframes become clip-owned (relative times). New SequenceTrack replaces ClipTrack+ZoomTrack. Overlay tracks stack above. Metal compositor handles multi-layer export.

**Tech Stack:** React + TypeScript (frontend), Zustand (state), Tauri v2 + Rust (backend), Swift/Metal (export)

---

## Phase 1: Core Data Model & Store Migration

### Task 1: Define Sequence Types

**Files:**
- Modify: `src/types/editor.ts`
- Create: `src/lib/sequence.ts`
- Create: `src/__tests__/sequence.test.ts`

**Step 1: Write failing test for sequence types and helpers**

Create `src/__tests__/sequence.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createClip,
  getSequenceDuration,
  sequenceTimeToSourceTime,
  sourceTimeToSequenceTime,
} from "@/lib/sequence";
import type { Clip, Transition } from "@/types/editor";

describe("sequence helpers", () => {
  const clips: Clip[] = [
    { id: "a", sourceStart: 0, sourceEnd: 3000, speed: 1, zoomKeyframes: [] },
    { id: "b", sourceStart: 5000, sourceEnd: 8000, speed: 1, zoomKeyframes: [] },
    { id: "c", sourceStart: 10000, sourceEnd: 12000, speed: 1, zoomKeyframes: [] },
  ];
  const transitions: (Transition | null)[] = [null, null]; // cuts between clips

  it("calculates total sequence duration", () => {
    // 3000 + 3000 + 2000 = 8000
    expect(getSequenceDuration(clips, transitions)).toBe(8000);
  });

  it("maps sequence time to source time for first clip", () => {
    const result = sequenceTimeToSourceTime(1500, clips, transitions);
    expect(result).toEqual({ clipIndex: 0, clipId: "a", sourceTime: 1500 });
  });

  it("maps sequence time to source time for second clip", () => {
    const result = sequenceTimeToSourceTime(4000, clips, transitions);
    expect(result).toEqual({ clipIndex: 1, clipId: "b", sourceTime: 6000 });
  });

  it("maps sequence time to source time for third clip", () => {
    const result = sequenceTimeToSourceTime(7000, clips, transitions);
    expect(result).toEqual({ clipIndex: 2, clipId: "c", sourceTime: 11000 });
  });

  it("accounts for crossfade transition overlap", () => {
    const xfadeTransitions: (Transition | null)[] = [
      { type: "crossfade", durationMs: 200 },
      null,
    ];
    // total: 3000 + 3000 + 2000 - 200 = 7800
    expect(getSequenceDuration(clips, xfadeTransitions)).toBe(7800);
  });

  it("creates a clip with generated id", () => {
    const clip = createClip(1000, 5000);
    expect(clip.id).toBeTruthy();
    expect(clip.sourceStart).toBe(1000);
    expect(clip.sourceEnd).toBe(5000);
    expect(clip.speed).toBe(1);
    expect(clip.zoomKeyframes).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/sequence.test.ts`
Expected: FAIL — modules don't exist

**Step 3: Add types to `src/types/editor.ts`**

Add after the existing `ZoomKeyframe` interface (after line 86):

```typescript
export interface Clip {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  speed: number;
  zoomKeyframes: ZoomKeyframe[];
}

export interface Transition {
  type: "cut" | "crossfade" | "dissolve" | "fade-through-black";
  durationMs: number;
}

export interface OverlayTrack {
  id: string;
  type: "webcam" | "text" | "image";
  locked: boolean;
  visible: boolean;
}

export interface Overlay {
  id: string;
  trackId: string;
  type: "webcam" | "text" | "image";
  startMs: number;
  durationMs: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  opacity: number;
  linkedClipId?: string;
}

export interface Sequence {
  clips: Clip[];
  transitions: (Transition | null)[]; // length = clips.length - 1
  overlayTracks: OverlayTrack[];
  overlays: Overlay[];
}
```

**Step 4: Implement sequence helpers in `src/lib/sequence.ts`**

```typescript
import type { Clip, Transition } from "@/types/editor";
import { nanoid } from "nanoid";

export function createClip(
  sourceStart: number,
  sourceEnd: number,
  zoomKeyframes: Clip["zoomKeyframes"] = []
): Clip {
  return { id: nanoid(), sourceStart, sourceEnd, speed: 1, zoomKeyframes };
}

/** Total duration of the sequence accounting for transition overlaps */
export function getSequenceDuration(
  clips: Clip[],
  transitions: (Transition | null)[]
): number {
  let total = 0;
  for (const clip of clips) {
    total += (clip.sourceEnd - clip.sourceStart) / clip.speed;
  }
  for (const t of transitions) {
    if (t && t.type !== "cut") {
      total -= t.durationMs;
    }
  }
  return total;
}

export interface SourceTimeResult {
  clipIndex: number;
  clipId: string;
  sourceTime: number;
}

/** Convert sequence playback time to a source time within a specific clip */
export function sequenceTimeToSourceTime(
  seqTime: number,
  clips: Clip[],
  transitions: (Transition | null)[]
): SourceTimeResult | null {
  let elapsed = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const clipDuration = (clip.sourceEnd - clip.sourceStart) / clip.speed;
    const overlapBefore =
      i > 0 && transitions[i - 1] && transitions[i - 1]!.type !== "cut"
        ? transitions[i - 1]!.durationMs
        : 0;
    const clipStart = elapsed - overlapBefore;

    if (seqTime < elapsed + clipDuration - overlapBefore) {
      const timeInClip = seqTime - clipStart;
      return {
        clipIndex: i,
        clipId: clip.id,
        sourceTime: clip.sourceStart + timeInClip * clip.speed,
      };
    }

    elapsed += clipDuration;
    // Subtract overlap with the next transition
    if (i < transitions.length && transitions[i] && transitions[i]!.type !== "cut") {
      elapsed -= transitions[i]!.durationMs;
    }
  }

  return null;
}

/** Convert source time back to sequence time for a given clip */
export function sourceTimeToSequenceTime(
  sourceTime: number,
  clipIndex: number,
  clips: Clip[],
  transitions: (Transition | null)[]
): number {
  let elapsed = 0;
  for (let i = 0; i < clipIndex; i++) {
    const clip = clips[i];
    elapsed += (clip.sourceEnd - clip.sourceStart) / clip.speed;
    if (i < transitions.length && transitions[i] && transitions[i]!.type !== "cut") {
      elapsed -= transitions[i]!.durationMs;
    }
  }
  const clip = clips[clipIndex];
  elapsed += (sourceTime - clip.sourceStart) / clip.speed;
  return elapsed;
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/sequence.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types/editor.ts src/lib/sequence.ts src/__tests__/sequence.test.ts
git commit -m "feat: add Sequence/Clip/Transition types and sequence helpers"
```

---

### Task 2: Split Clip Helper

**Files:**
- Modify: `src/lib/sequence.ts`
- Modify: `src/__tests__/sequence.test.ts`

**Step 1: Write failing test for splitClip**

Append to `src/__tests__/sequence.test.ts`:

```typescript
import { splitClip } from "@/lib/sequence";
import type { ZoomKeyframe } from "@/types/editor";

describe("splitClip", () => {
  it("splits a clip at a given source time", () => {
    const clip: Clip = {
      id: "a",
      sourceStart: 0,
      sourceEnd: 6000,
      speed: 1,
      zoomKeyframes: [],
    };
    const [left, right] = splitClip(clip, 3000);
    expect(left.sourceStart).toBe(0);
    expect(left.sourceEnd).toBe(3000);
    expect(right.sourceStart).toBe(3000);
    expect(right.sourceEnd).toBe(6000);
    expect(left.id).not.toBe(right.id);
  });

  it("distributes zoom keyframes to correct clip", () => {
    const kf1: ZoomKeyframe = {
      timeMs: 500, durationMs: 300, x: 0.5, y: 0.5, scale: 2, easing: "ease-in-out",
    };
    const kf2: ZoomKeyframe = {
      timeMs: 3500, durationMs: 300, x: 0.3, y: 0.7, scale: 1.5, easing: "linear",
    };
    const clip: Clip = {
      id: "a",
      sourceStart: 0,
      sourceEnd: 6000,
      speed: 1,
      zoomKeyframes: [kf1, kf2],
    };
    const [left, right] = splitClip(clip, 3000);
    expect(left.zoomKeyframes).toEqual([kf1]);
    // kf2 should have timeMs adjusted relative to right clip start
    expect(right.zoomKeyframes).toEqual([
      { ...kf2, timeMs: 500 }, // 3500 - 3000
    ]);
  });

  it("throws if split point is outside clip range", () => {
    const clip: Clip = {
      id: "a", sourceStart: 1000, sourceEnd: 5000, speed: 1, zoomKeyframes: [],
    };
    expect(() => splitClip(clip, 500)).toThrow();
    expect(() => splitClip(clip, 6000)).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/sequence.test.ts`
Expected: FAIL — `splitClip` not exported

**Step 3: Implement splitClip in `src/lib/sequence.ts`**

```typescript
/** Split a clip at a source time, distributing zoom keyframes */
export function splitClip(clip: Clip, sourceTime: number): [Clip, Clip] {
  if (sourceTime <= clip.sourceStart || sourceTime >= clip.sourceEnd) {
    throw new Error(
      `Split point ${sourceTime} is outside clip range [${clip.sourceStart}, ${clip.sourceEnd}]`
    );
  }
  const splitRelative = sourceTime - clip.sourceStart;

  const leftKeyframes = clip.zoomKeyframes.filter(
    (kf) => kf.timeMs + kf.durationMs <= splitRelative
  );
  const rightKeyframes = clip.zoomKeyframes
    .filter((kf) => kf.timeMs >= splitRelative)
    .map((kf) => ({ ...kf, timeMs: kf.timeMs - splitRelative }));

  const left: Clip = {
    id: nanoid(),
    sourceStart: clip.sourceStart,
    sourceEnd: sourceTime,
    speed: clip.speed,
    zoomKeyframes: leftKeyframes,
  };
  const right: Clip = {
    id: nanoid(),
    sourceStart: sourceTime,
    sourceEnd: clip.sourceEnd,
    speed: clip.speed,
    zoomKeyframes: rightKeyframes,
  };

  return [left, right];
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/sequence.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/sequence.ts src/__tests__/sequence.test.ts
git commit -m "feat: add splitClip helper with zoom keyframe distribution"
```

---

### Task 3: Migrate Editor Store to Sequence Model

**Files:**
- Modify: `src/stores/editor-store.ts`
- Modify: `src/__tests__/editor-store.test.ts`
- Modify: `src/types/editor.ts`

This is the core migration. The store needs to hold a `Sequence` instead of `{ in_point, out_point }` + top-level `zoomKeyframes`.

**Step 1: Write failing tests for new store actions**

Append to `src/__tests__/editor-store.test.ts`:

```typescript
describe("sequence actions", () => {
  beforeEach(() => {
    const store = useEditorStore.getState();
    // Load a project — the store should auto-migrate to sequence model
    store.loadProject(mockProject);
  });

  it("auto-migrates project to sequence with one clip", () => {
    const { project } = useEditorStore.getState();
    expect(project!.sequence.clips).toHaveLength(1);
    expect(project!.sequence.clips[0].sourceStart).toBe(0);
    expect(project!.sequence.clips[0].sourceEnd).toBe(mockProject.timeline.duration_ms);
  });

  it("splits a clip at playhead", () => {
    const store = useEditorStore.getState();
    store.setCurrentTime(2000);
    store.splitAtPlayhead();
    const { project } = useEditorStore.getState();
    expect(project!.sequence.clips).toHaveLength(2);
    expect(project!.sequence.clips[0].sourceEnd).toBe(2000);
    expect(project!.sequence.clips[1].sourceStart).toBe(2000);
    expect(project!.sequence.transitions).toHaveLength(1);
    expect(project!.sequence.transitions[0]).toBeNull(); // cut
  });

  it("removes a clip with ripple delete", () => {
    const store = useEditorStore.getState();
    store.setCurrentTime(2000);
    store.splitAtPlayhead();
    store.setSelectedClipIndex(1);
    store.rippleDelete();
    const { project } = useEditorStore.getState();
    expect(project!.sequence.clips).toHaveLength(1);
    expect(project!.sequence.clips[0].sourceEnd).toBe(2000);
  });

  it("reorders clips via moveClip", () => {
    const store = useEditorStore.getState();
    // Split into 3 clips
    store.setCurrentTime(2000);
    store.splitAtPlayhead();
    store.setCurrentTime(3000); // 1000 into second clip -> source 3000
    store.splitAtPlayhead();

    const clipsBefore = useEditorStore.getState().project!.sequence.clips;
    expect(clipsBefore).toHaveLength(3);

    store.moveClip(2, 0); // move last clip to first position
    const clipsAfter = useEditorStore.getState().project!.sequence.clips;
    expect(clipsAfter[0].id).toBe(clipsBefore[2].id);
    expect(clipsAfter[1].id).toBe(clipsBefore[0].id);
    expect(clipsAfter[2].id).toBe(clipsBefore[1].id);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/editor-store.test.ts`
Expected: FAIL — `sequence`, `splitAtPlayhead`, etc. don't exist

**Step 3: Add `sequence` to EditorProject type**

In `src/types/editor.ts`, modify the `EditorProject` interface to add:

```typescript
// Add to EditorProject interface:
  sequence: Sequence;
```

**Step 4: Add new state and actions to store**

In `src/stores/editor-store.ts`, add to the `EditorState` interface:

```typescript
  // Selection state
  selectedClipIndex: number | null;
  activeTool: "select" | "razor" | "zoom";

  // Sequence actions
  splitAtPlayhead: () => void;
  rippleDelete: () => void;
  liftDelete: () => void;
  moveClip: (fromIndex: number, toIndex: number) => void;
  trimClipStart: (clipIndex: number, newSourceStart: number) => void;
  trimClipEnd: (clipIndex: number, newSourceEnd: number) => void;
  setSelectedClipIndex: (index: number | null) => void;
  setActiveTool: (tool: "select" | "razor" | "zoom") => void;
  addTransition: (index: number, transition: Transition) => void;
  removeTransition: (index: number) => void;
```

Add the `migrateToSequence` helper that runs on project load:

```typescript
function migrateToSequence(project: EditorProject): EditorProject {
  if (project.sequence) return project;
  const clip = createClip(
    project.timeline.in_point ?? 0,
    project.timeline.out_point ?? project.timeline.duration_ms,
    project.effects.zoomKeyframes ?? []
  );
  return {
    ...project,
    sequence: {
      clips: [clip],
      transitions: [],
      overlayTracks: [],
      overlays: [],
    },
  };
}
```

Implement each action in the store `set()` calls. Key implementations:

- `splitAtPlayhead`: uses `sequenceTimeToSourceTime` to find clip, then `splitClip`, then splices into `sequence.clips` and adds `null` transition
- `rippleDelete`: removes clip at `selectedClipIndex`, removes adjacent transition, shifts overlays
- `moveClip`: array splice reorder on `sequence.clips`, reorder transitions accordingly
- `trimClipStart/End`: update clip bounds with min-length guard

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/editor-store.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/stores/editor-store.ts src/types/editor.ts src/__tests__/editor-store.test.ts
git commit -m "feat: migrate editor store from trim model to sequence model"
```

---

### Task 4: Update Zoom Interpolation for Clip-Relative Times

**Files:**
- Modify: `src/lib/zoom-interpolation.ts`
- Modify: `src/__tests__/zoom-interpolation.test.ts`

The existing `interpolateZoom` takes absolute `timeMs`. Now it needs a wrapper that resolves sequence time → clip → clip-relative keyframes.

**Step 1: Write failing test**

Add to `src/__tests__/zoom-interpolation.test.ts`:

```typescript
import { interpolateZoomAtSequenceTime } from "@/lib/zoom-interpolation";
import type { Clip, Transition } from "@/types/editor";

describe("interpolateZoomAtSequenceTime", () => {
  const clips: Clip[] = [
    {
      id: "a", sourceStart: 0, sourceEnd: 3000, speed: 1,
      zoomKeyframes: [
        { timeMs: 500, durationMs: 500, x: 0.3, y: 0.3, scale: 2, easing: "ease-in-out" },
      ],
    },
    {
      id: "b", sourceStart: 5000, sourceEnd: 8000, speed: 1,
      zoomKeyframes: [
        { timeMs: 1000, durationMs: 500, x: 0.7, y: 0.7, scale: 1.5, easing: "linear" },
      ],
    },
  ];
  const transitions: (Transition | null)[] = [null];

  it("resolves zoom from first clip", () => {
    // seqTime 750 is in hold phase of first clip's keyframe (500 + 200 ramp = 700)
    const result = interpolateZoomAtSequenceTime(750, clips, transitions);
    expect(result.scale).toBe(2);
    expect(result.x).toBe(0.3);
  });

  it("resolves zoom from second clip", () => {
    // seqTime 4200 = 1200 into second clip, in hold phase of its keyframe (1000 + 200 = 1200)
    const result = interpolateZoomAtSequenceTime(4200, clips, transitions);
    expect(result.scale).toBe(1.5);
  });

  it("returns default for time between keyframes", () => {
    const result = interpolateZoomAtSequenceTime(2500, clips, transitions);
    expect(result.scale).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/zoom-interpolation.test.ts`
Expected: FAIL

**Step 3: Implement wrapper**

In `src/lib/zoom-interpolation.ts`, add:

```typescript
import { sequenceTimeToSourceTime } from "@/lib/sequence";
import type { Clip, Transition } from "@/types/editor";

export function interpolateZoomAtSequenceTime(
  seqTime: number,
  clips: Clip[],
  transitions: (Transition | null)[]
): { x: number; y: number; scale: number } {
  const mapping = sequenceTimeToSourceTime(seqTime, clips, transitions);
  if (!mapping) return { x: 0.5, y: 0.5, scale: 1 };

  const clip = clips[mapping.clipIndex];
  const clipRelativeTime = mapping.sourceTime - clip.sourceStart;
  return interpolateZoom(clip.zoomKeyframes, clipRelativeTime);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/zoom-interpolation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/zoom-interpolation.ts src/__tests__/zoom-interpolation.test.ts
git commit -m "feat: add sequence-aware zoom interpolation wrapper"
```

---

## Phase 2: Sequence Track UI

### Task 5: SequenceTrack Component (Replaces ClipTrack + ZoomTrack)

**Files:**
- Create: `src/components/editor/timeline/sequence-track.tsx`
- Modify: `src/components/editor/timeline/index.tsx`
- Create: `src/components/editor/timeline/clip-block.tsx`
- Modify: `src/__tests__/timeline.test.tsx`

**Step 1: Write failing test**

Add to `src/__tests__/timeline.test.tsx`:

```typescript
it("renders sequence track with multiple clips", () => {
  // Set up store with a sequence that has 2 clips
  const store = useEditorStore.getState();
  store.loadProject(mockProject);
  store.setCurrentTime(2000);
  store.splitAtPlayhead();

  const { getByTestId, getAllByTestId } = render(
    <Timeline videoSync={mockVideoSync as any} />
  );
  expect(getByTestId("sequence-track")).toBeTruthy();
  expect(getAllByTestId("clip-block")).toHaveLength(2);
});

it("shows zoom badges on clips", () => {
  const store = useEditorStore.getState();
  store.loadProject({
    ...mockProject,
    effects: {
      ...mockProject.effects,
      zoomKeyframes: [
        { timeMs: 500, durationMs: 300, x: 0.5, y: 0.5, scale: 2, easing: "ease-in-out" },
      ],
    },
  });

  const { getAllByTestId } = render(
    <Timeline videoSync={mockVideoSync as any} />
  );
  expect(getAllByTestId("zoom-badge").length).toBeGreaterThanOrEqual(1);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: FAIL

**Step 3: Build ClipBlock component**

Create `src/components/editor/timeline/clip-block.tsx`:

```typescript
import { useEditorStore } from "@/stores/editor-store";
import type { Clip } from "@/types/editor";
import type { TimelineContext } from "./types";

interface ClipBlockProps {
  clip: Clip;
  index: number;
  ctx: TimelineContext;
}

export function ClipBlock({ clip, index, ctx }: ClipBlockProps) {
  const selectedClipIndex = useEditorStore((s) => s.selectedClipIndex);
  const setSelectedClipIndex = useEditorStore((s) => s.setSelectedClipIndex);
  const isSelected = selectedClipIndex === index;
  const clipDuration = (clip.sourceEnd - clip.sourceStart) / clip.speed;
  const widthPercent = ctx.msToPercent(clipDuration);

  const formatDuration = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${s}s`;
  };

  return (
    <div
      data-testid="clip-block"
      className={`relative h-full rounded-md cursor-pointer transition-colors ${
        isSelected
          ? "bg-amber-500/40 ring-2 ring-amber-400"
          : "bg-amber-500/25 hover:bg-amber-500/30"
      }`}
      style={{ width: `${widthPercent}%`, minWidth: "2px" }}
      onClick={() => setSelectedClipIndex(index)}
    >
      {/* Clip label */}
      <div className="absolute inset-0 flex items-center px-2 text-xs text-amber-200/80 truncate">
        <span className="font-medium">
          {formatDuration(clipDuration)}
          {clip.speed !== 1 && ` · ${clip.speed}x`}
        </span>
      </div>

      {/* Zoom badges */}
      {clip.zoomKeyframes.map((kf, ki) => {
        const leftPercent = (kf.timeMs / clipDuration) * 100;
        const widthPercent = (kf.durationMs / clipDuration) * 100;
        return (
          <div
            key={ki}
            data-testid="zoom-badge"
            className="absolute bottom-0.5 h-1.5 rounded-full bg-purple-500/60"
            style={{ left: `${leftPercent}%`, width: `${Math.max(widthPercent, 1)}%` }}
          />
        );
      })}

      {/* Trim handles (visible when selected) */}
      {isSelected && (
        <>
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400 cursor-col-resize rounded-l-md" />
          <div className="absolute right-0 top-0 bottom-0 w-1 bg-amber-400 cursor-col-resize rounded-r-md" />
        </>
      )}
    </div>
  );
}
```

**Step 4: Build SequenceTrack component**

Create `src/components/editor/timeline/sequence-track.tsx`:

```typescript
import { useEditorStore } from "@/stores/editor-store";
import { ClipBlock } from "./clip-block";
import type { TimelineContext } from "./types";

interface SequenceTrackProps {
  ctx: TimelineContext;
}

export function SequenceTrack({ ctx }: SequenceTrackProps) {
  const sequence = useEditorStore((s) => s.project?.sequence);
  const activeTool = useEditorStore((s) => s.activeTool);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);

  if (!sequence) return null;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== "razor") return;
    // Razor tool: split at click position
    // For now, use Cmd+K / splitAtPlayhead for razor functionality
    splitAtPlayhead();
  };

  return (
    <div
      data-testid="sequence-track"
      className="relative flex items-stretch h-12 gap-px"
      onClick={handleTrackClick}
    >
      {/* Track label */}
      <div className="flex-shrink-0 w-8 flex items-center justify-center text-xs text-zinc-500 font-medium">
        S1
      </div>

      {/* Clips */}
      <div className="flex-1 flex items-stretch gap-px">
        {sequence.clips.map((clip, i) => (
          <ClipBlock key={clip.id} clip={clip} index={i} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}
```

**Step 5: Wire SequenceTrack into Timeline index**

In `src/components/editor/timeline/index.tsx`, replace the `<ClipTrack>` and `<ZoomTrack>` with `<SequenceTrack>`:

```typescript
import { SequenceTrack } from "./sequence-track";

// In the render, replace:
//   <ClipTrack ctx={ctx} />
//   <ZoomTrack ctx={ctx} />
// With:
//   <SequenceTrack ctx={ctx} />
```

Keep `<AudioTrack>` below it.

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: PASS

**Step 7: Commit**

```bash
git add src/components/editor/timeline/sequence-track.tsx src/components/editor/timeline/clip-block.tsx src/components/editor/timeline/index.tsx src/__tests__/timeline.test.tsx
git commit -m "feat: add SequenceTrack and ClipBlock, replace ClipTrack+ZoomTrack"
```

---

### Task 6: Track Labels & Toolbar

**Files:**
- Create: `src/components/editor/timeline/track-label.tsx`
- Create: `src/components/editor/timeline/timeline-toolbar.tsx`
- Modify: `src/components/editor/timeline/index.tsx`

**Step 1: Write failing test**

Add to `src/__tests__/timeline.test.tsx`:

```typescript
it("renders timeline toolbar with tool buttons", () => {
  const { getByTestId } = render(
    <Timeline videoSync={mockVideoSync as any} />
  );
  expect(getByTestId("tool-select")).toBeTruthy();
  expect(getByTestId("tool-razor")).toBeTruthy();
  expect(getByTestId("tool-zoom")).toBeTruthy();
});

it("switches active tool on click", async () => {
  const { getByTestId } = render(
    <Timeline videoSync={mockVideoSync as any} />
  );
  const razorBtn = getByTestId("tool-razor");
  await userEvent.click(razorBtn);
  expect(useEditorStore.getState().activeTool).toBe("razor");
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: FAIL

**Step 3: Build TrackLabel**

Create `src/components/editor/timeline/track-label.tsx`:

```typescript
interface TrackLabelProps {
  label: string;
  locked?: boolean;
  visible?: boolean;
  onToggleLock?: () => void;
  onToggleVisible?: () => void;
}

export function TrackLabel({ label }: TrackLabelProps) {
  return (
    <div className="flex-shrink-0 w-10 flex items-center justify-center text-xs text-zinc-500 font-medium border-r border-zinc-800">
      {label}
    </div>
  );
}
```

**Step 4: Build TimelineToolbar**

Create `src/components/editor/timeline/timeline-toolbar.tsx`:

```typescript
import { useEditorStore } from "@/stores/editor-store";
import { MousePointer2, Scissors, ZoomIn } from "lucide-react";

export function TimelineToolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  const tools = [
    { id: "select" as const, icon: MousePointer2, shortcut: "V", testId: "tool-select" },
    { id: "razor" as const, icon: Scissors, shortcut: "C", testId: "tool-razor" },
    { id: "zoom" as const, icon: ZoomIn, shortcut: "Z", testId: "tool-zoom" },
  ];

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800">
      {tools.map(({ id, icon: Icon, shortcut, testId }) => (
        <button
          key={id}
          data-testid={testId}
          onClick={() => setActiveTool(id)}
          className={`p-1.5 rounded text-xs ${
            activeTool === id
              ? "bg-zinc-700 text-white"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800"
          }`}
          title={`${id} (${shortcut})`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
```

**Step 5: Wire into Timeline index**

Add `<TimelineToolbar />` at the top of the Timeline render.

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: PASS

**Step 7: Commit**

```bash
git add src/components/editor/timeline/track-label.tsx src/components/editor/timeline/timeline-toolbar.tsx src/components/editor/timeline/index.tsx src/__tests__/timeline.test.tsx
git commit -m "feat: add timeline toolbar with select/razor/zoom tools"
```

---

### Task 7: Keyboard Shortcuts for Sequence Editing

**Files:**
- Modify: `src/hooks/use-keyboard-shortcuts.ts`
- Create: `src/__tests__/keyboard-shortcuts.test.ts`

**Step 1: Write failing test**

Create `src/__tests__/keyboard-shortcuts.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEditorStore } from "@/stores/editor-store";

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject(mockProject);
    useEditorStore.getState().setCurrentTime(2000);
  });

  it("Cmd+K splits at playhead", () => {
    const splitSpy = vi.spyOn(useEditorStore.getState(), "splitAtPlayhead");
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true });
    document.dispatchEvent(event);
    expect(splitSpy).toHaveBeenCalled();
  });

  it("V switches to select tool", () => {
    const event = new KeyboardEvent("keydown", { key: "v" });
    document.dispatchEvent(event);
    expect(useEditorStore.getState().activeTool).toBe("select");
  });

  it("C switches to razor tool", () => {
    const event = new KeyboardEvent("keydown", { key: "c" });
    document.dispatchEvent(event);
    expect(useEditorStore.getState().activeTool).toBe("razor");
  });

  it("Delete ripple-deletes selected clip", () => {
    useEditorStore.getState().splitAtPlayhead();
    useEditorStore.getState().setSelectedClipIndex(1);
    const event = new KeyboardEvent("keydown", { key: "Delete" });
    document.dispatchEvent(event);
    expect(useEditorStore.getState().project!.sequence.clips).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/keyboard-shortcuts.test.ts`
Expected: FAIL

**Step 3: Add new shortcuts to `src/hooks/use-keyboard-shortcuts.ts`**

Add handlers for:
- `Cmd+K` → `splitAtPlayhead()`
- `V` (no modifier, not in text input) → `setActiveTool("select")`
- `C` (no modifier) → `setActiveTool("razor")`
- `Z` (no modifier) → `setActiveTool("zoom")`
- `Delete` → `rippleDelete()`
- `Shift+Delete` → `liftDelete()`
- `Cmd+D` → `addTransition(selectedClipIndex, { type: "crossfade", durationMs: 200 })`
- `J/K/L` → reverse/pause/forward playback

Guard all single-key shortcuts: skip if `e.target` is an input/textarea.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/keyboard-shortcuts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/use-keyboard-shortcuts.ts src/__tests__/keyboard-shortcuts.test.ts
git commit -m "feat: add Premiere-style keyboard shortcuts for sequence editing"
```

---

### Task 8: Clip Drag-and-Drop Reordering

**Files:**
- Modify: `src/components/editor/timeline/sequence-track.tsx`
- Modify: `src/components/editor/timeline/clip-block.tsx`

**Step 1: Write failing test**

Add to `src/__tests__/timeline.test.tsx`:

```typescript
it("reorders clips via drag and drop", async () => {
  const store = useEditorStore.getState();
  store.loadProject(mockProject);
  store.setCurrentTime(2000);
  store.splitAtPlayhead();

  const clipsBefore = useEditorStore.getState().project!.sequence.clips;

  const { getAllByTestId } = render(
    <Timeline videoSync={mockVideoSync as any} />
  );
  const blocks = getAllByTestId("clip-block");
  expect(blocks).toHaveLength(2);

  // Simulate drag: move second clip to first position
  store.moveClip(1, 0);
  const clipsAfter = useEditorStore.getState().project!.sequence.clips;
  expect(clipsAfter[0].id).toBe(clipsBefore[1].id);
});
```

**Step 2: Run test to verify it fails (or passes if moveClip already works)**

Run: `npx vitest run src/__tests__/timeline.test.tsx`

**Step 3: Add drag-and-drop to ClipBlock**

Use HTML5 drag events on `ClipBlock`:

```typescript
// In clip-block.tsx, add to the root div:
draggable
onDragStart={(e) => {
  e.dataTransfer.setData("clip-index", String(index));
  e.dataTransfer.effectAllowed = "move";
}}
```

In `SequenceTrack`, add drop handling:

```typescript
onDragOver={(e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  // Show drop indicator based on mouse position
}}
onDrop={(e) => {
  e.preventDefault();
  const fromIndex = parseInt(e.dataTransfer.getData("clip-index"), 10);
  // Calculate toIndex based on drop position
  const toIndex = calculateDropIndex(e);
  if (fromIndex !== toIndex) {
    moveClip(fromIndex, toIndex);
  }
}}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/editor/timeline/clip-block.tsx src/components/editor/timeline/sequence-track.tsx src/__tests__/timeline.test.tsx
git commit -m "feat: add clip drag-and-drop reordering"
```

---

### Task 9: Clip Trimming via Drag Handles

**Files:**
- Modify: `src/components/editor/timeline/clip-block.tsx`

**Step 1: Write failing test**

Add to `src/__tests__/timeline.test.tsx`:

```typescript
it("trims clip end via drag handle", () => {
  const store = useEditorStore.getState();
  store.loadProject(mockProject);
  const clipBefore = store.project!.sequence.clips[0];
  store.trimClipEnd(0, clipBefore.sourceEnd - 1000);
  const clipAfter = useEditorStore.getState().project!.sequence.clips[0];
  expect(clipAfter.sourceEnd).toBe(clipBefore.sourceEnd - 1000);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: FAIL (if trimClipEnd not implemented yet)

**Step 3: Add drag trimming to ClipBlock**

The left and right handles already render when selected. Add `onMouseDown` handlers that:

1. Track initial mouse X and initial clip bounds
2. On `mousemove`, calculate delta in ms using `ctx.containerRef` width
3. Call `trimClipStart` or `trimClipEnd` on the store
4. Enforce minimum clip duration of 500ms
5. On `mouseup`, stop tracking

```typescript
const handleTrimStart = (e: React.MouseEvent) => {
  e.stopPropagation();
  const startX = e.clientX;
  const origSourceStart = clip.sourceStart;
  const containerWidth = ctx.containerRef.current?.clientWidth ?? 1;
  const msPerPx = ctx.durationMs / containerWidth;

  const onMove = (me: MouseEvent) => {
    const deltaPx = me.clientX - startX;
    const deltaMs = deltaPx * msPerPx;
    const newStart = Math.max(0, Math.min(clip.sourceEnd - 500, origSourceStart + deltaMs));
    trimClipStart(index, newStart);
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/editor/timeline/clip-block.tsx src/__tests__/timeline.test.tsx
git commit -m "feat: add clip trim handles with drag interaction"
```

---

## Phase 3: Transitions

### Task 10: Transition UI Between Clips

**Files:**
- Create: `src/components/editor/timeline/transition-block.tsx`
- Modify: `src/components/editor/timeline/sequence-track.tsx`
- Modify: `src/__tests__/timeline.test.tsx`

**Step 1: Write failing test**

```typescript
it("renders transition block between clips", () => {
  const store = useEditorStore.getState();
  store.loadProject(mockProject);
  store.setCurrentTime(2000);
  store.splitAtPlayhead();
  store.addTransition(0, { type: "crossfade", durationMs: 200 });

  const { getByTestId } = render(
    <Timeline videoSync={mockVideoSync as any} />
  );
  expect(getByTestId("transition-block")).toBeTruthy();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: FAIL

**Step 3: Build TransitionBlock component**

Create `src/components/editor/timeline/transition-block.tsx`:

```typescript
import type { Transition } from "@/types/editor";
import type { TimelineContext } from "./types";

interface TransitionBlockProps {
  transition: Transition;
  index: number;
  ctx: TimelineContext;
  onRemove: () => void;
  onDurationChange: (ms: number) => void;
}

export function TransitionBlock({ transition, index, ctx, onRemove }: TransitionBlockProps) {
  if (transition.type === "cut") return null;

  const widthPercent = ctx.msToPercent(transition.durationMs);

  const label = {
    crossfade: "XF",
    dissolve: "DS",
    "fade-through-black": "FB",
    cut: "",
  }[transition.type];

  return (
    <div
      data-testid="transition-block"
      className="relative flex items-center justify-center rounded bg-blue-500/30 border border-blue-500/50 cursor-pointer text-[10px] text-blue-300 font-medium"
      style={{ width: `${Math.max(widthPercent, 0.5)}%`, minWidth: "16px" }}
      title={`${transition.type} (${transition.durationMs}ms)`}
      onDoubleClick={onRemove}
    >
      {label}
    </div>
  );
}
```

**Step 4: Wire TransitionBlock into SequenceTrack**

In the clip rendering loop, between each `ClipBlock`, render a `TransitionBlock` if the transition is not null and not a "cut".

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/editor/timeline/transition-block.tsx src/components/editor/timeline/sequence-track.tsx src/__tests__/timeline.test.tsx
git commit -m "feat: add transition blocks between clips"
```

---

### Task 11: Transition Context Menu

**Files:**
- Create: `src/components/editor/timeline/transition-menu.tsx`
- Modify: `src/components/editor/timeline/sequence-track.tsx`

**Step 1: Write failing test**

```typescript
it("shows transition menu on right-click between clips", async () => {
  const store = useEditorStore.getState();
  store.loadProject(mockProject);
  store.setCurrentTime(2000);
  store.splitAtPlayhead();

  const { getAllByTestId, findByTestId } = render(
    <Timeline videoSync={mockVideoSync as any} />
  );

  // Right-click on the cut point (gap between clips)
  const cutPoint = getAllByTestId("cut-point")[0];
  await userEvent.pointer({ keys: "[MouseRight]", target: cutPoint });

  expect(await findByTestId("transition-menu")).toBeTruthy();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: FAIL

**Step 3: Build TransitionMenu**

A small dropdown with the 4 transition types. Uses shadcn `DropdownMenu` or a simple positioned div.

```typescript
interface TransitionMenuProps {
  position: { x: number; y: number };
  onSelect: (type: Transition["type"]) => void;
  onClose: () => void;
}

export function TransitionMenu({ position, onSelect, onClose }: TransitionMenuProps) {
  const options: { type: Transition["type"]; label: string }[] = [
    { type: "crossfade", label: "Crossfade" },
    { type: "dissolve", label: "Dissolve" },
    { type: "fade-through-black", label: "Fade Through Black" },
    { type: "cut", label: "Cut (No Transition)" },
  ];

  return (
    <div
      data-testid="transition-menu"
      className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-md shadow-lg py-1"
      style={{ left: position.x, top: position.y }}
    >
      {options.map(({ type, label }) => (
        <button
          key={type}
          className="block w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
          onClick={() => { onSelect(type); onClose(); }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

**Step 4: Add cut-point click areas and menu state to SequenceTrack**

Between clips where there's no transition (or a cut), render a thin clickable `cut-point` div. On right-click, show the TransitionMenu.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/editor/timeline/transition-menu.tsx src/components/editor/timeline/sequence-track.tsx src/__tests__/timeline.test.tsx
git commit -m "feat: add right-click transition menu between clips"
```

---

## Phase 4: Overlay Tracks

### Task 12: Overlay Track Data Model & Store Actions

**Files:**
- Modify: `src/stores/editor-store.ts`
- Modify: `src/__tests__/editor-store.test.ts`

**Step 1: Write failing tests**

```typescript
describe("overlay actions", () => {
  beforeEach(() => {
    useEditorStore.getState().loadProject(mockProject);
  });

  it("adds an overlay track", () => {
    const store = useEditorStore.getState();
    store.addOverlayTrack("text");
    const tracks = useEditorStore.getState().project!.sequence.overlayTracks;
    expect(tracks).toHaveLength(1);
    expect(tracks[0].type).toBe("text");
  });

  it("adds an overlay to a track", () => {
    const store = useEditorStore.getState();
    store.addOverlayTrack("text");
    const trackId = useEditorStore.getState().project!.sequence.overlayTracks[0].id;
    store.addOverlay({
      trackId,
      type: "text",
      startMs: 1000,
      durationMs: 2000,
      position: { x: 0.5, y: 0.1 },
      size: { width: 0.3, height: 0.05 },
      opacity: 1,
    });
    const overlays = useEditorStore.getState().project!.sequence.overlays;
    expect(overlays).toHaveLength(1);
    expect(overlays[0].startMs).toBe(1000);
  });

  it("removes an overlay", () => {
    const store = useEditorStore.getState();
    store.addOverlayTrack("text");
    const trackId = useEditorStore.getState().project!.sequence.overlayTracks[0].id;
    store.addOverlay({
      trackId, type: "text", startMs: 1000, durationMs: 2000,
      position: { x: 0.5, y: 0.1 }, size: { width: 0.3, height: 0.05 }, opacity: 1,
    });
    const overlayId = useEditorStore.getState().project!.sequence.overlays[0].id;
    store.removeOverlay(overlayId);
    expect(useEditorStore.getState().project!.sequence.overlays).toHaveLength(0);
  });

  it("enforces max 5 overlay tracks", () => {
    const store = useEditorStore.getState();
    for (let i = 0; i < 5; i++) store.addOverlayTrack("text");
    expect(useEditorStore.getState().project!.sequence.overlayTracks).toHaveLength(5);
    store.addOverlayTrack("image"); // should be ignored
    expect(useEditorStore.getState().project!.sequence.overlayTracks).toHaveLength(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/editor-store.test.ts`
Expected: FAIL

**Step 3: Add overlay actions to store**

Add to the `EditorState` interface and implement:

```typescript
  addOverlayTrack: (type: OverlayTrack["type"]) => void;
  removeOverlayTrack: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  toggleTrackVisible: (trackId: string) => void;
  addOverlay: (overlay: Omit<Overlay, "id">) => void;
  removeOverlay: (overlayId: string) => void;
  updateOverlay: (overlayId: string, updates: Partial<Overlay>) => void;
  moveOverlay: (overlayId: string, startMs: number) => void;
  trimOverlay: (overlayId: string, startMs: number, durationMs: number) => void;
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/editor-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/editor-store.ts src/__tests__/editor-store.test.ts
git commit -m "feat: add overlay track and overlay store actions"
```

---

### Task 13: Overlay Track UI Component

**Files:**
- Create: `src/components/editor/timeline/overlay-track.tsx`
- Create: `src/components/editor/timeline/overlay-block.tsx`
- Modify: `src/components/editor/timeline/index.tsx`
- Modify: `src/__tests__/timeline.test.tsx`

**Step 1: Write failing test**

```typescript
it("renders overlay tracks above sequence track", () => {
  const store = useEditorStore.getState();
  store.loadProject(mockProject);
  store.addOverlayTrack("text");
  const trackId = store.project!.sequence.overlayTracks[0].id;
  store.addOverlay({
    trackId, type: "text", startMs: 500, durationMs: 2000,
    position: { x: 0.5, y: 0.1 }, size: { width: 0.3, height: 0.05 }, opacity: 1,
  });

  const { getByTestId, getAllByTestId } = render(
    <Timeline videoSync={mockVideoSync as any} />
  );
  expect(getByTestId("overlay-track")).toBeTruthy();
  expect(getAllByTestId("overlay-block")).toHaveLength(1);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: FAIL

**Step 3: Build OverlayBlock**

```typescript
import type { Overlay } from "@/types/editor";
import type { TimelineContext } from "./types";

interface OverlayBlockProps {
  overlay: Overlay;
  ctx: TimelineContext;
}

export function OverlayBlock({ overlay, ctx }: OverlayBlockProps) {
  const leftPercent = ctx.msToPercent(overlay.startMs);
  const widthPercent = ctx.msToPercent(overlay.durationMs);

  const colorMap = {
    webcam: "bg-green-500/30 border-green-500/50",
    text: "bg-sky-500/30 border-sky-500/50",
    image: "bg-orange-500/30 border-orange-500/50",
  };

  return (
    <div
      data-testid="overlay-block"
      className={`absolute top-0.5 bottom-0.5 rounded border ${colorMap[overlay.type]} cursor-pointer`}
      style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
    >
      <span className="text-[10px] text-zinc-300 px-1 truncate">
        {overlay.type}
      </span>
    </div>
  );
}
```

**Step 4: Build OverlayTrack**

```typescript
import { useEditorStore } from "@/stores/editor-store";
import { OverlayBlock } from "./overlay-block";
import { TrackLabel } from "./track-label";
import type { OverlayTrack as OverlayTrackType } from "@/types/editor";
import type { TimelineContext } from "./types";

interface OverlayTrackProps {
  track: OverlayTrackType;
  trackIndex: number;
  ctx: TimelineContext;
}

export function OverlayTrack({ track, trackIndex, ctx }: OverlayTrackProps) {
  const overlays = useEditorStore(
    (s) => s.project?.sequence.overlays.filter((o) => o.trackId === track.id) ?? []
  );

  const label = `V${trackIndex + 1}`;

  return (
    <div data-testid="overlay-track" className="relative flex items-stretch h-8">
      <TrackLabel label={label} />
      <div className="flex-1 relative">
        {overlays.map((overlay) => (
          <OverlayBlock key={overlay.id} overlay={overlay} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}
```

**Step 5: Wire into Timeline index**

In `src/components/editor/timeline/index.tsx`, render overlay tracks above the SequenceTrack:

```typescript
{sequence.overlayTracks.map((track, i) => (
  <OverlayTrack key={track.id} track={track} trackIndex={i} ctx={ctx} />
))}
<SequenceTrack ctx={ctx} />
<AudioTrack ... />
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/timeline.test.tsx`
Expected: PASS

**Step 7: Commit**

```bash
git add src/components/editor/timeline/overlay-track.tsx src/components/editor/timeline/overlay-block.tsx src/components/editor/timeline/index.tsx src/__tests__/timeline.test.tsx
git commit -m "feat: add overlay track and overlay block UI components"
```

---

## Phase 5: Preview & Playback Integration

### Task 14: Update Preview Canvas for Sequence Model

**Files:**
- Modify: `src/components/editor/preview-canvas.tsx`
- Modify: `src/hooks/use-video-sync.ts`

**Step 1: Write failing test**

Add to `src/__tests__/preview-canvas.test.tsx` (create if needed):

```typescript
it("applies zoom from correct clip at sequence time", () => {
  const store = useEditorStore.getState();
  store.loadProject(mockProject);
  // The preview canvas should use interpolateZoomAtSequenceTime
  // instead of the old interpolateZoom with absolute time
});
```

**Step 2: Update PreviewCanvas**

In `src/components/editor/preview-canvas.tsx` (around line 43), replace:

```typescript
// Old:
const zoom = interpolateZoom(project.effects.zoomKeyframes, currentTime);

// New:
import { interpolateZoomAtSequenceTime } from "@/lib/zoom-interpolation";
const zoom = interpolateZoomAtSequenceTime(
  currentTime,
  project.sequence.clips,
  project.sequence.transitions
);
```

**Step 3: Update useVideoSync for sequence-aware seeking**

In `src/hooks/use-video-sync.ts`, the `seek` function needs to map sequence time to source time before seeking the `<video>` element:

```typescript
// The video element plays the original source file.
// When seeking, convert sequence time to source time:
import { sequenceTimeToSourceTime } from "@/lib/sequence";

const seek = (seqTimeMs: number) => {
  const mapping = sequenceTimeToSourceTime(seqTimeMs, clips, transitions);
  if (!mapping) return;
  const videoTime = mapping.sourceTime / 1000;
  for (const video of videosRef.current) {
    video.currentTime = videoTime;
  }
};
```

**Step 4: Run tests and verify manually**

Run: `npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/components/editor/preview-canvas.tsx src/hooks/use-video-sync.ts
git commit -m "feat: update preview canvas and video sync for sequence model"
```

---

### Task 15: Update Audio Waveform for Sequence Arrangement

**Files:**
- Modify: `src/components/editor/timeline/audio-track.tsx`
- Modify: `src/hooks/use-audio-waveform.ts`

**Step 1: Plan**

The audio waveform currently renders the raw decoded peaks. For the sequence model, it needs to rearrange peaks to match clip order:

1. Decode full source audio as before
2. For each clip in the sequence, extract the corresponding peak range
3. Concatenate extracted ranges in sequence order

**Step 2: Add `rearrangeWaveform` helper to `use-audio-waveform.ts`**

```typescript
export function rearrangeWaveform(
  allPeaks: number[],
  durationMs: number,
  clips: Clip[]
): number[] {
  const msPerPeak = durationMs / allPeaks.length;
  const result: number[] = [];
  for (const clip of clips) {
    const startIdx = Math.floor(clip.sourceStart / msPerPeak);
    const endIdx = Math.floor(clip.sourceEnd / msPerPeak);
    result.push(...allPeaks.slice(startIdx, endIdx));
  }
  return result;
}
```

**Step 3: Use it in AudioTrack**

Pass `sequence.clips` into the audio track. Rearrange peaks before rendering.

**Step 4: Run tests, verify visually**

Run: `npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/use-audio-waveform.ts src/components/editor/timeline/audio-track.tsx
git commit -m "feat: rearrange audio waveform to match sequence clip order"
```

---

## Phase 6: Inspector Panel Updates

### Task 16: Update Zoom Panel for Clip-Scoped Editing

**Files:**
- Modify: `src/components/editor/inspector/zoom-panel.tsx`

**Step 1: Plan**

The zoom panel currently shows global zoom keyframes. Now it should:
- Show keyframes for the **selected clip only**
- "Add Keyframe" adds to the selected clip at playhead position (relative to clip start)
- "Auto-Zoom" generates keyframes scoped to selected clip
- "Clear All" clears only selected clip's keyframes

**Step 2: Update zoom panel selectors**

```typescript
const selectedClipIndex = useEditorStore((s) => s.selectedClipIndex);
const selectedClip = useEditorStore((s) =>
  s.selectedClipIndex !== null ? s.project?.sequence.clips[s.selectedClipIndex] : null
);
const keyframes = selectedClip?.zoomKeyframes ?? [];
```

**Step 3: Update action handlers**

```typescript
const handleAddKeyframe = () => {
  if (selectedClipIndex === null || !selectedClip) return;
  const clipRelativeTime = currentTime - getClipSequenceStart(selectedClipIndex, sequence);
  // Add keyframe at clipRelativeTime to selectedClip
  store.addZoomKeyframeToClip(selectedClipIndex, {
    timeMs: clipRelativeTime,
    durationMs: 500,
    x: 0.5,
    y: 0.5,
    scale: 2.0,
    easing: "ease-in-out",
  });
};
```

**Step 4: Add `addZoomKeyframeToClip` and `removeZoomKeyframeFromClip` to store**

These replace the old global `addZoomKeyframe`/`removeZoomKeyframe`.

**Step 5: Run tests, verify**

Run: `npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/editor/inspector/zoom-panel.tsx src/stores/editor-store.ts
git commit -m "feat: update zoom panel for clip-scoped keyframe editing"
```

---

## Phase 7: Snapping System

### Task 17: Snap Engine

**Files:**
- Create: `src/lib/snap.ts`
- Create: `src/__tests__/snap.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { findSnapTarget } from "@/lib/snap";

describe("snap engine", () => {
  const snapPoints = [0, 1000, 2500, 5000, 7000, 10000]; // ms
  const threshold = 50; // ms

  it("snaps to nearest point within threshold", () => {
    expect(findSnapTarget(1020, snapPoints, threshold)).toBe(1000);
  });

  it("returns original value if no snap point within threshold", () => {
    expect(findSnapTarget(3000, snapPoints, threshold)).toBe(3000);
  });

  it("prefers exact match", () => {
    expect(findSnapTarget(5000, snapPoints, threshold)).toBe(5000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/snap.test.ts`
Expected: FAIL

**Step 3: Implement**

```typescript
export function findSnapTarget(
  value: number,
  snapPoints: number[],
  threshold: number
): number {
  let closest = value;
  let closestDist = threshold + 1;
  for (const point of snapPoints) {
    const dist = Math.abs(value - point);
    if (dist < closestDist) {
      closestDist = dist;
      closest = point;
    }
  }
  return closestDist <= threshold ? closest : value;
}

export function getSequenceSnapPoints(
  clips: Clip[],
  transitions: (Transition | null)[],
  playheadMs: number
): number[] {
  const points: number[] = [0, playheadMs];
  let elapsed = 0;
  for (let i = 0; i < clips.length; i++) {
    points.push(elapsed); // clip start
    const clipDur = (clips[i].sourceEnd - clips[i].sourceStart) / clips[i].speed;
    elapsed += clipDur;
    if (i < transitions.length && transitions[i]?.type !== "cut") {
      elapsed -= transitions[i]!.durationMs;
    }
    points.push(elapsed); // clip end
  }
  return [...new Set(points)].sort((a, b) => a - b);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/snap.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/snap.ts src/__tests__/snap.test.ts
git commit -m "feat: add snap engine for timeline interactions"
```

---

## Phase 8: Rust Backend Updates

### Task 18: Update Rust Types for Sequence Model

**Files:**
- Modify: `src-tauri/src/project.rs`
- Modify: `src-tauri/src/autozoom.rs`

**Step 1: Add Sequence types to Rust project**

In `src-tauri/src/project.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    pub source_start: u64,
    pub source_end: u64,
    pub speed: f64,
    pub zoom_keyframes: Vec<ZoomKeyframe>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transition {
    #[serde(rename = "type")]
    pub transition_type: String, // "cut" | "crossfade" | "dissolve" | "fade-through-black"
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sequence {
    pub clips: Vec<Clip>,
    pub transitions: Vec<Option<Transition>>,
    pub overlay_tracks: Vec<OverlayTrack>,
    pub overlays: Vec<Overlay>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayTrack {
    pub id: String,
    #[serde(rename = "type")]
    pub track_type: String,
    pub locked: bool,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Overlay {
    pub id: String,
    pub track_id: String,
    #[serde(rename = "type")]
    pub overlay_type: String,
    pub start_ms: u64,
    pub duration_ms: u64,
    pub position: Position,
    pub size: Size,
    pub opacity: f64,
    pub linked_clip_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position { pub x: f64, pub y: f64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Size { pub width: f64, pub height: f64 }
```

**Step 2: Update auto-zoom to work with clips**

In `src-tauri/src/autozoom.rs`, update `generate_zoom_keyframes` to accept a clip's source time range, so it only generates keyframes for events within that clip's source range. Adjust output times to be clip-relative.

**Step 3: Build and verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: Compiles successfully

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

**Step 4: Commit**

```bash
git add src-tauri/src/project.rs src-tauri/src/autozoom.rs
git commit -m "feat: add Sequence/Clip/Transition Rust types, update auto-zoom"
```

---

### Task 19: Update Rust Interpolation for Sequence Model

**Files:**
- Modify: `src-tauri/src/autozoom.rs`

**Step 1: Add sequence-aware interpolation**

Mirror the TypeScript `interpolateZoomAtSequenceTime` in Rust:

```rust
pub fn interpolate_zoom_at_sequence_time(
    seq_time: u64,
    clips: &[Clip],
    transitions: &[Option<Transition>],
) -> (f64, f64, f64) {
    // Same logic as TypeScript: find active clip, get clip-relative time, interpolate
    let mut elapsed: i64 = 0;
    for (i, clip) in clips.iter().enumerate() {
        let clip_duration = ((clip.source_end - clip.source_start) as f64 / clip.speed) as i64;
        let overlap_before = if i > 0 {
            transitions.get(i - 1)
                .and_then(|t| t.as_ref())
                .filter(|t| t.transition_type != "cut")
                .map(|t| t.duration_ms as i64)
                .unwrap_or(0)
        } else { 0 };

        if (seq_time as i64) < elapsed + clip_duration - overlap_before {
            let time_in_clip = seq_time as i64 - (elapsed - overlap_before);
            return interpolate_zoom(&clip.zoom_keyframes, time_in_clip as u64);
        }

        elapsed += clip_duration;
        if let Some(Some(t)) = transitions.get(i) {
            if t.transition_type != "cut" {
                elapsed -= t.duration_ms as i64;
            }
        }
    }
    (0.5, 0.5, 1.0)
}
```

**Step 2: Add tests**

```rust
#[test]
fn test_sequence_interpolation_first_clip() {
    let clips = vec![
        Clip {
            id: "a".to_string(), source_start: 0, source_end: 3000, speed: 1.0,
            zoom_keyframes: vec![ZoomKeyframe {
                time_ms: 500, duration_ms: 500, x: 0.3, y: 0.3, scale: 2.0,
                easing: "ease-in-out".to_string(),
            }],
        },
        Clip {
            id: "b".to_string(), source_start: 5000, source_end: 8000, speed: 1.0,
            zoom_keyframes: vec![],
        },
    ];
    let transitions = vec![None];

    let (_, _, scale) = interpolate_zoom_at_sequence_time(750, &clips, &transitions);
    assert_eq!(scale, 2.0);
}
```

**Step 3: Build and test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

**Step 4: Commit**

```bash
git add src-tauri/src/autozoom.rs
git commit -m "feat: add sequence-aware zoom interpolation in Rust"
```

---

## Phase 9: Cleanup & Migration

### Task 20: Remove Old ClipTrack and ZoomTrack Components

**Files:**
- Delete: `src/components/editor/timeline/clip-track.tsx`
- Delete: `src/components/editor/timeline/zoom-track.tsx`
- Delete: `src/components/editor/timeline/zoom-segment.tsx`
- Delete: `src/components/editor/timeline/zoom-popover.tsx`
- Modify: `src/__tests__/timeline.test.tsx` (remove old tests)

**Step 1: Remove old component files**

Delete the four files listed above. They're fully replaced by `SequenceTrack`, `ClipBlock`, and inline zoom badge editing.

**Step 2: Update test file**

Remove any tests referencing `ClipTrack`, `ZoomTrack`, `ZoomSegment`, or `ZoomPopover` directly.

**Step 3: Remove old store actions**

Clean up the old `setInPoint`, `setOutPoint` if they're no longer used (replaced by `trimClipStart`/`trimClipEnd`). Keep them if needed for backward compat during migration.

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old ClipTrack, ZoomTrack, ZoomSegment, ZoomPopover"
```

---

### Task 21: End-to-End Smoke Test

**Files:**
- Create: `src/__tests__/sequence-e2e.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect } from "vitest";
import { useEditorStore } from "@/stores/editor-store";

describe("sequence editing e2e", () => {
  const mockProject = {
    // ... full mock project with duration_ms: 10000
  };

  it("full workflow: load → split → reorder → add transition → delete clip", () => {
    const store = useEditorStore.getState();
    store.loadProject(mockProject);

    // Verify migration
    const seq = () => useEditorStore.getState().project!.sequence;
    expect(seq().clips).toHaveLength(1);

    // Split at 3s and 7s
    store.setCurrentTime(3000);
    store.splitAtPlayhead();
    expect(seq().clips).toHaveLength(2);

    store.setCurrentTime(7000);
    store.splitAtPlayhead();
    expect(seq().clips).toHaveLength(3);

    // Add crossfade between clips 0 and 1
    store.addTransition(0, { type: "crossfade", durationMs: 200 });
    expect(seq().transitions[0]?.type).toBe("crossfade");

    // Reorder: move clip 2 to position 0
    const clip2Id = seq().clips[2].id;
    store.moveClip(2, 0);
    expect(seq().clips[0].id).toBe(clip2Id);

    // Delete clip 1
    store.setSelectedClipIndex(1);
    store.rippleDelete();
    expect(seq().clips).toHaveLength(2);

    // Undo
    useEditorStore.temporal.getState().undo();
    expect(seq().clips).toHaveLength(3);
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/__tests__/sequence-e2e.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/__tests__/sequence-e2e.test.ts
git commit -m "test: add sequence editing end-to-end smoke test"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1: Data Model | 1-4 | Sequence types, helpers, store migration, zoom interpolation |
| 2: Sequence UI | 5-9 | SequenceTrack, ClipBlock, toolbar, shortcuts, drag-drop, trimming |
| 3: Transitions | 10-11 | Transition blocks, context menu |
| 4: Overlays | 12-13 | Overlay store actions, overlay track UI |
| 5: Preview | 14-15 | Preview canvas update, audio waveform rearrangement |
| 6: Inspector | 16 | Clip-scoped zoom panel |
| 7: Snapping | 17 | Snap engine |
| 8: Rust Backend | 18-19 | Rust types, sequence-aware interpolation |
| 9: Cleanup | 20-21 | Remove old components, e2e smoke test |

**Total: 21 tasks across 9 phases.**

> **Not in scope (future work):**
> - Metal-based multi-layer compositor for export (Phase 10+)
> - Webcam PiP recording & compositing
> - Text overlay rendering in preview/export
> - Image overlay import & compositing
> - J/K/L playback speed control
> - Transition easing curve editor
