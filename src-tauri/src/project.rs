use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectState {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub tracks: Tracks,
    pub timeline: Timeline,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tracks {
    pub screen: String,
    pub mic: Option<String>,
    pub system_audio: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Timeline {
    pub duration_ms: u64,
    pub in_point: u64,
    pub out_point: u64,
}

pub fn projects_dir() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.capturekit.app")
        .join("projects");
    fs::create_dir_all(&dir).ok();
    dir
}

pub fn project_dir(id: &str) -> PathBuf {
    projects_dir().join(id)
}

pub fn raw_dir(id: &str) -> PathBuf {
    project_dir(id).join("raw")
}

pub fn save_project(project: &ProjectState) -> Result<(), String> {
    let dir = project_dir(&project.id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(project).map_err(|e| e.to_string())?;
    fs::write(dir.join("project.json"), json).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tracks_serialization_roundtrip() {
        let tracks = Tracks {
            screen: "screen.mov".to_string(),
            mic: Some("mic.wav".to_string()),
            system_audio: None,
        };
        let json = serde_json::to_string(&tracks).unwrap();
        let parsed: Tracks = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.screen, "screen.mov");
        assert_eq!(parsed.mic, Some("mic.wav".to_string()));
        assert!(parsed.system_audio.is_none());
    }
}
