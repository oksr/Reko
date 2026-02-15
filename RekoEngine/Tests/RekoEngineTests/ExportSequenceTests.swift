import XCTest
@testable import RekoEngine

final class ExportSequenceTests: XCTestCase {

    // MARK: - Step 1: Sequence Duration Calculation

    func testSequenceDuration_threeClipsWithCuts() {
        // 3 clips: 3000 + 3000 + 2000 = 8000
        let clips = [
            ExportClip(sourceStartMs: 0, sourceEndMs: 3000, speed: 1.0, zoomKeyframes: []),
            ExportClip(sourceStartMs: 5000, sourceEndMs: 8000, speed: 1.0, zoomKeyframes: []),
            ExportClip(sourceStartMs: 10000, sourceEndMs: 12000, speed: 1.0, zoomKeyframes: []),
        ]
        let transitions: [ExportTransition?] = [nil, nil]
        XCTAssertEqual(ExportMath.sequenceDurationMs(clips: clips, transitions: transitions), 8000)
    }

    func testSequenceDuration_crossfadeSubtractsOverlap() {
        let clips = [
            ExportClip(sourceStartMs: 0, sourceEndMs: 3000, speed: 1.0, zoomKeyframes: []),
            ExportClip(sourceStartMs: 5000, sourceEndMs: 8000, speed: 1.0, zoomKeyframes: []),
            ExportClip(sourceStartMs: 10000, sourceEndMs: 12000, speed: 1.0, zoomKeyframes: []),
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
            ExportClip(sourceStartMs: 1000, sourceEndMs: 4000, speed: 1.0, zoomKeyframes: []),
        ]
        XCTAssertEqual(ExportMath.sequenceDurationMs(clips: clips, transitions: []), 3000)
    }

    func testSequenceDuration_emptyClips() {
        XCTAssertEqual(ExportMath.sequenceDurationMs(clips: [], transitions: []), 0)
    }

    // MARK: - Step 2: Clip Output Range Computation

