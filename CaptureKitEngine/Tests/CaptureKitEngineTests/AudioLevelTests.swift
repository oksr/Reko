import XCTest
import AVFoundation
@testable import CaptureKitEngine

final class AudioLevelTests: XCTestCase {
    func testPeakLevelWithSilence() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 100)!
        buffer.frameLength = 100
        // All zeros = silence
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 0.0)
    }

    func testPeakLevelWithMaxSignal() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 100)!
        buffer.frameLength = 100
        let ptr = buffer.floatChannelData![0]
        for i in 0..<100 {
            ptr[i] = (i % 2 == 0) ? 1.0 : -1.0
        }
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 1.0)
    }

    func testPeakLevelWithHalfSignal() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 100)!
        buffer.frameLength = 100
        let ptr = buffer.floatChannelData![0]
        for i in 0..<100 {
            ptr[i] = 0.5
        }
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 0.5, accuracy: 0.001)
    }

    func testPeakLevelClampedToOne() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 10)!
        buffer.frameLength = 10
        let ptr = buffer.floatChannelData![0]
        ptr[0] = 2.5 // Over 1.0
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 1.0) // Clamped
    }

    func testPeakLevelNegativeValues() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 10)!
        buffer.frameLength = 10
        let ptr = buffer.floatChannelData![0]
        ptr[0] = -0.75
        let level = AudioLevelCalculator.peakLevel(from: buffer)
        XCTAssertEqual(level, 0.75, accuracy: 0.001)
    }
}
