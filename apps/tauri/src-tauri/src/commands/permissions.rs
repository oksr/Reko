use crate::swift_ffi::RekoEngine;

#[tauri::command]
pub async fn check_permission(kind: String) -> Result<String, String> {
    let status = match kind.as_str() {
        "screen" => RekoEngine::check_screen_recording_permission(),
        "microphone" => RekoEngine::check_microphone_permission(),
        "camera" => RekoEngine::check_camera_permission(),
        "accessibility" => RekoEngine::check_accessibility_permission(),
        _ => return Err(format!("Unknown permission kind: {}", kind)),
    };
    let label = match status {
        1 => "granted",
        2 => "denied",
        _ => "not_determined",
    };
    Ok(label.to_string())
}

#[tauri::command]
pub async fn request_permission(kind: String) -> Result<String, String> {
    let status = match kind.as_str() {
        "microphone" => RekoEngine::request_microphone_permission(),
        "camera" => RekoEngine::request_camera_permission(),
        _ => return Err(format!("Cannot request permission for: {}", kind)),
    };
    let label = match status {
        1 => "granted",
        _ => "denied",
    };
    Ok(label.to_string())
}

#[tauri::command]
pub fn open_permission_settings(kind: String) -> Result<(), String> {
    let url = match kind.as_str() {
        "screen" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "microphone" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        "camera" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
        "accessibility" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        _ => return Err(format!("Unknown permission kind: {}", kind)),
    };
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
