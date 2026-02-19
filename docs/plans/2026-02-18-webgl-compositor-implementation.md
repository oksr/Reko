# WebGL Compositor + WebCodecs Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Metal-based preview and export with a unified WebGL2 compositor + WebCodecs encoder so preview = export at 60fps with zero IPC overhead.

**Architecture:** A single `WebGLCompositor` TypeScript class renders all visual layers (background, screen+zoom, camera bubble, cursor, click animation) using GLSL shaders. Preview feeds it `<video>` textures at 60fps via RAF. Export feeds it `VideoDecoder` frames and captures output via `VideoFrame(canvas)` → `VideoEncoder` → `mp4-muxer`. Audio encoded via WASM AAC. Swift retains recording/permissions only.

**Tech Stack:** WebGL2, GLSL, WebCodecs (VideoDecoder, VideoEncoder, VideoFrame), mp4box.js (demux), mp4-muxer (mux), fdk-aac-wasm (audio encoding), TypeScript, React

**Design doc:** `docs/plans/2026-02-18-webgl-compositor-design.md`

---

## Task 0: Install Dependencies + Configure Vite for GLSL

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json` (add `.glsl` module declaration)

**Step 1: Install npm packages**

Run:
```bash
npm install mp4box mp4-muxer @simonwep/fdk-aac-enc
npm install -D vite-plugin-glsl @types/mp4box
```

Note: If `@simonwep/fdk-aac-enc` is not available, use `@nicknisi/fdk-aac-enc` or similar WASM AAC encoder. Verify the package exists first. If no suitable WASM AAC encoder exists, we'll handle audio encoding as a later task with an alternative approach (ffmpeg sidecar fallback).

**Step 2: Add vite-plugin-glsl to Vite config**

In `vite.config.ts`, add the GLSL import plugin so `.vert` and `.frag` files can be imported as strings:

```typescript
import glsl from "vite-plugin-glsl"

export default defineConfig({
  plugins: [react(), tailwindcss(), glsl(), serveLocalAssets()],
  // ... rest unchanged
})
```

**Step 3: Add GLSL module declaration**

Create `src/glsl.d.ts`:

```typescript
declare module "*.vert" {
  const value: string
  export default value
}
declare module "*.frag" {
  const value: string
  export default value
}
declare module "*.glsl" {
  const value: string
  export default value
}
```

**Step 4: Verify the build still works**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/glsl.d.ts
git commit -m "chore: add WebGL/WebCodecs dependencies and GLSL import support"
```

---

## Task 1: WebGL Shader Utilities

**Files:**
- Create: `src/lib/webgl-compositor/shader-utils.ts`
- Create: `src/__tests__/shader-utils.test.ts`

**Context:** Utility functions for compiling and linking WebGL shader programs. Used by the compositor in Task 3. These are pure functions that take a `WebGL2RenderingContext` and return compiled programs.

**Step 1: Write the test**

```typescript
// src/__tests__/shader-utils.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { compileShader, linkProgram } from "@/lib/webgl-compositor/shader-utils"

// Mock WebGL2RenderingContext
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/shader-utils.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement shader-utils**

```typescript
// src/lib/webgl-compositor/shader-utils.ts

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("Failed to create shader")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown error"
    gl.deleteShader(shader)
    throw new Error(log)
  }
  return shader
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error("Failed to create program")
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown error"
    gl.deleteProgram(program)
    throw new Error(log)
  }
  return program
}

