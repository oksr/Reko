use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub launch_at_login: bool,
    pub show_in_dock: bool,
    pub default_save_path: String,
    pub default_export_resolution: String,
    pub default_export_quality: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        let desktop = dirs::desktop_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from("~")))
            .to_string_lossy()
            .to_string();

        Self {
            launch_at_login: false,
            show_in_dock: true,
            default_save_path: desktop,
            default_export_resolution: "1080p".to_string(),
            default_export_quality: "high".to_string(),
        }
    }
}

fn settings_path() -> PathBuf {
    let data = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = data.join("com.reko.app");
    fs::create_dir_all(&dir).ok();
    dir.join("settings.json")
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    let path = settings_path();
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let settings: AppSettings = serde_json::from_str(&contents).unwrap_or_default();
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_dock_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::Mutex;
        // Update the tray checkmark
        let state = app.state::<Mutex<crate::tray::TrayState>>();
        let s = state.lock().unwrap();
        let _ = s.dock_item.set_checked(visible);
        drop(s);

        app.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
            unsafe {
                let mtm = MainThreadMarker::new_unchecked();
                let ns_app = NSApplication::sharedApplication(mtm);
                let policy = if visible {
                    NSApplicationActivationPolicy::Regular
                } else {
                    NSApplicationActivationPolicy::Accessory
                };
                ns_app.setActivationPolicy(policy);
            }
        })
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle, default_path: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();

    let mut builder = app.dialog().file();
    if let Some(ref path) = default_path {
        builder = builder.set_directory(path);
    }
    builder.pick_folder(move |path| {
        let result = path.and_then(|p| p.as_path().map(|p| p.to_string_lossy().to_string()));
        let _ = tx.send(result);
    });

    let selected = rx.recv().map_err(|e| e.to_string())?;
    Ok(selected)
}
