import Foundation
import CoreMedia
import AVFoundation
import ScreenCaptureKit

public enum AudioLevelCalculator {
    public static func peakLevel(from buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData else { return 0 }
        let frames = Int(buffer.frameLength)
        var peak: Float = 0
        for i in 0..<frames {
            peak = max(peak, abs(channelData[0][i]))
        }
        return min(peak, 1.0)
    }

    public static func peakLevel(from sampleBuffer: CMSampleBuffer) -> Float {
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return 0 }
        let length = CMBlockBufferGetDataLength(blockBuffer)
        guard length > 0 else { return 0 }

        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &dataPointer)
        guard let src = dataPointer else { return 0 }

        let floatPtr = UnsafeRawPointer(src).assumingMemoryBound(to: Float.self)
        let sampleCount = length / MemoryLayout<Float>.size
        var peak: Float = 0
        for i in 0..<sampleCount {
            peak = max(peak, abs(floatPtr[i]))
        }
        return min(peak, 1.0)
    }
}

public struct AreaRect: Codable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
}

public struct RecordingConfig: Codable {
    public let displayId: UInt32?
    public let windowId: UInt32?
    public let area: AreaRect?
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
    public let mouseEventsPath: String?
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
    private var mouseLogger: MouseLogger?
    private var frameCount: UInt64 = 0
    private var startTime: UInt64 = 0
    private var isRecording = false
    private var isPaused = false
    private var totalPausedNano: UInt64 = 0
    private var pauseStartNano: UInt64 = 0
    private var micLevel: Float = 0
    private var systemAudioLevel: Float = 0
    private let levelsLock = NSLock()
    private let config: RecordingConfig
    private let outputDir: URL

    public init(config: RecordingConfig) {
        self.config = config
        self.outputDir = URL(fileURLWithPath: config.outputDir)
    }

    public func start() async throws {
        try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

        // Determine capture source dimensions
        let captureWidth: Int
        let captureHeight: Int

        if let windowId = config.windowId {
            // Window capture path
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
                throw CaptureError.windowNotFound
            }
            captureWidth = Int(window.frame.width) * 2
            captureHeight = Int(window.frame.height) * 2

            // Start mouse logging — use the main display dimensions for coordinate normalization
            // since CGEvent reports absolute screen coordinates
            let mainDisplay = CGMainDisplayID()
            let displayWidth = CGDisplayPixelsWide(mainDisplay)
            let displayHeight = CGDisplayPixelsHigh(mainDisplay)
            let mouseOutputURL = outputDir.appendingPathComponent("mouse_events.jsonl")
            let logger = MouseLogger(
                outputURL: mouseOutputURL,
                screenWidth: displayWidth,
                screenHeight: displayHeight
            )
            if logger.start() {
                mouseLogger = logger
            }
        } else if let displayId = config.displayId {
            let displays = try await ScreenCapture.listDisplays()
            guard let display = displays.first(where: { $0.id == displayId }) else {
                throw CaptureError.displayNotFound
            }

            if let area = config.area {
                // Area capture: dimensions match the selected area
                captureWidth = Int(area.width) * 2
                captureHeight = Int(area.height) * 2
            } else {
                captureWidth = display.width * 2
                captureHeight = display.height * 2
            }

            // Start mouse logging (display recording only)
            let mouseOutputURL = outputDir.appendingPathComponent("mouse_events.jsonl")
            let logger = MouseLogger(
                outputURL: mouseOutputURL,
                screenWidth: display.width,
                screenHeight: display.height
            )
            if logger.start() {
                mouseLogger = logger
            }
        } else {
            throw CaptureError.displayNotFound
        }

        videoWriter = try VideoWriter(
            outputURL: outputDir.appendingPathComponent("screen.mov"),
            width: captureWidth, height: captureHeight, fps: config.fps
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
            try mic.start { [weak self] buffer, _ in
                guard let self = self, self.isRecording, !self.isPaused else { return }
                writer.write(buffer: buffer)
                let level = AudioLevelCalculator.peakLevel(from: buffer)
                self.levelsLock.lock()
                self.micLevel = level
                self.levelsLock.unlock()
            }
            micCapture = mic
            micWriter = writer
        }

        if let cameraId = config.cameraId {
            let camera = CameraCapture()
            let dims = try camera.startCapture(deviceId: cameraId) { [weak self] sampleBuffer in
                guard let self = self, self.isRecording, !self.isPaused else { return }
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
        mouseLogger?.resetStartTime()
        isRecording = true

        let videoHandler: (CMSampleBuffer) -> Void = { [weak self] sampleBuffer in
            guard let self = self, self.isRecording, !self.isPaused else { return }
            self.videoWriter?.appendVideoSample(sampleBuffer)
            self.frameCount += 1
        }
        let audioHandler: (CMSampleBuffer) -> Void = { [weak self] sampleBuffer in
            guard let self = self, self.isRecording, !self.isPaused else { return }
            self.systemAudioWriter?.appendAudioSample(sampleBuffer)
            let level = AudioLevelCalculator.peakLevel(from: sampleBuffer)
            self.levelsLock.lock()
            self.systemAudioLevel = level
            self.levelsLock.unlock()
        }

        if let windowId = config.windowId {
            try await screenCapture.startWindowCapture(
                windowID: windowId,
                fps: config.fps,
                captureAudio: config.captureSystemAudio,
                onVideoFrame: videoHandler,
                onAudioSample: audioHandler
            )
        } else if let displayId = config.displayId {
            try await screenCapture.startCapture(
                displayID: displayId,
                area: config.area,
                fps: config.fps,
                captureAudio: config.captureSystemAudio,
                onVideoFrame: videoHandler,
                onAudioSample: audioHandler
            )
        }
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
        let hasMouseLogger = mouseLogger != nil
        mouseLogger?.stop()

        var timebaseInfo = mach_timebase_info_data_t()
        mach_timebase_info(&timebaseInfo)
        let elapsed = mach_absolute_time() - startTime - totalPausedNano
        let durationMs = elapsed * UInt64(timebaseInfo.numer) / UInt64(timebaseInfo.denom) / 1_000_000

        return RecordingResult(
            screenPath: "screen.mov",
            systemAudioPath: config.captureSystemAudio ? "system_audio.wav" : nil,
            micPath: micCapture != nil ? "mic.wav" : nil,
            cameraPath: cameraCapture != nil ? "camera.mov" : nil,
            mouseEventsPath: hasMouseLogger ? "mouse_events.jsonl" : nil,
            durationMs: durationMs,
            frameCount: frameCount
        )
    }

    public func pause() {
        guard isRecording, !isPaused else { return }
        isPaused = true
        pauseStartNano = mach_absolute_time()
        mouseLogger?.pause()
    }

    public func resume() {
        guard isRecording, isPaused else { return }
        isPaused = false
        totalPausedNano += mach_absolute_time() - pauseStartNano
        mouseLogger?.resume()
    }

    public func getAudioLevels() -> (mic: Float, systemAudio: Float) {
        levelsLock.lock()
        defer { levelsLock.unlock() }
        return (micLevel, systemAudioLevel)
    }
}
