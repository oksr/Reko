import type { Clip, Transition } from "@/types/editor"

export function createClip(
  sourceStart: number,
  sourceEnd: number,
  zoomEvents: Clip["zoomEvents"] = []
): Clip {
  return { id: crypto.randomUUID(), sourceStart, sourceEnd, speed: 1, zoomEvents }
}

/** Total duration of the sequence accounting for transition overlaps */
export function getSequenceDuration(
  clips: Clip[],
  transitions: (Transition | null)[]
): number {
  let total = 0
  for (const clip of clips) {
    total += (clip.sourceEnd - clip.sourceStart) / clip.speed
  }
  for (const t of transitions) {
    if (t && t.type !== "cut") {
      total -= t.durationMs
    }
  }
  return total
}

export interface SourceTimeResult {
  clipIndex: number
  clipId: string
  sourceTime: number
}

/** Convert sequence playback time to a source time within a specific clip.
 *  Uses <= for the last clip so that seeking to exactly seqDuration resolves
 *  to the last frame of the last clip instead of returning null. */
export function sequenceTimeToSourceTime(
  seqTime: number,
  clips: Clip[],
  transitions: (Transition | null)[]
): SourceTimeResult | null {
  let elapsed = 0

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const clipDuration = (clip.sourceEnd - clip.sourceStart) / clip.speed
    const overlapBefore =
      i > 0 && transitions[i - 1] && transitions[i - 1]!.type !== "cut"
        ? transitions[i - 1]!.durationMs
        : 0
    const clipStart = elapsed - overlapBefore
    const clipEnd = elapsed + clipDuration - overlapBefore
    const isLast = i === clips.length - 1

    if (seqTime < clipEnd || (isLast && seqTime <= clipEnd)) {
      const timeInClip = Math.min(seqTime - clipStart, clipDuration)
      return {
        clipIndex: i,
        clipId: clip.id,
        sourceTime: clip.sourceStart + timeInClip * clip.speed,
      }
    }

    elapsed += clipDuration
    // Subtract overlap with the next transition
    if (i < transitions.length && transitions[i] && transitions[i]!.type !== "cut") {
      elapsed -= transitions[i]!.durationMs
    }
  }

  return null
}

/** Split a clip at a source time, distributing zoom keyframes */
export function splitClip(clip: Clip, sourceTime: number): [Clip, Clip] {
  if (sourceTime <= clip.sourceStart || sourceTime >= clip.sourceEnd) {
    throw new Error(
      `Split point ${sourceTime} is outside clip range [${clip.sourceStart}, ${clip.sourceEnd}]`
    )
  }
  const splitRelative = sourceTime - clip.sourceStart

  // Split zoom events: events that start before split go to left clip,
  // events that start after go to right clip (with adjusted time).
  // Events that span the split point stay in left clip.
  const leftEvents = clip.zoomEvents.filter(
    (e) => e.timeMs < splitRelative
  )
  const rightEvents = clip.zoomEvents
    .filter((e) => e.timeMs >= splitRelative)
    .map((e) => ({ ...e, timeMs: e.timeMs - splitRelative }))

  const left: Clip = {
    id: crypto.randomUUID(),
    sourceStart: clip.sourceStart,
    sourceEnd: sourceTime,
    speed: clip.speed,
    zoomEvents: leftEvents,
  }
  const right: Clip = {
    id: crypto.randomUUID(),
    sourceStart: sourceTime,
    sourceEnd: clip.sourceEnd,
    speed: clip.speed,
    zoomEvents: rightEvents,
  }

  return [left, right]
}

/** Convert source time back to sequence time for a given clip */
export function sourceTimeToSequenceTime(
  sourceTime: number,
  clipIndex: number,
  clips: Clip[],
  transitions: (Transition | null)[]
): number {
  let elapsed = 0
  for (let i = 0; i < clipIndex; i++) {
    const clip = clips[i]
    elapsed += (clip.sourceEnd - clip.sourceStart) / clip.speed
    if (i < transitions.length && transitions[i] && transitions[i]!.type !== "cut") {
      elapsed -= transitions[i]!.durationMs
    }
  }
  const clip = clips[clipIndex]
  elapsed += (sourceTime - clip.sourceStart) / clip.speed
  return elapsed
}
