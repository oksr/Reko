import type { Clip, Transition } from "@/types/editor"

export function findSnapTarget(
  value: number,
  snapPoints: number[],
  threshold: number
): number {
  let closest = value
  let closestDist = threshold + 1
  for (const point of snapPoints) {
    const dist = Math.abs(value - point)
    if (dist < closestDist) {
      closestDist = dist
      closest = point
    }
  }
  return closestDist <= threshold ? closest : value
}

export function getSequenceSnapPoints(
  clips: Clip[],
  transitions: (Transition | null)[],
  playheadMs: number
): number[] {
  const points: number[] = [0, playheadMs]
  let elapsed = 0
  for (let i = 0; i < clips.length; i++) {
    points.push(elapsed)
    const clipDur = (clips[i].sourceEnd - clips[i].sourceStart) / clips[i].speed
    elapsed += clipDur
    if (i < transitions.length && transitions[i] && transitions[i]!.type !== "cut") {
      elapsed -= transitions[i]!.durationMs
    }
    points.push(elapsed)
  }
  return [...new Set(points)].sort((a, b) => a - b)
}
