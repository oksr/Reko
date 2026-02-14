import XCTest
@testable import RekoEngine

final class PauseResumeTests: XCTestCase {
    func testDurationCalculationWithPause() {
        // Test the math: elapsed - paused = effective duration
        // Simulating: 10s total, 3s paused = 7s effective
        let startTime: UInt64 = 0
        let stopTime: UInt64 = 10_000_000_000 // 10s in nanoseconds (assuming numer/denom = 1)
        let totalPausedNano: UInt64 = 3_000_000_000 // 3s
        let effectiveNano = stopTime - startTime - totalPausedNano
        let effectiveMs = effectiveNano / 1_000_000
        XCTAssertEqual(effectiveMs, 7000)
    }

    func testDurationCalculationWithNoPause() {
        let startTime: UInt64 = 0
        let stopTime: UInt64 = 5_000_000_000
        let totalPausedNano: UInt64 = 0
        let effectiveNano = stopTime - startTime - totalPausedNano
        let effectiveMs = effectiveNano / 1_000_000
        XCTAssertEqual(effectiveMs, 5000)
    }

    func testDurationCalculationWithMultiplePauses() {
        // 20s total, paused twice: 2s + 3s = 5s paused = 15s effective
        let startTime: UInt64 = 0
        let stopTime: UInt64 = 20_000_000_000
        let totalPausedNano: UInt64 = 5_000_000_000
        let effectiveNano = stopTime - startTime - totalPausedNano
        let effectiveMs = effectiveNano / 1_000_000
        XCTAssertEqual(effectiveMs, 15000)
    }
}
