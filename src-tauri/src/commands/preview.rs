use crate::project;
use crate::swift_ffi::RekoEngine;

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDimensions {
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn configure_preview(project_id: String) -> Result<PreviewDimensions, String> {
    let project_path = project::project_dir(&project_id).join("project.json");
    let data = std::fs::read_to_string(&project_path).map_err(|e| e.to_string())?;
    let mut p: project::ProjectState = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    // Resolve relative track paths to absolute (same as load_project)
    let raw = project::raw_dir(&project_id);
    let resolve = |rel: &str| -> String {
        let abs = raw.join(rel);
        if abs.exists() {
            abs.to_string_lossy().to_string()
        } else {
            rel.to_string()
        }
    };
    p.tracks.screen = resolve(&p.tracks.screen);
    p.tracks.mic = p.tracks.mic.map(|m| resolve(&m));
    p.tracks.system_audio = p.tracks.system_audio.map(|s| resolve(&s));
    p.tracks.camera = p.tracks.camera.map(|c| resolve(&c));
    p.tracks.mouse_events = p.tracks.mouse_events.map(|m| resolve(&m));

    let project_json = serde_json::to_string(&p).map_err(|e| e.to_string())?;
    let dims_json = RekoEngine::preview_configure(&project_json)?;
    serde_json::from_str(&dims_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn render_preview_frame(
    source_time_ms: u64,
    effects: serde_json::Value,
    zoom_events: serde_json::Value,
) -> Result<tauri::ipc::Response, String> {
    let effects_json = serde_json::to_string(&effects).map_err(|e| e.to_string())?;
    let zoom_events_json = serde_json::to_string(&zoom_events).map_err(|e| e.to_string())?;
    let jpeg_bytes =
        RekoEngine::preview_frame(source_time_ms, &effects_json, &zoom_events_json)?;
    Ok(tauri::ipc::Response::new(jpeg_bytes))
}

#[tauri::command]
pub fn destroy_preview() -> Result<(), String> {
    RekoEngine::preview_destroy();
    Ok(())
}
