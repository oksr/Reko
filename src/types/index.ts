export interface DisplayInfo {
  id: number
  width: number
  height: number
  is_main: boolean
}

export interface AudioInputInfo {
  id: string
  name: string
}

export interface CameraInfo {
  id: string
  name: string
}

export interface RecordingConfig {
  display_id: number
  mic_id: string | null
  camera_id: string | null
  capture_system_audio: boolean
  fps: number
}

export interface ProjectState {
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
}
