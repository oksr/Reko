import { describe, test, expect } from "vitest"
import { interpolateZoom } from "@/lib/zoom-interpolation"
import type { ZoomKeyframe } from "@/types/editor"

const RAMP_MS = 200 // fixed ramp duration

const seg = (timeMs: number, durationMs: number, scale = 2.0): ZoomKeyframe => ({
  timeMs, durationMs, scale, x: 0.3, y: 0.7, easing: "ease-in-out",
})

describe("interpolateZoom (segment model)", () => {
  test("empty keyframes returns default (no zoom)", () => {
    expect(interpolateZoom([], 1000)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("before segment returns no zoom", () => {
    expect(interpolateZoom([seg(1000, 1000)], 500)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("after segment returns no zoom", () => {
    expect(interpolateZoom([seg(1000, 1000)], 2500)).toEqual({ x: 0.5, y: 0.5, scale: 1 })
  })

  test("during ramp-in phase: interpolates from 1x toward target scale", () => {
    const result = interpolateZoom([seg(1000, 1000)], 1100) // 100ms into 200ms ramp
    expect(result.scale).toBeGreaterThan(1)
    expect(result.scale).toBeLessThan(2)
  })

  test("during hold phase: returns full target values", () => {
    // hold starts at 1000+200=1200, ends at 1000+1000-200=1800
    const result = interpolateZoom([seg(1000, 1000)], 1500)
    expect(result.x).toBeCloseTo(0.3)
    expect(result.y).toBeCloseTo(0.7)
    expect(result.scale).toBe(2)
  })

  test("during ramp-out phase: interpolates from target toward 1x", () => {
    // ramp-out starts at 1800, ends at 2000
    const result = interpolateZoom([seg(1000, 1000)], 1900)
    expect(result.scale).toBeGreaterThan(1)
    expect(result.scale).toBeLessThan(2)
  })

  test("between two segments: returns no zoom", () => {
    const kfs = [seg(1000, 500), seg(3000, 500)]
    const result = interpolateZoom(kfs, 2000)
    expect(result.scale).toBe(1)
  })

  test("short segment (< 2*RAMP): ramp fills entire segment, peak may not reach full scale", () => {
    const result = interpolateZoom([seg(1000, 200, 2.0)], 1100) // midpoint of 200ms segment
    expect(result.scale).toBeGreaterThan(1)
    // with only 200ms total, ramp halves at 100ms each, so midpoint = peak
  })

  test("multiple segments: each is independent", () => {
    const kfs = [seg(1000, 500, 1.5), seg(3000, 500, 2.5)]
    // In hold of first segment
    const r1 = interpolateZoom(kfs, 1300)
    expect(r1.scale).toBe(1.5)
    // In hold of second segment
    const r2 = interpolateZoom(kfs, 3300)
    expect(r2.scale).toBe(2.5)
  })
})
