import XCTest
@testable import RekoEngine

final class LayoutMathTests: XCTestCase {

    func testScreenRectWithNoPadding() {
        let rect = LayoutMath.screenRect(
            canvasWidth: 1920, canvasHeight: 1080,
            screenWidth: 1920, screenHeight: 1080,
            paddingPercent: 0
        )
        XCTAssertEqual(rect.origin.x, 0, accuracy: 0.1)
        XCTAssertEqual(rect.origin.y, 0, accuracy: 0.1)
        XCTAssertEqual(rect.size.width, 1920, accuracy: 0.1)
        XCTAssertEqual(rect.size.height, 1080, accuracy: 0.1)
    }

    func testScreenRectWith8PercentPadding() {
        let rect = LayoutMath.screenRect(
            canvasWidth: 1920, canvasHeight: 1080,
            screenWidth: 1920, screenHeight: 1080,
            paddingPercent: 8
        )
        XCTAssertEqual(rect.origin.x, 273.0, accuracy: 1.0)
        XCTAssertEqual(rect.origin.y, 153.6, accuracy: 0.1)
        XCTAssertEqual(rect.size.height, 772.8, accuracy: 0.1)
    }

    func testCameraPositionBottomRight() {
        let pos = LayoutMath.cameraOrigin(
            canvasWidth: 1920, canvasHeight: 1080,
            sizePercent: 15, position: "bottom-right"
        )
        XCTAssertEqual(pos.x, 1555.2, accuracy: 0.1)
        XCTAssertEqual(pos.y, 715.2, accuracy: 0.1)
    }

    func testCameraPositionTopLeft() {
        let pos = LayoutMath.cameraOrigin(
            canvasWidth: 1920, canvasHeight: 1080,
            sizePercent: 15, position: "top-left"
        )
        XCTAssertEqual(pos.x, 76.8, accuracy: 0.1)
        XCTAssertEqual(pos.y, 76.8, accuracy: 0.1)
    }

    func testOutputResolutionOriginal() {
        let orig = LayoutMath.outputSize(resolution: "original", recordingWidth: 2880, recordingHeight: 1800)
        XCTAssertEqual(orig.width, 2880)
        XCTAssertEqual(orig.height, 1800)
    }

    func testOutputResolutionPreservesAspectRatio() {
        // 2880x1800 (16:10) → 1080p should be 1728x1080, not 1920x1080
        let hd = LayoutMath.outputSize(resolution: "1080p", recordingWidth: 2880, recordingHeight: 1800)
        XCTAssertEqual(hd.width, 1728)
        XCTAssertEqual(hd.height, 1080)

        let sd = LayoutMath.outputSize(resolution: "720p", recordingWidth: 2880, recordingHeight: 1800)
        XCTAssertEqual(sd.width, 1152)
        XCTAssertEqual(sd.height, 720)
    }

    func testOutputResolution16x9Recording() {
        // 1920x1080 (16:9) → 1080p stays 1920x1080
        let hd = LayoutMath.outputSize(resolution: "1080p", recordingWidth: 1920, recordingHeight: 1080)
        XCTAssertEqual(hd.width, 1920)
        XCTAssertEqual(hd.height, 1080)

        let sd = LayoutMath.outputSize(resolution: "720p", recordingWidth: 1920, recordingHeight: 1080)
        XCTAssertEqual(sd.width, 1280)
        XCTAssertEqual(sd.height, 720)
    }

    func testOutputResolutionEvenDimensions() {
        // Odd aspect ratio should still produce even width for H.264
        let size = LayoutMath.outputSize(resolution: "1080p", recordingWidth: 3024, recordingHeight: 1964)
        XCTAssertEqual(size.width % 2, 0, "Width must be even for H.264")
        XCTAssertEqual(size.height, 1080)
    }
}
