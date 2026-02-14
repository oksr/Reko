use crate::project::ZoomKeyframe;
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

/// Generate zoom keyframes from mouse click events.
///
/// Algorithm:
/// 1. Filter to click events only
/// 2. Group clicks that are close in time (within `cluster_ms`)
/// 3. For each cluster, create a zoom-in keyframe at the cluster center
/// 4. After each zoom-in, add a zoom-out keyframe (`hold_ms` later)
/// 5. Ensure keyframes don't overlap
pub fn generate_zoom_keyframes(
    events: &[MouseEvent],
    zoom_scale: f64,
    transition_ms: u64,
    hold_ms: u64,
    cluster_ms: u64,
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

    // Generate zoom-in + zoom-out pairs from clusters
    let mut keyframes: Vec<ZoomKeyframe> = vec![];

    for cluster in &clusters {
        // Cluster center = average position
        let cx: f64 = cluster.iter().map(|e| e.x).sum::<f64>() / cluster.len() as f64;
        let cy: f64 = cluster.iter().map(|e| e.y).sum::<f64>() / cluster.len() as f64;
        let time_ms = cluster[0].time_ms;

        // Check there's room: don't overlap with previous zoom-out
        if let Some(last) = keyframes.last() {
            if time_ms < last.time_ms + last.duration_ms + 100 {
                continue; // Skip — too close to previous
            }
        }

        // Zoom IN
        keyframes.push(ZoomKeyframe {
            time_ms,
            x: cx,
            y: cy,
            scale: zoom_scale,
            easing: "ease-in-out".to_string(),
            duration_ms: transition_ms,
        });

        // Zoom OUT (return to 1.0)
        keyframes.push(ZoomKeyframe {
            time_ms: time_ms + transition_ms + hold_ms,
            x: 0.5,
            y: 0.5,
            scale: 1.0,
            easing: "ease-in-out".to_string(),
            duration_ms: transition_ms,
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
        let kfs = generate_zoom_keyframes(&events, 2.0, 300, 1000, 500);
        assert!(kfs.is_empty());
    }

    #[test]
    fn test_single_click_generates_zoom_pair() {
        let events = vec![make_click(1000, 0.3, 0.7)];
        let kfs = generate_zoom_keyframes(&events, 2.0, 300, 1000, 500);
        assert_eq!(kfs.len(), 2);
        // Zoom in
        assert_eq!(kfs[0].time_ms, 1000);
        assert_eq!(kfs[0].x, 0.3);
        assert_eq!(kfs[0].y, 0.7);
        assert_eq!(kfs[0].scale, 2.0);
        assert_eq!(kfs[0].duration_ms, 300);
        // Zoom out
        assert_eq!(kfs[1].time_ms, 1000 + 300 + 1000); // 2300
        assert_eq!(kfs[1].scale, 1.0);
    }

    #[test]
    fn test_clustered_clicks_merge() {
        let events = vec![
            make_click(1000, 0.3, 0.3),
            make_click(1200, 0.4, 0.4), // within 500ms cluster
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, 300, 1000, 500);
        assert_eq!(kfs.len(), 2); // one pair, not two
        // Center of cluster
        assert!((kfs[0].x - 0.35).abs() < 0.01);
        assert!((kfs[0].y - 0.35).abs() < 0.01);
    }

    #[test]
    fn test_spaced_clicks_generate_multiple_pairs() {
        let events = vec![
            make_click(1000, 0.2, 0.2),
            make_click(5000, 0.8, 0.8), // well spaced
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, 300, 1000, 500);
        assert_eq!(kfs.len(), 4); // two pairs
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
}
