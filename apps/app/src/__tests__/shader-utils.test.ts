import { describe, it, expect, vi, beforeEach } from "vitest"
import { compileShader, linkProgram } from "@/lib/webgl-compositor/shader-utils"

function createMockGL() {
  const shader = { __type: "shader" }
  const program = { __type: "program" }
  return {
    createShader: vi.fn().mockReturnValue(shader),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn().mockReturnValue(true),
    getShaderInfoLog: vi.fn().mockReturnValue(""),
    createProgram: vi.fn().mockReturnValue(program),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn().mockReturnValue(true),
    getProgramInfoLog: vi.fn().mockReturnValue(""),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    VERTEX_SHADER: 0x8B31,
    FRAGMENT_SHADER: 0x8B30,
    COMPILE_STATUS: 0x8B81,
    LINK_STATUS: 0x8B82,
  } as unknown as WebGL2RenderingContext
}

describe("shader-utils", () => {
  let gl: WebGL2RenderingContext

  beforeEach(() => {
    gl = createMockGL()
  })

  it("compileShader compiles a vertex shader", () => {
    const shader = compileShader(gl, gl.VERTEX_SHADER, "void main() {}")
    expect(gl.createShader).toHaveBeenCalledWith(gl.VERTEX_SHADER)
    expect(gl.shaderSource).toHaveBeenCalled()
    expect(gl.compileShader).toHaveBeenCalled()
    expect(shader).toBeTruthy()
  })

  it("compileShader throws on compilation failure", () => {
    vi.mocked(gl.getShaderParameter).mockReturnValue(false)
    vi.mocked(gl.getShaderInfoLog).mockReturnValue("syntax error")
    expect(() => compileShader(gl, gl.FRAGMENT_SHADER, "bad")).toThrow("syntax error")
  })

  it("linkProgram links vertex + fragment shaders", () => {
    const vs = compileShader(gl, gl.VERTEX_SHADER, "void main() {}")
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, "void main() {}")
    const prog = linkProgram(gl, vs, fs)
    expect(gl.attachShader).toHaveBeenCalledTimes(2)
    expect(gl.linkProgram).toHaveBeenCalled()
    expect(prog).toBeTruthy()
  })

  it("linkProgram throws on link failure", () => {
    vi.mocked(gl.getProgramParameter).mockReturnValue(false)
    vi.mocked(gl.getProgramInfoLog).mockReturnValue("link error")
    const vs = compileShader(gl, gl.VERTEX_SHADER, "void main() {}")
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, "void main() {}")
    expect(() => linkProgram(gl, vs, fs)).toThrow("link error")
  })
})
