# Premiere-Style Timeline Editing Design

**Date:** 2026-02-14
**Status:** Draft
**Scope:** Single-source screen recording with NLE-style editing

## Overview

Transform the current fixed three-track timeline (Clip, Zoom, Audio) into a Premiere Pro-inspired editing experience. Users can razor-cut their screen recording into clips, rearrange them, add transitions, and layer overlays (webcam PiP, text, images) — all while keeping the simplicity of a single-source recording workflow.

## Core Data Model

### Sequence

The timeline backbone. Replaces the current `{ in_point, out_point }` trim model.

- An ordered list of **Clips**, each referencing a time range in the source recording
- Each Clip owns its zoom keyframes (relative to clip start, not absolute time)
- Gaps between clips = deleted content (not rendered)

### Clip

```typescript
interface Clip {
  id: string
  sourceStart: number      // where in the original recording this clip begins (ms)
  sourceEnd: number        // where it ends (ms)
  speed: number            // playback speed (1x default)
  zoomKeyframes: ZoomKeyframe[]  // times relative to clip start
}
```

### Transition

Sits between two adjacent clips.

```typescript
interface Transition {
  type: "cut" | "crossfade" | "dissolve" | "fade-through-black"
  durationMs: number       // overlap duration
}
```

### Overlay

Independent layer positioned in sequence time.

```typescript
interface Overlay {
  id: string
  trackId: string
  type: "webcam" | "text" | "image"
  startMs: number          // sequence time
  durationMs: number
  position: { x: number; y: number }  // normalized 0-1
  size: { width: number; height: number }
  opacity: number
  linkedClipId?: string    // optional: moves with a clip when reordered
  // Type-specific props via discriminated union
}
```

### Zoom Keyframes

Same structure as today, but times are relative to clip start:

```typescript
interface ZoomKeyframe {
  timeMs: number           // relative to owning clip's start
  durationMs: number
  x: number                // 0-1 normalized
  y: number                // 0-1 normalized
  scale: number            // 1.0 = no zoom
  easing: "ease-in-out" | "ease-in" | "ease-out" | "linear"
}
```

## Timeline UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  0:00    0:05    0:10    0:15    0:20    0:25    0:30   │  Time Ruler
│  ▼ Playhead                                             │
├─────────────────────────────────────────────────────────┤
│  V2  │ [Text: "Step 1"]          [Text: "Step 2"]      │  Text/Image Track
├─────────────────────────────────────────────────────────┤
│  V1  │ [Webcam PiP ████████████████████████]            │  Webcam Track
├─────────────────────────────────────────────────────────┤
│  S1  │ [Clip A ██████]><[Clip B ████████][Clip C ███]   │  Main Sequence (tall)
│      │   🔍1.5x  🔍2x    🔍1.5x           🔍2x        │  (zoom badges inline)
├─────────────────────────────────────────────────────────┤
│  A1  │ ▁▃▅▇▅▃▁▃▅▇█▇▅▃▁▃▅▇▅▃▁▃▅▇█▇▅▃▁▃▅▃▁            │  Audio Waveform
└─────────────────────────────────────────────────────────┘
```

### Layout Rules

- **Track labels** on the left (V2, V1, S1, A1) — clickable to toggle visibility/lock
- **Main sequence track (S1)** is the tallest — primary interaction target
- **Zoom indicators** render inline on clips as small purple badges (not a separate track). Click to edit, click empty clip space to add
- **Overlay tracks above**, audio below — video stacks up, audio stacks down (Premiere convention)
- **`><` between clips** = transition zone. Drag to adjust transition duration
- Track labels double as drag handles to **reorder overlay tracks**
- Audio waveform reflects the sequence arrangement, not original recording order

## Interactions & Tools

### Select Tool (V) — Default

- Click a clip to select (blue outline, trim handles appear)
- Drag a clip to reorder in the sequence (other clips slide apart)
- Drag clip edges to trim (shows source timecode tooltip)
- Click a zoom badge to open zoom popover
- Click an overlay to select, drag to reposition in time
- Drag overlay edges to trim duration
- Multi-select with Shift+click or marquee drag

### Razor Tool (C) — Split Clips

- Cursor becomes a blade icon
- Hover shows a vertical cut line snapping to playhead
- Click to split a clip into two at that point
- Zoom keyframes split intelligently: each new clip keeps only keyframes within its range
- Works on overlay tracks too

### Zoom Tool (Z) — Add Zoom Effects

- Click on a clip to add a zoom keyframe at that point
- Click-and-drag to create a zoom segment spanning a range
- Zoom segments render as purple overlays on the clip itself
- All current zoom editing (drag, resize, popover) still works, but inside the clip

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/pause |
| `J/K/L` | Reverse / pause / forward (tap L = 2x) |
| `I/O` | Mark in/out point |
| `Delete` | Ripple delete — remove clip, close gap |
| `Shift+Delete` | Lift — remove clip, leave gap |
| `Cmd+Z` / `Shift+Cmd+Z` | Undo / redo |
| `Cmd+K` | Split at playhead (razor without switching tools) |
| `Cmd+D` | Apply default transition (crossfade) to selected cut |
| `+/-` | Zoom timeline in/out (horizontal scale) |
| `V` | Select tool |
| `C` | Razor tool |
| `Z` | Zoom tool |

### Snapping

Clips snap to the playhead, other clip edges, and ruler markers. Hold `Shift` to temporarily disable snapping.

## Transitions

Transitions live at the junction between two adjacent clips. No separate transition track.

### Adding Transitions

- Right-click cut point → context menu with transition options
- Drag a transition preset from a transitions panel onto the cut point
- `Cmd+D` applies the default transition (crossfade) to selected cut

### Transition Types (v1)

| Type | Behavior |
|------|----------|
| **Cut** | Instant switch, no blending (default) |
| **Crossfade** | Both clips overlap, opacity blends |
| **Dissolve** | Crossfade with brief dip to black |
| **Fade through black** | Clip A fades out to black, Clip B fades in |

### Handle Requirement

Transitions require **handle** — extra source footage beyond the clip's current trim point. If Clip A ends at source time 5000ms but the original recording continues to 5200ms, there's 200ms of handle available. The UI warns if there's not enough handle for the requested transition duration.

```
Before transition:  [Clip A ██████][Clip B ████████]

