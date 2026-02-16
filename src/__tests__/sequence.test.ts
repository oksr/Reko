import { describe, it, expect } from "vitest"
import {
  createClip,
  getSequenceDuration,
  sequenceTimeToSourceTime,
  sourceTimeToSequenceTime,
  splitClip,
} from "@/lib/sequence"
import type { Clip, Transition, ZoomKeyframe } from "@/types/editor"

describe("sequence helpers", () => {
  const clips: Clip[] = [
    { id: "a", sourceStart: 0, sourceEnd: 3000, speed: 1, zoomKeyframes: [] },
    { id: "b", sourceStart: 5000, sourceEnd: 8000, speed: 1, zoomKeyframes: [] },
    { id: "c", sourceStart: 10000, sourceEnd: 12000, speed: 1, zoomKeyframes: [] },
  ]
  const transitions: (Transition | null)[] = [null, null] // cuts between clips

  it("calculates total sequence duration", () => {
    // 3000 + 3000 + 2000 = 8000
    expect(getSequenceDuration(clips, transitions)).toBe(8000)
  })

  it("maps sequence time to source time for first clip", () => {
    const result = sequenceTimeToSourceTime(1500, clips, transitions)
    expect(result).toEqual({ clipIndex: 0, clipId: "a", sourceTime: 1500 })
  })

  it("maps sequence time to source time for second clip", () => {
    const result = sequenceTimeToSourceTime(4000, clips, transitions)
    expect(result).toEqual({ clipIndex: 1, clipId: "b", sourceTime: 6000 })
  })

  it("maps sequence time to source time for third clip", () => {
    const result = sequenceTimeToSourceTime(7000, clips, transitions)
    expect(result).toEqual({ clipIndex: 2, clipId: "c", sourceTime: 11000 })
  })

  it("accounts for crossfade transition overlap", () => {
    const xfadeTransitions: (Transition | null)[] = [
      { type: "crossfade", durationMs: 200 },
      null,
    ]
    // total: 3000 + 3000 + 2000 - 200 = 7800
    expect(getSequenceDuration(clips, xfadeTransitions)).toBe(7800)
  })

  it("creates a clip with generated id", () => {
    const clip = createClip(1000, 5000)
    expect(clip.id).toBeTruthy()
    expect(clip.sourceStart).toBe(1000)
    expect(clip.sourceEnd).toBe(5000)
    expect(clip.speed).toBe(1)
    expect(clip.zoomKeyframes).toEqual([])
  })
})

describe("splitClip", () => {
  it("splits a clip at a given source time", () => {
    const clip: Clip = {
      id: "a",
      sourceStart: 0,
      sourceEnd: 6000,
      speed: 1,
      zoomKeyframes: [],
    }
    const [left, right] = splitClip(clip, 3000)
    expect(left.sourceStart).toBe(0)
    expect(left.sourceEnd).toBe(3000)
    expect(right.sourceStart).toBe(3000)
    expect(right.sourceEnd).toBe(6000)
    expect(left.id).not.toBe(right.id)
  })

  it("distributes zoom keyframes to correct clip", () => {
    const kf1: ZoomKeyframe = {
      timeMs: 500, x: 0.5, y: 0.5, scale: 2, easing: "spring",
    }
    const kf2: ZoomKeyframe = {
      timeMs: 3500, x: 0.3, y: 0.7, scale: 1.5, easing: "linear",
    }
    const clip: Clip = {
      id: "a",
      sourceStart: 0,
      sourceEnd: 6000,
      speed: 1,
      zoomKeyframes: [kf1, kf2],
    }
    const [left, right] = splitClip(clip, 3000)
    expect(left.zoomKeyframes).toEqual([kf1])
    // kf2 should have timeMs adjusted relative to right clip start
    expect(right.zoomKeyframes).toEqual([
      { ...kf2, timeMs: 500 }, // 3500 - 3000
    ])
  })

  it("throws if split point is outside clip range", () => {
    const clip: Clip = {
      id: "a", sourceStart: 1000, sourceEnd: 5000, speed: 1, zoomKeyframes: [],
    }
    expect(() => splitClip(clip, 500)).toThrow()
    expect(() => splitClip(clip, 6000)).toThrow()
  })
})
