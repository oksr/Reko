import XCTest
@testable import RekoEngine

final class MouseLoggerTests: XCTestCase {

    func testMouseEventToJSON() {
        let event = MouseLogEvent(
            timeMs: 1234,
            x: 0.5,
            y: 0.3,
            type: "click"
        )
        let json = event.toJSON()
        XCTAssertTrue(json.contains("\"timeMs\":1234"))
        XCTAssertTrue(json.contains("\"x\":0.5"))
        XCTAssertTrue(json.contains("\"type\":\"click\""))
        // Should be a single line (JSONL format)
        XCTAssertFalse(json.contains("\n"))
    }

    func testNormalizedCoordinates() {
        // Screen 1920x1080, mouse at (960, 540) → (0.5, 0.5)
        let (nx, ny) = MouseLogEvent.normalize(
            mouseX: 960, mouseY: 540,
            screenWidth: 1920, screenHeight: 1080
        )
        XCTAssertEqual(nx, 0.5, accuracy: 0.001)
        XCTAssertEqual(ny, 0.5, accuracy: 0.001)
    }

    func testNormalizedCoordinatesClamped() {
        // Off-screen coordinates should clamp to 0-1
        let (nx, ny) = MouseLogEvent.normalize(
            mouseX: -100, mouseY: 2000,
            screenWidth: 1920, screenHeight: 1080
        )
        XCTAssertEqual(nx, 0.0, accuracy: 0.001)
        XCTAssertEqual(ny, 1.0, accuracy: 0.001)
    }
}
