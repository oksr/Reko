# Smart Zoom Redesign

## Problem

The current smart zoom system has three issues:
1. **Auto-zoom algorithm is hyperactive** — zooms on too many clicks, bad framing, awkward timing
2. **Timeline UI is all-or-nothing** — zoom keyframes render as monolithic regions, can't select/edit/delete individual zoom events
3. **Data model is over-complex** — triplet keyframes (anchor → zoom → anchor), dual zoom storage (per-clip + legacy per-project), cursor follow blending, session-based clustering

## Design

### Data Model

Replace `ZoomKeyframe` with `ZoomEvent`:

```typescript
interface ZoomEvent {
  id: string              // unique ID for selection/editing
  timeMs: number          // when the zoom starts (clip-relative)
  durationMs: number      // how long the zoom holds
  x: number               // normalized center (0-1)
  y: number               // normalized center (0-1)
  scale: number           // zoom factor (e.g. 2.0)
}
```

On the clip: `Clip.zoomEvents: ZoomEvent[]` replaces `Clip.zoomKeyframes`.
Legacy `effects.zoomKeyframes` is deleted entirely.

Rust and Swift types mirror this exactly.

### Auto-Zoom Algorithm

Replace session-based clustering with a simple intentional click filter:

**Step 1 — Filter noise:**
- Discard clicks within ~200ms of each other (rapid double/triple clicks)
- Discard clicks where cursor barely moved from previous click (same spot re-clicks)
- Discard right-clicks entirely

**Step 2 — One click = one ZoomEvent:**
- `timeMs`: click time minus ~300ms lead-in
- `durationMs`: fixed default ~1500ms
- `x, y`: click position
- `scale`: user-configured zoom intensity (default 2.0)

**Step 3 — Merge overlapping events:**
If event B starts before event A ends, merge into one longer event. Position pans from A's center to B's center.

### Interpolation

For each ZoomEvent, the rendered zoom curve:

```
  lead-in     hold      lead-out
|---spring---|========|---spring---|
   ~250ms    durationMs   ~250ms
```

- **Lead-in**: spring ease from 1.0 → event.scale
- **Hold**: constant at event.scale at (event.x, event.y)
- **Lead-out**: spring ease from event.scale → 1.0

If two events are close enough that lead-out/lead-in overlap, skip the zoom-out/zoom-in — just pan between them while staying zoomed.

Spring physics stay (medium params: response=1.0, damping=1.0). Cursor follow is removed entirely.

### Timeline UI

Each ZoomEvent renders as an independent block on the zoom track:

- **Visual**: rounded rect showing duration, labeled with scale (e.g. "2.0x")
- **Select**: click to select, shows handles + edit popover
- **Move**: drag to reposition in time
- **Resize**: drag left/right edges to change duration
- **Delete**: select + backspace
- **Add**: click empty space on zoom track to create new event with defaults

Auto-zoom button replaces all events on the clip. User then deletes/tweaks individual events.

## What Gets Deleted

- `ZoomKeyframe` type (TS, Rust, Swift) — replaced by `ZoomEvent`
- Triplet creation logic in zoom-panel.tsx
- `ZoomRegion` computation in zoom-track.tsx
- Session-based clustering in autozoom.rs
- Cursor follow — `cursorFollowStrength`, blending logic in all 3 layers, cursor smoothing in Swift export
- `AutoZoomSettings.cursorFollowStrength` and `transitionSpeed` fields
- `effects.zoomKeyframes` (legacy per-project zoom)

## What Stays

- Spring physics (easing math only)
- Metal shader zoom crop (still receives x/y/scale per frame)
- Zoom intensity slider (maps to `scale` on generated events)
- Basic export flow (interpolate per frame → pass to compositor)

## Implementation Order

1. **Data model** — Define `ZoomEvent` in TS, Rust, Swift. Replace `zoomKeyframes` with `zoomEvents` on Clip.
2. **Interpolation** — New `interpolateZoomEvents()` in TS and Swift. Delete cursor follow logic.
3. **Auto-zoom algorithm** — Rewrite `generate_auto_zoom` in Rust with click filter approach.
4. **Store actions** — Replace keyframe actions with event-based actions (add/remove/update/clear zoom events).
5. **Timeline UI** — Rewrite zoom-track.tsx to render individual event blocks with drag/resize/delete.
6. **Zoom panel** — Simplify to just auto-zoom button + intensity slider. Remove cursor follow and transition speed controls.
7. **Export pipeline** — Update Swift export to use `ZoomEvent` model and new interpolation.
8. **Cleanup** — Delete all dead code, old types, old tests. Write new tests.
