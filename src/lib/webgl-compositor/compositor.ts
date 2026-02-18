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

  private bgProgram!: WebGLProgram
  private videoProgram!: WebGLProgram
  private cameraProgram!: WebGLProgram
  private cursorProgram!: WebGLProgram
  private clickProgram!: WebGLProgram
  private motionBlurProgram!: WebGLProgram

  private screenTexture: WebGLTexture | null = null
  private cameraTexture: WebGLTexture | null = null
  private bgImageTexture: WebGLTexture | null = null

  private fbo: WebGLFramebuffer | null = null
  private fboTexture: WebGLTexture | null = null

  private vao!: WebGLVertexArrayObject

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
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

    const canvas = gl.canvas
    if (canvas instanceof HTMLCanvasElement) {
      canvas.width = width
      canvas.height = height
    } else {
      (canvas as OffscreenCanvas).width = width;
      (canvas as OffscreenCanvas).height = height
    }

    this.initFBO(width, height)
  }

  uploadScreen(source: HTMLVideoElement | VideoFrame): void {
    this.screenTexture = this.uploadToTexture(this.screenTexture, source)
  }

  uploadCamera(source: HTMLVideoElement | VideoFrame): void {
    this.cameraTexture = this.uploadToTexture(this.cameraTexture, source)
  }

  async loadBackgroundImage(imageUrl: string, _blur: number): Promise<void> {
    const img = new Image()
    img.crossOrigin = "anonymous"
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`Failed to load background: ${imageUrl}`))
      img.src = imageUrl
    })
    this.bgImageTexture = this.uploadToTexture(this.bgImageTexture, img)
  }

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
    gl.uniform4fv(getUniform(gl, this.bgProgram, "u_colorFrom"), hexToVec4(bg.type === "gradient" || bg.type === "preset" ? bg.gradientFrom : bg.color))
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

function hexToVec4(hex: string): Float32Array {
  const h = hex.replace("#", "")
  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255
  return new Float32Array([r, g, b, 1.0])
}
