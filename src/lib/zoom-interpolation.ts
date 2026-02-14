import type { ZoomKeyframe } from "@/types/editor"

const RAMP_MS = 200

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

/**
 * Segment-based zoom interpolation.
 * Each keyframe defines a zoom segment: ramp in -> hold -> ramp out.
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
