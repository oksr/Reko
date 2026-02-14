import { describe, it, expect } from "vitest"
import { findSnapTarget, getSequenceSnapPoints } from "@/lib/snap"
import type { Clip, Transition } from "@/types/editor"

describe("snap engine", () => {
  const snapPoints = [0, 1000, 2500, 5000, 7000, 10000]
  const threshold = 50

  it("snaps to nearest point within threshold", () => {
    expect(findSnapTarget(1020, snapPoints, threshold)).toBe(1000)
  })

  it("returns original value if no snap point within threshold", () => {
    expect(findSnapTarget(3000, snapPoints, threshold)).toBe(3000)
  })

  it("prefers exact match", () => {
    expect(findSnapTarget(5000, snapPoints, threshold)).toBe(5000)
  })

  it("snaps to closest when between two points", () => {
    expect(findSnapTarget(2480, snapPoints, threshold)).toBe(2500)
    expect(findSnapTarget(2520, snapPoints, threshold)).toBe(2500)
  })
})

describe("getSequenceSnapPoints", () => {
  const makeClip = (start: number, end: number): Clip => ({
    id: `clip-${start}`,
    sourceStart: start,
    sourceEnd: end,
    speed: 1,
    zoomKeyframes: [],
  })

  it("returns clip boundaries and playhead", () => {
    const clips = [makeClip(0, 3000), makeClip(3000, 7000)]
    const transitions: (Transition | null)[] = [null]
    const points = getSequenceSnapPoints(clips, transitions, 1500)
    expect(points).toContain(0)     // first clip start
    expect(points).toContain(3000)  // boundary
    expect(points).toContain(7000)  // last clip end
    expect(points).toContain(1500)  // playhead
  })

  it("accounts for transition overlaps", () => {
    const clips = [makeClip(0, 3000), makeClip(3000, 7000)]
    const transitions: (Transition | null)[] = [{ type: "crossfade", durationMs: 200 }]
    const points = getSequenceSnapPoints(clips, transitions, 500)
    // Total = 3000 + 4000 - 200 = 6800
    expect(points).toContain(6800)
  })
})
