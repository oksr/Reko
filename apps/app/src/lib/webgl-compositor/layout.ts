export interface NRect {
  x: number
  y: number
  w: number
  h: number
}

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
    fitW = availW
    fitH = availW / recAspect
  } else {
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

/**
 * Apply a canvas-space zoom transform to a screen rect.
 * Scales the rect by zoom.scale and translates so the zoom center
 * (in video UV space) maps to canvas center (0.5, 0.5).
 * At scale=1 the rect is returned unchanged.
 */
export function applyZoomToRect(
  base: NRect,
  zoom: { x: number; y: number; scale: number }
): NRect {
  if (zoom.scale <= 1) return base
  const newW = base.w * zoom.scale
  const newH = base.h * zoom.scale
  // Blend between base position and zoomed position based on how far
  // above 1.0 the scale is. This avoids a hard snap at scale=1.0 —
  // the zoom interpolation already drives position toward (0.5, 0.5)
  // as scale → 1.0, but this extra lerp ensures any residual offset
  // fades out smoothly in the last fraction of the transition.
  const zoomFactor = Math.min((zoom.scale - 1.0) / 0.1, 1.0) // 0→1 over scale 1.0→1.1
  const zoomedX = 0.5 - zoom.x * newW
  const zoomedY = 0.5 - zoom.y * newH
  return {
    x: base.x + (zoomedX - base.x) * zoomFactor,
    y: base.y + (zoomedY - base.y) * zoomFactor,
    w: newW,
    h: newH,
  }
}

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
