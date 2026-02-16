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

// ── Session-based generation constants ──

const SESSION_MERGE_INTERVAL_MS: u64 = 3000;
const SESSION_MERGE_DISTANCE: f64 = 0.3;
const IDLE_TIMEOUT_MS: u64 = 4000;
const FOCUSING_DURATION_MS: u64 = 300;
const POST_SESSION_HOLD_MS: u64 = 500;
const INTRA_SESSION_DEAD_ZONE: f64 = 0.12;
const INTRA_SESSION_MIN_INTERVAL_MS: u64 = 800;

#[derive(Debug)]
struct Session {
    start_ms: u64,
    end_ms: u64,
    center_x: f64,
    center_y: f64,
    activities: Vec<(u64, f64, f64)>, // (time, x, y)
}

/// Generate zoom keyframes from mouse events using session-based clustering.
///
/// Algorithm:
/// 1. Filter to click/rightClick events
/// 2. Group into sessions by time + distance proximity
/// 3. Generate keyframe pairs: zoom-in before session, hold during, zoom-out after
/// 4. Smart transitions: pan directly between close sessions, zoom-out-then-in for distant ones
pub fn generate_zoom_keyframes(
    events: &[MouseEvent],
    zoom_scale: f64,
    transition_speed: &str,
    video_duration_ms: u64,
) -> Vec<ZoomKeyframe> {
    let clicks: Vec<&MouseEvent> = events
        .iter()
        .filter(|e| e.event_type == "click" || e.event_type == "rightClick")
        .collect();

    if clicks.is_empty() {
        return vec![];
    }

    // Step 1: Build sessions
    let sessions = build_sessions(&clicks);
    if sessions.is_empty() {
        return vec![];
    }

    // Step 2: Generate keyframes from sessions
    let _speed = transition_speed; // reserved for future per-keyframe spring params
    generate_keyframes_from_sessions(&sessions, zoom_scale, video_duration_ms)
}

fn build_sessions<'a>(clicks: &[&'a MouseEvent]) -> Vec<Session> {
    let mut sessions: Vec<Session> = vec![];

    for click in clicks {
        let merged = if let Some(last) = sessions.last_mut() {
            let time_gap = click.time_ms.saturating_sub(last.end_ms);
            let dx = click.x - last.center_x;
            let dy = click.y - last.center_y;
            let dist = (dx * dx + dy * dy).sqrt();

            if time_gap < SESSION_MERGE_INTERVAL_MS && dist < SESSION_MERGE_DISTANCE {
                // Merge into current session
                last.activities.push((click.time_ms, click.x, click.y));
                last.end_ms = click.time_ms + POST_SESSION_HOLD_MS;
                // Recompute center with recency weighting
                let mut total_weight = 0.0;
                let mut wx = 0.0;
                let mut wy = 0.0;
                for (idx, &(_, ax, ay)) in last.activities.iter().enumerate() {
                    let w = 1.0 + idx as f64 * 0.5;
                    wx += ax * w;
                    wy += ay * w;
                    total_weight += w;
                }
                last.center_x = wx / total_weight;
                last.center_y = wy / total_weight;
                true
            } else {
                false
            }
        } else {
            false
        };

        if !merged {
            sessions.push(Session {
                start_ms: click.time_ms,
                end_ms: click.time_ms + POST_SESSION_HOLD_MS,
                center_x: click.x,
                center_y: click.y,
                activities: vec![(click.time_ms, click.x, click.y)],
            });
        }
    }

    sessions
}

