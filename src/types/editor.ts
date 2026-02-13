export interface EditorProject {
  id: string
  name: string
  created_at: number
  tracks: {
    screen: string
    mic: string | null
    system_audio: string | null
    camera: string | null
  }
  timeline: {
    duration_ms: number
    in_point: number
    out_point: number
  }
  effects: Effects
}

export interface Effects {
  background: BackgroundConfig
  cameraBubble: CameraBubbleConfig
  frame: FrameConfig
}

export interface BackgroundConfig {
  type: "solid" | "gradient" | "preset"
  color: string
  gradientFrom: string
  gradientTo: string
  gradientAngle: number
  padding: number
  presetId: string | null
}

export interface GradientPreset {
  id: string
  name: string
  from: string
  to: string
  angle: number
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "midnight", name: "Midnight", from: "#1a1a2e", to: "#16213e", angle: 135 },
  { id: "ocean", name: "Ocean", from: "#0f3443", to: "#34e89e", angle: 135 },
  { id: "sunset", name: "Sunset", from: "#f12711", to: "#f5af19", angle: 135 },
  { id: "lavender", name: "Lavender", from: "#834d9b", to: "#d04ed6", angle: 135 },
  { id: "forest", name: "Forest", from: "#0b486b", to: "#416d3d", angle: 135 },
  { id: "slate", name: "Slate", from: "#2c3e50", to: "#4ca1af", angle: 135 },
  { id: "ember", name: "Ember", from: "#cb2d3e", to: "#ef473a", angle: 135 },
  { id: "arctic", name: "Arctic", from: "#2193b0", to: "#6dd5ed", angle: 135 },
]

export interface CameraBubbleConfig {
  visible: boolean
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  size: number // percentage of canvas width (5-30)
  shape: "circle" | "rounded"
  borderWidth: number
  borderColor: string
}

export interface FrameConfig {
  borderRadius: number
  shadow: boolean
  shadowIntensity: number // 0-1
}

export interface ExportConfig {
  resolution: "original" | "1080p" | "720p"
  outputPath: string
}

export interface ExportProgress {
  framesRendered: number
  totalFrames: number
  percentage: number
  elapsedMs: number
  estimatedRemainingMs: number | null
  phase: "compositing" | "finalizing" | "done" | "cancelled" | "error"
}

export interface ExportResult {
  outputPath: string
  durationMs: number
  fileSizeBytes: number
}