/** Get uniform location, throwing if not found (catches typos). */
export function getUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name)
  if (loc === null) throw new Error(`Uniform '${name}' not found`)
  return loc
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/shader-utils.test.ts`
Expected: PASS — all 4 tests pass.

**Step 5: Commit**

```bash
git add src/lib/webgl-compositor/shader-utils.ts src/__tests__/shader-utils.test.ts
git commit -m "feat(compositor): add WebGL shader compilation utilities"
```

---

## Task 2: Layout Math (Pure Functions)

**Files:**
- Create: `src/lib/webgl-compositor/layout.ts`
- Create: `src/__tests__/compositor-layout.test.ts`

**Context:** Port the Metal compositor's `LayoutMath` struct to TypeScript. These pure functions compute normalized positions/sizes for the screen rect, camera bubble, and cursor. They are used by the compositor to set shader uniforms. Must match the Metal implementation exactly to ensure visual parity during migration.

**Reference:** The Metal `LayoutMath` in `RekoEngine/Sources/RekoEngine/export/metal-compositor.swift` computes:
- `screenRect`: aspect-fit the recording inside the canvas with padding, returns normalized origin + size
- `cameraOrigin`: position camera bubble with 4% margin from edge, returns normalized origin + size
- `outputSize`: compute output dimensions for a given resolution preset

**Step 1: Write the tests**

```typescript
// src/__tests__/compositor-layout.test.ts
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
      // padding = 1920 * 4/100 = 76.8 on each side
      // available = 1920 - 153.6 = 1766.4 x (1080 - 153.6 = 926.4)
      // aspect = 16:9 both, so fills available area
      expect(rect.x).toBeCloseTo(76.8 / 1920, 3)
      expect(rect.y).toBeCloseTo(76.8 / 1080, 3)
      expect(rect.w).toBeCloseTo(1766.4 / 1920, 3)
      expect(rect.h).toBeCloseTo(926.4 / 1080, 3)
    })

    it("aspect-fits 1920x1200 (16:10) into 1920x1080 canvas with 0% padding", () => {
      const rect = screenRect(1920, 1080, 1920, 1200, 0)
      // recording is taller ratio — width fills, height is letterboxed
      const recordingAspect = 1920 / 1200 // 1.6
      const fitH = 1920 / recordingAspect // 1200 — taller than canvas
      // Since fitH > canvasH, fit by height instead
      const fitW = 1080 * recordingAspect // 1728
      expect(rect.w).toBeCloseTo(fitW / 1920, 2)
      expect(rect.h).toBeCloseTo(1, 2) // fills height
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
      const size = 1920 * 15 / 100 // 288
      const margin = 1920 * 0.04 // 76.8
      expect(rect.w).toBeCloseTo(size / 1920, 3)
      expect(rect.h).toBeCloseTo(size / 1080, 3)
      // origin X = canvas - margin - size
      expect(rect.x).toBeCloseTo((1920 - margin - size) / 1920, 3)
      // origin Y = canvas - margin - size
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
      expect(size.width % 2).toBe(0) // even
    })

    it("computes 720p from 2560x1440 original", () => {
      const size = outputSize("720p", 2560, 1440)
      expect(size.height).toBe(720)
      // aspect = 2560/1440 = 1.778, width = 720 * 1.778 = 1280
      expect(size.width).toBe(1280)
    })

    it("original returns source dimensions (rounded even)", () => {
      const size = outputSize("original", 2560, 1440)
      expect(size.width).toBe(2560)
      expect(size.height).toBe(1440)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/compositor-layout.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement layout.ts**

```typescript
// src/lib/webgl-compositor/layout.ts

/** Normalized rect in 0-1 space */
export interface NRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Aspect-fit the screen recording inside the canvas with padding.
 * Returns normalized (0-1) origin and size.
 */
export function screenRect(
  canvasW: number,
  canvasH: number,
  recordingW: number,
  recordingH: number,
  paddingPercent: number
): NRect {
  const pad = canvasW * paddingPercent / 100
  const availW = canvasW - pad * 2
  const availH = canvasH - pad * 2
  const recAspect = recordingW / recordingH
  const availAspect = availW / availH

  let fitW: number, fitH: number
  if (recAspect > availAspect) {
    // Recording wider — fit by width
    fitW = availW
    fitH = availW / recAspect
  } else {
    // Recording taller — fit by height
    fitH = availH
    fitW = availH * recAspect
  }

  const originX = pad + (availW - fitW) / 2
  const originY = pad + (availH - fitH) / 2

  return {
    x: originX / canvasW,
    y: originY / canvasH,
    w: fitW / canvasW,
    h: fitH / canvasH,
  }
}

/**
 * Compute camera bubble position and size (normalized 0-1).
 * Camera is always square (sizePercent of canvas width).
 */
export function cameraRect(
  canvasW: number,
  canvasH: number,
  sizePercent: number,
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
): NRect {
  const size = canvasW * sizePercent / 100
  const margin = canvasW * 0.04

  let originX: number, originY: number
  switch (position) {
    case "bottom-right":
      originX = canvasW - margin - size
      originY = canvasH - margin - size
      break
    case "bottom-left":
      originX = margin
      originY = canvasH - margin - size
      break
    case "top-right":
      originX = canvasW - margin - size
      originY = margin
      break
    case "top-left":
      originX = margin
      originY = margin
      break
  }

  return {
    x: originX / canvasW,
    y: originY / canvasH,
    w: size / canvasW,
    h: size / canvasH,
  }
}

/** Compute output dimensions for a resolution preset. Width always even. */
export function outputSize(
  resolution: "original" | "4k" | "1080p" | "720p",
  recordingW: number,
  recordingH: number
): { width: number; height: number } {
  const targetH =
    resolution === "4k" ? 2160 :
    resolution === "1080p" ? 1080 :
    resolution === "720p" ? 720 :
    recordingH

  const aspect = recordingW / recordingH
  const w = Math.round(targetH * aspect / 2) * 2
  const h = resolution === "original" ? recordingH : targetH
  return { width: w, height: h }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/compositor-layout.test.ts`
Expected: PASS — all tests pass.

**Step 5: Commit**

```bash
git add src/lib/webgl-compositor/layout.ts src/__tests__/compositor-layout.test.ts
git commit -m "feat(compositor): add layout math for screen rect, camera, output sizing"
```

---

## Task 3: GLSL Shaders

**Files:**
- Create: `src/lib/webgl-compositor/shaders/quad.vert`
- Create: `src/lib/webgl-compositor/shaders/background.frag`
- Create: `src/lib/webgl-compositor/shaders/video.frag`
- Create: `src/lib/webgl-compositor/shaders/camera-bubble.frag`
- Create: `src/lib/webgl-compositor/shaders/cursor.frag`
- Create: `src/lib/webgl-compositor/shaders/click-ripple.frag`
- Create: `src/lib/webgl-compositor/shaders/motion-blur.frag`

**Context:** Port the Metal shader (`metalShaderSource` in `metal-compositor.swift`) to GLSL ES 3.0. The Metal shader is a single monolithic fragment shader with all layers inline. We split it into separate programs for clarity and to allow skipping disabled layers. Each fragment shader handles one visual layer.

**IMPORTANT:** All SDF functions, coordinate transforms, and visual effects must match the Metal implementation exactly. Reference the Metal shader source in `RekoEngine/Sources/RekoEngine/export/metal-compositor.swift` (embedded as `metalShaderSource` string literal around line 30).

**Step 1: Write the shared vertex shader**

```glsl
// src/lib/webgl-compositor/shaders/quad.vert
#version 300 es
precision highp float;

out vec2 v_uv;

void main() {
  // Fullscreen triangle (3 vertices, no vertex buffer needed)
  // Vertex 0: (-1, -1), Vertex 1: (3, -1), Vertex 2: (-1, 3)
  float x = float((gl_VertexID & 1) << 2) - 1.0;
  float y = float((gl_VertexID & 2) << 1) - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
  // UV: top-left = (0,0), bottom-right = (1,1)
  v_uv = vec2((x + 1.0) * 0.5, 1.0 - (y + 1.0) * 0.5);
}
```

**Step 2: Write background.frag**

```glsl
// src/lib/webgl-compositor/shaders/background.frag
#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform int u_type;           // 0=solid, 1=gradient, 2=image
uniform vec4 u_colorFrom;
uniform vec4 u_colorTo;
uniform float u_angleDeg;
uniform sampler2D u_bgImage;
uniform float u_hasBgImage;

void main() {
  if (u_type == 2 && u_hasBgImage > 0.5) {
    // Image background (pre-blurred at load time)
    fragColor = texture(u_bgImage, v_uv);
  } else if (u_type == 1) {
    // Linear gradient
    float rad = radians(u_angleDeg);
    vec2 dir = vec2(cos(rad), sin(rad));
    float t = dot(v_uv - 0.5, dir) + 0.5;
    t = clamp(t, 0.0, 1.0);
    fragColor = mix(u_colorFrom, u_colorTo, t);
  } else {
    // Solid color
    fragColor = u_colorFrom;
  }
}
```

**Step 3: Write video.frag**

This is the most complex shader — screen recording with zoom, rounded corners, and shadow. Must match Metal's `roundedRectSDF` and shadow layers.

```glsl
// src/lib/webgl-compositor/shaders/video.frag
#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_screen;
uniform vec2 u_screenOrigin;   // normalized origin of screen rect
uniform vec2 u_screenSize;     // normalized size of screen rect
uniform float u_borderRadius;  // pixels
uniform float u_hasShadow;
uniform float u_shadowIntensity;
uniform vec2 u_canvasSize;     // pixels (for px -> normalized conversion)

// Zoom
uniform vec2 u_zoomCenter;    // normalized 0-1 within screen
uniform float u_zoomScale;    // 1.0 = no zoom

float roundedRectSDF(vec2 p, vec2 center, vec2 halfSize, float radius) {
  vec2 d = abs(p - center) - halfSize + radius;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

void main() {
  fragColor = vec4(0.0); // transparent — blend over background

  vec2 screenCenter = u_screenOrigin + u_screenSize * 0.5;
  vec2 halfSize = u_screenSize * 0.5;
  float radiusNorm = u_borderRadius / u_canvasSize.x;

  // Shadow (3 layers, matching Metal)
  if (u_hasShadow > 0.5) {
    float shadowAlphas[3] = float[3](0.10, 0.15, 0.20);
    float shadowOffsetY[3] = float[3](4.0, 12.0, 24.0);
    float shadowBlur[3] = float[3](6.0, 24.0, 48.0);

    for (int i = 0; i < 3; i++) {
      vec2 offset = vec2(0.0, shadowOffsetY[i] / u_canvasSize.y);
      float blur = shadowBlur[i] / u_canvasSize.x;
      float d = roundedRectSDF(v_uv, screenCenter + offset, halfSize, radiusNorm);
      float shadowMask = 1.0 - smoothstep(-blur, blur, d);
      float alpha = shadowMask * shadowAlphas[i] * u_shadowIntensity;
      fragColor = vec4(0.0, 0.0, 0.0, alpha);
    }
  }

  // Screen content
  float d = roundedRectSDF(v_uv, screenCenter, halfSize, radiusNorm);
  if (d < 0.5 / u_canvasSize.x) {
    // Map pixel to screen-local UV (0-1)
    vec2 localUV = (v_uv - u_screenOrigin) / u_screenSize;
    // Apply zoom: crop around zoom center
    float invScale = 1.0 / u_zoomScale;
    localUV = u_zoomCenter + (localUV - u_zoomCenter) * invScale;
    // Clamp to prevent sampling outside
    localUV = clamp(localUV, 0.0, 1.0);

    vec4 screenColor = texture(u_screen, localUV);
    // Anti-aliased edge
    float aa = 1.0 - smoothstep(-0.5 / u_canvasSize.x, 0.5 / u_canvasSize.x, d);
    fragColor = vec4(screenColor.rgb, screenColor.a * aa);
  }
}
```

**Step 4: Write camera-bubble.frag**

```glsl
// src/lib/webgl-compositor/shaders/camera-bubble.frag
#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_camera;
uniform vec2 u_camOrigin;      // normalized
uniform vec2 u_camSize;        // normalized
uniform float u_isCircle;      // 1.0 = circle, 0.0 = rounded square
uniform float u_borderWidth;   // normalized (px / canvasWidth)
uniform vec4 u_borderColor;
uniform float u_cameraAspect;  // camera texture width/height
uniform float u_hasCamera;

float circleSDF(vec2 p, vec2 center, float radius) {
  return length(p - center) - radius;
}

float roundedRectSDF(vec2 p, vec2 center, vec2 halfSize, float radius) {
  vec2 d = abs(p - center) - halfSize + radius;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

void main() {
  fragColor = vec4(0.0);
  if (u_hasCamera < 0.5) return;

  vec2 center = u_camOrigin + u_camSize * 0.5;
  float radius = min(u_camSize.x, u_camSize.y) * 0.5;

  float d;
  if (u_isCircle > 0.5) {
    d = circleSDF(v_uv, center, radius);
  } else {
    float cornerR = radius * 0.2; // 20% corner radius for rounded square
    d = roundedRectSDF(v_uv, center, u_camSize * 0.5, cornerR);
  }

  // Border ring
  float outerD = d;
  float innerD = d + u_borderWidth;
  float borderMask = smoothstep(0.001, -0.001, outerD) * (1.0 - smoothstep(-0.001, 0.001, innerD));
  fragColor = u_borderColor * borderMask;

  // Camera texture (inside border)
  if (innerD < 0.001) {
    vec2 localUV = (v_uv - u_camOrigin) / u_camSize;
    // Object-cover: center-crop based on camera aspect vs bubble aspect
    float bubbleAspect = u_camSize.x / u_camSize.y;
    if (u_cameraAspect > bubbleAspect) {
      float scale = bubbleAspect / u_cameraAspect;
      localUV.x = 0.5 + (localUV.x - 0.5) / scale;
    } else {
      float scale = u_cameraAspect / bubbleAspect;
      localUV.y = 0.5 + (localUV.y - 0.5) / scale;
    }
    localUV = clamp(localUV, 0.0, 1.0);

    vec4 camColor = texture(u_camera, localUV);
    float mask = smoothstep(0.001, -0.001, innerD);
    fragColor = mix(fragColor, camColor, mask);
  }
}
```

**Step 5: Write cursor.frag**

```glsl
// src/lib/webgl-compositor/shaders/cursor.frag
#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_hasCursor;
uniform vec2 u_cursorPos;      // absolute normalized position on canvas
uniform float u_cursorRadius;  // normalized (px / canvasWidth)
uniform float u_isSpotlight;   // 1.0 = spotlight, 0.0 = highlight
uniform float u_cursorOpacity;
uniform vec4 u_cursorColor;

void main() {
  fragColor = vec4(0.0);
  if (u_hasCursor < 0.5) return;

  float dist = length(v_uv - u_cursorPos);

  if (u_isSpotlight > 0.5) {
    // Spotlight: darken everything outside radius
    float mask = smoothstep(u_cursorRadius * 0.8, u_cursorRadius * 1.2, dist);
    fragColor = vec4(0.0, 0.0, 0.0, mask * u_cursorOpacity * 0.6);
  } else {
    // Highlight: bright glow ring
    float ring = smoothstep(u_cursorRadius, u_cursorRadius * 0.6, dist);
    float core = smoothstep(u_cursorRadius * 0.3, 0.0, dist);
    float glow = ring * (1.0 - core * 0.5);
    fragColor = vec4(u_cursorColor.rgb, glow * u_cursorOpacity);
  }
}
```

**Step 6: Write click-ripple.frag**

```glsl
// src/lib/webgl-compositor/shaders/click-ripple.frag
#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_hasClick;
uniform vec2 u_clickPos;       // absolute normalized position on canvas
uniform float u_clickProgress; // 0-1
uniform float u_clickRadius;   // max radius normalized
uniform float u_clickOpacity;
uniform vec4 u_clickColor;

void main() {
  fragColor = vec4(0.0);
  if (u_hasClick < 0.5) return;

  float dist = length(v_uv - u_clickPos);

  // Radius grows from 30% to 100% over progress
  float currentRadius = u_clickRadius * mix(0.3, 1.0, u_clickProgress);
  float fade = 1.0 - u_clickProgress;

  // Ring
  float ringWidth = u_clickRadius * 0.08;
  float ring = smoothstep(ringWidth, 0.0, abs(dist - currentRadius));

  // Inner fill (radial gradient)
  float fill = smoothstep(currentRadius, 0.0, dist) * 0.3;

  float alpha = (ring + fill) * fade * u_clickOpacity;
  fragColor = vec4(u_clickColor.rgb, alpha);
}
```

**Step 7: Write motion-blur.frag**

```glsl
// src/lib/webgl-compositor/shaders/motion-blur.frag
#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;
uniform vec2 u_velocity;       // direction + magnitude in UV space
uniform float u_intensity;     // 0 = disabled
uniform vec2 u_zoomCenter;     // for radial component

const int SAMPLES = 12;

void main() {
  if (u_intensity < 0.001) {
    fragColor = texture(u_scene, v_uv);
    return;
  }

  // Combine directional (pan) and radial (zoom) blur
  vec2 toCenter = v_uv - u_zoomCenter;
  vec2 radialVelocity = toCenter * u_intensity;
  vec2 totalVelocity = u_velocity + radialVelocity;

  vec4 color = vec4(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float t = float(i) / float(SAMPLES) - 0.5;
    vec2 offset = totalVelocity * t;
    color += texture(u_scene, v_uv + offset);
  }
  fragColor = color / float(SAMPLES);
}
```

**Step 8: Verify build with shaders**

Run: `npm run build`
Expected: Build succeeds. Shaders are imported as strings via vite-plugin-glsl.

**Step 9: Commit**

```bash
git add src/lib/webgl-compositor/shaders/
git commit -m "feat(compositor): add GLSL shaders — background, video, camera, cursor, click, motion blur"
```

---

## Task 4: WebGLCompositor Class

**Files:**
- Create: `src/lib/webgl-compositor/compositor.ts`
- Create: `src/lib/webgl-compositor/index.ts`
- Create: `src/__tests__/compositor.test.ts`

**Context:** The main compositor class. Initializes WebGL2 context, compiles all shader programs, manages textures, and exposes a `render()` method. This is the single renderer shared by preview and export.

**Step 1: Write the test**

Test that the compositor initializes, can upload textures, and calls the right GL functions. Since we can't run real WebGL in jsdom, we test the public API with mocked GL.

```typescript
// src/__tests__/compositor.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// We test that the module exports correctly and the constructor validates.
// Full rendering tests require a real WebGL context (integration test).
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/compositor.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement compositor.ts**

```typescript
// src/lib/webgl-compositor/compositor.ts
import { compileShader, linkProgram, getUniform } from "./shader-utils"
import { screenRect, cameraRect, type NRect } from "./layout"
import type { Effects } from "@/types/editor"

import quadVert from "./shaders/quad.vert"
import backgroundFrag from "./shaders/background.frag"
import videoFrag from "./shaders/video.frag"
import cameraBubbleFrag from "./shaders/camera-bubble.frag"
import cursorFrag from "./shaders/cursor.frag"
import clickRippleFrag from "./shaders/click-ripple.frag"
import motionBlurFrag from "./shaders/motion-blur.frag"

export interface RenderParams {
  effects: Effects
  screenWidth: number
  screenHeight: number
  zoom: { x: number; y: number; scale: number }
  cursor?: { x: number; y: number } | null
  click?: { x: number; y: number; progress: number } | null
  motionBlur?: { dx: number; dy: number; intensity: number } | null
}

export class WebGLCompositor {
  private gl: WebGL2RenderingContext
  private canvasWidth = 0
  private canvasHeight = 0

  // Shader programs
  private bgProgram!: WebGLProgram
  private videoProgram!: WebGLProgram
  private cameraProgram!: WebGLProgram
  private cursorProgram!: WebGLProgram
  private clickProgram!: WebGLProgram
  private motionBlurProgram!: WebGLProgram

  // Textures
  private screenTexture: WebGLTexture | null = null
  private cameraTexture: WebGLTexture | null = null
  private bgImageTexture: WebGLTexture | null = null

  // FBO for motion blur (render layers to texture, then post-process)
  private fbo: WebGLFramebuffer | null = null
  private fboTexture: WebGLTexture | null = null

  // Vertex array for fullscreen triangle
  private vao!: WebGLVertexArrayObject

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // needed for VideoFrame capture
    })
    if (!gl) throw new Error("WebGL2 not available")
    this.gl = gl

    this.initPrograms()
    this.vao = gl.createVertexArray()!
  }

  configure(width: number, height: number): void {
    this.canvasWidth = width
    this.canvasHeight = height
    const gl = this.gl
    gl.viewport(0, 0, width, height)

    // Set canvas dimensions
    const canvas = gl.canvas
    if (canvas instanceof HTMLCanvasElement) {
      canvas.width = width
      canvas.height = height
    } else {
      // OffscreenCanvas
      (canvas as OffscreenCanvas).width = width;
      (canvas as OffscreenCanvas).height = height
    }

    // Create/recreate FBO for motion blur
    this.initFBO(width, height)
  }

  /** Upload a video frame or video element as the screen texture. */
  uploadScreen(source: HTMLVideoElement | VideoFrame): void {
    this.screenTexture = this.uploadToTexture(this.screenTexture, source)
  }

  /** Upload a video frame or video element as the camera texture. */
  uploadCamera(source: HTMLVideoElement | VideoFrame): void {
    this.cameraTexture = this.uploadToTexture(this.cameraTexture, source)
  }

  /** Load and optionally blur a background image. Call once at configure time. */
  async loadBackgroundImage(imageUrl: string, _blur: number): Promise<void> {
    const img = new Image()
    img.crossOrigin = "anonymous"
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`Failed to load background: ${imageUrl}`))
      img.src = imageUrl
    })

    // TODO: If blur > 0, apply Gaussian blur via multi-pass render-to-texture.
    // For now, upload the image directly. Blur support added in a later task.
    this.bgImageTexture = this.uploadToTexture(this.bgImageTexture, img)
  }

  /** Render all layers for the current frame. */
  render(params: RenderParams): void {
    const gl = this.gl
    const { effects, screenWidth, screenHeight, zoom, cursor, click, motionBlur } = params

    const useMotionBlur = motionBlur && motionBlur.intensity > 0.001
    if (useMotionBlur && this.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }

    gl.viewport(0, 0, this.canvasWidth, this.canvasHeight)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(this.vao)

    // Layer 1: Background
    this.renderBackground(effects)

    // Layer 2: Screen (with zoom, border radius, shadow)
    const scrRect = screenRect(
      this.canvasWidth, this.canvasHeight,
      screenWidth, screenHeight,
      effects.background.padding
    )
    this.renderScreen(effects, scrRect, zoom)

    // Layer 3: Camera bubble
    if (effects.cameraBubble.visible && this.cameraTexture) {
      const camRect = cameraRect(
        this.canvasWidth, this.canvasHeight,
        effects.cameraBubble.size,
        effects.cameraBubble.position
      )
      this.renderCamera(effects, camRect)
    }

    // Layer 4: Cursor
    if (effects.cursor.enabled && cursor) {
      this.renderCursor(effects, scrRect, zoom, cursor)
    }

    // Layer 5: Click ripple
    if (effects.cursor.clickHighlight?.enabled && click) {
      this.renderClick(effects, scrRect, zoom, click)
    }

    // Layer 6: Motion blur post-process
    if (useMotionBlur && this.fbo && this.fboTexture) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, this.canvasWidth, this.canvasHeight)
      this.renderMotionBlur(motionBlur!, zoom)
    }

    gl.bindVertexArray(null)
  }

  destroy(): void {
    const gl = this.gl
    gl.deleteProgram(this.bgProgram)
    gl.deleteProgram(this.videoProgram)
    gl.deleteProgram(this.cameraProgram)
    gl.deleteProgram(this.cursorProgram)
    gl.deleteProgram(this.clickProgram)
    gl.deleteProgram(this.motionBlurProgram)
    if (this.screenTexture) gl.deleteTexture(this.screenTexture)
    if (this.cameraTexture) gl.deleteTexture(this.cameraTexture)
    if (this.bgImageTexture) gl.deleteTexture(this.bgImageTexture)
    if (this.fbo) gl.deleteFramebuffer(this.fbo)
    if (this.fboTexture) gl.deleteTexture(this.fboTexture)
    gl.deleteVertexArray(this.vao)
  }

  // --- Private rendering methods ---

  private renderBackground(effects: Effects): void {
    const gl = this.gl
    const bg = effects.background
    gl.useProgram(this.bgProgram)

    const typeMap: Record<string, number> = {
      solid: 0, gradient: 1, image: 2, wallpaper: 2, custom: 2, preset: 1,
    }
    gl.uniform1i(getUniform(gl, this.bgProgram, "u_type"), typeMap[bg.type] ?? 0)
    gl.uniform4fv(getUniform(gl, this.bgProgram, "u_colorFrom"), hexToVec4(bg.color))
    gl.uniform4fv(getUniform(gl, this.bgProgram, "u_colorTo"), hexToVec4(bg.gradientTo))
    gl.uniform1f(getUniform(gl, this.bgProgram, "u_angleDeg"), bg.gradientAngle)

    const hasBgImage = this.bgImageTexture ? 1.0 : 0.0
    gl.uniform1f(getUniform(gl, this.bgProgram, "u_hasBgImage"), hasBgImage)
    if (this.bgImageTexture) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.bgImageTexture)
      gl.uniform1i(getUniform(gl, this.bgProgram, "u_bgImage"), 0)
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private renderScreen(effects: Effects, rect: NRect, zoom: RenderParams["zoom"]): void {
    const gl = this.gl
    if (!this.screenTexture) return
    gl.useProgram(this.videoProgram)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.screenTexture)
    gl.uniform1i(getUniform(gl, this.videoProgram, "u_screen"), 0)
    gl.uniform2f(getUniform(gl, this.videoProgram, "u_screenOrigin"), rect.x, rect.y)
    gl.uniform2f(getUniform(gl, this.videoProgram, "u_screenSize"), rect.w, rect.h)
    gl.uniform1f(getUniform(gl, this.videoProgram, "u_borderRadius"), effects.frame.borderRadius)
    gl.uniform1f(getUniform(gl, this.videoProgram, "u_hasShadow"), effects.frame.shadow ? 1.0 : 0.0)
    gl.uniform1f(getUniform(gl, this.videoProgram, "u_shadowIntensity"), effects.frame.shadowIntensity)
    gl.uniform2f(getUniform(gl, this.videoProgram, "u_canvasSize"), this.canvasWidth, this.canvasHeight)
    gl.uniform2f(getUniform(gl, this.videoProgram, "u_zoomCenter"), zoom.x, zoom.y)
    gl.uniform1f(getUniform(gl, this.videoProgram, "u_zoomScale"), zoom.scale)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private renderCamera(effects: Effects, rect: NRect): void {
    const gl = this.gl
    if (!this.cameraTexture) return
    gl.useProgram(this.cameraProgram)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.cameraTexture)
    gl.uniform1i(getUniform(gl, this.cameraProgram, "u_camera"), 0)
    gl.uniform2f(getUniform(gl, this.cameraProgram, "u_camOrigin"), rect.x, rect.y)
    gl.uniform2f(getUniform(gl, this.cameraProgram, "u_camSize"), rect.w, rect.h)
    gl.uniform1f(getUniform(gl, this.cameraProgram, "u_isCircle"), effects.cameraBubble.shape === "circle" ? 1.0 : 0.0)
    gl.uniform1f(getUniform(gl, this.cameraProgram, "u_borderWidth"), effects.cameraBubble.borderWidth / this.canvasWidth)
    gl.uniform4fv(getUniform(gl, this.cameraProgram, "u_borderColor"), hexToVec4(effects.cameraBubble.borderColor))
    gl.uniform1f(getUniform(gl, this.cameraProgram, "u_cameraAspect"), 16 / 9) // TODO: get from video track
    gl.uniform1f(getUniform(gl, this.cameraProgram, "u_hasCamera"), 1.0)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private renderCursor(
    effects: Effects,
    scrRect: NRect,
    zoom: RenderParams["zoom"],
    cursor: { x: number; y: number }
  ): void {
    const gl = this.gl
    gl.useProgram(this.cursorProgram)

    // Transform cursor position through screen rect + zoom
    const cx = scrRect.x + (scrRect.w * (zoom.x + (cursor.x - zoom.x) * zoom.scale))
    const cy = scrRect.y + (scrRect.h * (zoom.y + (cursor.y - zoom.y) * zoom.scale))

    gl.uniform1f(getUniform(gl, this.cursorProgram, "u_hasCursor"), 1.0)
    gl.uniform2f(getUniform(gl, this.cursorProgram, "u_cursorPos"), cx, cy)
    gl.uniform1f(getUniform(gl, this.cursorProgram, "u_cursorRadius"), effects.cursor.size / this.canvasWidth * zoom.scale)
    gl.uniform1f(getUniform(gl, this.cursorProgram, "u_isSpotlight"), effects.cursor.type === "spotlight" ? 1.0 : 0.0)
    gl.uniform1f(getUniform(gl, this.cursorProgram, "u_cursorOpacity"), effects.cursor.opacity)
    gl.uniform4fv(getUniform(gl, this.cursorProgram, "u_cursorColor"), hexToVec4(effects.cursor.color))

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private renderClick(
    effects: Effects,
    scrRect: NRect,
    zoom: RenderParams["zoom"],
    click: { x: number; y: number; progress: number }
  ): void {
    const gl = this.gl
    const clickCfg = effects.cursor.clickHighlight
    gl.useProgram(this.clickProgram)

    const cx = scrRect.x + (scrRect.w * (zoom.x + (click.x - zoom.x) * zoom.scale))
    const cy = scrRect.y + (scrRect.h * (zoom.y + (click.y - zoom.y) * zoom.scale))

    gl.uniform1f(getUniform(gl, this.clickProgram, "u_hasClick"), 1.0)
    gl.uniform2f(getUniform(gl, this.clickProgram, "u_clickPos"), cx, cy)
    gl.uniform1f(getUniform(gl, this.clickProgram, "u_clickProgress"), click.progress)
    gl.uniform1f(getUniform(gl, this.clickProgram, "u_clickRadius"), clickCfg.size / this.canvasWidth * zoom.scale)
    gl.uniform1f(getUniform(gl, this.clickProgram, "u_clickOpacity"), clickCfg.opacity)
    gl.uniform4fv(getUniform(gl, this.clickProgram, "u_clickColor"), hexToVec4(clickCfg.color))

    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private renderMotionBlur(
    mb: { dx: number; dy: number; intensity: number },
    zoom: RenderParams["zoom"]
  ): void {
    const gl = this.gl
    gl.useProgram(this.motionBlurProgram)
    gl.disable(gl.BLEND)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.fboTexture!)
    gl.uniform1i(getUniform(gl, this.motionBlurProgram, "u_scene"), 0)
    gl.uniform2f(getUniform(gl, this.motionBlurProgram, "u_velocity"), mb.dx, mb.dy)
    gl.uniform1f(getUniform(gl, this.motionBlurProgram, "u_intensity"), mb.intensity)
    gl.uniform2f(getUniform(gl, this.motionBlurProgram, "u_zoomCenter"), zoom.x, zoom.y)

    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.enable(gl.BLEND)
  }

  // --- Private helpers ---

  private initPrograms(): void {
    const gl = this.gl
    const vs = compileShader(gl, gl.VERTEX_SHADER, quadVert)
    this.bgProgram = linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, backgroundFrag))
    this.videoProgram = linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, videoFrag))
    this.cameraProgram = linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, cameraBubbleFrag))
    this.cursorProgram = linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, cursorFrag))
    this.clickProgram = linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, clickRippleFrag))
    this.motionBlurProgram = linkProgram(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, motionBlurFrag))
  }

  private initFBO(width: number, height: number): void {
    const gl = this.gl
    if (this.fbo) gl.deleteFramebuffer(this.fbo)
    if (this.fboTexture) gl.deleteTexture(this.fboTexture)

    this.fboTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.fboTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTexture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private uploadToTexture(
    existing: WebGLTexture | null,
    source: HTMLVideoElement | VideoFrame | HTMLImageElement
  ): WebGLTexture {
    const gl = this.gl
    const tex = existing ?? gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
    if (!existing) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    return tex
  }
}

