# Timeline Redesign

## Overview

Full redesign of the timeline UI: visual overhaul, interactive zoom track with direct-manipulation segments, audio waveform visualization, and polished clip track with inline labels.

Reference: Screen Studio-style timeline with gold clip track, purple zoom segments, pin playhead, and waveform audio track.

---

## Layout Structure

```
┌─────────────────────────────────────────────────┐
│ 🔵 Playhead Pin                                  │
│  ·       0:01       ·       0:02       ·         │  ← Time Ruler
├─────────────────────────────────────────────────┤
│ ████████████████████████████████████████████████ │  ← Clip Track (gold, ~40px)
│          Clip  ·  3s  ⊘ 1x                      │
├─────────────────────────────────────────────────┤
│ ██████████              ███████                  │  ← Zoom Track (purple, ~36px)
│  1.1x Auto               2.0x                   │
├─────────────────────────────────────────────────┤
│ ▁▃▅▇▅▃▁▃▅▇█▇▅▃▁▃▅▃▁▃▅▇▅▃▁                     │  ← Audio Track (waveform, ~32px)
└─────────────────────────────────────────────────┘
```

---

## Time Ruler & Playhead

### Time Ruler
- Top of the timeline area
- Light gray tick marks with time labels (0:01, 0:02, etc.)
- Tick interval adapts to duration: sub-second for short clips, 5s/10s/30s for longer recordings
- Small dot markers between major ticks (matching reference style)
- Click anywhere on ruler to seek playhead

### Playhead
- Filled circle "pin" sitting on the ruler rail with a thin vertical line (1-2px) extending through all tracks
- Blue/purple accent color
- Draggable horizontally for scrubbing
- Smooth animation via existing RAF loop during playback
- Subtle glow on the vertical line for visibility against any track color

---

## Clip Track

### Appearance
- Rounded rectangle with warm gold/amber fill and subtle top-to-bottom gradient
- Spans from `in_point` to `out_point`
- ~6px corner radius

### Labels (centered on bar)
- "Clip" in smaller muted text above
- Duration + speed below: e.g., "3s 1x"
- Duration = `(out_point - in_point)` formatted as seconds
- Speed always "1x" for now (label structure ready for speed ramping later)
- Labels fade out when clip bar is too narrow

### Trim Handles
- ~8px wide rounded edge grips at left/right sides of clip bar
- Slightly darker gold shade with subtle vertical grip lines
- On hover: brighten + `col-resize` cursor
- Drag behavior: live scrub preview, min 500ms clip length, clamped to valid range

### Dimmed Regions
- Area before `in_point` and after `out_point` shows a darkened/faded version of the bar
- Replaces current black overlay with more informative "trimmed content" indication

---

## Zoom Track

### Empty State
- Dark purple/indigo bar with centered text: "Click or drag to add zoom on cursor"
- Subtle rounded corners, muted to indicate interactive drop zone

### Adding Segments
- **Click** → creates segment at that position with default duration (500ms) and scale (1.5x). Auto-locks to cursor position if mouse events exist.
- **Click and drag** → creates segment spanning the dragged range. Scale defaults to 1.5x.
- New segments snap to avoid overlapping existing ones.

### Segment Appearance
- Rounded purple rectangles with lighter/gradient fill
- Label: zoom level ("1.1x") + mode icon (mouse icon = auto, lock icon = manual)
- "Zoom" label in smaller text when segment is wide enough, hidden when narrow
- Selected segment gets brighter border/glow

### Segment Manipulation
- **Drag body** → moves segment in time (clamped, no overlap)
- **Drag left/right edges** → resize duration (min ~200ms)
- **Click** → select + open inline popover
- **Delete/Backspace** on selected → remove segment

### Inline Popover
Appears above (or below if near top) the selected segment:
- Scale slider (1.0x - 3.0x)
- Easing dropdown (ease-in-out, ease-in, ease-out, linear)
- "Follow cursor" toggle (auto from mouse events vs manual x/y)
- Delete button

---

## Audio Waveform Track

### Data Pipeline
1. On project load, check for mic track (primary) or system audio (fallback)
2. `AudioContext.decodeAudioData()` to decode the audio file
3. Downsample to ~2 peaks per pixel at current timeline width
4. Cache peaks in component state; recompute on window resize
5. Render to `<canvas>` for performance

### Visual Style
- Mirrored waveform (bars up and down from center) in muted yellow/amber (mic) or blue-gray (system audio)
- Rounded bar caps
- Content outside trim range is dimmed, matching clip track behavior

### Interaction
- Click on waveform → seeks playhead (same as ruler)
- No audio editing, purely visual reference
- During playback, playhead line passes through (no additional highlight needed)

### Performance
- Async decode on project load; shimmer placeholder until ready
- Canvas re-renders only on peaks change or resize
- Typical decode: <1s for 5 min, <3s for 30 min

### No Audio
- If neither mic nor system audio exists, audio track row is not rendered

---

## Component Architecture

```
timeline.tsx (major rewrite)
├── TimeRuler         - tick marks, time labels, click-to-seek
├── PlayheadPin       - draggable pin + vertical line
├── ClipTrack         - gold bar, labels, trim handles
├── ZoomTrack         - segments, empty state, click/drag to create
│   ├── ZoomSegment   - individual purple segment, draggable/resizable
│   └── ZoomPopover   - inline edit popover (scale, easing, delete)
└── AudioTrack        - canvas waveform renderer
```

### State Changes (`editor-store.ts`)
- Add `selectedZoomIndex: number | null` — which zoom segment is selected
- Add `zoomPopoverOpen: boolean` — popover visibility
- Existing `ZoomKeyframe` type stays; `durationMs` reinterpreted as segment length (not transition time)

### New Hook: `use-audio-waveform.ts`
- Takes audio file path, returns peaks array
- Handles decode, downsample, caching
- Returns loading state for shimmer placeholder

### Modified: `zoom-interpolation.ts`
- Segments become "zoom in → hold → zoom out" regions
- Ramp in/out: fixed ~200ms or proportional to segment length
- Between segments: no zoom (1x)

### Test Updates
- Update `timeline.test.tsx` for new component structure
- New tests for `ZoomSegment` drag/resize
- New tests for `use-audio-waveform` hook
- Update `zoom-interpolation.test.ts` for segment-based logic

### Unchanged
- Keyboard shortcuts, playback controls, inspector panels (zoom panel adapts to select from timeline), auto-save, undo/redo, export pipeline
