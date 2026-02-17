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
const MIN_CLICK_INTERVAL_MS: u64 = 200;
/// Discard clicks closer than this to the previous (same spot re-clicks)
const MIN_CLICK_DISTANCE: f64 = 0.03;
/// Lead-in before the click moment
const LEAD_IN_MS: u64 = 300;
/// Default hold duration for each zoom event
const DEFAULT_DURATION_MS: u64 = 1500;
/// Merge events whose gap is smaller than this (avoids brief zoom-out/zoom-in cycles)
const MERGE_GAP_MS: u64 = 2000;

/// Generate zoom events from mouse events using intentional click filtering.
///
/// Algorithm:
/// 1. Filter to left-clicks only (discard right-clicks)
/// 2. Discard rapid clicks (< 200ms apart)
/// 3. Discard same-spot re-clicks (< 0.03 normalized distance)
/// 4. One surviving click = one ZoomEvent
/// 5. Merge overlapping events
pub fn generate_zoom_events(events: &[MouseEvent], zoom_scale: f64) -> Vec<ZoomEvent> {
    // Step 1: Filter to intentional clicks
    let clicks: Vec<&MouseEvent> = events
        .iter()
        .filter(|e| e.event_type == "click")
        .collect();

    if clicks.is_empty() {
        return vec![];
    }

    // Step 2 & 3: Filter noise
    let mut filtered: Vec<&MouseEvent> = vec![];
    for click in &clicks {
        if let Some(prev) = filtered.last() {
            let time_gap = click.time_ms.saturating_sub(prev.time_ms);
            if time_gap < MIN_CLICK_INTERVAL_MS {
                continue; // rapid click
            }
            let dx = click.x - prev.x;
            let dy = click.y - prev.y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < MIN_CLICK_DISTANCE {
                continue; // same spot
            }
        }
        filtered.push(click);
    }

    if filtered.is_empty() {
        return vec![];
    }

    // Step 4: One click = one ZoomEvent
    let mut zoom_events: Vec<ZoomEvent> = filtered
        .iter()
        .enumerate()
        .map(|(i, click)| ZoomEvent {
            id: format!("auto-{}", i),
            time_ms: click.time_ms.saturating_sub(LEAD_IN_MS),
            duration_ms: DEFAULT_DURATION_MS,
            x: click.x,
            y: click.y,
            scale: zoom_scale,
        })
        .collect();

    // Step 5: Merge overlapping events
    merge_overlapping(&mut zoom_events);

    zoom_events
}

/// Merge nearby zoom events into longer events.
/// If event B starts before event A ends + MERGE_GAP_MS, extend A to cover both
/// and blend the position toward B's center. This avoids brief zoom-out/zoom-in
/// cycles when the user clicks in the same area within a few seconds.
fn merge_overlapping(events: &mut Vec<ZoomEvent>) {
    if events.len() < 2 {
        return;
    }

    let mut merged: Vec<ZoomEvent> = vec![events[0].clone()];

    for evt in &events[1..] {
        let last = merged.last_mut().unwrap();
        let last_end = last.time_ms + last.duration_ms;

        if evt.time_ms <= last_end + MERGE_GAP_MS {
            // Nearby — extend duration to cover both and blend position
            let new_end = (evt.time_ms + evt.duration_ms).max(last_end);
            last.duration_ms = new_end - last.time_ms;
            // Weight position toward the newer click
            last.x = (last.x + evt.x) / 2.0;
            last.y = (last.y + evt.y) / 2.0;
        } else {
            merged.push(evt.clone());
        }
    }

    *events = merged;
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

    #[test]
    fn test_no_clicks_returns_empty() {
        let events = vec![make_move(100, 0.5, 0.5)];
        let result = generate_zoom_events(&events, 2.0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_right_clicks_ignored() {
        let events = vec![make_right_click(1000, 0.5, 0.5)];
        let result = generate_zoom_events(&events, 2.0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_single_click_generates_one_event() {
        let events = vec![make_click(1000, 0.3, 0.7)];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].time_ms, 700); // 1000 - 300 lead-in
        assert_eq!(result[0].duration_ms, 1500);
        assert!((result[0].x - 0.3).abs() < 0.001);
        assert!((result[0].y - 0.7).abs() < 0.001);
        assert_eq!(result[0].scale, 2.0);
    }

    #[test]
    fn test_rapid_clicks_filtered() {
        let events = vec![
            make_click(1000, 0.3, 0.3),
            make_click(1100, 0.35, 0.35), // only 100ms apart
            make_click(1150, 0.4, 0.4),   // only 50ms from previous
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 1); // only first click survives
    }

    #[test]
    fn test_same_spot_clicks_filtered() {
        let events = vec![
            make_click(1000, 0.5, 0.5),
            make_click(2000, 0.51, 0.51), // same spot (dist < 0.03)
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_distant_clicks_create_separate_events() {
        let events = vec![
            make_click(1000, 0.1, 0.1),
            make_click(5000, 0.9, 0.9),
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_overlapping_events_merge() {
        // Two clicks 500ms apart, each with 1500ms duration -> they overlap
        let events = vec![
            make_click(1000, 0.2, 0.2),
            make_click(1500, 0.4, 0.4),
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 1);
        // Merged event should be longer
        assert!(result[0].duration_ms > 1500);
    }

    #[test]
    fn test_non_overlapping_events_stay_separate() {
        // Two clicks far apart (gap > MERGE_GAP_MS after event ends) -> stay separate
        let events = vec![
            make_click(1000, 0.2, 0.2),
            make_click(10000, 0.8, 0.8),
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_nearby_events_merge_within_gap() {
        // Two clicks ~3s apart: first event ends at 700+1500=2200,
        // second starts at 3700. Gap = 1500ms < MERGE_GAP_MS -> merge
        let events = vec![
            make_click(1000, 0.2, 0.2),
            make_click(4000, 0.4, 0.4),
        ];
        let result = generate_zoom_events(&events, 2.0);
        assert_eq!(result.len(), 1);
        // Merged event covers from first start to second end
        assert!(result[0].duration_ms > 1500);
    }

    #[test]
    fn test_zoom_scale_passed_through() {
        let events = vec![make_click(1000, 0.5, 0.5)];
        let result = generate_zoom_events(&events, 3.0);
        assert_eq!(result[0].scale, 3.0);
    }
}