    func testClipOutputRanges_threeClipsWithCuts() {
        let clips = [
            ExportClip(sourceStartMs: 0, sourceEndMs: 3000, speed: 1.0, zoomKeyframes: []),
            ExportClip(sourceStartMs: 5000, sourceEndMs: 8000, speed: 1.0, zoomKeyframes: []),
            ExportClip(sourceStartMs: 10000, sourceEndMs: 12000, speed: 1.0, zoomKeyframes: []),
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
            ExportClip(sourceStartMs: 0, sourceEndMs: 3000, speed: 1.0, zoomKeyframes: []),
            ExportClip(sourceStartMs: 5000, sourceEndMs: 8000, speed: 1.0, zoomKeyframes: []),
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

    func testClipOutputRanges_singleClip() {
        let zk = ExportZoomKeyframe(timeMs: 100, x: 0.3, y: 0.7, scale: 2.0, easing: "ease-in-out", durationMs: 500)
        let clips = [
            ExportClip(sourceStartMs: 1000, sourceEndMs: 4000, speed: 1.0, zoomKeyframes: [zk]),
        ]
        let ranges = ExportMath.computeClipOutputRanges(clips: clips, transitions: [])

        XCTAssertEqual(ranges.count, 1)
        XCTAssertEqual(ranges[0].outputStartMs, 0)
        XCTAssertEqual(ranges[0].outputEndMs, 3000)
        XCTAssertEqual(ranges[0].sourceStartMs, 1000)
        XCTAssertEqual(ranges[0].sourceEndMs, 4000)
        XCTAssertEqual(ranges[0].zoomKeyframes.count, 1)
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
                        "zoomKeyframes": [
                            ["timeMs": 500, "durationMs": 400, "x": 0.3, "y": 0.7, "scale": 2.0, "easing": "ease-in-out"]
                        ]
                    ],
                    [
                        "id": "b",
                        "sourceStart": 5000,
                        "sourceEnd": 8000,
                        "speed": 1,
                        "zoomKeyframes": [] as [[String: Any]]
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
        XCTAssertEqual(clips[0].zoomKeyframes.count, 1)
        XCTAssertEqual(clips[0].zoomKeyframes[0].timeMs, 500)
        XCTAssertEqual(clips[0].zoomKeyframes[0].scale, 2.0)
        XCTAssertEqual(clips[1].sourceStartMs, 5000)
        XCTAssertEqual(clips[1].sourceEndMs, 8000)
        XCTAssertEqual(clips[1].zoomKeyframes.count, 0)

        XCTAssertEqual(transitions.count, 1)
        XCTAssertNil(transitions[0])
    }

    func testParseSequenceClips_transitionsWithValues() {
        let project: [String: Any] = [
            "sequence": [
                "clips": [
                    ["id": "a", "sourceStart": 0, "sourceEnd": 3000, "speed": 1, "zoomKeyframes": [] as [[String: Any]]],
                    ["id": "b", "sourceStart": 5000, "sourceEnd": 8000, "speed": 1, "zoomKeyframes": [] as [[String: Any]]],
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

    // MARK: - Step 4: Zoom Interpolation (segment model, RAMP_MS=200)

    private func seg(_ timeMs: UInt64, _ durationMs: UInt64, scale: Double = 2.0) -> ExportZoomKeyframe {
        ExportZoomKeyframe(timeMs: timeMs, x: 0.3, y: 0.7, scale: scale, easing: "ease-in-out", durationMs: durationMs)
    }

    func testInterpolateZoom_emptyKeyframes() {
        let result = ExportMath.interpolateZoom([], at: 1000)
        XCTAssertEqual(result.x, 0.5)
        XCTAssertEqual(result.y, 0.5)
        XCTAssertEqual(result.scale, 1.0)
    }

    func testInterpolateZoom_beforeSegment() {
        let result = ExportMath.interpolateZoom([seg(1000, 1000)], at: 500)
        XCTAssertEqual(result.x, 0.5)
        XCTAssertEqual(result.y, 0.5)
        XCTAssertEqual(result.scale, 1.0)
    }

    func testInterpolateZoom_afterSegment() {
        let result = ExportMath.interpolateZoom([seg(1000, 1000)], at: 2500)
        XCTAssertEqual(result.x, 0.5)
        XCTAssertEqual(result.y, 0.5)
        XCTAssertEqual(result.scale, 1.0)
    }

    func testInterpolateZoom_duringRampIn() {
        // 100ms into 200ms ramp → partially zoomed
        let result = ExportMath.interpolateZoom([seg(1000, 1000)], at: 1100)
        XCTAssertGreaterThan(result.scale, 1.0)
        XCTAssertLessThan(result.scale, 2.0)
    }

    func testInterpolateZoom_duringHold() {
        // hold starts at 1000+200=1200, ends at 1000+1000-200=1800
        let result = ExportMath.interpolateZoom([seg(1000, 1000)], at: 1500)
        XCTAssertEqual(result.x, 0.3, accuracy: 0.001)
        XCTAssertEqual(result.y, 0.7, accuracy: 0.001)
        XCTAssertEqual(result.scale, 2.0)
    }

    func testInterpolateZoom_duringRampOut() {
        // ramp-out starts at 1800, ends at 2000
        let result = ExportMath.interpolateZoom([seg(1000, 1000)], at: 1900)
        XCTAssertGreaterThan(result.scale, 1.0)
        XCTAssertLessThan(result.scale, 2.0)
    }

    func testInterpolateZoom_betweenSegments() {
        let kfs = [seg(1000, 500), seg(3000, 500)]
        let result = ExportMath.interpolateZoom(kfs, at: 2000)
        XCTAssertEqual(result.scale, 1.0)
    }

    func testInterpolateZoom_shortSegment() {
        // 200ms total → ramp halves at 100ms each, midpoint=peak
        let result = ExportMath.interpolateZoom([seg(1000, 200, scale: 2.0)], at: 1100)
        XCTAssertGreaterThan(result.scale, 1.0)
    }

    func testInterpolateZoom_multipleSegments() {
        let kfs = [seg(1000, 500, scale: 1.5), seg(3000, 500, scale: 2.5)]
        // In hold of first (1000+200=1200 to 1000+500-200=1300)
        let r1 = ExportMath.interpolateZoom(kfs, at: 1300)
        XCTAssertEqual(r1.scale, 1.5)
        // In hold of second (3000+200=3200 to 3000+500-200=3300)
        let r2 = ExportMath.interpolateZoom(kfs, at: 3300)
        XCTAssertEqual(r2.scale, 2.5)
    }
}
