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
/// Handles a known recording bug where system_audio.wav can be ~2x the video duration
/// (non-interleaved audio was misinterpreted during recording). Detects this by comparing
/// durations and applies atempo correction when needed.
#[tauri::command]
pub fn mux_audio(
    video_path: String,
    audio_paths: Vec<String>,
    output_path: String,
) -> Result<(), String> {
    let video_duration = probe_duration(&video_path)?;

    // Detect time-scale ratios for each audio file (1.0 = normal, ~2.0 = buggy recording)
    let time_scales: Vec<f64> = audio_paths
        .iter()
        .map(|path| {
            let audio_dur = probe_duration(path).unwrap_or(video_duration);
            let ratio = audio_dur / video_duration;
            if ratio > 1.5 { ratio } else { 1.0 }
        })
        .collect();

    let needs_tempo_fix = time_scales.iter().any(|&s| s > 1.0);

    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.arg("-y"); // overwrite output
    cmd.arg("-i").arg(&video_path); // input 0: video

    for audio in &audio_paths {
        cmd.arg("-i").arg(audio);
    }

    if needs_tempo_fix || audio_paths.len() > 1 {
        // Build a filter_complex that applies atempo correction where needed, then mixes
        let mut filter_parts = Vec::new();
        let mut mix_inputs = Vec::new();

        for (i, &scale) in time_scales.iter().enumerate() {
            let input_idx = i + 1; // input 0 is video
            if scale > 1.0 {
                // Speed up audio to compensate for the 2x duration bug
                filter_parts.push(format!("[{input_idx}:a]atempo={scale:.4}[a{i}]"));
                mix_inputs.push(format!("[a{i}]"));
            } else {
                mix_inputs.push(format!("[{input_idx}:a]"));
            }
        }

        if audio_paths.len() == 1 {
            // Single track with tempo fix
            let filter = filter_parts.join(";");
            cmd.args(["-filter_complex", &filter]);
            cmd.args(["-c:v", "copy", "-c:a", "aac", "-b:a", "128k"]);
            cmd.args(["-map", "0:v:0", "-map", "[a0]"]);
        } else {
            // Multiple tracks — apply tempo fixes then mix
            let mix_filter = format!(
                "{}amix=inputs={}:duration=first:dropout_transition=0",
                mix_inputs.join(""),
                audio_paths.len()
            );
            filter_parts.push(mix_filter);
            let filter = filter_parts.join(";");
            cmd.args(["-filter_complex", &filter]);
            cmd.args(["-c:v", "copy", "-c:a", "aac", "-b:a", "128k"]);
            cmd.args(["-map", "0:v:0"]);
        }
    } else {
        // Simple case: single audio track, no correction needed
        cmd.args(["-c:v", "copy", "-c:a", "aac", "-b:a", "128k"]);
        cmd.args(["-map", "0:v:0", "-map", "1:a:0"]);
    }

    // Trim output to video duration
    cmd.arg("-t").arg(format!("{:.3}", video_duration));
    cmd.arg(&output_path);

    let output = cmd.output().map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {stderr}"));
    }

    // Remove the intermediate video-only file
    let _ = std::fs::remove_file(&video_path);

    Ok(())
}

