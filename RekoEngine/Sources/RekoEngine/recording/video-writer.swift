import Foundation
import AVFoundation
import CoreMedia

public final class VideoWriter {
    private let assetWriter: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private var isStarted = false
    private let lock = NSLock()

    public init(outputURL: URL, width: Int, height: Int, fps: Int) throws {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mov)

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 20_000_000,
                AVVideoMaxKeyFrameIntervalKey: fps,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: fps,
            ] as [String: Any],
        ]

        videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoInput.expectsMediaDataInRealTime = true
        assetWriter.add(videoInput)
    }

    public func appendVideoSample(_ sampleBuffer: CMSampleBuffer) {
        lock.lock()
        defer { lock.unlock() }
        // Defense-in-depth: skip buffers without pixel data (e.g. ScreenCaptureKit
        // status frames that slipped past the frame-status filter).
        guard CMSampleBufferGetImageBuffer(sampleBuffer) != nil else { return }
        if !isStarted {
            assetWriter.startWriting()
            assetWriter.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
            isStarted = true
        }
        // If the writer entered a failed state (e.g. from an incompatible buffer),
        // bail out rather than silently dropping frames.
        guard assetWriter.status == .writing else { return }
        guard videoInput.isReadyForMoreMediaData else { return }
        videoInput.append(sampleBuffer)
    }

    public func finish() async {
        lock.lock()
        guard isStarted else {
            lock.unlock()
            return
        }
        isStarted = false
        videoInput.markAsFinished()
        lock.unlock()
        await assetWriter.finishWriting()
    }
}
