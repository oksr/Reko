import { describe, it, expect } from "vitest"
import {
  screenRect,
  cameraRect,
  outputSize,
} from "@/lib/webgl-compositor/layout"

describe("compositor layout", () => {
  describe("screenRect", () => {
    it("aspect-fits 1920x1080 into 1920x1080 canvas with 4% padding", () => {
      const rect = screenRect(1920, 1080, 1920, 1080, 4)
      // pad = 1920 * 4/100 = 76.8 (CSS convention: width-based on all sides)
      // avail = 1766.4 x 926.4 (aspect ~1.91, wider than 16:9)
      // Recording is height-limited: fitH = 926.4, fitW = 926.4 * (16/9) ≈ 1646.93
      const pad = 76.8
      const availW = 1920 - pad * 2  // 1766.4
      const availH = 1080 - pad * 2  // 926.4
      const fitH = availH            // height-limited
      const fitW = fitH * (1920 / 1080)
      expect(rect.x).toBeCloseTo((pad + (availW - fitW) / 2) / 1920, 3)
      expect(rect.y).toBeCloseTo(pad / 1080, 3)
      expect(rect.w).toBeCloseTo(fitW / 1920, 3)
      expect(rect.h).toBeCloseTo(fitH / 1080, 3)
    })

    it("aspect-fits 1920x1200 (16:10) into 1920x1080 canvas with 0% padding", () => {
      const rect = screenRect(1920, 1080, 1920, 1200, 0)
      const recordingAspect = 1920 / 1200
      const fitW = 1080 * recordingAspect
      expect(rect.w).toBeCloseTo(fitW / 1920, 2)
      expect(rect.h).toBeCloseTo(1, 2)
    })

    it("handles 0 padding", () => {
      const rect = screenRect(1920, 1080, 1920, 1080, 0)
      expect(rect.x).toBeCloseTo(0)
      expect(rect.y).toBeCloseTo(0)
      expect(rect.w).toBeCloseTo(1)
      expect(rect.h).toBeCloseTo(1)
    })
  })

  describe("cameraRect", () => {
    it("places bottom-right with 4% margin", () => {
      const rect = cameraRect(1920, 1080, 15, "bottom-right")
      const size = 1920 * 15 / 100
      const margin = 1920 * 0.04
      expect(rect.w).toBeCloseTo(size / 1920, 3)
      expect(rect.h).toBeCloseTo(size / 1080, 3)
      expect(rect.x).toBeCloseTo((1920 - margin - size) / 1920, 3)
      expect(rect.y).toBeCloseTo((1080 - margin - size) / 1080, 3)
    })

    it("places top-left with 4% margin", () => {
      const rect = cameraRect(1920, 1080, 15, "top-left")
      const margin = 1920 * 0.04
      expect(rect.x).toBeCloseTo(margin / 1920, 3)
      expect(rect.y).toBeCloseTo(margin / 1080, 3)
    })
  })

  describe("outputSize", () => {
    it("computes 1080p from 1920x1080 original", () => {
      const size = outputSize("1080p", 1920, 1080)
      expect(size.height).toBe(1080)
      expect(size.width).toBe(1920)
      expect(size.width % 2).toBe(0)
    })

    it("computes 720p from 2560x1440 original", () => {
      const size = outputSize("720p", 2560, 1440)
      expect(size.height).toBe(720)
      expect(size.width).toBe(1280)
    })

    it("original returns source dimensions (rounded even)", () => {
      const size = outputSize("original", 2560, 1440)
      expect(size.width).toBe(2560)
      expect(size.height).toBe(1440)
    })
  })
})
