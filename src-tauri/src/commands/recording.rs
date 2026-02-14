use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

use crate::project::{self, ProjectState, Tracks, Timeline};
use crate::swift_ffi::CaptureKitEngine;

pub struct RecordingState {
    pub active_session_id: Mutex<Option<u64>>,
    pub active_project_id: Mutex<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingConfig {
    pub display_id: Option<u32>,
    pub window_id: Option<u32>,
    pub mic_id: Option<String>,
    pub camera_id: Option<String>,
    pub capture_system_audio: bool,
    pub fps: u32,
}

#[derive(Debug, Deserialize)]
struct SwiftRecordingResult {
    screen_path: String,
    system_audio_path: Option<String>,
    mic_path: Option<String>,
    camera_path: Option<String>,
    mouse_events_path: Option<String>,
    duration_ms: u64,
    #[allow(dead_code)]
    frame_count: u64,
}

#[tauri::command]
pub async fn start_recording(
    config: RecordingConfig,
    state: State<'_, RecordingState>,
) -> Result<String, String> {
    let project_id = uuid::Uuid::new_v4().to_string();
    let raw = project::raw_dir(&project_id);
    std::fs::create_dir_all(&raw).map_err(|e| e.to_string())?;

    let swift_config = serde_json::json!({
        "display_id": config.display_id,
        "window_id": config.window_id,
        "fps": config.fps,
        "capture_system_audio": config.capture_system_audio,
        "output_dir": raw.to_string_lossy(),
        "mic_id": config.mic_id,
        "camera_id": config.camera_id,
    });

    let session_id = CaptureKitEngine::start_recording(&swift_config.to_string())?;

    *state.active_session_id.lock().unwrap() = Some(session_id);
    *state.active_project_id.lock().unwrap() = Some(project_id.clone());

    Ok(project_id)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioLevels {
    pub mic_level: f32,
    pub system_audio_level: f32,
}

#[tauri::command]
pub async fn get_audio_levels(
    state: State<'_, RecordingState>,
) -> Result<AudioLevels, String> {
    let session_id = state.active_session_id.lock().unwrap()
        .ok_or("No active recording")?;
    let json = CaptureKitEngine::get_audio_levels(session_id)?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pause_recording(
    state: State<'_, RecordingState>,
) -> Result<(), String> {
    let session_id = state.active_session_id.lock().unwrap()
        .ok_or("No active recording")?;
    CaptureKitEngine::pause_recording(session_id)
}

#[tauri::command]
pub async fn resume_recording(
    state: State<'_, RecordingState>,
) -> Result<(), String> {
    let session_id = state.active_session_id.lock().unwrap()
        .ok_or("No active recording")?;
    CaptureKitEngine::resume_recording(session_id)
}

#[tauri::command]
pub async fn stop_recording(
    state: State<'_, RecordingState>,
) -> Result<ProjectState, String> {
    let session_id = state.active_session_id.lock().unwrap().take()
        .ok_or("No active recording")?;
    let project_id = state.active_project_id.lock().unwrap().take()
        .ok_or("No active project")?;

    let result_json = CaptureKitEngine::stop_recording(session_id)?;
    let result: SwiftRecordingResult = serde_json::from_str(&result_json)
        .map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap()
        .as_millis() as u64;

    let project = ProjectState {
        id: project_id,
        name: format!("Recording {}", chrono::Local::now().format("%Y-%m-%d %H:%M")),
        created_at: now,
        tracks: Tracks {
            screen: result.screen_path,
            mic: result.mic_path,
            system_audio: result.system_audio_path,
            camera: result.camera_path,
            mouse_events: result.mouse_events_path,
        },
        timeline: Timeline {
            duration_ms: result.duration_ms,
            in_point: 0,
            out_point: result.duration_ms,
        },
        effects: None,
        sequence: None,
    };

    project::save_project(&project)?;
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recording_config_serializes_with_camera_id() {
        let config = RecordingConfig {
            display_id: Some(1),
            window_id: None,
            mic_id: None,
            camera_id: Some("cam-abc".to_string()),
            capture_system_audio: true,
            fps: 60,
        };
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["camera_id"], "cam-abc");
    }

    #[test]
    fn test_swift_result_deserializes_with_camera_path() {
        let json = r#"{
            "screen_path": "screen.mov",
            "system_audio_path": null,
            "mic_path": null,
            "camera_path": "camera.mov",
            "duration_ms": 5000,
            "frame_count": 300
        }"#;
        let result: SwiftRecordingResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.camera_path, Some("camera.mov".to_string()));
    }

    #[test]
    fn test_recording_state_defaults_to_none() {
        let state = RecordingState {
            active_session_id: std::sync::Mutex::new(None),
            active_project_id: std::sync::Mutex::new(None),
        };
        assert!(state.active_session_id.lock().unwrap().is_none());
        assert!(state.active_project_id.lock().unwrap().is_none());
    }

    #[test]
    fn test_audio_levels_deserializes_from_swift_json() {
        let json = r#"{"mic_level":0.75,"system_audio_level":0.3}"#;
        let levels: AudioLevels = serde_json::from_str(json).unwrap();
        assert!((levels.mic_level - 0.75).abs() < 0.001);
        assert!((levels.system_audio_level - 0.3).abs() < 0.001);
    }

    #[test]
    fn test_audio_levels_deserializes_zeros() {
        let json = r#"{"mic_level":0.0,"system_audio_level":0.0}"#;
        let levels: AudioLevels = serde_json::from_str(json).unwrap();
        assert_eq!(levels.mic_level, 0.0);
        assert_eq!(levels.system_audio_level, 0.0);
    }

    #[test]
    fn test_swift_result_deserializes_without_camera_path() {
        let json = r#"{
            "screen_path": "screen.mov",
            "system_audio_path": null,
            "mic_path": null,
            "duration_ms": 5000,
            "frame_count": 300
        }"#;
        let result: SwiftRecordingResult = serde_json::from_str(json).unwrap();
        assert!(result.camera_path.is_none());
    }
}
