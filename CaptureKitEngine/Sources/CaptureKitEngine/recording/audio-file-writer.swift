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

        guard let pcmFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: asbd.mSampleRate,
            channels: AVAudioChannelCount(asbd.mChannelsPerFrame),
            interleaved: true
        ) else { return }

        let frameCount = UInt32(length) / UInt32(asbd.mBytesPerFrame)
        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: pcmFormat, frameCapacity: frameCount) else { return }
        pcmBuffer.frameLength = frameCount

        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &dataPointer)
        if let src = dataPointer, let dst = pcmBuffer.floatChannelData?[0] {
            memcpy(dst, src, length)
        }

        try? audioFile.write(from: pcmBuffer)
    }

    public func finish() {
        audioFile = nil
    }
}