// --- Utility ---

function hexToVec4(hex: string): Float32Array {
  const h = hex.replace("#", "")
  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255
  return new Float32Array([r, g, b, 1.0])
}
```

**Step 4: Create barrel export**

```typescript
// src/lib/webgl-compositor/index.ts
export { WebGLCompositor, type RenderParams } from "./compositor"
export { screenRect, cameraRect, outputSize, type NRect } from "./layout"
```

**Step 5: Run tests**

Run: `npx vitest run src/__tests__/compositor.test.ts`
Expected: PASS.

**Step 6: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add src/lib/webgl-compositor/
git commit -m "feat(compositor): WebGLCompositor class with 6-layer rendering pipeline"
```

---

## Task 5: Preview Pipeline — Rewrite usePreviewRenderer Hook

**Files:**
- Modify: `src/hooks/use-preview-renderer.ts`
- Modify: `src/components/editor/preview-canvas.tsx`
- Modify: `src/__tests__/preview-canvas.test.tsx`

**Context:** Replace the Tauri IPC-based preview renderer with the WebGL compositor. The hook creates a `WebGLCompositor`, uploads `<video>` frames as textures each RAF, and renders directly. No IPC per frame. The `<canvas>` becomes a WebGL canvas instead of 2D.

**Step 1: Rewrite use-preview-renderer.ts**

