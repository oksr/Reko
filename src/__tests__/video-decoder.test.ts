import { describe, it, expect } from "vitest"

describe("VideoDecoderWrapper", () => {
  it("exports the wrapper class", async () => {
    const mod = await import("@/lib/export/video-decoder")
    expect(mod.VideoDecoderWrapper).toBeDefined()
  })
})
