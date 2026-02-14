import XCTest
@testable import RekoEngine

final class AudioMixerTests: XCTestCase {

    func testMixSamplesAddition() {
        let a: [Float] = [0.3, -0.5, 0.8, 0.9]
        let b: [Float] = [0.2, -0.3, 0.4, 0.5]
        let result = AudioMixingMath.mixSamples(a, b)
        XCTAssertEqual(result[0], 0.5, accuracy: 0.001)
        XCTAssertEqual(result[1], -0.8, accuracy: 0.001)
        XCTAssertEqual(result[2], 1.0, accuracy: 0.001) // clamped from 1.2
        XCTAssertEqual(result[3], 1.0, accuracy: 0.001) // clamped from 1.4
    }

    func testMixSamplesDifferentLengths() {
        let a: [Float] = [0.5, 0.5, 0.5]
        let b: [Float] = [0.3]
        let result = AudioMixingMath.mixSamples(a, b)
        XCTAssertEqual(result.count, 3)
        XCTAssertEqual(result[0], 0.8, accuracy: 0.001)
        XCTAssertEqual(result[1], 0.5, accuracy: 0.001)
        XCTAssertEqual(result[2], 0.5, accuracy: 0.001)
    }

    func testMixSamplesClampingNegative() {
        let a: [Float] = [-0.9]
        let b: [Float] = [-0.5]
        let result = AudioMixingMath.mixSamples(a, b)
        XCTAssertEqual(result[0], -1.0, accuracy: 0.001)
    }
}
