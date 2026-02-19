use serde::{Deserialize, Serialize};

use crate::swift_ffi::RekoEngine;

#[derive(Debug, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub width: i32,
    pub height: i32,
    pub is_main: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioInputInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CameraInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub bundle_id: String,
    pub app_icon: String,
}

#[tauri::command]
pub async fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let json = RekoEngine::list_windows()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_cameras() -> Result<Vec<CameraInfo>, String> {
    let json = RekoEngine::list_cameras()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    let json = RekoEngine::list_displays()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_audio_inputs() -> Result<Vec<AudioInputInfo>, String> {
    let json = RekoEngine::list_audio_inputs()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_camera_info_deserializes_from_swift_json() {
        let json = r#"[{"id":"abc-123","name":"FaceTime HD"}]"#;
        let cameras: Vec<CameraInfo> = serde_json::from_str(json).unwrap();
        assert_eq!(cameras.len(), 1);
        assert_eq!(cameras[0].id, "abc-123");
        assert_eq!(cameras[0].name, "FaceTime HD");
    }

    #[test]
    fn test_camera_info_empty_array() {
        let json = "[]";
        let cameras: Vec<CameraInfo> = serde_json::from_str(json).unwrap();
        assert!(cameras.is_empty());
    }
}
