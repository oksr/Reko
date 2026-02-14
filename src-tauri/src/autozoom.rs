use crate::project::{Clip, SequenceTransition, ZoomKeyframe};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseEvent {
    pub time_ms: u64,
    pub x: f64,
    pub y: f64,
    #[serde(rename = "type")]
    pub event_type: String,
}

/// Generate zoom keyframes from mouse click events (segment model).
///
/// Algorithm:
/// 1. Filter to click events only
/// 2. Group clicks that are close in time (within `cluster_ms`)
/// 3. For each cluster, create a zoom segment at the cluster center
/// 4. Each segment has built-in ramp-in/hold/ramp-out (no separate zoom-out needed)
/// 5. Ensure segments don't overlap and stay within video duration
pub fn generate_zoom_keyframes(
    events: &[MouseEvent],
    zoom_scale: f64,
    segment_duration_ms: u64,
    cluster_ms: u64,
    video_duration_ms: u64,
) -> Vec<ZoomKeyframe> {
    // Filter clicks only
    let clicks: Vec<&MouseEvent> = events
        .iter()
        .filter(|e| e.event_type == "click" || e.event_type == "rightClick")
        .collect();

    if clicks.is_empty() {
        return vec![];
    }

    // Cluster clicks that are within cluster_ms of each other
    let mut clusters: Vec<Vec<&MouseEvent>> = vec![];
    let mut current_cluster: Vec<&MouseEvent> = vec![clicks[0]];

    for click in &clicks[1..] {
        let last = current_cluster.last().unwrap();
        if click.time_ms - last.time_ms <= cluster_ms {
            current_cluster.push(click);
        } else {
            clusters.push(current_cluster);
            current_cluster = vec![click];
        }
    }
    clusters.push(current_cluster);

    let mut keyframes: Vec<ZoomKeyframe> = vec![];

    for cluster in &clusters {
        // Cluster center = average position
        let cx: f64 = cluster.iter().map(|e| e.x).sum::<f64>() / cluster.len() as f64;
        let cy: f64 = cluster.iter().map(|e| e.y).sum::<f64>() / cluster.len() as f64;
        let time_ms = cluster[0].time_ms;

        // Clamp segment to not exceed video duration
        let duration = segment_duration_ms.min(video_duration_ms.saturating_sub(time_ms));
        if duration < 200 {
            continue; // Too short to be useful
        }

        // Check there's room: don't overlap with previous segment
        if let Some(last) = keyframes.last() {
            if time_ms < last.time_ms + last.duration_ms + 100 {
                continue; // Skip — too close to previous
            }
        }

        keyframes.push(ZoomKeyframe {
            time_ms,
            x: cx,
            y: cy,
            scale: zoom_scale,
            easing: "ease-in-out".to_string(),
            duration_ms: duration,
        });
    }

    keyframes
}

const RAMP_MS: u64 = 200;

/// Segment-based zoom interpolation.
/// Each keyframe defines a zoom segment: ramp in -> hold -> ramp out.
/// Between segments, zoom is 1x (no zoom).
/// Must match TypeScript `interpolateZoom` exactly for preview/export parity.
pub fn interpolate_zoom(keyframes: &[ZoomKeyframe], time_ms: u64) -> (f64, f64, f64) {
    if keyframes.is_empty() {
        return (0.5, 0.5, 1.0);
    }

    for kf in keyframes {
        let seg_end = kf.time_ms + kf.duration_ms;
        if time_ms < kf.time_ms || time_ms >= seg_end {
            continue;
        }

        // Inside this segment
        let elapsed = time_ms - kf.time_ms;
        let ramp = RAMP_MS.min(kf.duration_ms / 2);

        let t = if elapsed < ramp {
            // Ramp in
            ease_in_out(elapsed as f64 / ramp as f64)
        } else if elapsed > kf.duration_ms - ramp {
            // Ramp out
            ease_in_out((seg_end - time_ms) as f64 / ramp as f64)
        } else {
            // Hold
            1.0
        };

        let x = 0.5 + (kf.x - 0.5) * t;
        let y = 0.5 + (kf.y - 0.5) * t;
        let s = 1.0 + (kf.scale - 1.0) * t;
        return (x, y, s);
    }

    (0.5, 0.5, 1.0)
}

