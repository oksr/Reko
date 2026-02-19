import Foundation
import AVFoundation
import CoreMedia

public final class AudioFileWriter {
    private var audioFile: AVAudioFile?

    public init(outputURL: URL, sampleRate: Double, channels: UInt32) throws {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ]

        audioFile = try AVAudioFile(
            forWriting: outputURL,
            settings: settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: true
        )
    }

    public func appendAudioSample(_ sampleBuffer: CMSampleBuffer) {
        guard let audioFile = audioFile,
              let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer),
              let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }

        let length = CMBlockBufferGetDataLength(blockBuffer)
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)!.pointee
        let channels = AVAudioChannelCount(asbd.mChannelsPerFrame)
        let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0

        // For non-interleaved audio, mBytesPerFrame is per-plane.
        // Total bytes per frame = mBytesPerFrame * channels.
        let totalBytesPerFrame = isNonInterleaved
            ? asbd.mBytesPerFrame * UInt32(channels)
            : asbd.mBytesPerFrame
        let frameCount = UInt32(length) / totalBytesPerFrame

        // Create output format matching the source channel count but interleaved float32
        guard let pcmFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: asbd.mSampleRate,
            channels: channels,
            interleaved: true
        ) else { return }

        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: pcmFormat, frameCapacity: frameCount) else { return }
        pcmBuffer.frameLength = frameCount

        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &dataPointer)

        guard let src = dataPointer, let dst = pcmBuffer.floatChannelData?[0] else { return }

        if isNonInterleaved && channels > 1 {
            // Non-interleaved: block buffer has [L0 L1 ... Ln R0 R1 ... Rn]
            // Convert to interleaved: [L0 R0 L1 R1 ... Ln Rn]
            let samplesPerChannel = Int(frameCount)
            src.withMemoryRebound(to: Float.self, capacity: samplesPerChannel * Int(channels)) { srcFloat in
                for frame in 0..<samplesPerChannel {
                    for ch in 0..<Int(channels) {
                        dst[frame * Int(channels) + ch] = srcFloat[ch * samplesPerChannel + frame]
                    }
                }
            }
        } else {
            // Interleaved: direct copy
            memcpy(dst, src, length)
        }

        try? audioFile.write(from: pcmBuffer)
    }

    public func finish() {
        audioFile = nil
    }
}
