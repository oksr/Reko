import XCTest
@testable import CaptureKitEngine

final class CaptureKitEngineTests: XCTestCase {
    func testVersionIsNotEmpty() {
        XCTAssertFalse(CaptureKitEngine.version.isEmpty)
    }
}
