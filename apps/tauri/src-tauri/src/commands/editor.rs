use tauri::webview::WebviewWindowBuilder;
use tauri::{LogicalPosition, Manager, TitleBarStyle};
use tauri::path::BaseDirectory;

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

    let url = format!("/?project={}", project_id);
    WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title(&title)
    .title_bar_style(TitleBarStyle::Overlay)
    .hidden_title(true)
    .traffic_light_position(LogicalPosition::new(16.0, 18.0))
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
pub fn generate_auto_zoom(
    project_id: String,
    zoom_scale: f64,
) -> Result<Vec<project::ZoomEvent>, String> {
    let raw = project::raw_dir(&project_id);
    let mouse_path = raw.join("mouse_events.jsonl");

    if !mouse_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&mouse_path).map_err(|e| e.to_string())?;
    let events: Vec<autozoom::MouseEvent> = content
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();

    Ok(autozoom::generate_zoom_events(&events, zoom_scale))
}

#[tauri::command]
pub fn download_background_image(
    project_id: String,
    url: String,
    filename: String,
) -> Result<String, String> {
    let raw = project::raw_dir(&project_id);
    std::fs::create_dir_all(&raw).map_err(|e| e.to_string())?;

    let dest = raw.join(&filename);

    let response = ureq::get(&url)
        .call()
        .map_err(|e| format!("Download failed: {}", e))?;

    let mut reader = response.into_reader();
    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    std::io::copy(&mut reader, &mut file).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

fn wallpapers_resource_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/wallpapers");
        if dir.exists() {
            return Ok(dir);
        }
    }
    app.path()
        .resolve("resources/wallpapers", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve wallpapers resource dir: {}", e))
}

fn scan_wallpapers(dir: &std::path::Path) -> Result<Vec<WallpaperInfo>, String> {
    let mut wallpapers = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if let Some(ext) = path.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            if ["jpg", "jpeg", "png", "webp"].contains(&ext.as_str()) {
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                wallpapers.push(WallpaperInfo {
                    id: name.clone(),
                    name,
                    path: path.to_string_lossy().to_string(),
                });
            }
        }
    }
    wallpapers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(wallpapers)
}

#[tauri::command]
pub fn list_wallpapers(app: tauri::AppHandle) -> Result<Vec<WallpaperInfo>, String> {
    let wallpapers_dir = wallpapers_resource_dir(&app)?;
    scan_wallpapers(&wallpapers_dir)
}

#[tauri::command]
pub fn resolve_wallpaper_path(app: tauri::AppHandle, wallpaper_id: String) -> Result<String, String> {
    let wallpapers_dir = wallpapers_resource_dir(&app)?;
    for entry in std::fs::read_dir(&wallpapers_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if let Some(stem) = path.file_stem() {
            if stem.to_string_lossy() == wallpaper_id {
                return Ok(path.to_string_lossy().to_string());
            }
        }
    }
    Err(format!("Wallpaper '{}' not found", wallpaper_id))
}

#[tauri::command]
pub fn copy_background_image(
    project_id: String,
    source_path: String,
    filename: String,
) -> Result<String, String> {
    let raw = project::raw_dir(&project_id);
    std::fs::create_dir_all(&raw).map_err(|e| e.to_string())?;
    let dest = raw.join(&filename);
    std::fs::copy(&source_path, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
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
