import XCTest
@testable import RekoEngine

final class ExportSequenceTests: XCTestCase {

    // MARK: - Step 1: Sequence Duration Calculation

    func testSequenceDuration_threeClipsWithCuts() {
        // 3 clips: 3000 + 3000 + 2000 = 8000
        let clips = [
            ExportClip(sourceStartMs: 0, sourceEndMs: 3000, speed: 1.0, zoomEvents: []),
            ExportClip(sourceStartMs: 5000, sourceEndMs: 8000, speed: 1.0, zoomEvents: []),
            ExportClip(sourceStartMs: 10000, sourceEndMs: 12000, speed: 1.0, zoomEvents: []),
        ]
        let transitions: [ExportTransition?] = [nil, nil]
        XCTAssertEqual(ExportMath.sequenceDurationMs(clips: clips, transitions: transitions), 8000)
    }

    func testSequenceDuration_crossfadeSubtractsOverlap() {
        let clips = [
            ExportClip(sourceStartMs: 0, sourceEndMs: 3000, speed: 1.0, zoomEvents: []),
            ExportClip(sourceStartMs: 5000, sourceEndMs: 8000, speed: 1.0, zoomEvents: []),
            ExportClip(sourceStartMs: 10000, sourceEndMs: 12000, speed: 1.0, zoomEvents: []),
        ]
        let transitions: [ExportTransition?] = [
            ExportTransition(type: "crossfade", durationMs: 200),
            nil,
        ]
        // 8000 - 200 = 7800
        XCTAssertEqual(ExportMath.sequenceDurationMs(clips: clips, transitions: transitions), 7800)
    }

    func testSequenceDuration_singleClip() {
        let clips = [
            ExportClip(sourceStartMs: 1000, sourceEndMs: 4000, speed: 1.0, zoomEvents: []),
        ]
        XCTAssertEqual(ExportMath.sequenceDurationMs(clips: clips, transitions: []), 3000)
    }

    func testSequenceDuration_emptyClips() {
        XCTAssertEqual(ExportMath.sequenceDurationMs(clips: [], transitions: []), 0)
    }

    // MARK: - Step 2: Clip Output Range Computation

    func testClipOutputRanges_threeClipsWithCuts() {
        let clips = [
            ExportClip(sourceStartMs: 0, sourceEndMs: 3000, speed: 1.0, zoomEvents: []),
            ExportClip(sourceStartMs: 5000, sourceEndMs: 8000, speed: 1.0, zoomEvents: []),
            ExportClip(sourceStartMs: 10000, sourceEndMs: 12000, speed: 1.0, zoomEvents: []),
        ]
        let transitions: [ExportTransition?] = [nil, nil]
        let ranges = ExportMath.computeClipOutputRanges(clips: clips, transitions: transitions)

        XCTAssertEqual(ranges.count, 3)
        XCTAssertEqual(ranges[0].outputStartMs, 0)
        XCTAssertEqual(ranges[0].outputEndMs, 3000)
        XCTAssertEqual(ranges[1].outputStartMs, 3000)
        XCTAssertEqual(ranges[1].outputEndMs, 6000)
        XCTAssertEqual(ranges[2].outputStartMs, 6000)
        XCTAssertEqual(ranges[2].outputEndMs, 8000)
    }

    func testClipOutputRanges_crossfadeOverlap() {
        let clips = [
            ExportClip(sourceStartMs: 0, sourceEndMs: 3000, speed: 1.0, zoomEvents: []),
            ExportClip(sourceStartMs: 5000, sourceEndMs: 8000, speed: 1.0, zoomEvents: []),
        ]
        let transitions: [ExportTransition?] = [
            ExportTransition(type: "crossfade", durationMs: 200),
        ]
        let ranges = ExportMath.computeClipOutputRanges(clips: clips, transitions: transitions)

        XCTAssertEqual(ranges.count, 2)
        XCTAssertEqual(ranges[0].outputStartMs, 0)
        XCTAssertEqual(ranges[0].outputEndMs, 3000)
        // Second clip overlaps: elapsed=2800 after transition subtraction, minus 200 overlap = 2600
        XCTAssertEqual(ranges[1].outputStartMs, 2600)
        XCTAssertEqual(ranges[1].outputEndMs, 5600)
    }

