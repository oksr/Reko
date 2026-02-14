import XCTest
@testable import RekoEngine

final class RecordingConfigTests: XCTestCase {
    func testRecordingConfigDecodesWithCameraId() throws {
        let json = """
        {
            "display_id": 1,
            "fps": 60,
            "capture_system_audio": true,
            "output_dir": "/tmp/test",
            "mic_id": null,
            "camera_id": "cam-abc"
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let config = try decoder.decode(RecordingConfig.self, from: json)
        XCTAssertEqual(config.cameraId, "cam-abc")
    }

    func testRecordingConfigDecodesWithoutCameraId() throws {
        let json = """
        {
            "display_id": 1,
            "fps": 30,
            "capture_system_audio": false,
            "output_dir": "/tmp/test",
            "mic_id": null,
            "camera_id": null
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let config = try decoder.decode(RecordingConfig.self, from: json)
        XCTAssertNil(config.cameraId)
    }

    func testRecordingResultEncodesWithCameraPath() throws {
        let result = RecordingResult(
            screenPath: "screen.mov",
            systemAudioPath: nil,
            micPath: nil,
            cameraPath: "camera.mov",
            mouseEventsPath: nil,
            durationMs: 5000,
            frameCount: 300
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(result)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(json["camera_path"] as? String, "camera.mov")
    }

    func testRecordingResultOmitsNullCameraPath() throws {
        let result = RecordingResult(
            screenPath: "screen.mov",
            systemAudioPath: nil,
            micPath: nil,
            cameraPath: nil,
            mouseEventsPath: nil,
            durationMs: 5000,
            frameCount: 300
        )
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(result)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        // Swift's JSONEncoder omits nil optionals by default
        XCTAssertNil(json["camera_path"])
    }
}
