import { describe, it, expect } from "vitest"

describe("WebGLCompositor", () => {
  it("exports compositor class", async () => {
    const mod = await import("@/lib/webgl-compositor")
    expect(mod.WebGLCompositor).toBeDefined()
  })

  it("exports layout functions", async () => {
    const mod = await import("@/lib/webgl-compositor")
    expect(mod.screenRect).toBeDefined()
    expect(mod.cameraRect).toBeDefined()
    expect(mod.outputSize).toBeDefined()
  })
})
