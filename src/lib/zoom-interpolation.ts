import type { ZoomKeyframe } from "@/types/editor"

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

/**
 * Interpolate zoom state at a given time from keyframe list.
 * Returns { x, y, scale } where x,y are normalized center coords (0-1).
 * Must match Rust `interpolate_zoom` exactly for preview/export parity.
 */
export function interpolateZoom(
  keyframes: ZoomKeyframe[],
  timeMs: number
): { x: number; y: number; scale: number } {
  if (keyframes.length === 0) return { x: 0.5, y: 0.5, scale: 1 }

  // Before first keyframe
  if (timeMs <= keyframes[0].timeMs) return { x: 0.5, y: 0.5, scale: 1 }

  // After last keyframe
  const last = keyframes[keyframes.length - 1]
  if (timeMs >= last.timeMs + last.durationMs) {
    return { x: last.x, y: last.y, scale: last.scale }
  }

  // Find active keyframe
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i]
    const end = kf.timeMs + kf.durationMs
    if (timeMs >= kf.timeMs && timeMs < end) {
      const t = (timeMs - kf.timeMs) / kf.durationMs
      const et = easeInOut(t)

      const prev = i > 0
        ? { x: keyframes[i - 1].x, y: keyframes[i - 1].y, scale: keyframes[i - 1].scale }
        : { x: 0.5, y: 0.5, scale: 1 }

      return {
        x: prev.x + (kf.x - prev.x) * et,
        y: prev.y + (kf.y - prev.y) * et,
        scale: prev.scale + (kf.scale - prev.scale) * et,
      }
    }

    // Between keyframes (hold state)
    if (i + 1 < keyframes.length && timeMs >= end && timeMs < keyframes[i + 1].timeMs) {
      return { x: kf.x, y: kf.y, scale: kf.scale }
    }
  }

  return { x: 0.5, y: 0.5, scale: 1 }
}
