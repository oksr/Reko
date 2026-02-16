use crate::project::{self, ExportConfig, ExportProgress};
use crate::swift_ffi::RekoEngine;
use std::sync::Mutex;

pub struct ExportState {
    pub active_export_id: Mutex<Option<u64>>,
}

/// Start a composited export. Returns the export session ID.
#[tauri::command]
pub fn start_export(
    project_id: String,
    export_config: ExportConfig,
    state: tauri::State<ExportState>,
) -> Result<u64, String> {
    let project_path = project::project_dir(&project_id).join("project.json");
    let project_json = std::fs::read_to_string(&project_path).map_err(|e| e.to_string())?;
    let config_json = serde_json::to_string(&export_config).map_err(|e| e.to_string())?;
    let export_id = RekoEngine::start_export(&project_json, &config_json)?;

    let mut active = state.active_export_id.lock().unwrap();
    *active = Some(export_id);

    Ok(export_id)
}

/// Poll export progress.
#[tauri::command]
pub fn get_export_progress(state: tauri::State<ExportState>) -> Result<ExportProgress, String> {
    let active = state.active_export_id.lock().unwrap();
    let export_id = active.ok_or("No active export")?;
    let json = RekoEngine::get_export_progress(export_id)?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

/// Cancel the active export.
#[tauri::command]
pub fn cancel_export(state: tauri::State<ExportState>) -> Result<(), String> {
    let mut active = state.active_export_id.lock().unwrap();
    if let Some(export_id) = active.take() {
        RekoEngine::cancel_export(export_id)?;
    }
    Ok(())
}

/// Clean up after export completes.
#[tauri::command]
pub fn finish_export(state: tauri::State<ExportState>) -> Result<(), String> {
    let mut active = state.active_export_id.lock().unwrap();
    if let Some(export_id) = active.take() {
        RekoEngine::finish_export(export_id)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_export_config_to_json() {
        let config = ExportConfig {
            resolution: "1080p".to_string(),
            quality: "high".to_string(),
            bitrate: 20_000_000,
            output_path: "/Users/test/Desktop/output.mp4".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"resolution\":\"1080p\""));
        assert!(json.contains("\"outputPath\""));
        assert!(json.contains("\"bitrate\":20000000"));
    }
}
