mod commands;
mod project;
mod swift_ffi;

use commands::recording::RecordingState;
use std::sync::Mutex;
use swift_ffi::CaptureKitEngine;

#[tauri::command]
fn get_engine_version() -> String {
    CaptureKitEngine::version()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RecordingState {
            active_session_id: Mutex::new(None),
            active_project_id: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_version,
            commands::sources::list_displays,
            commands::sources::list_audio_inputs,
            commands::sources::list_cameras,
            commands::recording::start_recording,
            commands::recording::stop_recording,
            commands::recording::pause_recording,
            commands::recording::resume_recording,
            commands::recording::get_audio_levels,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