```typescript
// src/hooks/use-preview-renderer.ts
import { useRef, useCallback, useEffect, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { sequenceTimeToSourceTime } from "@/lib/sequence"
import { WebGLCompositor, outputSize, type RenderParams } from "@/lib/webgl-compositor"
import { assetUrl } from "@/lib/asset-url"

interface PreviewDimensions {
  width: number
  height: number
}

export function usePreviewRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  screenVideoRef: React.RefObject<HTMLVideoElement | null>,
  cameraVideoRef: React.RefObject<HTMLVideoElement | null>
) {
  const project = useEditorStore((s) => s.project)
  const effects = useEditorStore((s) => s.project?.effects)
  const currentTime = useEditorStore((s) => s.currentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)
  const compositorRef = useRef<WebGLCompositor | null>(null)
  const effectsRef = useRef(effects)
  effectsRef.current = effects
  const [dims, setDims] = useState<PreviewDimensions | null>(null)

  // Initialize compositor on project load
  useEffect(() => {
    if (!project?.id || !canvasRef.current) return

    // Probe screen video for dimensions
    const screenVideo = screenVideoRef.current
    if (!screenVideo) return

    const onLoaded = () => {
      const recordingW = screenVideo.videoWidth
      const recordingH = screenVideo.videoHeight
      if (!recordingW || !recordingH) return

      const size = outputSize("1080p", recordingW, recordingH)
      setDims(size)

      try {
        const comp = new WebGLCompositor(canvasRef.current!)
        comp.configure(size.width, size.height)

        // Load background image if configured
        const bg = effectsRef.current?.background
        if (bg?.imageUrl) {
          comp.loadBackgroundImage(assetUrl(bg.imageUrl), bg.imageBlur ?? 0)
        }

        compositorRef.current = comp
      } catch (e) {
        console.error("WebGL compositor init failed:", e)
      }
    }

    if (screenVideo.readyState >= 1) {
      onLoaded()
    } else {
      screenVideo.addEventListener("loadedmetadata", onLoaded, { once: true })
    }

    return () => {
      compositorRef.current?.destroy()
      compositorRef.current = null
    }
  }, [project?.id, canvasRef, screenVideoRef, cameraVideoRef])

  // Reload background image when it changes
  useEffect(() => {
    const bg = effects?.background
    if (compositorRef.current && bg?.imageUrl) {
      compositorRef.current.loadBackgroundImage(assetUrl(bg.imageUrl), bg.imageBlur ?? 0)
    }
  }, [effects?.background?.imageUrl, effects?.background?.imageBlur])

  // Map sequence time to source time + zoom events
  const mapTime = useCallback((seqTimeMs: number) => {
    const sequence = useEditorStore.getState().project?.sequence
    if (!sequence || sequence.clips.length === 0) {
      return { sourceTimeMs: seqTimeMs, zoomEvents: [] as import("@/types/editor").ZoomEvent[] }
    }
    const mapping = sequenceTimeToSourceTime(seqTimeMs, sequence.clips, sequence.transitions)
    if (!mapping) {
      return { sourceTimeMs: seqTimeMs, zoomEvents: [] as import("@/types/editor").ZoomEvent[] }
    }
    const clip = sequence.clips[mapping.clipIndex]
    return {
      sourceTimeMs: mapping.sourceTime,
      zoomEvents: clip.zoomEvents ?? [],
    }
  }, [])

  // Render one frame using the compositor
  const renderFrame = useCallback(() => {
    const comp = compositorRef.current
    const screenVideo = screenVideoRef.current
    const effects = effectsRef.current
    if (!comp || !screenVideo || !effects) return

    const state = useEditorStore.getState()
    const { sourceTimeMs, zoomEvents } = mapTime(state.currentTime)

    // Upload video frames as textures
    if (screenVideo.readyState >= 2) {
      comp.uploadScreen(screenVideo)
    }

    const cameraVideo = cameraVideoRef.current
    if (cameraVideo && cameraVideo.readyState >= 2) {
      comp.uploadCamera(cameraVideo)
    }

    // Compute zoom state
    let zoom = { x: 0.5, y: 0.5, scale: 1 }
    if (zoomEvents.length > 0) {
      zoom = interpolateZoomEvents(zoomEvents, sourceTimeMs)
    }

    // Compute cursor/click from mouse events
    const mouseEvents = state.project?.mouseEvents
    const cursor = mouseEvents ? cursorAt(mouseEvents, sourceTimeMs) : null
    const click = mouseEvents ? clickAt(mouseEvents, sourceTimeMs) : null

    comp.render({
      effects,
      screenWidth: screenVideo.videoWidth,
      screenHeight: screenVideo.videoHeight,
      zoom,
      cursor,
      click,
    })
  }, [screenVideoRef, cameraVideoRef, mapTime])

  // Scrubbing: render when currentTime changes (not during playback)
  useEffect(() => {
    if (!isPlaying) {
      const { sourceTimeMs } = mapTime(currentTime)
      const screenVideo = screenVideoRef.current
      if (screenVideo) {
        screenVideo.currentTime = sourceTimeMs / 1000
        // Render after seek completes
        const onSeeked = () => renderFrame()
        screenVideo.addEventListener("seeked", onSeeked, { once: true })
      }
    }
  }, [currentTime, isPlaying, renderFrame, mapTime, screenVideoRef])

  // Effects change: re-render current frame
  useEffect(() => {
    renderFrame()
  }, [effects, renderFrame])

  // Playback loop: render as fast as possible via RAF
  useEffect(() => {
    if (!isPlaying) return
    let running = true
    const tick = () => {
      if (!running) return
      renderFrame()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => { running = false }
  }, [isPlaying, renderFrame])

  return { dims }
}

// --- Zoom interpolation (matches ExportMath.interpolateZoomEvents in Swift) ---

function interpolateZoomEvents(
  events: Array<{ timeMs: number; durationMs: number; x: number; y: number; scale: number }>,
  sourceTimeMs: number
): { x: number; y: number; scale: number } {
  // Find active event: last event where timeMs <= sourceTimeMs
  let active: typeof events[0] | null = null
  for (const e of events) {
    if (e.timeMs <= sourceTimeMs) active = e
    else break
  }
  if (!active) return { x: 0.5, y: 0.5, scale: 1 }

  const elapsed = sourceTimeMs - active.timeMs
  if (elapsed >= active.durationMs) {
    return { x: active.x, y: active.y, scale: active.scale }
  }

  // Ease in-out
  const t = elapsed / active.durationMs
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

  // Interpolate from neutral (0.5, 0.5, 1.0) to target
  return {
    x: 0.5 + (active.x - 0.5) * eased,
    y: 0.5 + (active.y - 0.5) * eased,
    scale: 1 + (active.scale - 1) * eased,
  }
}

// --- Mouse cursor/click helpers ---

interface MouseEvt {
  timeMs: number
  x: number
  y: number
  type: string
}

function cursorAt(events: MouseEvt[], timeMs: number): { x: number; y: number } | null {
  if (!events.length) return null
  let lo = 0, hi = events.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (events[mid].timeMs <= timeMs) lo = mid; else hi = mid - 1
  }
  if (events[lo].timeMs > timeMs) return null
  return { x: events[lo].x, y: events[lo].y }
}

function clickAt(events: MouseEvt[], timeMs: number): { x: number; y: number; progress: number } | null {
  if (!events.length) return null
  let lo = 0, hi = events.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (events[mid].timeMs <= timeMs) lo = mid; else hi = mid - 1
  }
  if (events[lo].timeMs > timeMs) return null
  const clickDuration = 500
  for (let i = lo; i >= 0; i--) {
    const e = events[i]
    if (timeMs - e.timeMs > clickDuration) break
    if (e.type === "click" || e.type === "rightClick") {
      const elapsed = timeMs - e.timeMs
      return { x: e.x, y: e.y, progress: Math.min(1, elapsed / clickDuration) }
    }
  }
  return null
}
```