/// Sequence-aware zoom interpolation.
/// Finds the active clip at the given sequence time, then delegates
/// to `interpolate_zoom` with the clip-relative time.
pub fn interpolate_zoom_at_sequence_time(
    seq_time: u64,
    clips: &[Clip],
    transitions: &[Option<SequenceTransition>],
) -> (f64, f64, f64) {
    let mut elapsed: i64 = 0;
    for (i, clip) in clips.iter().enumerate() {
        let clip_duration = ((clip.source_end - clip.source_start) as f64 / clip.speed) as i64;
        let overlap_before = if i > 0 {
            transitions.get(i - 1)
                .and_then(|t| t.as_ref())
                .filter(|t| t.transition_type != "cut")
                .map(|t| t.duration_ms as i64)
                .unwrap_or(0)
        } else {
            0
        };

        if (seq_time as i64) < elapsed + clip_duration - overlap_before {
            let time_in_clip = seq_time as i64 - (elapsed - overlap_before);
            return interpolate_zoom(&clip.zoom_keyframes, time_in_clip.max(0) as u64);
        }

        elapsed += clip_duration;
        if let Some(Some(t)) = transitions.get(i) {
            if t.transition_type != "cut" {
                elapsed -= t.duration_ms as i64;
            }
        }
    }
    (0.5, 0.5, 1.0)
}

