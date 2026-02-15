import type { ZoomKeyframe, Clip, Transition } from "@/types/editor"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

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
  timeMs: number,
  cursorPos?: { x: number; y: number } | null
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

    const targetX = cursorPos?.x ?? kf.x
    const targetY = cursorPos?.y ?? kf.y
    return {
      x: none.x + (targetX - none.x) * t,
      y: none.y + (targetY - none.y) * t,
      scale: none.scale + (kf.scale - none.scale) * t,
    }
  }

  return none
}

export function interpolateZoomAtSequenceTime(
  seqTime: number,
  clips: Clip[],
  transitions: (Transition | null)[],
  getCursorAt?: (timeMs: number) => { x: number; y: number } | null
): { x: number; y: number; scale: number } {
  const mapping = sequenceTimeToSourceTime(seqTime, clips, transitions)
  if (!mapping) return { x: 0.5, y: 0.5, scale: 1 }

  const clip = clips[mapping.clipIndex]
  const clipRelativeTime = mapping.sourceTime - clip.sourceStart
  const cursorPos = getCursorAt?.(mapping.sourceTime) ?? null
  return interpolateZoom(clip.zoomKeyframes, clipRelativeTime, cursorPos)
}