**Step 2: Rewrite preview-canvas.tsx**

```typescript
// src/components/editor/preview-canvas.tsx
import { useRef, useEffect } from "react"
import { usePreviewRenderer } from "@/hooks/use-preview-renderer"
import { useEditorStore } from "@/stores/editor-store"
import { assetUrl } from "@/lib/asset-url"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const cameraVideoRef = useRef<HTMLVideoElement>(null)
  const micRef = useRef<HTMLAudioElement>(null)
  const systemAudioRef = useRef<HTMLAudioElement>(null)

  const { dims } = usePreviewRenderer(canvasRef, screenVideoRef, cameraVideoRef)

  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)

  // Sync audio on seek (when not playing)
  useEffect(() => {
    if (isPlaying || !project?.sequence) return
    const mapping = sequenceTimeToSourceTime(
      currentTime, project.sequence.clips, project.sequence.transitions
    )
    if (mapping) {
      const sourceTimeSec = mapping.sourceTime / 1000
      if (micRef.current) micRef.current.currentTime = sourceTimeSec
      if (systemAudioRef.current) systemAudioRef.current.currentTime = sourceTimeSec
    }
  }, [currentTime, isPlaying, project?.sequence])

  // Play/pause audio
  useEffect(() => {
    const audios = [micRef.current, systemAudioRef.current].filter(Boolean) as HTMLAudioElement[]
    if (isPlaying && project?.sequence) {
      const mapping = sequenceTimeToSourceTime(
        useEditorStore.getState().currentTime,
        project.sequence.clips, project.sequence.transitions
      )
      if (mapping) {
        const clip = project.sequence.clips[mapping.clipIndex]
        const sourceTimeSec = mapping.sourceTime / 1000
        audios.forEach((a) => {
          a.currentTime = sourceTimeSec
          a.playbackRate = clip.speed
          a.play().catch(() => {})
        })
      }
    } else {
      audios.forEach((a) => a.pause())
    }
  }, [isPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null

  return (
    <div
      className="relative w-full overflow-hidden ring-1 ring-white/5 select-none"
      style={{
        borderRadius: 8,
        aspectRatio: dims ? `${dims.width} / ${dims.height}` : "16 / 9",
      }}
    >
      <canvas
        ref={canvasRef}
        width={dims?.width ?? 1280}
        height={dims?.height ?? 720}
        className="w-full h-full"
      />
      {/* Hidden video elements — used as texture sources for WebGL */}
      <video
        ref={screenVideoRef}
        src={assetUrl(project.tracks.screen)}
        preload="auto"
        muted
        playsInline
        className="hidden"
      />
      {project.tracks.camera && (
        <video
          ref={cameraVideoRef}
          src={assetUrl(project.tracks.camera)}
          preload="auto"
          muted
          playsInline
          className="hidden"
        />
      )}
      {/* Hidden audio elements for preview playback */}
      {project.tracks.mic && (
        <audio ref={micRef} src={assetUrl(project.tracks.mic)} preload="auto" />
      )}
      {project.tracks.system_audio && (
        <audio ref={systemAudioRef} src={assetUrl(project.tracks.system_audio)} preload="auto" />
      )}
    </div>
  )
}
```

**Step 3: Update the test**

```typescript
// src/__tests__/preview-canvas.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { PreviewCanvas } from "@/components/editor/preview-canvas"
import { useEditorStore } from "@/stores/editor-store"
import type { EditorProject } from "@/types/editor"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: (path: string) => `asset://${path}`,
}))

