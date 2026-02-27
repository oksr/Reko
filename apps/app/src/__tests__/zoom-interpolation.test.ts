import { describe, test, expect } from "vitest"
import { interpolateZoomEvents, interpolateZoomAtSequenceTime, springEase } from "@/lib/zoom-interpolation"
import type { ZoomEvent, Clip, Transition } from "@/types/editor"

const evt = (timeMs: number, durationMs: number, x = 0.3, y = 0.7, scale = 2.0): ZoomEvent => ({
  id: crypto.randomUUID(), timeMs, durationMs, x, y, scale,
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

describe("interpolateZoomEvents (event-based model)", () => {
  test("empty events returns default", () => {
    expect(interpolateZoomEvents([], 1000)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("before lead-in returns default (scale 1)", () => {
    // Event starts at 1000, lead-in at 750 (1000-250)
    const result = interpolateZoomEvents([evt(1000, 1500)], 500)
    expect(result.scale).toBe(1)
  })

  test("during hold phase returns full scale", () => {
    const result = interpolateZoomEvents([evt(1000, 1500, 0.3, 0.7, 2.0)], 1500)
    expect(result.scale).toBeCloseTo(2.0)
    // Position is derived: px = cx - (cx - 0.5) / scale
    expect(result.x).toBeCloseTo(0.3 - (0.3 - 0.5) / 2.0) // 0.4
    expect(result.y).toBeCloseTo(0.7 - (0.7 - 0.5) / 2.0) // 0.6
  })

  test("after lead-out returns default", () => {
    // Event ends at 1000+1500=2500, lead-out ends at 2750
    const result = interpolateZoomEvents([evt(1000, 1500)], 3000)
    expect(result.scale).toBe(1)
  })

  test("during lead-in phase, scale is between 1 and target", () => {
    // Lead-in starts at 750, hold starts at 1000
    const result = interpolateZoomEvents([evt(1000, 1500, 0.3, 0.7, 2.0)], 875)
    expect(result.scale).toBeGreaterThan(1.0)
    expect(result.scale).toBeLessThan(2.0)
  })

  test("during lead-out phase, scale is between target and 1", () => {
    // Hold ends at 2500, lead-out ends at 2750
    const result = interpolateZoomEvents([evt(1000, 1500, 0.3, 0.7, 2.0)], 2625)
    expect(result.scale).toBeGreaterThan(1.0)
    expect(result.scale).toBeLessThan(2.0)
  })

  test("overlapping events: highest scale wins", () => {
    const events = [
      evt(1000, 2000, 0.3, 0.3, 1.5),
      evt(1500, 1000, 0.7, 0.7, 2.5),
    ]
    const result = interpolateZoomEvents(events, 1800)
    expect(result.scale).toBeCloseTo(2.5)
    // Position derived: px = cx - (cx - 0.5) / scale
    expect(result.x).toBeCloseTo(0.7 - (0.7 - 0.5) / 2.5) // 0.62
  })
})

describe("interpolateZoomAtSequenceTime", () => {
  const clips: Clip[] = [
    {
      id: "a", sourceStart: 0, sourceEnd: 3000, speed: 1,
      zoomEvents: [
        evt(500, 1500, 0.3, 0.3, 2.0),
      ],
    },
    {
      id: "b", sourceStart: 5000, sourceEnd: 8000, speed: 1,
      zoomEvents: [],
    },
  ]
  const transitions: (Transition | null)[] = [null]

  test("resolves zoom from first clip during hold", () => {
    // At sequence time 1000 → clip-relative 1000, event hold is [500, 2000]
    const result = interpolateZoomAtSequenceTime(1000, clips, transitions)
    expect(result.scale).toBeCloseTo(2.0)
  })

  test("returns default for empty clips", () => {
    const result = interpolateZoomAtSequenceTime(1000, [], [])
    expect(result.scale).toBe(1)
  })

  test("returns default for no events in clip", () => {
    // Second clip has no events, starts at sequence time 3000
    const result = interpolateZoomAtSequenceTime(4000, clips, transitions)
    expect(result.scale).toBe(1)
  })
})
