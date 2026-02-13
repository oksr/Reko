import Foundation
import AVFoundation
import CoreMedia

// MARK: - Mixing Math (testable)

public enum AudioMixingMath {
    /// Mix two float sample arrays by addition with clamping to [-1, 1].
    public static func mixSamples(_ a: [Float], _ b: [Float]) -> [Float] {
        let count = max(a.count, b.count)
        var result = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let va = i < a.count ? a[i] : 0
            let vb = i < b.count ? b[i] : 0
            result[i] = min(max(va + vb, -1.0), 1.0)
        }
        return result
    }
}

// MARK: - Audio Mixer

/// Reads and mixes audio files, providing mixed CMSampleBuffers for the export writer.
public final class AudioMixer {
    private var readers: [AVAssetReader] = []
    private var outputs: [AVAssetReaderTrackOutput] = []
    private let sampleRate: Double = 48000
    private let channels: Int = 2

    /// Audio format for the mixed output (AAC encoding settings for AVAssetWriterInput).
    public var outputSettings: [String: Any] {
        return [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: 192_000,
        ]
    }

    /// Linear PCM format for reading + mixing (intermediate format).
    private var readSettings: [String: Any] {
        return [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
        ]
    }

    public init() {}

    /// Add an audio file to the mix. Call this for mic.wav and/or system_audio.wav.
    public func addTrack(url: URL, inPointMs: UInt64, outPointMs: UInt64) throws {
        let asset = AVAsset(url: url)
        guard let track = asset.tracks(withMediaType: .audio).first else { return }

        let reader = try AVAssetReader(asset: asset)
        let inTime = CMTime(value: Int64(inPointMs), timescale: 1000)
        let outTime = CMTime(value: Int64(outPointMs), timescale: 1000)
        reader.timeRange = CMTimeRange(start: inTime, end: outTime)

        let output = AVAssetReaderTrackOutput(track: track, outputSettings: readSettings)
        reader.add(output)
        reader.startReading()

        readers.append(reader)
        outputs.append(output)
    }

    public var hasAudio: Bool { !outputs.isEmpty }

    /// Read the next chunk of mixed audio as a CMSampleBuffer.
    /// Returns nil when all sources are exhausted.
    public func nextMixedSample() -> CMSampleBuffer? {
        var buffers: [CMSampleBuffer] = []
        for output in outputs {
            if let buf = output.copyNextSampleBuffer() {
                buffers.append(buf)
            }
        }
        guard !buffers.isEmpty else { return nil }

        if buffers.count == 1 { return buffers[0] }

        return mixBuffers(buffers)
    }

    private func mixBuffers(_ buffers: [CMSampleBuffer]) -> CMSampleBuffer? {
        var allSamples: [[Float]] = []
        for buf in buffers {
            guard let blockBuffer = CMSampleBufferGetDataBuffer(buf) else { continue }
            let length = CMBlockBufferGetDataLength(blockBuffer)
            var data = Data(count: length)
            _ = data.withUnsafeMutableBytes { ptr in
                CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: length, destination: ptr.baseAddress!)
            }
            let floats = data.withUnsafeBytes {
                Array($0.bindMemory(to: Float.self))
            }
            allSamples.append(floats)
        }

        guard allSamples.count >= 2 else {
            return buffers.first
        }

        var mixed = allSamples[0]
        for i in 1..<allSamples.count {
            mixed = AudioMixingMath.mixSamples(mixed, allSamples[i])
        }

        let timing = CMSampleTimingInfo(
            duration: CMSampleBufferGetDuration(buffers[0]),
            presentationTimeStamp: CMSampleBufferGetPresentationTimeStamp(buffers[0]),
            decodeTimeStamp: .invalid
        )
        return createSampleBuffer(from: mixed, timing: timing)
    }

    private func createSampleBuffer(from samples: [Float], timing: CMSampleTimingInfo) -> CMSampleBuffer? {
        let byteCount = samples.count * MemoryLayout<Float>.size
        var blockBuffer: CMBlockBuffer?
        CMBlockBufferCreateWithMemoryBlock(
            allocator: nil, memoryBlock: nil, blockLength: byteCount,
            blockAllocator: nil, customBlockSource: nil, offsetToData: 0,
            dataLength: byteCount, flags: 0, blockBufferOut: &blockBuffer
        )
        guard let block = blockBuffer else { return nil }

        _ = samples.withUnsafeBytes { ptr in
            CMBlockBufferReplaceDataBytes(
                with: ptr.baseAddress!, blockBuffer: block,
                offsetIntoDestination: 0, dataLength: byteCount
            )
        }

        var formatDesc: CMAudioFormatDescription?
        var asbd = AudioStreamBasicDescription(
            mSampleRate: sampleRate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: UInt32(channels * MemoryLayout<Float>.size),
            mFramesPerPacket: 1,
            mBytesPerFrame: UInt32(channels * MemoryLayout<Float>.size),
            mChannelsPerFrame: UInt32(channels),
            mBitsPerChannel: 32,
            mReserved: 0
        )
        CMAudioFormatDescriptionCreate(
            allocator: nil, asbd: &asbd, layoutSize: 0,
            layout: nil, magicCookieSize: 0, magicCookie: nil,
            extensions: nil, formatDescriptionOut: &formatDesc
        )
        guard let fmt = formatDesc else { return nil }

        let frameCount = samples.count / channels
        var sampleBuffer: CMSampleBuffer?
        CMAudioSampleBufferCreateReadyWithPacketDescriptions(
            allocator: nil, dataBuffer: block, formatDescription: fmt,
            sampleCount: frameCount, presentationTimeStamp: timing.presentationTimeStamp,
            packetDescriptions: nil, sampleBufferOut: &sampleBuffer
        )
        return sampleBuffer
    }

    public func cancel() {
        readers.forEach { $0.cancelReading() }
    }
}