fn generate_keyframes_from_sessions(
    sessions: &[Session],
    zoom_scale: f64,
    video_duration_ms: u64,
) -> Vec<ZoomKeyframe> {
    let mut keyframes: Vec<ZoomKeyframe> = vec![];

    for (i, session) in sessions.iter().enumerate() {
        let focus_start = session.start_ms.saturating_sub(FOCUSING_DURATION_MS);

        // If this is the first session or we're coming from 1x, add a 1x keyframe before zoom-in
        let need_zoom_in = if i == 0 {
            true
        } else {
            let prev = &sessions[i - 1];
            let gap = session.start_ms.saturating_sub(prev.end_ms);
            gap >= IDLE_TIMEOUT_MS
        };

        if need_zoom_in {
            // Insert 1x anchor before the zoom-in
            keyframes.push(ZoomKeyframe {
                time_ms: focus_start,
                x: session.center_x,
                y: session.center_y,
                scale: 1.0,
                easing: "linear".to_string(),
            });
        }

        // Zoom-in keyframe at session start
        keyframes.push(ZoomKeyframe {
            time_ms: session.start_ms,
            x: session.center_x,
            y: session.center_y,
            scale: zoom_scale,
            easing: "spring".to_string(),
        });

        // Intra-session pans for long sessions
        if session.activities.len() > 1 {
            let mut last_pan_time = session.start_ms;
            let mut last_pan_x = session.center_x;
            let mut last_pan_y = session.center_y;

            for &(t, ax, ay) in &session.activities[1..] {
                let dx = ax - last_pan_x;
                let dy = ay - last_pan_y;
                let dist = (dx * dx + dy * dy).sqrt();
                let time_gap = t.saturating_sub(last_pan_time);

                if dist > INTRA_SESSION_DEAD_ZONE && time_gap >= INTRA_SESSION_MIN_INTERVAL_MS {
                    keyframes.push(ZoomKeyframe {
                        time_ms: t,
                        x: ax,
                        y: ay,
                        scale: zoom_scale,
                        easing: "spring".to_string(),
                            });
                    last_pan_time = t;
                    last_pan_x = ax;
                    last_pan_y = ay;
                }
            }
        }

        // Transition to next session or zoom-out
        if i + 1 < sessions.len() {
            let next = &sessions[i + 1];
            let gap = next.start_ms.saturating_sub(session.end_ms);

            if gap < IDLE_TIMEOUT_MS {
                // Direct pan to next session (stay zoomed)
                // The next iteration will add the zoom-in keyframe which acts as a pan
            } else {
                // Zoom out after idle
                let zoom_out_time = (session.end_ms + POST_SESSION_HOLD_MS).min(video_duration_ms);
                keyframes.push(ZoomKeyframe {
                    time_ms: zoom_out_time,
                    x: session.center_x,
                    y: session.center_y,
                    scale: 1.0,
                    easing: "ease-out".to_string(),
                    });
            }
        } else {
            // Last session: zoom out
            let zoom_out_time = (session.end_ms + POST_SESSION_HOLD_MS).min(video_duration_ms);
            keyframes.push(ZoomKeyframe {
                time_ms: zoom_out_time,
                x: session.center_x,
                y: session.center_y,
                scale: 1.0,
                easing: "ease-out".to_string(),
            });
        }
    }

    // Deduplicate keyframes at same time (keep last)
    keyframes.sort_by_key(|kf| kf.time_ms);
    keyframes.dedup_by_key(|kf| kf.time_ms);

    keyframes
}

// ── Spring physics interpolation ──

/// Spring response times for each speed setting
pub fn spring_params(speed: &str) -> (f64, f64) {
    match speed {
        "slow" => (1.4, 1.0),
        "fast" => (0.65, 0.95),
        _ => (1.0, 1.0), // medium (default)
    }
}

/// Critically-damped (or underdamped) spring easing.
/// Must match TypeScript and Swift implementations exactly.
pub fn spring_ease(t: f64, response: f64, damping: f64) -> f64 {
    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }

    let omega = 2.0 * std::f64::consts::PI / response;
    let actual_t = t * response * 2.0;
    let decay = (-damping * omega * actual_t).exp();

    if damping >= 1.0 {
        // Critically damped
        1.0 - (1.0 + omega * actual_t) * decay
    } else {
        // Underdamped
        let damped_freq = omega * (1.0 - damping * damping).sqrt();
        1.0 - decay
            * ((damped_freq * actual_t).cos()
                + (damping * omega / damped_freq) * (damped_freq * actual_t).sin())
    }
}

fn ease_out(t: f64) -> f64 {
    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }
    1.0 - (1.0 - t) * (1.0 - t)
}

fn apply_easing(t: f64, easing: &str, response: f64, damping: f64) -> f64 {
    match easing {
        "spring" => spring_ease(t, response, damping),
        "ease-out" => ease_out(t),
        _ => t, // linear
    }
}

