import Foundation
import AVFoundation
import CoreMedia
import CoreVideo

/// Reads video frames from a .mov file as CVPixelBuffer, seeking to a time range.
public final class VideoDecoder {
    private let asset: AVAsset
    private var reader: AVAssetReader?
    private var trackOutput: AVAssetReaderTrackOutput?
    public let naturalWidth: Int
    public let naturalHeight: Int
    public let fps: Float
    public let totalFrames: Int

    /// Frames that will be decoded (considering trim range).
    public let trimmedFrameCount: Int

    public init(url: URL, inPointMs: UInt64, outPointMs: UInt64) throws {
        asset = AVAsset(url: url)

        guard let videoTrack = asset.tracks(withMediaType: .video).first else {
            throw ExportError.videoDecoderFailed("No video track in \(url.lastPathComponent)")
        }

        let size = videoTrack.naturalSize.applying(videoTrack.preferredTransform)
        naturalWidth = Int(abs(size.width))
        naturalHeight = Int(abs(size.height))
        fps = videoTrack.nominalFrameRate

        let duration = CMTimeGetSeconds(asset.duration)
        totalFrames = Int(duration * Double(fps))

        let inTime = CMTime(value: Int64(inPointMs), timescale: 1000)
        let outTime = CMTime(value: Int64(outPointMs), timescale: 1000)
        let timeRange = CMTimeRange(start: inTime, end: outTime)

        let trimDuration = CMTimeGetSeconds(outTime) - CMTimeGetSeconds(inTime)
        trimmedFrameCount = max(1, Int(trimDuration * Double(fps)))

        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = timeRange

        let outputSettings: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ]
        let output = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: outputSettings)
        output.alwaysCopiesSampleData = false // zero-copy when possible
        reader.add(output)

        guard reader.startReading() else {
            throw ExportError.videoDecoderFailed("Failed to start reader: \(reader.error?.localizedDescription ?? "unknown")")
        }

        self.reader = reader
        self.trackOutput = output
    }

    /// Returns the next decoded frame, or nil if at end of range.
    public func nextFrame() -> CVPixelBuffer? {
        guard let output = trackOutput,
              let sampleBuffer = output.copyNextSampleBuffer(),
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return nil
        }
        return pixelBuffer
    }

    public func cancel() {
        reader?.cancelReading()
    }
}
