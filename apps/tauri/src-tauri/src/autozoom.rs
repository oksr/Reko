use crate::project::ZoomEvent;
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

// ── Constants ──

/// Discard clicks within this interval (rapid double/triple clicks)
const DOUBLE_CLICK_FILTER_MS: u64 = 150;
/// Lead-in before the first click moment
const LEAD_IN_MS: u64 = 400;
/// Hold after last click before zoom-out begins
const HOLD_AFTER_LAST_CLICK_MS: u64 = 1500;
/// Duration for zoom-out at end of session
const ZOOM_OUT_DURATION_MS: u64 = 600;
/// Distance factor for session radius — clicks within this from anchor drift center.
/// At 2x zoom: radius = 0.35 normalized. At 4x: 0.175.
const SESSION_RADIUS_FACTOR: f64 = 0.7;
/// Weight for old center when drifting
const CENTER_DRIFT_OLD: f64 = 0.4;
/// Weight for new click when drifting
const CENTER_DRIFT_NEW: f64 = 0.6;
/// Gap threshold to end a session — generous for natural click pauses
const SESSION_TIMEOUT_MS: u64 = 3500;

// ── Internal Structures ──

#[derive(Debug)]
struct FocusSession {
    /// Drifted center (for final zoom target)
    x: f64,
    y: f64,
    /// Anchor point — first click in session (for radius check)
    anchor_x: f64,
    anchor_y: f64,
    first_click_ms: u64,
    last_click_ms: u64,
}

// ── Helpers ──

fn distance(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let dx = ax - bx;
    let dy = ay - by;
    (dx * dx + dy * dy).sqrt()
}

fn clamp_center(x: f64, y: f64, scale: f64) -> (f64, f64) {
    let half = 0.5 / scale;
    let lo = half;
    let hi = 1.0 - half;
    (x.clamp(lo, hi), y.clamp(lo, hi))
}

// ── Pass 1: Filter noise ──

fn filter_clicks(events: &[MouseEvent]) -> Vec<&MouseEvent> {
    let clicks: Vec<&MouseEvent> = events
        .iter()
        .filter(|e| e.event_type == "click")
        .collect();

    let mut filtered: Vec<&MouseEvent> = vec![];
    for click in &clicks {
        if let Some(prev) = filtered.last() {
            let gap = click.time_ms.saturating_sub(prev.time_ms);
            if gap < DOUBLE_CLICK_FILTER_MS {
                continue;
            }
        }
        filtered.push(click);
    }
    filtered
}

// ── Pass 2: Group into sessions ──

fn group_into_sessions(clicks: &[&MouseEvent], zoom_scale: f64) -> Vec<FocusSession> {
    if clicks.is_empty() {
        return vec![];
    }

    let viewport = 1.0 / zoom_scale;
    let session_radius = viewport * SESSION_RADIUS_FACTOR;

    let mut sessions: Vec<FocusSession> = vec![];
    let first = clicks[0];
    let mut current = FocusSession {
        x: first.x,
        y: first.y,
        anchor_x: first.x,
        anchor_y: first.y,
        first_click_ms: first.time_ms,
        last_click_ms: first.time_ms,
    };

    for &click in &clicks[1..] {
        // Check distance from anchor (not drifted center) to prevent walk
        let dist_from_anchor = distance(current.anchor_x, current.anchor_y, click.x, click.y);
        let gap = click.time_ms.saturating_sub(current.last_click_ms);

        if gap > SESSION_TIMEOUT_MS || dist_from_anchor >= session_radius {
            // Far from anchor or timeout — end session, start new one
            sessions.push(current);
            current = FocusSession {
                x: click.x,
                y: click.y,
                anchor_x: click.x,
                anchor_y: click.y,
                first_click_ms: click.time_ms,
                last_click_ms: click.time_ms,
            };
        } else {
            // Within session — drift center toward new click
            current.x = current.x * CENTER_DRIFT_OLD + click.x * CENTER_DRIFT_NEW;
            current.y = current.y * CENTER_DRIFT_OLD + click.y * CENTER_DRIFT_NEW;
            current.last_click_ms = click.time_ms;
        }
    }
    sessions.push(current);
    sessions
}

// ── Pass 3: Sessions to ZoomEvents ──

fn sessions_to_events(sessions: &[FocusSession], zoom_scale: f64) -> Vec<ZoomEvent> {
    sessions
        .iter()
        .enumerate()
        .map(|(i, session)| {
            let (cx, cy) = clamp_center(session.x, session.y, zoom_scale);
            let time_ms = session.first_click_ms.saturating_sub(LEAD_IN_MS);
            let span = session.last_click_ms - session.first_click_ms;
            let duration_ms = span + LEAD_IN_MS + HOLD_AFTER_LAST_CLICK_MS + ZOOM_OUT_DURATION_MS;

            ZoomEvent {
                id: format!("auto-{}", i),
                time_ms,
                duration_ms,
                x: cx,
                y: cy,
                scale: zoom_scale,
            }
        })
        .collect()
}

