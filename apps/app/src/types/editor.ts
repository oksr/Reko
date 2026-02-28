export interface EditorProject {
  id: string
  name: string
  created_at: number
  tracks: {
    screen: string
    mic: string | null
    system_audio: string | null
    camera: string | null
    mouse_events: string | null
  }
  timeline: {
    duration_ms: number
    in_point: number
    out_point: number
  }
  effects: Effects
  sequence: Sequence
  autoZoomSettings?: AutoZoomSettings
}

export interface Effects {
  background: BackgroundConfig
  cameraBubble: CameraBubbleConfig
  frame: FrameConfig
  cursor: CursorConfig
}

export interface BackgroundConfig {
  type: "solid" | "gradient" | "preset" | "image" | "wallpaper" | "custom"
  color: string
  gradientFrom: string
  gradientTo: string
  gradientAngle: number
  padding: number
  presetId: string | null
  imageUrl: string | null
  imageBlur: number
  unsplashId: string | null
  unsplashAuthor: string | null
  wallpaperId: string | null
}

export interface WallpaperInfo {
  id: string
  name: string
  path: string
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
  shadow: boolean
  shadowIntensity: number // 0-1
}

export interface FrameConfig {
  borderRadius: number
  shadow: boolean
  shadowIntensity: number // 0-1
}

export type SystemCursorType = "arrow" | "pointer" | "ibeam"

export interface MouseEvent {
  timeMs: number
  x: number           // normalized 0-1 (fraction of screen width)
  y: number           // normalized 0-1 (fraction of screen height)
  type: "move" | "click" | "rightClick" | "scroll"
  cursor?: SystemCursorType  // system cursor type at this position (defaults to "arrow")
}

export interface ZoomEvent {
  id: string              // unique ID for selection/editing
  timeMs: number          // when the zoom starts (clip-relative)
  durationMs: number      // how long the zoom holds
  x: number               // normalized center (0-1)
  y: number               // normalized center (0-1)
  scale: number           // zoom factor (e.g. 2.0)
}

export interface AutoZoomSettings {
  zoomScale: number           // 1.5 - 3.0, default 2.0
}

export const DEFAULT_AUTO_ZOOM_SETTINGS: AutoZoomSettings = {
  zoomScale: 2.0,
}

export interface Clip {
  id: string
  sourceStart: number
  sourceEnd: number
  speed: number
  zoomEvents: ZoomEvent[]
}

export interface Transition {
  type: "cut" | "crossfade" | "dissolve" | "fade-through-black"
  durationMs: number
}

export interface OverlayTrack {
  id: string
  type: "webcam" | "text" | "image"
  locked: boolean
  visible: boolean
}

export interface Overlay {
  id: string
  trackId: string
  type: "webcam" | "text" | "image"
  startMs: number
  durationMs: number
  position: { x: number; y: number }
  size: { width: number; height: number }
  opacity: number
  linkedClipId?: string
}

export interface Sequence {
  clips: Clip[]
  transitions: (Transition | null)[] // length = clips.length - 1
  overlayTracks: OverlayTrack[]
  overlays: Overlay[]
}

export type CursorIcon =
  | "hand-pointer"
  | "outline-arrow"
  | "thick-arrow"
  | "filled-arrow"
  | "rounded-pointer"

export const CURSOR_ICONS: { id: CursorIcon; label: string }[] = [
  { id: "filled-arrow", label: "Default" },
  { id: "outline-arrow", label: "Outline" },
  { id: "thick-arrow", label: "Thick" },
  { id: "rounded-pointer", label: "Rounded" },
  { id: "hand-pointer", label: "Hand" },
]

export interface CursorConfig {
  enabled: boolean           // show custom cursor icon
  icon: CursorIcon
  size: number               // cursor icon size in px (16-64)
  highlightEnabled: boolean  // show highlight/spotlight effect (independent of icon)
  type: "highlight" | "spotlight"
  highlightSize: number      // effect radius in px
  color: string              // hex, used for highlight ring
  opacity: number            // 0-1
  clickHighlight: ClickHighlightConfig
}

export interface ClickHighlightConfig {
  enabled: boolean
  color: string       // hex
  opacity: number     // 0-1
  size: number        // max ripple radius in px (30-120)
}

export type ExportResolution = "original" | "4k" | "1080p" | "720p"
export type ExportQuality = "low" | "medium" | "high" | "best"

export interface ExportConfig {
  resolution: ExportResolution
  quality: ExportQuality
  bitrate: number
  outputPath: string
}

export const BITRATE_MAP: Record<ExportQuality, Record<string, number>> = {
  low:    { "720p": 5_000_000,  "1080p": 10_000_000, "4k": 25_000_000 },
  medium: { "720p": 10_000_000, "1080p": 15_000_000, "4k": 35_000_000 },
  high:   { "720p": 15_000_000, "1080p": 20_000_000, "4k": 50_000_000 },
  best:   { "720p": 20_000_000, "1080p": 30_000_000, "4k": 80_000_000 },
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
