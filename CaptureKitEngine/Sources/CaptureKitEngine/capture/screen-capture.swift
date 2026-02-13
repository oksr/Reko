import Foundation
import ScreenCaptureKit
import CoreMedia

public struct DisplayInfo: Codable {
    public let id: UInt32
    public let width: Int
    public let height: Int
    public let isMain: Bool
}

public final class ScreenCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var onVideoFrame: ((CMSampleBuffer) -> Void)?
    private var onAudioSample: ((CMSampleBuffer) -> Void)?

    public static func listDisplays() async throws -> [DisplayInfo] {
        let content = try await SCShareableContent.excludingDesktopWindows(
            true, onScreenWindowsOnly: true
        )
        let mainID = CGMainDisplayID()
        return content.displays.map { display in
            DisplayInfo(
                id: display.displayID,
                width: display.width,
                height: display.height,
                isMain: display.displayID == mainID
            )
        }
    }

    public func startCapture(
        displayID: UInt32,
        fps: Int,
        captureAudio: Bool,
        onVideoFrame: @escaping (CMSampleBuffer) -> Void,
        onAudioSample: ((CMSampleBuffer) -> Void)? = nil
    ) async throws {
        self.onVideoFrame = onVideoFrame
        self.onAudioSample = onAudioSample

        let content = try await SCShareableContent.excludingDesktopWindows(
            true, onScreenWindowsOnly: true
        )
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw CaptureError.displayNotFound
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.width = display.width * 2
        config.height = display.height * 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = true
        config.capturesAudio = captureAudio
        if captureAudio {
            config.sampleRate = 48000
            config.channelCount = 2
        }

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        let videoQueue = DispatchQueue(label: "com.capturekit.video", qos: .userInteractive)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: videoQueue)
        if captureAudio {
            let audioQueue = DispatchQueue(label: "com.capturekit.audio", qos: .userInteractive)
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
        }

        try await stream.startCapture()
        self.stream = stream
    }

    public func stopCapture() async throws {
        guard let stream = stream else { return }
        try await stream.stopCapture()
        self.stream = nil
    }

    // MARK: - SCStreamOutput

    public func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard sampleBuffer.isValid else { return }
        switch type {
        case .screen:
            onVideoFrame?(sampleBuffer)
        case .audio:
            onAudioSample?(sampleBuffer)
        case .microphone:
            break
        @unknown default:
            break
        }
    }

    // MARK: - SCStreamDelegate

    public func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("Stream error: \(error)")
    }
}

public enum CaptureError: Error {
    case displayNotFound
}
