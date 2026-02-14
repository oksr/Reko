use tauri::webview::WebviewWindowBuilder;
use tauri::Manager;

use crate::autozoom;
use crate::project;

#[tauri::command]
pub fn open_editor(
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    // Use first 12 chars of UUID to reduce collision risk
    let label = format!("editor-{}", &project_id[..12.min(project_id.len())]);

    // If window already exists, focus it
    if let Some(window) = app_handle.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Load project to get its name for the window title
    let project_path = project::project_dir(&project_id).join("project.json");
    let title = if let Ok(data) = std::fs::read_to_string(&project_path) {
        if let Ok(p) = serde_json::from_str::<project::ProjectState>(&data) {
            format!("Reko — {}", p.name)
        } else {
            "Reko Editor".to_string()
        }
    } else {
        "Reko Editor".to_string()
    };

    let url = format!("/editor?project={}", project_id);
    WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title(&title)
    .inner_size(1400.0, 900.0)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<project::ProjectState>, String> {
    let dir = project::projects_dir();
    let mut projects = Vec::new();

    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let project_json = entry.path().join("project.json");
        if project_json.exists() {
            if let Ok(data) = std::fs::read_to_string(&project_json) {
                if let Ok(project) = serde_json::from_str::<project::ProjectState>(&data) {
                    projects.push(project);
                }
            }
        }
    }

    projects.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(projects)
}

#[tauri::command]
pub fn load_project(project_id: String) -> Result<project::ProjectState, String> {
    let path = project::project_dir(&project_id).join("project.json");
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut p: project::ProjectState = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    // Resolve relative track paths to absolute (files live in raw/ subdir)
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

    Ok(p)
}

#[tauri::command]
pub fn save_project_state(project: project::ProjectState) -> Result<(), String> {
    project::save_project(&project)
}

#[tauri::command]
pub fn generate_auto_zoom(project_id: String) -> Result<Vec<project::ZoomKeyframe>, String> {
    let raw = project::raw_dir(&project_id);
    let mouse_path = raw.join("mouse_events.jsonl");

    if !mouse_path.exists() {
        return Ok(vec![]);
    }

    // Load project to get video duration
    let project_path = project::project_dir(&project_id).join("project.json");
    let project_data = std::fs::read_to_string(&project_path).map_err(|e| e.to_string())?;
    let p: project::ProjectState = serde_json::from_str(&project_data).map_err(|e| e.to_string())?;
    let video_duration_ms = p.timeline.duration_ms;

    let content = std::fs::read_to_string(&mouse_path).map_err(|e| e.to_string())?;
    let events: Vec<autozoom::MouseEvent> = content
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();

    Ok(autozoom::generate_zoom_keyframes(
        &events,
        2.0,    // zoom_scale
        1000,   // segment_duration_ms
        500,    // cluster_ms
        video_duration_ms,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_projects_returns_vec() {
        let result = list_projects();
        // Should not error even if dir is empty
        assert!(result.is_ok());
    }

    #[test]
    fn test_load_project_errors_on_missing() {
        let result = load_project("nonexistent-id".to_string());
        assert!(result.is_err());
    }
}
