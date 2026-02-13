import Foundation
import AVFoundation

public struct AudioInputInfo: Codable {
    public let id: String
    public let name: String
}

public final class MicCapture {
    private let engine = AVAudioEngine()
    private var onAudioBuffer: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?

    public static func listInputs() -> [AudioInputInfo] {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone],
            mediaType: .audio,
            position: .unspecified
        ).devices
        return devices.map { AudioInputInfo(id: $0.uniqueID, name: $0.localizedName) }
    }

    public func inputFormat() -> AVAudioFormat {
        return engine.inputNode.outputFormat(forBus: 0)
    }

    public func start(onAudioBuffer: @escaping (AVAudioPCMBuffer, AVAudioTime) -> Void) throws {
        self.onAudioBuffer = onAudioBuffer
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, time in
            self?.onAudioBuffer?(buffer, time)
        }
        engine.prepare()
        try engine.start()
    }

    public func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}