/// Keyframe-pair zoom interpolation.
/// Finds the surrounding keyframe pair and interpolates using the target keyframe's easing.
/// Must match TypeScript `interpolateZoom` exactly for preview/export parity.
pub fn interpolate_zoom(keyframes: &[ZoomKeyframe], time_ms: u64) -> (f64, f64, f64) {
    interpolate_zoom_with_cursor(keyframes, time_ms, None, 0.0, "medium")
}

pub fn interpolate_zoom_with_cursor(
    keyframes: &[ZoomKeyframe],
    time_ms: u64,
    cursor: Option<(f64, f64)>,
    cursor_follow_strength: f64,
    transition_speed: &str,
) -> (f64, f64, f64) {
    if keyframes.is_empty() {
        return (0.5, 0.5, 1.0);
    }

    let (response, damping) = spring_params(transition_speed);

    // Before first keyframe
    if time_ms <= keyframes[0].time_ms {
        let kf = &keyframes[0];
        let (x, y) = apply_cursor_follow(kf.x, kf.y, cursor, cursor_follow_strength, kf.scale);
        return (x, y, kf.scale);
    }

    // After last keyframe
    if time_ms >= keyframes[keyframes.len() - 1].time_ms {
        let kf = &keyframes[keyframes.len() - 1];
        let (x, y) = apply_cursor_follow(kf.x, kf.y, cursor, cursor_follow_strength, kf.scale);
        return (x, y, kf.scale);
    }

    // Find surrounding pair
    let mut next_idx = 0;
    for (i, kf) in keyframes.iter().enumerate() {
        if kf.time_ms > time_ms {
            next_idx = i;
            break;
        }
    }

    let prev = &keyframes[next_idx - 1];
    let next = &keyframes[next_idx];

    let duration = (next.time_ms - prev.time_ms) as f64;
    let raw_t = if duration > 0.0 {
        (time_ms - prev.time_ms) as f64 / duration
    } else {
        1.0
    };

    let eased_t = apply_easing(raw_t, &next.easing, response, damping);

    let x = prev.x + (next.x - prev.x) * eased_t;
    let y = prev.y + (next.y - prev.y) * eased_t;
    let scale = prev.scale + (next.scale - prev.scale) * eased_t;

    let (fx, fy) = apply_cursor_follow(x, y, cursor, cursor_follow_strength, scale);
    (fx, fy, scale)
}

fn apply_cursor_follow(
    x: f64,
    y: f64,
    cursor: Option<(f64, f64)>,
    strength: f64,
    scale: f64,
) -> (f64, f64) {
    if strength <= 0.0 || scale <= 1.0 {
        return (x, y);
    }
    match cursor {
        Some((cx, cy)) => {
            // Only apply follow when zoomed in
            let blend = strength * ((scale - 1.0) / 1.0).min(1.0);
            (x * (1.0 - blend) + cx * blend, y * (1.0 - blend) + cy * blend)
        }
        None => (x, y),
    }
}

