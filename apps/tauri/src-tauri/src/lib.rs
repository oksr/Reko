pub mod autozoom;
mod commands;
pub mod project;
mod swift_ffi;
mod tray;

use commands::recording::RecordingState;
use std::sync::Mutex;
use swift_ffi::RekoEngine;
use tauri::Manager;

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
    #[cfg(debug_assertions)]
    {
        let version = env!("CARGO_PKG_VERSION");
        let os_version = std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .unwrap_or_default();
        let os_version = os_version.trim();

        let art: &[(&str, u8)] = &[
            (" /$$$$$$$  /$$$$$$$$  /$$   /$$   /$$$$$$", 159),
            ("| $$__  $$| $$_____/ | $$  /$$/ /$$__  $$", 123),
            ("| $$  \\ $$| $$       | $$ /$$/ | $$  \\ $$", 87),
            ("| $$$$$$$/| $$$$$    | $$$$$/  | $$  | $$", 51),
            ("| $$__  $$| $$__/    | $$  $$  | $$  | $$", 45),
            ("| $$  \\ $$| $$       | $$\\  $$ | $$  | $$", 39),
            ("| $$  | $$| $$$$$$$$ | $$ \\  $$|  $$$$$$/", 33),
            ("|__/  |__/|________/ |__/  \\__/ \\______/", 27),
        ];

        let max_w = art.iter().map(|(s, _)| s.len()).max().unwrap();
        let inner = max_w + 4;
        let hbar: String = "─".repeat(inner);

        let d = "\x1b[38;5;240m";
        let c = "\x1b[38;5;51m";
        let r = "\x1b[0m";

        println!();
        println!("  {d}╭{hbar}╮{r}");
        println!("  {d}│{r}{:inner$}{d}│{r}", "");
        for &(line, color) in art {
            println!("  {d}│{r}  \x1b[1;38;5;{color}m{line:<max_w$}\x1b[0m  {d}│{r}");
        }
        println!("  {d}│{r}{:inner$}{d}│{r}", "");
        println!("  {d}├{hbar}┤{r}");
        println!("  {d}│{r}{:inner$}{d}│{r}", "");

        let pad = inner - 11;
        let info: &[(&str, &str)] = &[
            ("version", version),
            ("env", "development"),
            ("macos", os_version),
        ];
        for &(label, value) in info {
            println!("  {d}│{r}  {c}{label:<9}{r}{value:<pad$}{d}│{r}");
        }

        println!("  {d}│{r}{:inner$}{d}│{r}", "");
        println!("  {d}╰{hbar}╯{r}");
        println!();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin({
            let mut updater = tauri_plugin_updater::Builder::new();
            if let Some(token) = option_env!("UPDATER_GITHUB_TOKEN") {
                updater = updater
                    .header("Authorization", format!("token {token}"))
                    .expect("failed to set updater auth header")
                    .header("Accept", "application/octet-stream")
                    .expect("failed to set updater accept header");
            }
            updater.build()
        })
        .plugin(tauri_plugin_process::init())
        .manage(RecordingState {
            active_session_id: Mutex::new(None),
            active_project_id: Mutex::new(None),
        })
        .setup(|app| {
            tray::setup(app)?;

            #[cfg(target_os = "macos")]
            {
                use objc2_app_kit::NSColor;

                if let Some(recorder) = app.get_webview_window("recorder") {
                    if let Ok(ns_window) = recorder.ns_window() {
                        unsafe {
                            let ns_window: *mut objc2_app_kit::NSWindow =
                                ns_window.cast();
                            let ns_window = &*ns_window;

                            // Make the window background fully transparent
                            let clear = NSColor::clearColor();
                            ns_window.setBackgroundColor(Some(&clear));

                            // Set corner radius on the window's content view layer
                            if let Some(content_view) = ns_window.contentView() {
                                content_view.setWantsLayer(true);
                                if let Some(layer) = content_view.layer() {
                                    layer.setCornerRadius(12.0);
                                    layer.setMasksToBounds(true);
                                }
                            }
                        }
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.label().starts_with("editor-") {
                    if let Some(recorder) = window.app_handle().get_webview_window("recorder") {
                        let _ = recorder.show();
                        let _ = recorder.set_focus();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_version,
            commands::sources::list_displays,
            commands::sources::list_audio_inputs,
            commands::sources::list_cameras,
            commands::sources::list_windows,
            commands::sources::prewarm_camera,
            commands::sources::stop_camera_prewarm,
            commands::recording::start_recording,
            commands::recording::stop_recording,
            commands::recording::pause_recording,
            commands::recording::resume_recording,
            commands::recording::get_audio_levels,
            commands::editor::open_editor,
            commands::editor::list_projects,
            commands::editor::load_project,
            commands::editor::save_project_state,
            commands::export::write_export_file,
            commands::export::mux_audio,
            commands::editor::generate_auto_zoom,
            commands::editor::download_background_image,
            commands::editor::list_wallpapers,
            commands::editor::resolve_wallpaper_path,
            commands::editor::copy_background_image,
            get_home_dir,
            commands::permissions::check_permission,
            commands::permissions::request_permission,
            commands::permissions::open_permission_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
