/// Write export data to a file (used by WebCodecs export pipeline).
#[tauri::command]
pub fn write_export_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write export file: {e}"))
}

/// Get duration of a media file in seconds using ffprobe.
fn probe_duration(path: &str) -> Result<f64, String> {
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed for {path}: {stderr}"));
    }
    let s = String::from_utf8_lossy(&output.stdout);
    s.trim()
        .parse::<f64>()
        .map_err(|e| format!("Failed to parse duration from ffprobe: {e}"))
}

/// Mux audio tracks into a video-only MP4 using ffmpeg.
#[tauri::command]
pub fn mux_audio(
    video_path: String,
    audio_paths: Vec<String>,
    output_path: String,
) -> Result<(), String> {
    let video_duration = probe_duration(&video_path)?;

    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.arg("-y");
    cmd.arg("-i").arg(&video_path);
    for audio in &audio_paths {
        cmd.arg("-i").arg(audio);
    }

    if audio_paths.len() > 1 {
        let mix_inputs: String = (1..=audio_paths.len()).map(|i| format!("[{i}:a]")).collect();
        let filter = format!(
            "{mix_inputs}amix=inputs={}:duration=first:dropout_transition=0",
            audio_paths.len()
        );
        cmd.args(["-filter_complex", &filter]);
        cmd.args(["-c:v", "copy", "-c:a", "aac", "-b:a", "128k"]);
        cmd.args(["-map", "0:v:0"]);
    } else {
        cmd.args(["-c:v", "copy", "-c:a", "aac", "-b:a", "128k"]);
        cmd.args(["-map", "0:v:0", "-map", "1:a:0"]);
    }

    cmd.arg("-t").arg(format!("{:.3}", video_duration));
    cmd.arg(&output_path);

    let output = cmd.output().map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {stderr}"));
    }

    let _ = std::fs::remove_file(&video_path);
    Ok(())
}