fn ease_in_out(t: f64) -> f64 {
    if t < 0.5 {
        2.0 * t * t
    } else {
        -1.0 + (4.0 - 2.0 * t) * t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_click(time_ms: u64, x: f64, y: f64) -> MouseEvent {
        MouseEvent { time_ms, x, y, event_type: "click".to_string() }
    }

    fn make_move(time_ms: u64, x: f64, y: f64) -> MouseEvent {
        MouseEvent { time_ms, x, y, event_type: "move".to_string() }
    }

    #[test]
    fn test_no_clicks_returns_empty() {
        let events = vec![make_move(100, 0.5, 0.5)];
        let kfs = generate_zoom_keyframes(&events, 2.0, 1000, 500, 10000);
        assert!(kfs.is_empty());
    }

    #[test]
    fn test_single_click_generates_one_segment() {
        let events = vec![make_click(1000, 0.3, 0.7)];
        let kfs = generate_zoom_keyframes(&events, 2.0, 1000, 500, 10000);
        assert_eq!(kfs.len(), 1);
        assert_eq!(kfs[0].time_ms, 1000);
        assert_eq!(kfs[0].x, 0.3);
        assert_eq!(kfs[0].y, 0.7);
        assert_eq!(kfs[0].scale, 2.0);
        assert_eq!(kfs[0].duration_ms, 1000);
    }

    #[test]
    fn test_clustered_clicks_merge() {
        let events = vec![
            make_click(1000, 0.3, 0.3),
            make_click(1200, 0.4, 0.4), // within 500ms cluster
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, 1000, 500, 10000);
        assert_eq!(kfs.len(), 1); // one segment, not two
        // Center of cluster
        assert!((kfs[0].x - 0.35).abs() < 0.01);
        assert!((kfs[0].y - 0.35).abs() < 0.01);
    }

    #[test]
    fn test_spaced_clicks_generate_multiple_segments() {
        let events = vec![
            make_click(1000, 0.2, 0.2),
            make_click(5000, 0.8, 0.8), // well spaced
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, 1000, 500, 10000);
        assert_eq!(kfs.len(), 2); // two segments (not pairs)
    }

    #[test]
    fn test_segment_clamped_to_video_duration() {
        let events = vec![make_click(2000, 0.5, 0.5)];
        // Video is only 2400ms, click at 2000 — segment should be clamped
        let kfs = generate_zoom_keyframes(&events, 2.0, 1000, 500, 2400);
        assert_eq!(kfs.len(), 1);
        assert_eq!(kfs[0].duration_ms, 400); // 2400 - 2000
    }

    #[test]
    fn test_segment_too_close_to_end_is_skipped() {
        let events = vec![make_click(2300, 0.5, 0.5)];
        // Video is 2400ms, click at 2300 — only 100ms left, < 200 minimum
        let kfs = generate_zoom_keyframes(&events, 2.0, 1000, 500, 2400);
        assert!(kfs.is_empty());
    }

    #[test]
    fn test_interpolate_empty() {
        assert_eq!(interpolate_zoom(&[], 1000), (0.5, 0.5, 1.0));
    }

    #[test]
    fn test_interpolate_before_segment() {
        let kfs = vec![ZoomKeyframe {
            time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
            easing: "ease-in-out".to_string(), duration_ms: 1000,
        }];
        assert_eq!(interpolate_zoom(&kfs, 500), (0.5, 0.5, 1.0));
    }

    #[test]
    fn test_interpolate_after_segment() {
        let kfs = vec![ZoomKeyframe {
            time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
            easing: "ease-in-out".to_string(), duration_ms: 1000,
        }];
        assert_eq!(interpolate_zoom(&kfs, 2500), (0.5, 0.5, 1.0));
    }

    #[test]
    fn test_interpolate_hold_phase() {
        let kfs = vec![ZoomKeyframe {
            time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
            easing: "ease-in-out".to_string(), duration_ms: 1000,
        }];
        let (x, y, s) = interpolate_zoom(&kfs, 1500); // in hold phase
        assert!((x - 0.3).abs() < 0.001);
        assert!((y - 0.7).abs() < 0.001);
        assert!((s - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_interpolate_ramp_in() {
        let kfs = vec![ZoomKeyframe {
            time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0,
            easing: "ease-in-out".to_string(), duration_ms: 1000,
        }];
        let (_, _, s) = interpolate_zoom(&kfs, 1100); // 100ms into 200ms ramp
        assert!(s > 1.0 && s < 2.0);
    }

    #[test]
    fn test_interpolate_between_segments() {
        let kfs = vec![
            ZoomKeyframe { time_ms: 1000, x: 0.3, y: 0.7, scale: 2.0, easing: "ease-in-out".to_string(), duration_ms: 500 },
            ZoomKeyframe { time_ms: 3000, x: 0.5, y: 0.5, scale: 1.5, easing: "ease-in-out".to_string(), duration_ms: 500 },
        ];
        assert_eq!(interpolate_zoom(&kfs, 2000), (0.5, 0.5, 1.0));
    }

    #[test]
    fn test_sequence_interpolation_first_clip() {
        let clips = vec![
            Clip {
                id: "a".to_string(), source_start: 0, source_end: 3000, speed: 1.0,
                zoom_keyframes: vec![ZoomKeyframe {
                    time_ms: 500, duration_ms: 500, x: 0.3, y: 0.3, scale: 2.0,
                    easing: "ease-in-out".to_string(),
                }],
            },
            Clip {
                id: "b".to_string(), source_start: 5000, source_end: 8000, speed: 1.0,
                zoom_keyframes: vec![],
            },
        ];
        let transitions = vec![None];

        // 750ms is in the hold phase of the zoom segment (500..1000)
        let (_, _, scale) = interpolate_zoom_at_sequence_time(750, &clips, &transitions);
        assert!((scale - 2.0).abs() < 0.01);
    }

    #[test]
    fn test_sequence_interpolation_second_clip() {
        let clips = vec![
            Clip {
                id: "a".to_string(), source_start: 0, source_end: 3000, speed: 1.0,
                zoom_keyframes: vec![],
            },
            Clip {
                id: "b".to_string(), source_start: 5000, source_end: 8000, speed: 1.0,
                zoom_keyframes: vec![ZoomKeyframe {
                    time_ms: 500, duration_ms: 500, x: 0.7, y: 0.7, scale: 1.5,
                    easing: "ease-in-out".to_string(),
                }],
            },
        ];
        let transitions = vec![None];

        // Seq time 3750 = 3000 (clip A) + 750 into clip B -> in hold phase of kf at 500
        let (_, _, scale) = interpolate_zoom_at_sequence_time(3750, &clips, &transitions);
        assert!((scale - 1.5).abs() < 0.01);
    }

    #[test]
    fn test_sequence_interpolation_empty_clips() {
        assert_eq!(interpolate_zoom_at_sequence_time(1000, &[], &[]), (0.5, 0.5, 1.0));
    }

    #[test]
    fn test_sequence_interpolation_no_keyframes() {
        let clips = vec![Clip {
            id: "a".to_string(), source_start: 0, source_end: 5000, speed: 1.0,
            zoom_keyframes: vec![],
        }];
        assert_eq!(interpolate_zoom_at_sequence_time(2500, &clips, &[]), (0.5, 0.5, 1.0));
    }
}