/// Smooth cursor position using a weighted moving average over a trailing window.
pub fn smoothed_cursor_position(events: &[MouseEvent], time_ms: u64, window_ms: u64) -> Option<(f64, f64)> {
    if events.is_empty() {
        return None;
    }
    let samples = 7usize;
    let mut total_weight = 0.0f64;
    let mut wx = 0.0f64;
    let mut wy = 0.0f64;
    let mut hit_count = 0usize;

    for i in 0..samples {
        let t = if time_ms >= window_ms {
            time_ms - window_ms + (window_ms * i as u64) / (samples as u64 - 1)
        } else {
            (time_ms * i as u64) / (samples as u64 - 1)
        };

        // Binary search for last event at or before t
        let pos = {
            let mut lo = 0usize;
            let mut hi = events.len() - 1;
            while lo < hi {
                let mid = (lo + hi + 1) / 2;
                if events[mid].time_ms <= t {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            if events[lo].time_ms <= t {
                Some((events[lo].x, events[lo].y))
            } else {
                None
            }
        };

        if let Some((px, py)) = pos {
            let weight = ((i as f64 - (samples as f64 - 1.0)) / 2.0).exp();
            wx += px * weight;
            wy += py * weight;
            total_weight += weight;
            hit_count += 1;
        }
    }

    if hit_count == 0 {
        return None;
    }
    Some((wx / total_weight, wy / total_weight))
}

/// Sequence-aware zoom interpolation.
/// Finds the active clip at the given sequence time, then delegates
/// to `interpolate_zoom` with the clip-relative time.
pub fn interpolate_zoom_at_sequence_time(
    seq_time: u64,
    clips: &[Clip],
    transitions: &[Option<SequenceTransition>],
) -> (f64, f64, f64) {
    interpolate_zoom_at_sequence_time_with_cursor(seq_time, clips, transitions, None, 0.0, "medium")
}

pub fn interpolate_zoom_at_sequence_time_with_cursor(
    seq_time: u64,
    clips: &[Clip],
    transitions: &[Option<SequenceTransition>],
    mouse_events: Option<&[MouseEvent]>,
    cursor_follow_strength: f64,
    transition_speed: &str,
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
            let clip_time = time_in_clip.max(0) as u64;
            let source_time = clip.source_start + clip_time;
            let cursor = mouse_events
                .and_then(|evts| smoothed_cursor_position(evts, source_time, 150));
            return interpolate_zoom_with_cursor(
                &clip.zoom_keyframes,
                clip_time,
                cursor,
                cursor_follow_strength,
                transition_speed,
            );
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_click(time_ms: u64, x: f64, y: f64) -> MouseEvent {
        MouseEvent { time_ms, x, y, event_type: "click".to_string() }
    }

    fn make_move(time_ms: u64, x: f64, y: f64) -> MouseEvent {
        MouseEvent { time_ms, x, y, event_type: "move".to_string() }
    }

    fn kf(time_ms: u64, x: f64, y: f64, scale: f64, easing: &str) -> ZoomKeyframe {
        ZoomKeyframe {
            time_ms, x, y, scale,
            easing: easing.to_string(),
        }
    }

    // ── Session clustering tests ──

    #[test]
    fn test_no_clicks_returns_empty() {
        let events = vec![make_move(100, 0.5, 0.5)];
        let kfs = generate_zoom_keyframes(&events, 2.0, "medium", 10000);
        assert!(kfs.is_empty());
    }

    #[test]
    fn test_single_click_generates_keyframes() {
        let events = vec![make_click(1000, 0.3, 0.7)];
        let kfs = generate_zoom_keyframes(&events, 2.0, "medium", 10000);
        // Should have: 1x anchor -> zoom-in -> zoom-out
        assert!(kfs.len() >= 3);
        // First is 1x anchor
        assert_eq!(kfs[0].scale, 1.0);
        // Second is zoom-in
        assert_eq!(kfs[1].time_ms, 1000);
        assert_eq!(kfs[1].scale, 2.0);
        assert!((kfs[1].x - 0.3).abs() < 0.01);
        assert!((kfs[1].y - 0.7).abs() < 0.01);
        // Last is zoom-out
        assert_eq!(kfs.last().unwrap().scale, 1.0);
    }

    #[test]
    fn test_close_clicks_merge_into_session() {
        let events = vec![
            make_click(1000, 0.3, 0.3),
            make_click(1500, 0.35, 0.35), // within 3000ms and distance < 0.3
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, "medium", 10000);
        // Should be one session, so: 1x anchor, zoom-in, zoom-out
        let zoom_kfs: Vec<_> = kfs.iter().filter(|k| k.scale > 1.0).collect();
        // One session = one zoom-in
        assert_eq!(zoom_kfs.len(), 1);
    }

    #[test]
    fn test_distant_clicks_create_separate_sessions() {
        let events = vec![
            make_click(1000, 0.1, 0.1),
            make_click(8000, 0.9, 0.9), // far in time (>3000ms) and distance (>0.3)
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, "medium", 20000);
        let zoom_kfs: Vec<_> = kfs.iter().filter(|k| k.scale > 1.0).collect();
        assert_eq!(zoom_kfs.len(), 2); // two separate zoom-ins
    }

    #[test]
    fn test_close_sessions_direct_pan() {
        // Two sessions close in time (gap < IDLE_TIMEOUT_MS) but different positions
        let events = vec![
            make_click(1000, 0.2, 0.2),
            make_click(3000, 0.8, 0.8), // 3000ms gap, different position but close in time
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, "medium", 20000);
        // Between sessions close in time, there should NOT be a zoom-out to 1x between them
        let zoom_outs_between: Vec<_> = kfs.iter()
            .filter(|k| k.scale == 1.0 && k.time_ms > 1000 && k.time_ms < 3000)
            .collect();
        assert!(zoom_outs_between.is_empty(), "Should not zoom out between close sessions");
    }

    #[test]
    fn test_distant_sessions_zoom_out_between() {
        let events = vec![
            make_click(1000, 0.2, 0.2),
            make_click(10000, 0.8, 0.8), // gap > IDLE_TIMEOUT_MS
        ];
        let kfs = generate_zoom_keyframes(&events, 2.0, "medium", 20000);
        // Should have a zoom-out between sessions
        let zoom_outs_between: Vec<_> = kfs.iter()
            .filter(|k| k.scale == 1.0 && k.time_ms > 1000 && k.time_ms < 10000)
            .collect();
        assert!(!zoom_outs_between.is_empty(), "Should zoom out between distant sessions");
    }

    #[test]
    fn test_zoom_out_at_end() {
        let events = vec![make_click(1000, 0.5, 0.5)];
        let kfs = generate_zoom_keyframes(&events, 2.0, "medium", 10000);
        let last = kfs.last().unwrap();
        assert_eq!(last.scale, 1.0);
        assert_eq!(last.easing, "ease-out");
    }

    // ── Spring easing tests (canonical vectors) ──

    #[test]
    fn test_spring_ease_boundaries() {
        assert_eq!(spring_ease(0.0, 0.7, 1.0), 0.0);
        assert_eq!(spring_ease(1.0, 0.7, 1.0), 1.0);
    }

    #[test]
    fn test_spring_ease_midpoint() {
        let mid = spring_ease(0.5, 0.7, 1.0);
        assert!(mid > 0.5, "Spring should overshoot midpoint: {}", mid);
        assert!(mid < 1.5, "Spring should not be extreme: {}", mid);
    }

    #[test]
    fn test_spring_ease_critically_damped() {
        // Critically damped (damping=1.0) should approach 1.0 monotonically
        let v1 = spring_ease(0.25, 0.7, 1.0);
        let v2 = spring_ease(0.5, 0.7, 1.0);
        let v3 = spring_ease(0.75, 0.7, 1.0);
        assert!(v1 < v2, "Should be monotonically increasing");
        assert!(v2 < v3, "Should be monotonically increasing");
    }

    #[test]
    fn test_spring_ease_underdamped() {
        // Underdamped (damping < 1.0) — may overshoot
        let v = spring_ease(0.5, 0.4, 0.95);
        assert!(v > 0.0);
    }

    // Canonical test vectors for cross-layer parity
    #[test]
    fn test_spring_canonical_vectors() {
        let cases = [
            // (t, response, damping, expected_min, expected_max)
            (0.0, 0.7, 1.0, 0.0, 0.001),
            (1.0, 0.7, 1.0, 0.999, 1.001),
            (0.25, 0.7, 1.0, 0.4, 0.95),
            (0.5, 0.7, 1.0, 0.8, 1.1),
            (0.75, 0.7, 1.0, 0.95, 1.05),
            (0.5, 1.0, 1.0, 0.6, 1.0),
            (0.5, 0.4, 0.95, 0.7, 1.2),
        ];
        for (t, r, d, min, max) in &cases {
            let v = spring_ease(*t, *r, *d);
            assert!(
                v >= *min && v <= *max,
                "spring_ease({}, {}, {}) = {} not in [{}, {}]",
                t, r, d, v, min, max
            );
        }
    }

    // ── Keyframe-pair interpolation tests ──

    #[test]
    fn test_interpolate_empty() {
        assert_eq!(interpolate_zoom(&[], 1000), (0.5, 0.5, 1.0));
    }

    #[test]
    fn test_interpolate_before_first_keyframe() {
        let kfs = vec![kf(1000, 0.3, 0.7, 2.0, "spring")];
        let (x, y, s) = interpolate_zoom(&kfs, 500);
        // Before first kf: returns first kf's values
        assert!((x - 0.3).abs() < 0.001);
        assert!((y - 0.7).abs() < 0.001);
        assert!((s - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_interpolate_after_last_keyframe() {
        let kfs = vec![kf(1000, 0.3, 0.7, 2.0, "spring")];
        let (x, y, s) = interpolate_zoom(&kfs, 2500);
        // After last kf: returns last kf's values
        assert!((x - 0.3).abs() < 0.001);
        assert!((y - 0.7).abs() < 0.001);
        assert!((s - 2.0).abs() < 0.001);
    }

    #[test]
    fn test_interpolate_between_keyframes_linear() {
        let kfs = vec![
            kf(0, 0.5, 0.5, 1.0, "linear"),
            kf(1000, 0.3, 0.7, 2.0, "linear"),
        ];
        let (x, y, s) = interpolate_zoom(&kfs, 500);
        // Linear at midpoint
        assert!((x - 0.4).abs() < 0.001);
        assert!((y - 0.6).abs() < 0.001);
        assert!((s - 1.5).abs() < 0.001);
    }

    #[test]
    fn test_interpolate_between_keyframes_spring() {
        let kfs = vec![
            kf(0, 0.5, 0.5, 1.0, "linear"),
            kf(1000, 0.3, 0.7, 2.0, "spring"),
        ];
        let (_, _, s) = interpolate_zoom(&kfs, 500);
        // Spring at t=0.5 should be > linear 0.5 (spring overshoots)
        assert!(s > 1.5, "Spring should overshoot linear midpoint: {}", s);
    }

    #[test]
    fn test_interpolate_zoom_out_ease_out() {
        let kfs = vec![
            kf(0, 0.3, 0.7, 2.0, "spring"),
            kf(1000, 0.3, 0.7, 1.0, "ease-out"),
        ];
        let (_, _, s) = interpolate_zoom(&kfs, 500);
        // Ease-out at t=0.5: 1-(1-0.5)^2 = 0.75, so scale = 2.0 + (1.0 - 2.0) * 0.75 = 1.25
        assert!((s - 1.25).abs() < 0.01, "Scale should be ~1.25: {}", s);
    }

    #[test]
    fn test_interpolate_sequence_first_clip() {
        let clips = vec![
            Clip {
                id: "a".to_string(), source_start: 0, source_end: 3000, speed: 1.0,
                zoom_keyframes: vec![
                    kf(0, 0.5, 0.5, 1.0, "linear"),
                    kf(500, 0.3, 0.3, 2.0, "spring"),
                    kf(1500, 0.3, 0.3, 1.0, "ease-out"),
                ],
            },
            Clip {
                id: "b".to_string(), source_start: 5000, source_end: 8000, speed: 1.0,
                zoom_keyframes: vec![],
            },
        ];
        let transitions = vec![None];

        // At time 500 (zoom-in keyframe), scale should be 2.0
        let (_, _, scale) = interpolate_zoom_at_sequence_time(500, &clips, &transitions);
        assert!((scale - 2.0).abs() < 0.01);
    }

    #[test]
    fn test_interpolate_sequence_empty_clips() {
        assert_eq!(interpolate_zoom_at_sequence_time(1000, &[], &[]), (0.5, 0.5, 1.0));
    }

    #[test]
    fn test_interpolate_sequence_no_keyframes() {
        let clips = vec![Clip {
            id: "a".to_string(), source_start: 0, source_end: 5000, speed: 1.0,
            zoom_keyframes: vec![],
        }];
        assert_eq!(interpolate_zoom_at_sequence_time(2500, &clips, &[]), (0.5, 0.5, 1.0));
    }

    #[test]
    fn test_cursor_follow_strength() {
        let kfs = vec![
            kf(0, 0.5, 0.5, 1.0, "linear"),
            kf(1000, 0.3, 0.3, 2.0, "linear"),
        ];
        // At time 1000, fully zoomed. Cursor at (0.8, 0.8), strength 0.5
        let (x, y, _) = interpolate_zoom_with_cursor(&kfs, 1000, Some((0.8, 0.8)), 0.5, "medium");
        // Should blend between 0.3 and 0.8 by 0.5
        assert!((x - 0.55).abs() < 0.01);
        assert!((y - 0.55).abs() < 0.01);
    }

    #[test]
    fn test_cursor_follow_only_when_zoomed() {
        let kfs = vec![kf(0, 0.5, 0.5, 1.0, "linear")];
        // At scale 1.0, cursor follow should not apply
        let (x, y, _) = interpolate_zoom_with_cursor(&kfs, 0, Some((0.8, 0.8)), 1.0, "medium");
        assert!((x - 0.5).abs() < 0.01);
        assert!((y - 0.5).abs() < 0.01);
    }
}
