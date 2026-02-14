import XCTest
import CoreMedia
import ScreenCaptureKit
@testable import RekoEngine

final class FrameFilterTests: XCTestCase {

    // MARK: - ScreenCapture.isCompleteFrame

    func testCompleteFrameReturnsTrue() throws {
        let sampleBuffer = try makeScreenSampleBuffer(status: SCFrameStatus.complete)
        XCTAssertTrue(ScreenCapture.isCompleteFrame(sampleBuffer))
    }

    func testIdleFrameReturnsFalse() throws {
        let sampleBuffer = try makeScreenSampleBuffer(status: SCFrameStatus.idle)
        XCTAssertFalse(ScreenCapture.isCompleteFrame(sampleBuffer))
    }

    func testBlankFrameReturnsFalse() throws {
        let sampleBuffer = try makeScreenSampleBuffer(status: SCFrameStatus.blank)
        XCTAssertFalse(ScreenCapture.isCompleteFrame(sampleBuffer))
    }

    func testStartedFrameReturnsFalse() throws {
        let sampleBuffer = try makeScreenSampleBuffer(status: SCFrameStatus.started)
        XCTAssertFalse(ScreenCapture.isCompleteFrame(sampleBuffer))
    }

    func testSuspendedFrameReturnsFalse() throws {
        let sampleBuffer = try makeScreenSampleBuffer(status: SCFrameStatus.suspended)
        XCTAssertFalse(ScreenCapture.isCompleteFrame(sampleBuffer))
    }

    func testMissingAttachmentsReturnsFalse() throws {
        let sampleBuffer = try makePlainSampleBuffer()
        XCTAssertFalse(ScreenCapture.isCompleteFrame(sampleBuffer))
    }

    // MARK: - VideoWriter skips buffers without pixel data

    func testVideoWriterSkipsBufferWithoutPixelData() async throws {
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("mov")
        let writer = try VideoWriter(outputURL: outputURL, width: 100, height: 100, fps: 30)

        // Create a sample buffer with NO image/pixel buffer — just timing info
        let sampleBuffer = try makePlainSampleBuffer()

        // Should not crash or start writing
        writer.appendVideoSample(sampleBuffer)

        // Writer should NOT have started (isStarted stays false), so finish is a no-op
        await writer.finish()

        // If we get here without crashing, the guard worked
        // Clean up
        try? FileManager.default.removeItem(at: outputURL)
    }

    // MARK: - Helpers

    private func makeScreenSampleBuffer(status: SCFrameStatus) throws -> CMSampleBuffer {
        var sampleBuffer: CMSampleBuffer?
        var timingInfo = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: 60),
            presentationTimeStamp: CMTime(value: 0, timescale: 60),
            decodeTimeStamp: .invalid
        )
        var sampleSize: Int = 0
        let osStatus = CMSampleBufferCreate(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: true,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: nil,
            sampleCount: 1,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timingInfo,
            sampleSizeEntryCount: 1,
            sampleSizeArray: &sampleSize,
            sampleBufferOut: &sampleBuffer
        )
        guard osStatus == noErr, let buffer = sampleBuffer else {
            throw NSError(domain: "test", code: Int(osStatus))
        }

        // Set SCStreamFrameInfo.status attachment
        let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: true)! as! [NSMutableDictionary]
        attachments[0][SCStreamFrameInfo.status] = status.rawValue

        return buffer
    }

    private func makePlainSampleBuffer() throws -> CMSampleBuffer {
        var sampleBuffer: CMSampleBuffer?
        var timingInfo = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: 60),
            presentationTimeStamp: CMTime(value: 0, timescale: 60),
            decodeTimeStamp: .invalid
        )
        let osStatus = CMSampleBufferCreate(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: true,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: nil,
            sampleCount: 0,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timingInfo,
            sampleSizeEntryCount: 0,
            sampleSizeArray: nil,
            sampleBufferOut: &sampleBuffer
        )
        guard osStatus == noErr, let buffer = sampleBuffer else {
            throw NSError(domain: "test", code: Int(osStatus))
        }
        return buffer
    }
}