const MOCK_PROJECT: EditorProject = {
  id: "test-1",
  name: "Test",
  created_at: 0,
  tracks: { screen: "/screen.mov", mic: "/mic.wav", system_audio: null, camera: null, mouse_events: null },
  timeline: { duration_ms: 10000, in_point: 0, out_point: 10000 },
  effects: {
    background: { type: "solid", color: "#000", gradientFrom: "#000", gradientTo: "#111", gradientAngle: 135, padding: 8, presetId: null },
    cameraBubble: { visible: false, position: "bottom-right", size: 15, shape: "circle", borderWidth: 3, borderColor: "#fff" },
    frame: { borderRadius: 12, shadow: true, shadowIntensity: 0.5 },
    cursor: { enabled: false, type: "highlight", size: 40, color: "#ffcc00", opacity: 0.6 },
  },
}

describe("PreviewCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorStore.getState().loadProject({ ...MOCK_PROJECT })
  })

  it("renders a canvas element", () => {
    render(<PreviewCanvas />)
    const canvas = document.querySelector("canvas")
    expect(canvas).toBeTruthy()
  })

  it("renders hidden video element for screen track", () => {
    render(<PreviewCanvas />)
    const videos = document.querySelectorAll("video")
    expect(videos.length).toBe(1) // screen video
  })

  it("renders audio element when mic track exists", () => {
    render(<PreviewCanvas />)
    const audios = document.querySelectorAll("audio")
    expect(audios.length).toBe(1)
  })

  it("does not render audio when no audio tracks", () => {
    useEditorStore.getState().loadProject({
      ...MOCK_PROJECT,
      tracks: { ...MOCK_PROJECT.tracks, mic: null },
    })
    render(<PreviewCanvas />)
    const audios = document.querySelectorAll("audio")
    expect(audios.length).toBe(0)
  })

  it("returns null when no project", () => {
    useEditorStore.setState({ project: null })
    const { container } = render(<PreviewCanvas />)
    expect(container.innerHTML).toBe("")
  })
})
```

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

**Step 5: Build and verify**

Run: `npm run build`
Expected: Build succeeds.

**Step 6: Commit**

```bash
git add src/hooks/use-preview-renderer.ts src/components/editor/preview-canvas.tsx src/__tests__/preview-canvas.test.tsx
git commit -m "feat(preview): replace Metal IPC preview with WebGL compositor — 60fps, zero encoding"
```

---

## Task 6: Export Pipeline — Video Decoder

**Files:**
- Create: `src/lib/export/video-decoder.ts`
- Create: `src/__tests__/video-decoder.test.ts`

**Context:** Wraps mp4box.js for demuxing + WebCodecs VideoDecoder for frame-accurate decoding. Used by the export pipeline to decode source video frames sequentially. This replaces Swift's AVAssetReader.

**Step 1: Write the test**

```typescript
// src/__tests__/video-decoder.test.ts
import { describe, it, expect } from "vitest"

describe("VideoDecoderWrapper", () => {
  it("exports the wrapper class", async () => {
    const mod = await import("@/lib/export/video-decoder")
    expect(mod.VideoDecoderWrapper).toBeDefined()
  })
})
```

**Step 2: Run test — FAIL**

Run: `npx vitest run src/__tests__/video-decoder.test.ts`

**Step 3: Implement video-decoder.ts**

```typescript
// src/lib/export/video-decoder.ts
import MP4Box, { type MP4File, type MP4Info, type MP4Sample } from "mp4box"

/**
 * Demuxes an MP4/MOV file and decodes video frames sequentially using WebCodecs.
 * Provides frame-accurate access to decoded VideoFrame objects.
 */
export class VideoDecoderWrapper {
  private file: MP4File | null = null
  private decoder: VideoDecoder | null = null
  private samples: MP4Sample[] = []
  private frameQueue: VideoFrame[] = []
  private resolveFrame: ((frame: VideoFrame) => void) | null = null
  private configured = false

  /**
   * Initialize with a file path. Reads the file via fetch and demuxes it.
   * Returns video track info (width, height, duration).
   */
  async init(url: string): Promise<{ width: number; height: number; durationMs: number }> {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()

    return new Promise((resolve, reject) => {
      const file = MP4Box.createFile()
      this.file = file

      file.onReady = (info: MP4Info) => {
        const videoTrack = info.tracks.find((t) => t.type === "video")
        if (!videoTrack) {
          reject(new Error("No video track found"))
          return
        }

        // Configure decoder
        const decoder = new VideoDecoder({
          output: (frame: VideoFrame) => {
            if (this.resolveFrame) {
              const cb = this.resolveFrame
              this.resolveFrame = null
              cb(frame)
            } else {
              this.frameQueue.push(frame)
            }
          },
          error: (e: DOMException) => {
            console.error("VideoDecoder error:", e)
          },
        })

        const config: VideoDecoderConfig = {
          codec: videoTrack.codec,
          codedWidth: videoTrack.video?.width ?? videoTrack.track_width,
          codedHeight: videoTrack.video?.height ?? videoTrack.track_height,
          description: this.getDescription(file, videoTrack.id),
        }
        decoder.configure(config)
        this.decoder = decoder
        this.configured = true

        // Extract all samples
        file.setExtractionOptions(videoTrack.id, null, { nbSamples: Infinity })
        file.onSamples = (_id: number, _user: unknown, samples: MP4Sample[]) => {
          this.samples.push(...samples)
        }
        file.start()

        resolve({
          width: videoTrack.video?.width ?? videoTrack.track_width,
          height: videoTrack.video?.height ?? videoTrack.track_height,
          durationMs: (videoTrack.duration / videoTrack.timescale) * 1000,
        })
      }

      file.onError = (e: string) => reject(new Error(e))

      // Feed data to mp4box
      ;(arrayBuffer as MP4ArrayBuffer).fileStart = 0
      file.appendBuffer(arrayBuffer as MP4ArrayBuffer)
      file.flush()
    })
  }

  /** Decode the next sample and return a VideoFrame. Caller must call frame.close(). */
  async decodeNext(): Promise<VideoFrame | null> {
    if (!this.decoder || !this.configured) return null

    // Return queued frame if available
    if (this.frameQueue.length > 0) {
      return this.frameQueue.shift()!
    }

    // Feed next sample to decoder
    if (this.samples.length === 0) {
      await this.decoder.flush()
      return this.frameQueue.shift() ?? null
    }

    const sample = this.samples.shift()!
    const chunk = new EncodedVideoChunk({
      type: sample.is_sync ? "key" : "delta",
      timestamp: (sample.cts / sample.timescale) * 1_000_000, // microseconds
      duration: (sample.duration / sample.timescale) * 1_000_000,
      data: sample.data,
    })
    this.decoder.decode(chunk)

    // Wait for output
    return new Promise((resolve) => {
      if (this.frameQueue.length > 0) {
        resolve(this.frameQueue.shift()!)
      } else {
        this.resolveFrame = resolve
      }
    })
  }

  /** Get total number of samples (frames). */
  get totalFrames(): number {
    return this.samples.length
  }

  /** Clean up. */
  destroy(): void {
    this.decoder?.close()
    this.decoder = null
    this.file = null
    this.frameQueue.forEach((f) => f.close())
    this.frameQueue = []
  }

  private getDescription(file: MP4File, trackId: number): Uint8Array | undefined {
    const trak = file.getTrackById(trackId)
    if (!trak) return undefined

    const stsd = trak.mdia?.minf?.stbl?.stsd
    if (!stsd?.entries?.length) return undefined

    const entry = stsd.entries[0]
    const avcC = entry.avcC ?? entry.hvcC
    if (!avcC) return undefined

    const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN)
    avcC.write(stream)
    return new Uint8Array(stream.buffer, 8) // skip box header
  }
}

// mp4box requires fileStart property on ArrayBuffer
interface MP4ArrayBuffer extends ArrayBuffer {
  fileStart: number
}
```

**Step 4: Run test — PASS**

Run: `npx vitest run src/__tests__/video-decoder.test.ts`

**Step 5: Commit**

```bash
git add src/lib/export/video-decoder.ts src/__tests__/video-decoder.test.ts
git commit -m "feat(export): add WebCodecs VideoDecoder wrapper with mp4box.js demuxing"
```

---

## Task 7: Export Pipeline — Video Encoder + Muxer

**Files:**
- Create: `src/lib/export/video-encoder.ts`
- Create: `src/lib/export/muxer.ts`

**Context:** VideoEncoder wraps WebCodecs VideoEncoder for hardware H.264 encoding. Muxer wraps mp4-muxer for combining encoded video + audio into a .mp4 file.

**Step 1: Implement video-encoder.ts**

```typescript
// src/lib/export/video-encoder.ts

export interface EncoderConfig {
  width: number
  height: number
  bitrate: number
  fps: number
}

/**
 * Wraps WebCodecs VideoEncoder for hardware-accelerated H.264 encoding.
 * Collects EncodedVideoChunks for the muxer.
 */
export class VideoEncoderWrapper {
  private encoder: VideoEncoder | null = null
  private chunks: Array<{ chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }> = []
  private config: EncoderConfig | null = null

