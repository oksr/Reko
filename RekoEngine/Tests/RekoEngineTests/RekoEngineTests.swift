import XCTest
@testable import RekoEngine

final class RekoEngineTests: XCTestCase {
    func testVersionIsNotEmpty() {
        XCTAssertFalse(RekoEngine.version.isEmpty)
    }
}
