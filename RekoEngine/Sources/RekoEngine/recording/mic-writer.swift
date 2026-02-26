import Foundation
import AVFoundation

public final class MicWriter {
    private var audioFile: AVAudioFile?
    private let lock = NSLock()

    public init(outputURL: URL, format: AVAudioFormat) throws {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }
        audioFile = try AVAudioFile(
            forWriting: outputURL,
            settings: format.settings,
            commonFormat: format.commonFormat,
            interleaved: format.isInterleaved
        )
    }

    public func write(buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        try? audioFile?.write(from: buffer)
    }

    public func finish() {
        lock.lock()
        defer { lock.unlock() }
        audioFile = nil
    }
}