  async init(config: EncoderConfig): Promise<void> {
    this.config = config

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        this.chunks.push({ chunk, meta })
      },
      error: (e) => {
        console.error("VideoEncoder error:", e)
      },
    })

    this.encoder.configure({
      codec: "avc1.640028", // H.264 High Profile Level 4.0
      width: config.width,
      height: config.height,
      bitrate: config.bitrate,
      framerate: config.fps,
      hardwareAcceleration: "prefer-hardware",
    })
  }

  /** Encode a composited frame. Caller should create VideoFrame from canvas. */
  encode(frame: VideoFrame, keyFrame = false): void {
    if (!this.encoder) throw new Error("Encoder not initialized")
    this.encoder.encode(frame, { keyFrame })
    frame.close()
  }

  /** Flush remaining frames and return all encoded chunks. */
  async flush(): Promise<Array<{ chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }>> {
    if (!this.encoder) return []
    await this.encoder.flush()
    return this.chunks
  }

  destroy(): void {
    this.encoder?.close()
    this.encoder = null
    this.chunks = []
  }
}
```

**Step 2: Implement muxer.ts**

```typescript
// src/lib/export/muxer.ts
import { Muxer, ArrayBufferTarget } from "mp4-muxer"

export interface MuxerConfig {
  width: number
  height: number
  fps: number
}

/**
 * Wraps mp4-muxer to combine encoded video chunks (and optionally audio) into an .mp4 file.
 */
export class Mp4Muxer {
  private muxer: Muxer<ArrayBufferTarget> | null = null
  private target: ArrayBufferTarget | null = null

  init(config: MuxerConfig): void {
    this.target = new ArrayBufferTarget()
    this.muxer = new Muxer({
      target: this.target,
      video: {
        codec: "avc",
        width: config.width,
        height: config.height,
      },
      fastStart: "in-memory",
    })
  }

  /** Add an encoded video chunk. */
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    if (!this.muxer) throw new Error("Muxer not initialized")
    this.muxer.addVideoChunk(chunk, meta)
  }

  /** Finalize and return the .mp4 as ArrayBuffer. */
  finalize(): ArrayBuffer {
    if (!this.muxer || !this.target) throw new Error("Muxer not initialized")
    this.muxer.finalize()
    return this.target.buffer
  }

  destroy(): void {
    this.muxer = null
    this.target = null
  }
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/lib/export/video-encoder.ts src/lib/export/muxer.ts
git commit -m "feat(export): add WebCodecs VideoEncoder and mp4-muxer wrappers"
```

---

## Task 8: Export Pipeline — Orchestrator

**Files:**
- Create: `src/lib/export/export-pipeline.ts`
- Create: `src/hooks/use-export.ts`

**Context:** The orchestrator drives the full export: decode → render → encode → mux. It iterates through the sequence model frame-by-frame, uses the WebGL compositor to render each frame, captures via `VideoFrame(canvas)`, encodes, and muxes into the final .mp4. Progress is reported via callback.

**Step 1: Implement export-pipeline.ts**

```typescript
// src/lib/export/export-pipeline.ts
import { WebGLCompositor, outputSize, type RenderParams } from "@/lib/webgl-compositor"
import { VideoDecoderWrapper } from "./video-decoder"
import { VideoEncoderWrapper } from "./video-encoder"
import { Mp4Muxer } from "./muxer"
import { assetUrl } from "@/lib/asset-url"
import type { EditorProject, ExportConfig, ExportProgress } from "@/types/editor"
import { sequenceTimeToSourceTime, getSequenceDuration } from "@/lib/sequence"

export interface ExportCallbacks {
  onProgress: (progress: ExportProgress) => void
  onComplete: (mp4Data: ArrayBuffer) => void
  onError: (error: string) => void
}

export class ExportPipeline {
  private cancelled = false
  private compositor: WebGLCompositor | null = null
  private decoder: VideoDecoderWrapper | null = null
  private encoder: VideoEncoderWrapper | null = null
  private muxer: Mp4Muxer | null = null

  async run(
    project: EditorProject,
    exportConfig: ExportConfig,
    callbacks: ExportCallbacks
  ): Promise<void> {
    const startTime = performance.now()
    const fps = 30

    try {
      // 1. Compute output dimensions
      // We need the screen video dimensions — decode first frame to get them
      this.decoder = new VideoDecoderWrapper()
      const videoInfo = await this.decoder.init(assetUrl(project.tracks.screen))
      const size = outputSize(exportConfig.resolution, videoInfo.width, videoInfo.height)

      // 2. Init compositor on offscreen canvas
      const canvas = new OffscreenCanvas(size.width, size.height)
      this.compositor = new WebGLCompositor(canvas as unknown as HTMLCanvasElement)
      this.compositor.configure(size.width, size.height)

      // Load background image
      if (project.effects.background.imageUrl) {
        await this.compositor.loadBackgroundImage(
          assetUrl(project.effects.background.imageUrl),
          project.effects.background.imageBlur ?? 0
        )
      }

      // 3. Init encoder + muxer
      this.encoder = new VideoEncoderWrapper()
      await this.encoder.init({
        width: size.width,
        height: size.height,
        bitrate: exportConfig.bitrate,
        fps,
      })

      this.muxer = new Mp4Muxer()
      this.muxer.init({ width: size.width, height: size.height, fps })

      // 4. Iterate through sequence frames
      const sequence = project.sequence
      const seqDurationMs = getSequenceDuration(sequence.clips, sequence.transitions)
      const frameIntervalMs = 1000 / fps
      const totalFrames = Math.ceil(seqDurationMs / frameIntervalMs)
      let framesRendered = 0

      // TODO: This is a simplified loop — decode frames sequentially.
      // A production implementation should seek to the right frame for each clip.
      // For now, decode sequentially and use frames at the right timestamps.

      for (let seqTimeMs = 0; seqTimeMs < seqDurationMs; seqTimeMs += frameIntervalMs) {
        if (this.cancelled) break

        // Map sequence time to source time
        const mapping = sequenceTimeToSourceTime(seqTimeMs, sequence.clips, sequence.transitions)
        if (!mapping) continue

        const clip = sequence.clips[mapping.clipIndex]

        // Decode frame at source time
        const frame = await this.decoder.decodeNext()
        if (!frame) continue

        // Upload frame as screen texture
        this.compositor.uploadScreen(frame)
        frame.close()

        // Compute zoom state
        let zoom = { x: 0.5, y: 0.5, scale: 1 }
        if (clip.zoomEvents?.length) {
          zoom = interpolateZoom(clip.zoomEvents, mapping.sourceTime)
        }

        // Render composited frame
        this.compositor.render({
          effects: project.effects,
          screenWidth: videoInfo.width,
          screenHeight: videoInfo.height,
          zoom,
          cursor: null,  // TODO: load mouse events
          click: null,   // TODO: load mouse events
        })

        // Capture and encode
        const outputFrame = new VideoFrame(canvas, {
          timestamp: seqTimeMs * 1000, // microseconds
        })
        const isKeyFrame = framesRendered % (fps * 2) === 0 // keyframe every 2 seconds
        this.encoder.encode(outputFrame, isKeyFrame)

        framesRendered++
        const elapsed = performance.now() - startTime
        callbacks.onProgress({
          framesRendered,
          totalFrames,
          percentage: (framesRendered / totalFrames) * 100,
          elapsedMs: elapsed,
          estimatedRemainingMs: totalFrames > 0
            ? (elapsed / framesRendered) * (totalFrames - framesRendered)
            : null,
          phase: "compositing",
        })
      }

      if (this.cancelled) {
        callbacks.onProgress({ framesRendered, totalFrames, percentage: 0, elapsedMs: 0, estimatedRemainingMs: null, phase: "cancelled" })
        return
      }

      // 5. Flush encoder and mux
      callbacks.onProgress({ framesRendered, totalFrames, percentage: 99, elapsedMs: performance.now() - startTime, estimatedRemainingMs: 1000, phase: "finalizing" })

      const chunks = await this.encoder.flush()
      for (const { chunk, meta } of chunks) {
        this.muxer.addVideoChunk(chunk, meta)
      }

      // TODO: Add audio track (Task 9)

      const mp4Data = this.muxer.finalize()
      callbacks.onProgress({ framesRendered, totalFrames, percentage: 100, elapsedMs: performance.now() - startTime, estimatedRemainingMs: 0, phase: "done" })
      callbacks.onComplete(mp4Data)

    } catch (e) {
      callbacks.onError(String(e))
    } finally {
      this.cleanup()
    }
  }

  cancel(): void {
    this.cancelled = true
  }

  private cleanup(): void {
    this.compositor?.destroy()
    this.decoder?.destroy()
    this.encoder?.destroy()
    this.muxer?.destroy()
  }
}

// Same interpolation as in use-preview-renderer
function interpolateZoom(
  events: Array<{ timeMs: number; durationMs: number; x: number; y: number; scale: number }>,
  sourceTimeMs: number
): { x: number; y: number; scale: number } {
  let active: typeof events[0] | null = null
  for (const e of events) {
    if (e.timeMs <= sourceTimeMs) active = e
    else break
  }
  if (!active) return { x: 0.5, y: 0.5, scale: 1 }
  const elapsed = sourceTimeMs - active.timeMs
  if (elapsed >= active.durationMs) return { x: active.x, y: active.y, scale: active.scale }
  const t = elapsed / active.durationMs
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  return {
    x: 0.5 + (active.x - 0.5) * eased,
    y: 0.5 + (active.y - 0.5) * eased,
    scale: 1 + (active.scale - 1) * eased,
  }
}
```

**Step 2: Implement use-export.ts hook**

```typescript
// src/hooks/use-export.ts
import { useRef, useCallback, useState } from "react"
import { writeBinaryFile } from "@tauri-apps/plugin-fs"
import { useEditorStore } from "@/stores/editor-store"
import { ExportPipeline } from "@/lib/export/export-pipeline"
import type { ExportConfig, ExportProgress } from "@/types/editor"