    func testClipOutputRanges_singleClipWithZoomEvent() {
        let ze = ExportZoomEvent(id: "z1", timeMs: 100, durationMs: 1500, x: 0.3, y: 0.7, scale: 2.0)
        let clips = [
            ExportClip(sourceStartMs: 1000, sourceEndMs: 4000, speed: 1.0, zoomEvents: [ze]),
        ]
        let ranges = ExportMath.computeClipOutputRanges(clips: clips, transitions: [])

        XCTAssertEqual(ranges.count, 1)
        XCTAssertEqual(ranges[0].outputStartMs, 0)
        XCTAssertEqual(ranges[0].outputEndMs, 3000)
        XCTAssertEqual(ranges[0].sourceStartMs, 1000)
        XCTAssertEqual(ranges[0].sourceEndMs, 4000)
        XCTAssertEqual(ranges[0].zoomEvents.count, 1)
    }

    // MARK: - Step 3: Sequence JSON Parsing

    func testParseSequenceClips_validJSON() {
        let project: [String: Any] = [
            "sequence": [
                "clips": [
                    [
                        "id": "a",
                        "sourceStart": 0,
                        "sourceEnd": 3000,
                        "speed": 1,
                        "zoomEvents": [
                            ["id": "z1", "timeMs": 500, "durationMs": 1500, "x": 0.3, "y": 0.7, "scale": 2.0]
                        ]
                    ],
                    [
                        "id": "b",
                        "sourceStart": 5000,
                        "sourceEnd": 8000,
                        "speed": 1,
                        "zoomEvents": [] as [[String: Any]]
                    ]
                ] as [[String: Any]],
                "transitions": [
                    NSNull(),
                ] as [Any]
            ] as [String: Any]
        ]

        let (clips, transitions) = ExportMath.parseSequenceClips(from: project)
        XCTAssertEqual(clips.count, 2)
        XCTAssertEqual(clips[0].sourceStartMs, 0)
        XCTAssertEqual(clips[0].sourceEndMs, 3000)
        XCTAssertEqual(clips[0].zoomEvents.count, 1)
        XCTAssertEqual(clips[0].zoomEvents[0].timeMs, 500)
        XCTAssertEqual(clips[0].zoomEvents[0].durationMs, 1500)
        XCTAssertEqual(clips[0].zoomEvents[0].scale, 2.0)
        XCTAssertEqual(clips[1].sourceStartMs, 5000)
        XCTAssertEqual(clips[1].sourceEndMs, 8000)
        XCTAssertEqual(clips[1].zoomEvents.count, 0)

        XCTAssertEqual(transitions.count, 1)
        XCTAssertNil(transitions[0])
    }

    func testParseSequenceClips_transitionsWithValues() {
        let project: [String: Any] = [
            "sequence": [
                "clips": [
                    ["id": "a", "sourceStart": 0, "sourceEnd": 3000, "speed": 1, "zoomEvents": [] as [[String: Any]]],
                    ["id": "b", "sourceStart": 5000, "sourceEnd": 8000, "speed": 1, "zoomEvents": [] as [[String: Any]]],
                ] as [[String: Any]],
                "transitions": [
                    ["type": "crossfade", "durationMs": 200]
                ] as [Any]
            ] as [String: Any]
        ]

        let (clips, transitions) = ExportMath.parseSequenceClips(from: project)
        XCTAssertEqual(clips.count, 2)
        XCTAssertEqual(transitions.count, 1)
        XCTAssertNotNil(transitions[0])
        XCTAssertEqual(transitions[0]?.type, "crossfade")
        XCTAssertEqual(transitions[0]?.durationMs, 200)
    }

    func testParseSequenceClips_missingSequence() {
        let project: [String: Any] = [
            "tracks": ["screen": "/path/to/screen.mov"]
        ]
        let (clips, transitions) = ExportMath.parseSequenceClips(from: project)
        XCTAssertEqual(clips.count, 0)
        XCTAssertEqual(transitions.count, 0)
    }

    // MARK: - Step 4: Zoom Event Interpolation

    private func ze(_ timeMs: UInt64, durationMs: UInt64 = 1500, x: Double = 0.3, y: Double = 0.7, scale: Double = 2.0) -> ExportZoomEvent {
        ExportZoomEvent(id: "z-\(timeMs)", timeMs: timeMs, durationMs: durationMs, x: x, y: y, scale: scale)
    }

