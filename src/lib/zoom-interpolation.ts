import type { ZoomKeyframe, Clip, Transition } from "@/types/editor"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

// ── Spring physics ──

const SPRING_PARAMS: Record<string, { response: number; damping: number }> = {
  slow: { response: 1.4, damping: 1.0 },
  medium: { response: 1.0, damping: 1.0 },
  fast: { response: 0.65, damping: 0.95 },
}

/**
 * Critically-damped (or underdamped) spring easing.
 * Must match Rust `spring_ease` and Swift `springEase` exactly.
 */
export function springEase(t: number, response: number, damping: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1

  const omega = (2 * Math.PI) / response
  const actualT = t * response * 2
  const decay = Math.exp(-damping * omega * actualT)

  if (damping >= 1.0) {
    // Critically damped
    return 1.0 - (1.0 + omega * actualT) * decay
  } else {
    // Underdamped
    const dampedFreq = omega * Math.sqrt(1 - damping * damping)
    return (
      1.0 -
      decay *
        (Math.cos(dampedFreq * actualT) +
          ((damping * omega) / dampedFreq) * Math.sin(dampedFreq * actualT))
    )
  }
}

function easeOut(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 1 - (1 - t) * (1 - t)
}

function applyEasing(
  t: number,
  easing: string,
  response: number,
  damping: number
): number {
  switch (easing) {
    case "spring":
      return springEase(t, response, damping)
    case "ease-out":
      return easeOut(t)
    default:
      return t // linear
  }
}

function applyCursorFollow(
  x: number,
  y: number,
  cursor: { x: number; y: number } | null | undefined,
  strength: number,
  scale: number
): { x: number; y: number } {
  if (strength <= 0 || scale <= 1.0 || !cursor) {
    return { x, y }
  }
  const blend = strength * Math.min((scale - 1.0) / 1.0, 1.0)
  return {
    x: x * (1 - blend) + cursor.x * blend,
    y: y * (1 - blend) + cursor.y * blend,
  }
}

/**
 * Keyframe-pair zoom interpolation.
 * Finds the surrounding keyframe pair and interpolates using the target keyframe's easing.
 * Must match Rust `interpolate_zoom_with_cursor` exactly for preview/export parity.
 */
export function interpolateZoom(
  keyframes: ZoomKeyframe[],
  timeMs: number,
  cursorPos?: { x: number; y: number } | null,
  cursorFollowStrength: number = 0,
  transitionSpeed: string = "medium"
): { x: number; y: number; scale: number } {
  const none = { x: 0.5, y: 0.5, scale: 1 }
  if (keyframes.length === 0) return none

  const params = SPRING_PARAMS[transitionSpeed] ?? SPRING_PARAMS.medium
  const { response, damping } = params

  // Before first keyframe
  if (timeMs <= keyframes[0].timeMs) {
    const kf = keyframes[0]
    const pos = applyCursorFollow(kf.x, kf.y, cursorPos, cursorFollowStrength, kf.scale)
    return { ...pos, scale: kf.scale }
  }

  // After last keyframe
  if (timeMs >= keyframes[keyframes.length - 1].timeMs) {
    const kf = keyframes[keyframes.length - 1]
    const pos = applyCursorFollow(kf.x, kf.y, cursorPos, cursorFollowStrength, kf.scale)
    return { ...pos, scale: kf.scale }
  }

  // Find surrounding pair
  let nextIdx = 0
  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].timeMs > timeMs) {
      nextIdx = i
      break
    }
  }

  const prev = keyframes[nextIdx - 1]
  const next = keyframes[nextIdx]

  const duration = next.timeMs - prev.timeMs
  const rawT = duration > 0 ? (timeMs - prev.timeMs) / duration : 1

  const easedT = applyEasing(rawT, next.easing, response, damping)

  const x = prev.x + (next.x - prev.x) * easedT
  const y = prev.y + (next.y - prev.y) * easedT
  const scale = prev.scale + (next.scale - prev.scale) * easedT

  const pos = applyCursorFollow(x, y, cursorPos, cursorFollowStrength, scale)
  return { ...pos, scale }
}

export function interpolateZoomAtSequenceTime(
  seqTime: number,
  clips: Clip[],
  transitions: (Transition | null)[],
  getCursorAt?: (timeMs: number) => { x: number; y: number } | null,
  cursorFollowStrength: number = 0,
  transitionSpeed: string = "medium"
): { x: number; y: number; scale: number } {
  const mapping = sequenceTimeToSourceTime(seqTime, clips, transitions)
  if (!mapping) return { x: 0.5, y: 0.5, scale: 1 }

  const clip = clips[mapping.clipIndex]
  const clipRelativeTime = mapping.sourceTime - clip.sourceStart
  const cursorPos = getCursorAt?.(mapping.sourceTime) ?? null
  return interpolateZoom(
    clip.zoomKeyframes,
    clipRelativeTime,
    cursorPos,
    cursorFollowStrength,
    transitionSpeed
  )
}
