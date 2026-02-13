import Foundation
import CoreMedia

public struct RecordingConfig: Codable {
    public let displayId: UInt32
    public let fps: Int
    public let captureSystemAudio: Bool
    public let outputDir: String
    public let micId: String?
    public let cameraId: String?
}

public struct RecordingResult: Codable {
    public let screenPath: String
    public let systemAudioPath: String?
    public let micPath: String?
    public let cameraPath: String?
    public let durationMs: UInt64
    public let frameCount: UInt64
}

public final class RecordingPipeline {
    private let screenCapture = ScreenCapture()
    private var videoWriter: VideoWriter?
    private var systemAudioWriter: AudioFileWriter?
    private var micCapture: MicCapture?
    private var micWriter: MicWriter?
    private var cameraCapture: CameraCapture?
    private var cameraWriter: VideoWriter?
    private var frameCount: UInt64 = 0
    private var startTime: UInt64 = 0
    private var isRecording = false
    private let config: RecordingConfig
    private let outputDir: URL

    public init(config: RecordingConfig) {
        self.config = config
        self.outputDir = URL(fileURLWithPath: config.outputDir)
    }

    public func start() async throws {
        try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

        let displays = try await ScreenCapture.listDisplays()
        guard let display = displays.first(where: { $0.id == config.displayId }) else {
            throw CaptureError.displayNotFound
        }

        let width = display.width * 2
        let height = display.height * 2

        videoWriter = try VideoWriter(
            outputURL: outputDir.appendingPathComponent("screen.mov"),
            width: width, height: height, fps: config.fps
        )

        if config.captureSystemAudio {
            systemAudioWriter = try AudioFileWriter(
                outputURL: outputDir.appendingPathComponent("system_audio.wav"),
                sampleRate: 48000, channels: 2
            )
        }

        if config.micId != nil {
            let mic = MicCapture()
            let format = mic.inputFormat()
            let writer = try MicWriter(
                outputURL: outputDir.appendingPathComponent("mic.wav"),
                format: format
            )
            try mic.start { buffer, _ in
                writer.write(buffer: buffer)
            }
            micCapture = mic
            micWriter = writer
        }

        if let cameraId = config.cameraId {
            let camera = CameraCapture()
            let dims = try camera.startCapture(deviceId: cameraId) { [weak self] sampleBuffer in
                guard let self = self, self.isRecording else { return }
                self.cameraWriter?.appendVideoSample(sampleBuffer)
            }
            cameraWriter = try VideoWriter(
                outputURL: outputDir.appendingPathComponent("camera.mov"),
                width: dims.width, height: dims.height, fps: config.fps
            )
            cameraCapture = camera
        }

        frameCount = 0
        startTime = mach_absolute_time()
        isRecording = true

        try await screenCapture.startCapture(
            displayID: config.displayId,
            fps: config.fps,
            captureAudio: config.captureSystemAudio,
            onVideoFrame: { [weak self] sampleBuffer in
                guard let self = self, self.isRecording else { return }
                self.videoWriter?.appendVideoSample(sampleBuffer)
                self.frameCount += 1
            },
            onAudioSample: { [weak self] sampleBuffer in
                guard let self = self, self.isRecording else { return }
                self.systemAudioWriter?.appendAudioSample(sampleBuffer)
            }
        )
    }

    public func stop() async throws -> RecordingResult {
        isRecording = false
        try await screenCapture.stopCapture()
        await videoWriter?.finish()
        systemAudioWriter?.finish()
        micCapture?.stop()
        micWriter?.finish()
        cameraCapture?.stopCapture()
        await cameraWriter?.finish()

        var timebaseInfo = mach_timebase_info_data_t()
        mach_timebase_info(&timebaseInfo)
        let elapsed = mach_absolute_time() - startTime
        let durationMs = elapsed * UInt64(timebaseInfo.numer) / UInt64(timebaseInfo.denom) / 1_000_000

        return RecordingResult(
            screenPath: "screen.mov",
            systemAudioPath: config.captureSystemAudio ? "system_audio.wav" : nil,
            micPath: micCapture != nil ? "mic.wav" : nil,
            cameraPath: cameraCapture != nil ? "camera.mov" : nil,
            durationMs: durationMs,
            frameCount: frameCount
        )
    }
}
