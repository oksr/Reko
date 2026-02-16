pub mod autozoom;
mod commands;
pub mod project;
mod swift_ffi;

use commands::export::ExportState;
use commands::recording::RecordingState;
use std::sync::Mutex;
use swift_ffi::RekoEngine;

#[tauri::command]
fn get_engine_version() -> String {
    RekoEngine::version()
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or("Could not find home directory".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RecordingState {
            active_session_id: Mutex::new(None),
            active_project_id: Mutex::new(None),
        })
        .manage(ExportState {
            active_export_id: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_version,
            commands::sources::list_displays,
            commands::sources::list_audio_inputs,
            commands::sources::list_cameras,
            commands::sources::list_windows,
            commands::recording::start_recording,
            commands::recording::stop_recording,
            commands::recording::pause_recording,
            commands::recording::resume_recording,
            commands::recording::get_audio_levels,
            commands::editor::open_editor,
            commands::editor::list_projects,
            commands::editor::load_project,
            commands::editor::save_project_state,
            commands::export::start_export,
            commands::export::get_export_progress,
            commands::export::cancel_export,
            commands::export::finish_export,
            commands::editor::generate_auto_zoom,
            commands::editor::download_background_image,
            commands::editor::list_wallpapers,
            commands::editor::resolve_wallpaper_path,
            commands::editor::copy_background_image,
            get_home_dir,
            commands::permissions::check_permission,
            commands::permissions::open_permission_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
