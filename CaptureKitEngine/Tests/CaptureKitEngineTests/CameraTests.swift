import XCTest
@testable import CaptureKitEngine

final class CameraTests: XCTestCase {
    func testCameraInfoEncodesToSnakeCase() throws {
        let camera = CameraInfo(id: "abc-123", name: "FaceTime HD")
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(camera)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["id"] as? String, "abc-123")
        XCTAssertEqual(json["name"] as? String, "FaceTime HD")
    }

    func testListCamerasReturnsArray() {
        // May be empty in CI/headless, but should not crash
        let cameras = CameraCapture.listCameras()
        XCTAssertNotNil(cameras)
    }

    func testStopCaptureOnFreshInstanceDoesNotCrash() {
        let capture = CameraCapture()
        capture.stopCapture() // should be a no-op
    }

    func testCameraDimensionsArePositive() {
        let dims = CameraCapture.CameraDimensions(width: 1920, height: 1080)
        XCTAssertGreaterThan(dims.width, 0)
        XCTAssertGreaterThan(dims.height, 0)
    }
}
