import { describe, test, expect } from "vitest"
import { interpolateZoom, interpolateZoomAtSequenceTime, springEase } from "@/lib/zoom-interpolation"
import type { ZoomKeyframe, Clip, Transition } from "@/types/editor"

const kf = (timeMs: number, x = 0.3, y = 0.7, scale = 2.0, easing: ZoomKeyframe["easing"] = "spring"): ZoomKeyframe => ({
  timeMs, x, y, scale, easing,
})

describe("springEase", () => {
  test("boundaries", () => {
    expect(springEase(0, 0.7, 1.0)).toBe(0)
    expect(springEase(1, 0.7, 1.0)).toBe(1)
  })

  test("critically damped is monotonically increasing", () => {
    const v1 = springEase(0.25, 0.7, 1.0)
    const v2 = springEase(0.5, 0.7, 1.0)
    const v3 = springEase(0.75, 0.7, 1.0)
    expect(v1).toBeLessThan(v2)
    expect(v2).toBeLessThan(v3)
  })

  test("canonical vectors (cross-layer parity)", () => {
    const cases: [number, number, number, number, number][] = [
      // [t, response, damping, min, max]
      [0.0, 0.7, 1.0, 0.0, 0.001],
      [1.0, 0.7, 1.0, 0.999, 1.001],
      [0.25, 0.7, 1.0, 0.4, 0.95],
      [0.5, 0.7, 1.0, 0.8, 1.1],
      [0.75, 0.7, 1.0, 0.95, 1.05],
      [0.5, 1.0, 1.0, 0.6, 1.0],
      [0.5, 0.4, 0.95, 0.7, 1.2],
    ]
    for (const [t, r, d, min, max] of cases) {
      const v = springEase(t, r, d)
      expect(v).toBeGreaterThanOrEqual(min)
      expect(v).toBeLessThanOrEqual(max)
    }
  })
})

describe("interpolateZoom (keyframe-pair model)", () => {
  test("empty keyframes returns default", () => {
    expect(interpolateZoom([], 1000)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("before first keyframe returns first keyframe's values", () => {
    const result = interpolateZoom([kf(1000, 0.3, 0.7, 2.0)], 500)
    expect(result.x).toBeCloseTo(0.3)
    expect(result.y).toBeCloseTo(0.7)
    expect(result.scale).toBeCloseTo(2.0)
  })

  test("after last keyframe returns last keyframe's values", () => {
    const result = interpolateZoom([kf(1000, 0.3, 0.7, 2.0)], 2500)
    expect(result.x).toBeCloseTo(0.3)
    expect(result.y).toBeCloseTo(0.7)
    expect(result.scale).toBeCloseTo(2.0)
  })

  test("linear interpolation at midpoint", () => {
    const kfs = [
      kf(0, 0.5, 0.5, 1.0, "linear"),
      kf(1000, 0.3, 0.7, 2.0, "linear"),
    ]
    const result = interpolateZoom(kfs, 500)
    expect(result.x).toBeCloseTo(0.4)
    expect(result.y).toBeCloseTo(0.6)
    expect(result.scale).toBeCloseTo(1.5)
  })

  test("spring overshoots linear midpoint", () => {
    const kfs = [
      kf(0, 0.5, 0.5, 1.0, "linear"),
      kf(1000, 0.3, 0.7, 2.0, "spring"),
    ]
    const result = interpolateZoom(kfs, 500)
    expect(result.scale).toBeGreaterThan(1.5)
  })

  test("ease-out at midpoint", () => {
    const kfs = [
      kf(0, 0.3, 0.7, 2.0, "spring"),
      kf(1000, 0.3, 0.7, 1.0, "ease-out"),
    ]
    const result = interpolateZoom(kfs, 500)
    // ease-out at t=0.5: 1-(1-0.5)^2 = 0.75, scale = 2.0 + (1.0-2.0)*0.75 = 1.25
    expect(result.scale).toBeCloseTo(1.25, 1)
  })

  test("cursor follow blends position when zoomed", () => {
    const kfs = [
      kf(0, 0.5, 0.5, 1.0, "linear"),
      kf(1000, 0.3, 0.3, 2.0, "linear"),
    ]
    const result = interpolateZoom(kfs, 1000, { x: 0.8, y: 0.8 }, 0.5)
    expect(result.x).toBeCloseTo(0.55, 1)
    expect(result.y).toBeCloseTo(0.55, 1)
  })

  test("cursor follow does not apply at scale 1.0", () => {
    const kfs = [kf(0, 0.5, 0.5, 1.0, "linear")]
    const result = interpolateZoom(kfs, 0, { x: 0.8, y: 0.8 }, 1.0)
    expect(result.x).toBeCloseTo(0.5)
    expect(result.y).toBeCloseTo(0.5)
  })
})

describe("interpolateZoomAtSequenceTime", () => {
  const clips: Clip[] = [
    {
      id: "a", sourceStart: 0, sourceEnd: 3000, speed: 1,
      zoomKeyframes: [
        kf(0, 0.5, 0.5, 1.0, "linear"),
        kf(500, 0.3, 0.3, 2.0, "spring"),
        kf(1500, 0.3, 0.3, 1.0, "ease-out"),
      ],
    },
    {
      id: "b", sourceStart: 5000, sourceEnd: 8000, speed: 1,
      zoomKeyframes: [],
    },
  ]
  const transitions: (Transition | null)[] = [null]

  test("resolves zoom-in from first clip", () => {
    // At time 500, should be fully zoomed in
    const result = interpolateZoomAtSequenceTime(500, clips, transitions)
    expect(result.scale).toBeCloseTo(2.0)
  })

  test("returns default for empty clips", () => {
    const result = interpolateZoomAtSequenceTime(1000, [], [])
    expect(result.scale).toBe(1)
  })

  test("returns default for no keyframes in clip", () => {
    // Second clip has no keyframes
    const result = interpolateZoomAtSequenceTime(4000, clips, transitions)
    expect(result.scale).toBe(1)
  })
})
