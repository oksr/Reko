use crate::project;

/// Quick export: copies the raw screen recording to a user-chosen location.
/// In Phase 4, this will be replaced with a full composited export via Metal.
#[tauri::command]
pub fn quick_export(project_id: String) -> Result<String, String> {
    let project_path = project::project_dir(&project_id).join("project.json");
    let data = std::fs::read_to_string(&project_path).map_err(|e| e.to_string())?;
    let project: project::ProjectState = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    // For MVP, copy the raw screen recording to Desktop
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let desktop = home.join("Desktop");
    let filename = format!(
        "{}.mov",
        project
            .name
            .replace(['/', '\\', ':', '"'], "_")
    );
    let dest = desktop.join(&filename);

    std::fs::copy(&project.tracks.screen, &dest).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quick_export_errors_on_missing_project() {
        let result = quick_export("nonexistent-project-id".to_string());
        assert!(result.is_err());
    }
}