    func testInterpolateZoomEvents_empty() {
        let result = ExportMath.interpolateZoomEvents([], at: 1000)
        XCTAssertEqual(result.x, 0.5)
        XCTAssertEqual(result.y, 0.5)
        XCTAssertEqual(result.scale, 1.0)
    }

    func testInterpolateZoomEvents_beforeLeadIn() {
        // Event at 1000, lead-in starts at 750
        let result = ExportMath.interpolateZoomEvents([ze(1000)], at: 500)
        XCTAssertEqual(result.scale, 1.0, accuracy: 0.001)
    }

    func testInterpolateZoomEvents_duringHold() {
        let result = ExportMath.interpolateZoomEvents([ze(1000, durationMs: 1500, x: 0.3, y: 0.7, scale: 2.0)], at: 1500)
        XCTAssertEqual(result.scale, 2.0, accuracy: 0.001)
        XCTAssertEqual(result.x, 0.3, accuracy: 0.001)
        XCTAssertEqual(result.y, 0.7, accuracy: 0.001)
    }

    func testInterpolateZoomEvents_afterLeadOut() {
        // Event ends at 1000+1500=2500, lead-out ends at 2750
        let result = ExportMath.interpolateZoomEvents([ze(1000)], at: 3000)
        XCTAssertEqual(result.scale, 1.0, accuracy: 0.001)
    }

    func testInterpolateZoomEvents_duringLeadIn() {
        // Lead-in: 750..1000
        let result = ExportMath.interpolateZoomEvents([ze(1000, durationMs: 1500, x: 0.3, y: 0.7, scale: 2.0)], at: 875)
        XCTAssertGreaterThan(result.scale, 1.0)
        XCTAssertLessThan(result.scale, 2.0)
    }

    func testInterpolateZoomEvents_overlappingHighestScaleWins() {
        let events = [
            ze(1000, durationMs: 2000, x: 0.3, y: 0.3, scale: 1.5),
            ze(1500, durationMs: 1000, x: 0.7, y: 0.7, scale: 2.5),
        ]
        let result = ExportMath.interpolateZoomEvents(events, at: 1800)
        XCTAssertEqual(result.scale, 2.5, accuracy: 0.01)
        XCTAssertEqual(result.x, 0.7, accuracy: 0.01)
    }

    // MARK: - Spring Easing Canonical Vectors

    func testSpringEase_boundaries() {
        XCTAssertEqual(ExportMath.springEase(0.0, response: 0.7, damping: 1.0), 0.0)
        XCTAssertEqual(ExportMath.springEase(1.0, response: 0.7, damping: 1.0), 1.0)
    }

    func testSpringEase_criticallyDamped_monotonic() {
        let v1 = ExportMath.springEase(0.25, response: 0.7, damping: 1.0)
        let v2 = ExportMath.springEase(0.5, response: 0.7, damping: 1.0)
        let v3 = ExportMath.springEase(0.75, response: 0.7, damping: 1.0)
        XCTAssertLessThan(v1, v2, "Should be monotonically increasing")
        XCTAssertLessThan(v2, v3, "Should be monotonically increasing")
    }

    func testSpringEase_canonicalVectors() {
        // Same canonical vectors as Rust and TypeScript tests
        let cases: [(Double, Double, Double, Double, Double)] = [
            // (t, response, damping, min, max)
            (0.0, 0.7, 1.0, 0.0, 0.001),
            (1.0, 0.7, 1.0, 0.999, 1.001),
            (0.25, 0.7, 1.0, 0.4, 0.95),
            (0.5, 0.7, 1.0, 0.8, 1.1),
            (0.75, 0.7, 1.0, 0.95, 1.05),
            (0.5, 1.0, 1.0, 0.6, 1.0),
            (0.5, 0.4, 0.95, 0.7, 1.2),
        ]
        for (t, r, d, minVal, maxVal) in cases {
            let v = ExportMath.springEase(t, response: r, damping: d)
            XCTAssertGreaterThanOrEqual(v, minVal, "springEase(\(t), \(r), \(d)) = \(v) < \(minVal)")
            XCTAssertLessThanOrEqual(v, maxVal, "springEase(\(t), \(r), \(d)) = \(v) > \(maxVal)")
        }
    }
}
