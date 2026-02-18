use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

pub struct TrayState {
    pub dock_item: CheckMenuItem<tauri::Wry>,
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let new_recording = MenuItem::with_id(
        app,
        "tray:new-recording",
        "New recording...",
        true,
        Some("ctrl+cmd+return"),
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let record_display = MenuItem::with_id(
        app,
        "tray:record-display",
        "Record display",
        true,
        Some("alt+cmd+3"),
    )?;
    let record_window = MenuItem::with_id(
        app,
        "tray:record-window",
        "Record window",
        true,
        Some("alt+cmd+4"),
    )?;
    let record_area = MenuItem::with_id(
        app,
        "tray:record-area",
        "Record area",
        true,
        Some("alt+cmd+5"),
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let show_settings = MenuItem::with_id(
        app,
        "tray:show-settings",
        "Show settings",
        true,
        Some("cmd+,"),
    )?;
    let show_in_dock = CheckMenuItem::with_id(
        app,
        "tray:show-in-dock",
        "Show Reko in Dock",
        true,
        true,
        Some("cmd+d"),
    )?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let show_projects = MenuItem::with_id(
        app,
        "tray:show-projects",
        "Show previous projects",
        true,
        None::<&str>,
    )?;
    let sep4 = PredefinedMenuItem::separator(app)?;
    let open_project = MenuItem::with_id(
        app,
        "tray:open-project",
        "Open project...",
        true,
        Some("cmd+o"),
    )?;
    let open_last = MenuItem::with_id(
        app,
        "tray:open-last-project",
        "Open last project",
        true,
        Some("alt+cmd+z"),
    )?;
    let sep5 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray:quit", "Quit app", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &new_recording,
            &sep1,
            &record_display,
            &record_window,
            &record_area,
            &sep2,
            &show_settings,
            &show_in_dock,
            &sep3,
            &show_projects,
            &sep4,
            &open_project,
            &open_last,
            &sep5,
            &quit,
        ],
    )?;

    // Store the dock toggle item so we can flip its checkmark later
    app.manage(Mutex::new(TrayState {
        dock_item: show_in_dock,
    }));

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;

    app.on_menu_event(handle_menu_event);

    Ok(())
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "tray:new-recording"
        | "tray:record-display"
        | "tray:record-window"
        | "tray:record-area"
        | "tray:show-settings"
        | "tray:show-projects" => {
            show_recorder(app);
        }
        "tray:show-in-dock" => {
            toggle_dock_visibility(app);
        }
        "tray:open-project" => {
            open_project_dialog(app);
        }
        "tray:open-last-project" => {
            open_last_project(app);
        }
        "tray:quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

fn show_recorder(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("recorder") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_dock_visibility(app: &AppHandle) {
    let state = app.state::<Mutex<TrayState>>();
    let s = state.lock().unwrap();
    let currently_checked = s.dock_item.is_checked().unwrap_or(true);
    let new_value = !currently_checked;
    let _ = s.dock_item.set_checked(new_value);
    drop(s);

    #[cfg(target_os = "macos")]
    {
        // setActivationPolicy must run on the main thread
        let _ = app.run_on_main_thread(move || {
            set_dock_visible(new_value);
        });
    }
}

#[cfg(target_os = "macos")]
fn set_dock_visible(visible: bool) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    unsafe {
        // SAFETY: called via AppHandle::run_on_main_thread
        let mtm = MainThreadMarker::new_unchecked();
        let app = NSApplication::sharedApplication(mtm);
        let policy = if visible {
            NSApplicationActivationPolicy::Regular
        } else {
            NSApplicationActivationPolicy::Accessory
        };
        app.setActivationPolicy(policy);
    }
}

fn open_project_dialog(app: &AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    let app_clone = app.clone();
    // Pick the project folder — the folder name is the project ID (UUID)
    app.dialog().file().pick_folder(move |path| {
        let Some(file_path) = path else { return };
        let Some(p) = file_path.as_path() else { return };
        let Some(project_id) = p.file_name().and_then(|n| n.to_str()) else {
            return;
        };
        let _ = crate::commands::editor::open_editor(app_clone, project_id.to_string());
    });
}

fn open_last_project(app: &AppHandle) {
    if let Ok(projects) = crate::commands::editor::list_projects() {
        if let Some(project) = projects.first() {
            let _ = crate::commands::editor::open_editor(app.clone(), project.id.clone());
        }
    }
}