export function useExport() {
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const pipelineRef = useRef<ExportPipeline | null>(null)

  const startExport = useCallback(async (exportConfig: ExportConfig) => {
    const project = useEditorStore.getState().project
    if (!project) throw new Error("No project loaded")

    const pipeline = new ExportPipeline()
    pipelineRef.current = pipeline

    await pipeline.run(project, exportConfig, {
      onProgress: setProgress,
      onComplete: async (mp4Data) => {
        // Write to disk via Tauri
        await writeBinaryFile(exportConfig.outputPath, new Uint8Array(mp4Data))
      },
      onError: (error) => {
        console.error("Export failed:", error)
        setProgress((p) => p ? { ...p, phase: "error" } : null)
      },
    })
  }, [])

  const cancelExport = useCallback(() => {
    pipelineRef.current?.cancel()
    pipelineRef.current = null
  }, [])

  return { progress, startExport, cancelExport }
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/lib/export/export-pipeline.ts src/hooks/use-export.ts
git commit -m "feat(export): WebCodecs export pipeline — decode, render, encode, mux"
```

---

## Task 9: Export Pipeline — Audio Encoding

**Files:**
- Create: `src/lib/export/audio-encoder.ts`
- Modify: `src/lib/export/muxer.ts` (add audio track support)
- Modify: `src/lib/export/export-pipeline.ts` (integrate audio)

**Context:** Decode audio files (WAV/M4A) via Web Audio API, trim per sequence, encode to AAC via WASM encoder, and add to the muxer. If the WASM AAC encoder package is unavailable or problematic, fall back to including raw audio (or add ffmpeg sidecar later).

**Step 1: Implement audio-encoder.ts**

```typescript
// src/lib/export/audio-encoder.ts

/**
 * Decode an audio file and return trimmed PCM samples.
 * Uses Web Audio API for decoding (supports WAV, M4A, MP3, etc.)
 */
export async function decodeAudio(
  url: string,
  startMs: number,
  endMs: number,
  sampleRate: number = 44100
): Promise<{ samples: Float32Array; channels: number; sampleRate: number }> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()

  const audioCtx = new OfflineAudioContext(2, 1, sampleRate)
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

  const startSample = Math.floor((startMs / 1000) * audioBuffer.sampleRate)
  const endSample = Math.floor((endMs / 1000) * audioBuffer.sampleRate)
  const length = endSample - startSample
  const channels = audioBuffer.numberOfChannels

  // Interleave channels
  const samples = new Float32Array(length * channels)
  for (let ch = 0; ch < channels; ch++) {
    const channelData = audioBuffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      samples[i * channels + ch] = channelData[startSample + i] ?? 0
    }
  }

  return { samples, channels, sampleRate: audioBuffer.sampleRate }
}

/**
 * Mix multiple audio tracks (additive mixing with clipping).
 */
export function mixAudioTracks(
  tracks: Float32Array[],
  channels: number
): Float32Array {
  if (tracks.length === 0) return new Float32Array(0)

  const maxLen = Math.max(...tracks.map((t) => t.length))
  const mixed = new Float32Array(maxLen)

  for (const track of tracks) {
    for (let i = 0; i < track.length; i++) {
      mixed[i] += track[i]
    }
  }

  // Clip to [-1, 1]
  for (let i = 0; i < mixed.length; i++) {
    mixed[i] = Math.max(-1, Math.min(1, mixed[i]))
  }

  return mixed
}
```

**Step 2: Add audio support to muxer.ts**

Add audio configuration to the muxer init and an `addAudioChunk` method. The `mp4-muxer` library supports adding raw audio data.

Update `src/lib/export/muxer.ts` to accept audio config in `init()` and expose `addAudioData()`. Refer to mp4-muxer documentation for the exact API. The muxer can accept raw PCM data if we configure it with `codec: "aac"` and use `AudioEncoder` or pass pre-encoded AAC chunks.

**NOTE:** The exact audio encoding approach depends on what WASM packages are available. If no suitable AAC encoder is found during Task 0, this task should use one of:
- `AudioEncoder` from WebCodecs (macOS 26+ only — check Safari version at runtime)
- A WASM AAC encoder package
- Write audio to a separate file and use Tauri/ffmpeg for muxing as a fallback

**Step 3: Integrate audio into export-pipeline.ts**

Add audio decoding + mixing after the video encoding loop. Decode mic and system_audio tracks, trim per sequence clips, mix, encode to AAC, add to muxer.

**Step 4: Verify build**

Run: `npm run build`

**Step 5: Commit**

```bash
git add src/lib/export/audio-encoder.ts src/lib/export/muxer.ts src/lib/export/export-pipeline.ts
git commit -m "feat(export): add audio decoding, mixing, and muxing support"
```

---

## Task 10: Wire Export UI to Web Pipeline

**Files:**
- Modify: `src/components/editor/export-button.tsx`
- Modify: `src/editor-app.tsx`

**Context:** Replace the Tauri IPC-based export flow (invoke `start_export` → poll `get_export_progress`) with the in-browser `useExport` hook. The export button UI stays the same — just the backend changes from Rust/Swift to WebCodecs.

**Step 1: Update ExportButton to use useExport hook**

Replace the `invoke("start_export", ...)` calls with `startExport(config)`. Replace the polling interval with the `progress` state from the hook. Replace `invoke("cancel_export")` with `cancelExport()`. Remove `invoke("finish_export")` — the hook handles cleanup.

The file save dialog stays (Tauri `save` from `@tauri-apps/plugin-dialog`). The `useExport` hook writes the mp4 data to the chosen path via `@tauri-apps/plugin-fs`.

**Step 2: Update editor-app.tsx if needed**

The `ExportButton` is self-contained, so `editor-app.tsx` may not need changes. However, ensure the `useExport` hook is available in the component tree. If `writeBinaryFile` requires Tauri `fs` plugin permissions, add them to `src-tauri/capabilities/default.json`.

**Step 3: Add Tauri fs plugin permission**

Check if `fs:default` or `fs:allow-write-binary-file` is in `src-tauri/capabilities/default.json`. If not, add it:

```json
{
  "permissions": [
    "fs:default",
    "fs:allow-write-binary-file"
  ]
}
```

**Step 4: Test the export flow manually**

Run: `npx tauri dev`
- Open a project in the editor
- Click Export → choose settings → Export
- Verify progress bar advances
- Verify .mp4 file is created at the chosen path
- Verify the video plays correctly in QuickTime

**Step 5: Commit**

```bash
git add src/components/editor/export-button.tsx src/editor-app.tsx
git commit -m "feat(export): wire ExportButton to WebCodecs pipeline — no more IPC export"
```

---

## Task 11: Remove Swift/Rust Preview + Export Code

**Files:**
- Delete: `src-tauri/src/commands/preview.rs`
- Modify: `src-tauri/src/commands/mod.rs` (remove `pub mod preview;`)
- Modify: `src-tauri/src/commands/export.rs` (gut to file I/O only — keep `get_home_dir`)
- Modify: `src-tauri/src/swift_ffi.rs` (remove preview + export FFI)
- Modify: `src-tauri/src/lib.rs` (remove preview + export commands from `generate_handler!`)
- Delete: `RekoEngine/Sources/RekoEngine/preview/preview-renderer.swift`
- Optionally keep: `RekoEngine/Sources/RekoEngine/export/` — can be deleted once web export is fully validated

**IMPORTANT:** Only do this task AFTER Tasks 5 and 10 are verified working in `npx tauri dev`. Keep Swift export code until the web export pipeline is fully validated with real recordings.

**Step 1: Remove preview command and FFI**

Remove `pub mod preview;` from `src-tauri/src/commands/mod.rs`.
Delete `src-tauri/src/commands/preview.rs`.
Remove `configure_preview`, `render_preview_frame`, `destroy_preview` from `lib.rs` handler macro.
Remove preview-related extern functions and wrappers from `swift_ffi.rs`.

**Step 2: Simplify export command**

Keep `get_home_dir` command. Remove `start_export`, `get_export_progress`, `cancel_export`, `finish_export` from `export.rs` and `lib.rs`.
Remove export-related extern functions from `swift_ffi.rs`.

**Step 3: Delete Swift preview renderer**

Delete `RekoEngine/Sources/RekoEngine/preview/preview-renderer.swift`.
Remove preview C API functions from `capi.swift` (`ck_preview_configure`, `ck_preview_frame`, `ck_preview_free_bytes`, `ck_preview_destroy` and the `activePreview`/`previewLock` globals).

**Step 4: Build and verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Run: `cd RekoEngine && swift build -c release`
Run: `npm run build`
Run: `npx vitest run`
All should succeed.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove Swift/Rust preview and export code — replaced by WebGL + WebCodecs"
```

---

## Task 12: Integration Testing

**Files:** No new files — manual testing with real recordings.

**Step 1: Test preview**

Run: `npx tauri dev`
- Open an existing recording in the editor
- Verify video appears in the preview canvas (not blank)
- Verify background (solid, gradient, wallpaper) renders correctly
- Verify camera bubble appears (if recording has camera track)
- Scrub the timeline — verify frames update smoothly
- Play the timeline — verify 60fps playback
- Change effects (padding, border radius, shadow) — verify preview updates
- Zoom keyframes — verify zoom animation works
- Cursor effects — verify cursor highlight/spotlight renders
- Click highlights — verify expanding ripple animation

**Step 2: Test export**

- Click Export → 1080p → High → Export
- Verify progress bar advances smoothly
- Open the exported .mp4 in QuickTime
- Verify video matches the preview exactly
- Verify audio is present and in sync (if audio tracks exist)
- Test different resolutions: 720p, 4K, Original

**Step 3: Visual comparison**

- Take a screenshot of the preview at a specific timestamp
- Take a screenshot of the exported video at the same timestamp
- Compare — they should be visually identical (same compositor)

**Step 4: Performance check**

- Preview: open Activity Monitor, verify WebKit process stays under 30% CPU during playback
- Export: time a 1-minute recording export at 1080p — should complete in under 30 seconds
