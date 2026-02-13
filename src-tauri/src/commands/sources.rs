use serde::{Deserialize, Serialize};

use crate::swift_ffi::CaptureKitEngine;

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

#[tauri::command]
pub async fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    let json = CaptureKitEngine::list_displays()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_audio_inputs() -> Result<Vec<AudioInputInfo>, String> {
    let json = CaptureKitEngine::list_audio_inputs()?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}