After crossfade:    [Clip A ██████]
                              [Clip B ████████]
                           ↕ overlap duration

Sequence length shrinks by the overlap amount.
```

### Visual Representation

- Bowtie/hourglass icon at the junction
- Hover shows transition type and duration
- Drag transition edges to adjust duration
- Double-click to open mini editor with easing curve

### Zoom During Transitions

- Clip A's zoom ramps out, Clip B's zoom ramps in
- Blend follows the same easing as the visual transition

## Overlay Tracks

### Webcam Track

- Imports a webcam recording (separate file recorded alongside screen capture)
- Renders as PiP with configurable position, size, border radius
- Circle crop by default
- Can be trimmed, split with razor, or opacity keyframed

### Text Track

- Click track to add a text block at playhead
- Properties: content, font, size, color, background, position
- Animations: fade in/out, typewriter
- Drag edges to set on-screen duration
- Double-click to edit text inline in the preview

### Image Track

- Drag image file onto track to add
- Supports PNG/SVG overlays (logos, arrows, annotations)
- Same position/size controls as webcam

### Track Management

- Right-click track label → Add Track Above / Remove Track / Lock / Hide
- Maximum ~5 overlay tracks
- Locked tracks prevent accidental edits
- Hidden tracks don't render in preview or export

### Compositing Order

- Higher track = renders on top
- Opacity control per overlay, no blend modes (v1)

### Overlay-Clip Relationship

- Overlays are positioned in **sequence time** — rearranging clips doesn't move them
- Optional **link** attaches an overlay to a specific clip (moves with it when reordered)

## Export & Render Pipeline

### Approach: Metal-Based Compositor

Metal is preferred over FFmpeg filter graphs because:
- Existing Metal shader infrastructure for zoom/cursor effects
- Frame-by-frame compositing gives precise control over transitions
- Overlay positioning (PiP, text) is natural in a shader pipeline
- FFmpeg filter graphs become unmaintainable with this many layers
- Better performance on Apple Silicon

### Render Pipeline

```
For each output frame at sequence time T:
  1. Determine active clip → read source frame at clip's source time
  2. If in transition zone → read frames from both clips, blend
  3. Apply zoom/cursor effects to composited video frame
  4. For each overlay track (bottom to top):
     - If overlay active at time T → composite on top
  5. Encode final frame via AVAssetWriter
```

### Audio Pipeline

- Concatenate audio segments matching clip order
- Crossfade audio during transitions (linear fade, not video easing)
- Mix overlay audio (webcam mic) with main audio at configurable levels

### Preview vs Export

- **Preview:** Lower resolution, skip expensive effects if needed, real-time target
- **Export:** Full resolution, all effects, quality priority

## Migration from Current Model

The current `{ duration_ms, in_point, out_point }` timeline maps to a single-clip sequence:

```typescript
// Current model → new model
const sequence: Clip[] = [{
  id: generateId(),
  sourceStart: project.timeline.in_point,
  sourceEnd: project.timeline.out_point,
  speed: 1,
  zoomKeyframes: project.effects.zoomKeyframes  // already relative-ish
}]
```

Existing projects auto-migrate on open. The old trim UI becomes a single clip in the sequence that the user can then razor-cut.
