import { describe, test, expect } from "vitest"
import { interpolateZoom } from "@/lib/zoom-interpolation"

describe("interpolateZoom", () => {
  test("empty keyframes returns default", () => {
    expect(interpolateZoom([], 1000)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("before first keyframe returns default", () => {
    const kfs = [{ timeMs: 1000, x: 0.3, y: 0.7, scale: 2, easing: "ease-in-out" as const, durationMs: 300 }]
    expect(interpolateZoom(kfs, 500)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("mid-transition interpolates", () => {
    const kfs = [{ timeMs: 1000, x: 0.3, y: 0.7, scale: 2, easing: "ease-in-out" as const, durationMs: 1000 }]
    const result = interpolateZoom(kfs, 1500) // 50% through
    expect(result.scale).toBeGreaterThan(1)
    expect(result.scale).toBeLessThan(2)
  })

  test("after transition holds", () => {
    const kfs = [
      { timeMs: 1000, x: 0.3, y: 0.7, scale: 2, easing: "ease-in-out" as const, durationMs: 300 },
      { timeMs: 3000, x: 0.5, y: 0.5, scale: 1, easing: "ease-in-out" as const, durationMs: 300 },
    ]
    // Between kf[0] end (1300) and kf[1] start (3000) — should hold at kf[0]
    const result = interpolateZoom(kfs, 2000)
    expect(result.x).toBeCloseTo(0.3)
    expect(result.scale).toBe(2)
  })

  test("after last keyframe returns last state", () => {
    const kfs = [{ timeMs: 1000, x: 0.3, y: 0.7, scale: 2, easing: "ease-in-out" as const, durationMs: 300 }]
    const result = interpolateZoom(kfs, 5000)
    expect(result.x).toBe(0.3)
    expect(result.y).toBe(0.7)
    expect(result.scale).toBe(2)
  })
})
