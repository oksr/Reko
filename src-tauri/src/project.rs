use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectState {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub tracks: Tracks,
    pub timeline: Timeline,
    #[serde(default)]
    pub effects: Option<Effects>,
    #[serde(default)]
    pub sequence: Option<Sequence>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Effects {
    pub background: BackgroundConfig,
    pub camera_bubble: CameraBubbleConfig,
    pub frame: FrameConfig,
    #[serde(default)]
    pub cursor: Option<CursorConfig>,
    #[serde(default)]
    pub zoom_keyframes: Option<Vec<ZoomKeyframe>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundConfig {
    #[serde(rename = "type")]
    pub bg_type: String,
    pub color: String,
    pub gradient_from: String,
    pub gradient_to: String,
    pub gradient_angle: f64,
    pub padding: f64,
    pub preset_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CameraBubbleConfig {
    pub visible: bool,
    pub position: String,
    pub size: f64,
    pub shape: String,
    pub border_width: f64,
    pub border_color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrameConfig {
    pub border_radius: f64,
    pub shadow: bool,
    pub shadow_intensity: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CursorConfig {
    pub enabled: bool,
    #[serde(rename = "type")]
    pub cursor_type: String,      // "highlight" | "spotlight"
    pub size: f64,                // px radius
    pub color: String,            // hex
    pub opacity: f64,             // 0-1
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ZoomKeyframe {
    pub time_ms: u64,
    pub x: f64,                   // 0-1 normalized
    pub y: f64,                   // 0-1 normalized
    pub scale: f64,               // 1.0 = no zoom
    pub easing: String,           // "ease-in-out" | "ease-in" | "ease-out" | "linear"
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub source_start: u64,
    pub source_end: u64,
    pub speed: f64,
    pub zoom_keyframes: Vec<ZoomKeyframe>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SequenceTransition {
    #[serde(rename = "type")]
    pub transition_type: String,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Sequence {
    pub clips: Vec<Clip>,
    pub transitions: Vec<Option<SequenceTransition>>,
    pub overlay_tracks: Vec<SequenceOverlayTrack>,
    pub overlays: Vec<SequenceOverlay>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SequenceOverlayTrack {
    pub id: String,
    #[serde(rename = "type")]
    pub track_type: String,
    pub locked: bool,
    pub visible: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SequenceOverlay {
    pub id: String,
    pub track_id: String,
    #[serde(rename = "type")]
    pub overlay_type: String,
    pub start_ms: u64,
    pub duration_ms: u64,
    pub position: OverlayPosition,
    pub size: OverlaySize,
    pub opacity: f64,
    pub linked_clip_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OverlayPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OverlaySize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    pub resolution: String,        // "original" | "1080p" | "720p"
    pub output_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub frames_rendered: u64,
    pub total_frames: u64,
    pub percentage: f64,
    pub elapsed_ms: u64,
    pub estimated_remaining_ms: Option<u64>,
    pub phase: String,             // "compositing" | "finalizing" | "done" | "cancelled" | "error"
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output_path: String,
    pub duration_ms: u64,
    pub file_size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tracks {
    pub screen: String,
    pub mic: Option<String>,
    pub system_audio: Option<String>,
    pub camera: Option<String>,
    #[serde(default)]
    pub mouse_events: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Timeline {
    pub duration_ms: u64,
    pub in_point: u64,
    pub out_point: u64,
}

pub fn projects_dir() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.capturekit.app")
        .join("projects");
    fs::create_dir_all(&dir).ok();
    dir
}

pub fn project_dir(id: &str) -> PathBuf {
    projects_dir().join(id)
}

pub fn raw_dir(id: &str) -> PathBuf {
    project_dir(id).join("raw")
}

pub fn save_project(project: &ProjectState) -> Result<(), String> {
    let dir = project_dir(&project.id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(project).map_err(|e| e.to_string())?;
    fs::write(dir.join("project.json"), json).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tracks_serialization_with_camera() {
        let tracks = Tracks {
            screen: "screen.mov".to_string(),
            mic: Some("mic.wav".to_string()),
            system_audio: None,
            camera: Some("camera.mov".to_string()),
            mouse_events: None,
        };
        let json = serde_json::to_string(&tracks).unwrap();
        let parsed: Tracks = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.camera, Some("camera.mov".to_string()));
    }

    #[test]
    fn test_project_state_with_effects_roundtrip() {
        let project = ProjectState {
            id: "test".to_string(),
            name: "Test".to_string(),
            created_at: 12345,
            tracks: Tracks {
                screen: "screen.mov".to_string(),
                mic: None,
                system_audio: None,
                camera: None,
                mouse_events: None,
            },
            timeline: Timeline {
                duration_ms: 5000,
                in_point: 0,
                out_point: 5000,
            },
            effects: Some(Effects {
                background: BackgroundConfig {
                    bg_type: "gradient".to_string(),
                    color: "#000".to_string(),
                    gradient_from: "#1a1a2e".to_string(),
                    gradient_to: "#16213e".to_string(),
                    gradient_angle: 135.0,
                    padding: 8.0,
                    preset_id: Some("midnight".to_string()),
                },
                camera_bubble: CameraBubbleConfig {
                    visible: true,
                    position: "bottom-right".to_string(),
                    size: 15.0,
                    shape: "circle".to_string(),
                    border_width: 3.0,
                    border_color: "#ffffff".to_string(),
                },
                frame: FrameConfig {
                    border_radius: 12.0,
                    shadow: true,
                    shadow_intensity: 0.5,
                },
                cursor: None,
                zoom_keyframes: None,
            }),
            sequence: None,
        };
        let json = serde_json::to_string(&project).unwrap();
        // Verify camelCase serialization
        assert!(json.contains("cameraBubble"));
        assert!(json.contains("gradientFrom"));
        assert!(json.contains("borderRadius"));
        assert!(json.contains("shadowIntensity"));
        // Round-trip
        let parsed: ProjectState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.effects.unwrap().frame.border_radius, 12.0);
    }

    #[test]
    fn test_project_state_without_effects_deserializes() {
        let json = r#"{"id":"t","name":"T","created_at":0,"tracks":{"screen":"s.mov","mic":null,"system_audio":null,"camera":null},"timeline":{"duration_ms":5000,"in_point":0,"out_point":5000}}"#;
        let parsed: ProjectState = serde_json::from_str(json).unwrap();
        assert!(parsed.effects.is_none());
    }

    #[test]
    fn test_tracks_serialization_without_camera() {
        let tracks = Tracks {
            screen: "screen.mov".to_string(),
            mic: None,
            system_audio: None,
            camera: None,
            mouse_events: None,
        };
        let json = serde_json::to_string(&tracks).unwrap();
        let parsed: Tracks = serde_json::from_str(&json).unwrap();
        assert!(parsed.camera.is_none());
    }

    #[test]
    fn test_cursor_config_serialization() {
        let config = CursorConfig {
            enabled: true,
            cursor_type: "highlight".to_string(),
            size: 40.0,
            color: "#ffcc00".to_string(),
            opacity: 0.6,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"type\":\"highlight\""));
        assert!(json.contains("\"opacity\":0.6"));
        let parsed: CursorConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.cursor_type, "highlight");
    }

    #[test]
    fn test_zoom_keyframe_serialization() {
        let kf = ZoomKeyframe {
            time_ms: 5000,
            x: 0.5,
            y: 0.3,
            scale: 2.0,
            easing: "ease-in-out".to_string(),
            duration_ms: 500,
        };
        let json = serde_json::to_string(&kf).unwrap();
        assert!(json.contains("\"timeMs\":5000"));
        assert!(json.contains("\"durationMs\":500"));
        let parsed: ZoomKeyframe = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.scale, 2.0);
    }

    #[test]
    fn test_effects_with_cursor_and_zoom() {
        let json = r##"{"background":{"type":"solid","color":"#000","gradientFrom":"#000","gradientTo":"#000","gradientAngle":0,"padding":8,"presetId":null},"cameraBubble":{"visible":false,"position":"bottom-right","size":15,"shape":"circle","borderWidth":3,"borderColor":"#fff"},"frame":{"borderRadius":12,"shadow":true,"shadowIntensity":0.5},"cursor":{"type":"highlight","enabled":true,"size":40,"color":"#ffcc00","opacity":0.6},"zoomKeyframes":[{"timeMs":5000,"x":0.5,"y":0.3,"scale":2.0,"easing":"ease-in-out","durationMs":500}]}"##;
        let parsed: Effects = serde_json::from_str(json).unwrap();
        assert!(parsed.cursor.is_some());
        assert_eq!(parsed.zoom_keyframes.unwrap().len(), 1);
    }

    #[test]
    fn test_effects_without_cursor_backward_compat() {
        let json = r##"{"background":{"type":"solid","color":"#000","gradientFrom":"#000","gradientTo":"#000","gradientAngle":0,"padding":8,"presetId":null},"cameraBubble":{"visible":false,"position":"bottom-right","size":15,"shape":"circle","borderWidth":3,"borderColor":"#fff"},"frame":{"borderRadius":12,"shadow":true,"shadowIntensity":0.5}}"##;
        let parsed: Effects = serde_json::from_str(json).unwrap();
        assert!(parsed.cursor.is_none());
        assert!(parsed.zoom_keyframes.is_none());
    }

    #[test]
    fn test_export_config_serialization() {
        let config = ExportConfig {
            resolution: "1080p".to_string(),
            output_path: "/Users/test/Desktop/output.mp4".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("resolution"));
        assert!(json.contains("outputPath"));
        let parsed: ExportConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.resolution, "1080p");
    }

    #[test]
    fn test_export_progress_serialization() {
        let progress = ExportProgress {
            frames_rendered: 500,
            total_frames: 1000,
            percentage: 50.0,
            elapsed_ms: 5000,
            estimated_remaining_ms: Some(5000),
            phase: "compositing".to_string(),
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("framesRendered"));
        assert!(json.contains("estimatedRemainingMs"));
        let parsed: ExportProgress = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.percentage, 50.0);
    }
}
