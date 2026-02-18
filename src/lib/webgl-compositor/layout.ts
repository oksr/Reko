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
  const padX = canvasW * paddingPercent / 100
  const padY = canvasH * paddingPercent / 100
  const availW = canvasW - padX * 2
  const availH = canvasH - padY * 2
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

  const originX = padX + (availW - fitW) / 2
  const originY = padY + (availH - fitH) / 2

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