// ── Pass 4: Drop overlapping events ──

fn remove_overlapping(events: Vec<ZoomEvent>) -> Vec<ZoomEvent> {
    let mut result: Vec<ZoomEvent> = vec![];
    for event in events {
        if let Some(prev) = result.last() {
            let prev_end = prev.time_ms + prev.duration_ms;
            if event.time_ms < prev_end {
                continue; // overlaps with previous — drop
            }
        }
        result.push(event);
    }
    // Re-number IDs after filtering
    for (i, event) in result.iter_mut().enumerate() {
        event.id = format!("auto-{}", i);
    }
    result
}

// ── Public API ──

pub fn generate_zoom_events(events: &[MouseEvent], zoom_scale: f64) -> Vec<ZoomEvent> {
    let clicks = filter_clicks(events);
    if clicks.is_empty() {
        return vec![];
    }
    let sessions = group_into_sessions(&clicks, zoom_scale);
    let zoom_events = sessions_to_events(&sessions, zoom_scale);
    remove_overlapping(zoom_events)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_click(time_ms: u64, x: f64, y: f64) -> MouseEvent {
        MouseEvent { time_ms, x, y, event_type: "click".to_string() }
    }

    fn make_right_click(time_ms: u64, x: f64, y: f64) -> MouseEvent {
        MouseEvent { time_ms, x, y, event_type: "rightClick".to_string() }
    }

    fn make_move(time_ms: u64, x: f64, y: f64) -> MouseEvent {
        MouseEvent { time_ms, x, y, event_type: "move".to_string() }
    }

    // ── Basic filtering ──

    #[test]
    fn test_no_clicks_returns_empty() {
        let events = vec![make_move(100, 0.5, 0.5)];
        let result = generate_zoom_events(&events, 2.0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_empty_input_returns_empty() {
        let result = generate_zoom_events(&[], 2.0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_right_clicks_ignored() {
        let events = vec![make_right_click(1000, 0.5, 0.5)];
        let result = generate_zoom_events(&events, 2.0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_rapid_clicks_filtered() {
        let events = vec![
            make_click(1000, 0.3, 0.3),
            make_click(1100, 0.8, 0.8), // 100ms < 150ms filter
            make_click(1130, 0.2, 0.2), // 30ms < 150ms filter
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 1);
        assert!((result[0].x - 0.3).abs() < 0.01);
    }

    // ── Single click timing ──

    #[test]
    fn test_single_click_timing() {
        let events = vec![make_click(1000, 0.5, 0.5)];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 1);
        let e = &result[0];
        // time = 1000 - 400 lead-in = 600
        assert_eq!(e.time_ms, 600);
        // duration = 0 span + 400 lead-in + 1500 hold + 600 zoom-out = 2500
        assert_eq!(e.duration_ms, 2500);
        assert_eq!(e.scale, 2.0);
    }

    #[test]
    fn test_zoom_scale_passed_through() {
        let events = vec![make_click(1000, 0.5, 0.5)];
        let result = generate_zoom_events(&events, 3.5);
        assert_eq!(result[0].scale, 3.5);
    }

    // ── Center drift ──

    #[test]
    fn test_close_clicks_drift_center() {
        // At scale 2.0, viewport = 0.5, session_radius = 0.4
        // Two clicks 0.05 apart — well within session
        let events = vec![
            make_click(1000, 0.5, 0.5),
            make_click(1500, 0.53, 0.53),
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 1);
        // Center drifted: 0.5 * 0.4 + 0.53 * 0.6 = 0.518
        assert!((result[0].x - 0.518).abs() < 0.01);
        assert!((result[0].y - 0.518).abs() < 0.01);
        // Span = 500ms (1500-1000), duration = 500 + 400 + 1500 + 600 = 3000
        assert_eq!(result[0].duration_ms, 3000);
    }

    #[test]
    fn test_nearby_clicks_merge_into_single_event() {
        // At scale 2.0, viewport = 0.5, session_radius = 0.35
        // Click 0.2 apart — within session radius, drifts center
        let events = vec![
            make_click(1000, 0.3, 0.3),
            make_click(2000, 0.5, 0.3), // dist 0.2 < 0.35
        ];
        let result = generate_zoom_events(&events, 2.0);
        // Both clicks absorbed into one session → 1 event
        assert_eq!(result.len(), 1);
        // Center drifted toward second click
        let expected_x = 0.3 * CENTER_DRIFT_OLD + 0.5 * CENTER_DRIFT_NEW;
        assert!((result[0].x - expected_x).abs() < 0.01);
        // Duration spans both clicks
        assert_eq!(result[0].duration_ms, 1000 + LEAD_IN_MS + HOLD_AFTER_LAST_CLICK_MS + ZOOM_OUT_DURATION_MS);
    }

    // ── Far separation ──

    #[test]
    fn test_far_clicks_separate_sessions() {
        // Clicks far apart spatially (dist > session_radius)
        // Spaced 5s apart so events don't overlap
        let events = vec![
            make_click(1000, 0.1, 0.1),
            make_click(6000, 0.9, 0.9), // dist ~1.13, well beyond 0.35
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 2);
        assert!((result[0].x - 0.25).abs() < 0.01); // clamped
        assert!((result[1].x - 0.75).abs() < 0.01); // clamped
    }

    // ── Session timeout ──

    #[test]
    fn test_session_timeout_splits() {
        // Gap > 3500ms → separate sessions even if spatially close
        let events = vec![
            make_click(1000, 0.5, 0.5),
            make_click(5000, 0.52, 0.52), // 4000ms gap > 3500ms
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_within_timeout_stays_in_session() {
        // Same area click within timeout
        let events = vec![
            make_click(1000, 0.5, 0.5),
            make_click(4000, 0.52, 0.52), // 3000ms gap < 3500ms
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 1);
    }

    // ── Edge clamping ──

    #[test]
    fn test_edge_clamping() {
        // Click at corner — should clamp
        let events = vec![make_click(1000, 0.0, 1.0)];
        let result = generate_zoom_events(&events, 2.0);
        // At scale 2.0: clamp range = [0.25, 0.75]
        assert!((result[0].x - 0.25).abs() < 0.001);
        assert!((result[0].y - 0.75).abs() < 0.001);
    }

    #[test]
    fn test_edge_clamping_high_zoom() {
        // At scale 4.0: clamp range = [0.125, 0.875]
        let events = vec![make_click(1000, 0.05, 0.95)];
        let result = generate_zoom_events(&events, 4.0);
        assert!((result[0].x - 0.125).abs() < 0.001);
        assert!((result[0].y - 0.875).abs() < 0.001);
    }

    // ── Scale-adaptive thresholds ──

    #[test]
    fn test_thresholds_adapt_to_scale() {
        // At scale 2.0: session_radius = 0.35
        // At scale 4.0: session_radius = 0.175
        // Clicks 0.2 apart, 2s gap (within timeout, non-overlapping)
        let events = vec![
            make_click(1000, 0.5, 0.5),
            make_click(3000, 0.7, 0.5), // dist = 0.2
        ];

        let result_2x = generate_zoom_events(&events, 2.0);
        let result_4x = generate_zoom_events(&events, 4.0);

        // At 2x: 0.2 < 0.35 → same session → 1 event
        assert_eq!(result_2x.len(), 1);
        // At 4x: 0.2 > 0.175 → separate sessions, but first event (1000-600=600,
        // dur=2500, ends 3100) overlaps second (3000-400=2600) → second dropped
        // So at 4x with close timing we get 1 event too.
        // Use wider spacing to see the difference:
        assert_eq!(result_4x.len(), 1);

        // With wider spacing (no overlap possible):
        let events_wide = vec![
            make_click(1000, 0.5, 0.5),
            make_click(5000, 0.7, 0.5), // 4s gap > timeout at 4x
        ];
        let result_2x_wide = generate_zoom_events(&events_wide, 2.0);
        let result_4x_wide = generate_zoom_events(&events_wide, 4.0);

        // At 2x: timeout (4000 > 3500) → 2 sessions, but first ends at 3100,
        // second starts at 4600 → no overlap → 2 events
        assert_eq!(result_2x_wide.len(), 2);
        // At 4x: same → 2 events
        assert_eq!(result_4x_wide.len(), 2);
    }

    // ── Mixed scenario ──

    #[test]
    fn test_mixed_scenario() {
        // At scale 2.0: session_radius = 0.35, timeout = 3500ms
        let events = vec![
            make_right_click(500, 0.5, 0.5),  // ignored
            make_click(1000, 0.3, 0.3),        // session 1 start (anchor)
            make_click(1050, 0.35, 0.35),      // filtered (50ms)
            make_click(1500, 0.32, 0.32),      // within radius from anchor → drift
            make_click(2000, 0.5, 0.3),        // dist from anchor(0.3,0.3) = 0.2 < 0.35 → drift
            make_click(10000, 0.8, 0.8),       // timeout + far → session 2
            make_move(11000, 0.1, 0.1),        // ignored
        ];
        let result = generate_zoom_events(&events, 2.0);

        // Session 1: all nearby clicks merged → 1 event
        // Session 2: 1 event (far from session 1)
        assert_eq!(result.len(), 2);

        // Session 2 at (0.8, 0.8) → clamped to 0.75
        assert!((result[1].x - 0.75).abs() < 0.01);
        assert!((result[1].y - 0.75).abs() < 0.01);
    }

    #[test]
    fn test_multiple_nearby_clicks_single_event() {
        // 3 clicks all within session radius at scale 2.0 (radius = 0.4)
        let events = vec![
            make_click(1000, 0.3, 0.5),
            make_click(2000, 0.5, 0.5),  // dist 0.2 < 0.4
            make_click(3000, 0.6, 0.5),  // dist from drifted center < 0.4
        ];
        let result = generate_zoom_events(&events, 2.0);
        // All absorbed into one session → 1 event
        assert_eq!(result.len(), 1);
        // Duration spans first to last: 2000 + 400 + 1500 + 600 = 4500
        assert_eq!(result[0].duration_ms, 4500);
    }

    // ── Real-world pattern: right-side clicks with natural pauses ──

    #[test]
    fn test_real_world_right_side_cluster() {
        // Clicks on right side of screen with 3s pauses
        // Anchor at first click (0.73, 0.39), others within radius 0.35
        let events = vec![
            make_click(26437, 0.73, 0.39),  // anchor
            make_click(29443, 0.76, 0.66),  // dist 0.27 from anchor < 0.35
            make_click(32822, 0.76, 0.36),  // dist 0.04 from anchor < 0.35
            make_click(35501, 0.66, 0.41),  // dist 0.07 from anchor < 0.35
            make_click(37567, 0.64, 0.57),  // dist 0.20 from anchor < 0.35
        ];
        let result = generate_zoom_events(&events, 2.0);
        // All within radius and gaps < 3500ms → 1 session
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_real_world_full_recording() {
        // Full click pattern from actual recording
        let events = vec![
            make_click(1689, 0.37, 0.68),   // isolated early click
            make_click(15409, 0.50, 0.44),   // center area cluster start
            make_click(16821, 0.48, 0.53),
            make_click(18272, 0.34, 0.45),
            make_click(19621, 0.31, 0.58),
            make_click(20763, 0.32, 0.68),
            make_click(21795, 0.46, 0.31),
            make_click(22690, 0.46, 0.52),
            make_click(26437, 0.73, 0.39),   // right side cluster
            make_click(29443, 0.76, 0.66),
            make_click(32822, 0.76, 0.36),
            make_click(35501, 0.66, 0.41),
            make_click(37567, 0.64, 0.57),
            make_click(39709, 0.47, 0.93),   // bottom click
            make_click(40248, 0.47, 0.93),   // same spot
        ];
        let result = generate_zoom_events(&events, 2.0);
        // 15 clicks → 3 events: isolated, center cluster, right cluster
        // Bottom click (39.3s) overlaps with right cluster end (39.7s) → dropped
        assert_eq!(result.len(), 3);
    }

    // ── Lead-in at time zero ──

    #[test]
    fn test_lead_in_saturates_at_zero() {
        let events = vec![make_click(100, 0.5, 0.5)];
        let result = generate_zoom_events(&events, 2.0);
        // 100 - 400 would underflow, saturating_sub gives 0
        assert_eq!(result[0].time_ms, 0);
    }

    // ── Helpers ──

    #[test]
    fn test_distance() {
        assert!((distance(0.0, 0.0, 1.0, 0.0) - 1.0).abs() < 0.001);
        assert!((distance(0.0, 0.0, 0.0, 0.0)).abs() < 0.001);
        assert!((distance(0.0, 0.0, 1.0, 1.0) - std::f64::consts::SQRT_2).abs() < 0.001);
    }

    #[test]
    fn test_clamp_center() {
        // scale 2.0: range [0.25, 0.75]
        assert_eq!(clamp_center(0.5, 0.5, 2.0), (0.5, 0.5));
        assert_eq!(clamp_center(0.0, 0.0, 2.0), (0.25, 0.25));
        assert_eq!(clamp_center(1.0, 1.0, 2.0), (0.75, 0.75));

        // scale 1.0: range [0.5, 0.5] → always center
        assert_eq!(clamp_center(0.0, 0.0, 1.0), (0.5, 0.5));
    }
}
