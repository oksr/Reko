import type { ZoomEvent, Clip, Transition } from "@/types/editor"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

// ── Spring physics ──

const SPRING_RESPONSE = 1.0
const SPRING_DAMPING = 1.0
const TRANSITION_MS = 450 // lead-in / lead-out duration

/**
 * Critically-damped spring easing.
 * Must match Swift `springEase` exactly.
 */
export function springEase(t: number, response: number = SPRING_RESPONSE, damping: number = SPRING_DAMPING): number {
  if (t <= 0) return 0
  if (t >= 1) return 1

  const omega = (2 * Math.PI) / response
  const actualT = t * response * 2
  const decay = Math.exp(-damping * omega * actualT)

  if (damping >= 1.0) {
    return 1.0 - (1.0 + omega * actualT) * decay
  } else {
    const dampedFreq = omega * Math.sqrt(1 - damping * damping)
    return (
      1.0 -
      decay *
        (Math.cos(dampedFreq * actualT) +
          ((damping * omega) / dampedFreq) * Math.sin(dampedFreq * actualT))
    )
  }
}

/**
 * Interpolate zoom from ZoomEvent[] at a given clip-relative time.
 *
 * Each event produces:
 *   [timeMs - TRANSITION_MS] spring-in from 1.0 → event.scale
 *   [timeMs .. timeMs + durationMs] hold at event.scale
 *   [timeMs + durationMs .. + TRANSITION_MS] spring-out to 1.0
 *
 * If two events are close enough that lead-out/lead-in overlap,
 * we pan between them while staying zoomed.
 */
export function interpolateZoomEvents(
  events: ZoomEvent[],
  timeMs: number
): { x: number; y: number; scale: number } {
  const none = { x: 0.5, y: 0.5, scale: 1 }
  if (events.length === 0) return none

  // Find active event(s) at this time
  // For each event, its full range is [timeMs - TRANSITION_MS, timeMs + durationMs + TRANSITION_MS]
  let bestScale = 1.0
  let bestX = 0.5
  let bestY = 0.5

  for (const evt of events) {
    const leadInStart = evt.timeMs - TRANSITION_MS
    const holdStart = evt.timeMs
    const holdEnd = evt.timeMs + evt.durationMs
    const leadOutEnd = holdEnd + TRANSITION_MS

    if (timeMs < leadInStart || timeMs > leadOutEnd) continue

    let scale: number
    let blend: number // how much of this event's position to use

    if (timeMs < holdStart) {
      // Lead-in phase
      const t = (timeMs - leadInStart) / TRANSITION_MS
      const eased = springEase(t)
      scale = 1.0 + (evt.scale - 1.0) * eased
      blend = eased
    } else if (timeMs <= holdEnd) {
      // Hold phase
      scale = evt.scale
      blend = 1.0
    } else {
      // Lead-out phase
      const t = (timeMs - holdEnd) / TRANSITION_MS
      const eased = springEase(t)
      scale = evt.scale + (1.0 - evt.scale) * eased
      blend = 1.0 - eased
    }

    // If this event has higher scale influence, it wins
    if (scale > bestScale) {
      bestScale = scale
      bestX = 0.5 + (evt.x - 0.5) * blend
      bestY = 0.5 + (evt.y - 0.5) * blend
    }
  }

  return { x: bestX, y: bestY, scale: bestScale }
}

export function interpolateZoomAtSequenceTime(
  seqTime: number,
  clips: Clip[],
  transitions: (Transition | null)[]
): { x: number; y: number; scale: number } {
  const mapping = sequenceTimeToSourceTime(seqTime, clips, transitions)
  if (!mapping) return { x: 0.5, y: 0.5, scale: 1 }

  const clip = clips[mapping.clipIndex]
  const clipRelativeTime = mapping.sourceTime - clip.sourceStart
  return interpolateZoomEvents(clip.zoomEvents, clipRelativeTime)
}
