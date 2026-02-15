import Foundation
import AVFoundation
import CoreMedia
import CoreVideo

// MARK: - Export Config (decoded from JSON)

public struct ExportConfig: Codable {
    public let resolution: String
    public let outputPath: String
}

// MARK: - Zoom / Cursor helper types

private struct ZoomKF {
    let timeMs: UInt64
    let x: Double
    let y: Double
    let scale: Double
    let easing: String
    let durationMs: UInt64
}

private struct MouseEvt: Codable {
    let timeMs: UInt64
    let x: Double
    let y: Double
    let type: String
}

// MARK: - Export Progress (thread-safe, polled by C API)

public final class ExportProgress {
    private let lock = NSLock()
    private var _framesRendered: Int = 0
    private var _totalFrames: Int = 0
    private var _phase: String = "compositing"
    private var _startTime: UInt64 = 0
    private var _error: String?

    public func start(totalFrames: Int) {
        lock.lock()
        _totalFrames = totalFrames
        _framesRendered = 0
        _phase = "compositing"
        _startTime = mach_absolute_time()
        _error = nil
        lock.unlock()
    }

    public func updateFrame(_ count: Int) {
        lock.lock()
        _framesRendered = count
        lock.unlock()
    }

    public func setPhase(_ phase: String) {
        lock.lock()
        _phase = phase
        lock.unlock()
    }

    public func setError(_ error: String) {
        lock.lock()
        _phase = "error"
        _error = error
        lock.unlock()
    }

    public func toJSON() -> String {
        lock.lock()
        defer { lock.unlock() }

        let elapsedMs: UInt64
        if _startTime > 0 {
            var timebaseInfo = mach_timebase_info_data_t()
            mach_timebase_info(&timebaseInfo)
            // Divide before multiply to avoid UInt64 overflow
            let elapsed = mach_absolute_time() - _startTime
            elapsedMs = elapsed / UInt64(timebaseInfo.denom) * UInt64(timebaseInfo.numer) / 1_000_000
        } else {
            elapsedMs = 0
        }

        let percentage = _totalFrames > 0
            ? Double(_framesRendered) / Double(_totalFrames) * 100.0
            : 0
        let msPerFrame = _framesRendered > 0
            ? Double(elapsedMs) / Double(_framesRendered)
            : 0
        let remaining = _framesRendered > 0
            ? UInt64(msPerFrame * Double(_totalFrames - _framesRendered))
            : 0

        if let error = _error {
            return """
            {"framesRendered":\(_framesRendered),"totalFrames":\(_totalFrames),\
            "percentage":\(percentage),"elapsedMs":\(elapsedMs),\
            "estimatedRemainingMs":null,"phase":"error","error":"\(error)"}
            """
        }

        return """
        {"framesRendered":\(_framesRendered),"totalFrames":\(_totalFrames),\
        "percentage":\(String(format: "%.1f", percentage)),"elapsedMs":\(elapsedMs),\
        "estimatedRemainingMs":\(remaining),"phase":"\(_phase)"}
        """
    }
}

// MARK: - Export Result

public struct ExportResult: Codable {
    public let outputPath: String
    public let durationMs: UInt64
    public let fileSizeBytes: UInt64
}

// MARK: - Export Pipeline

public final class ExportPipeline {
    public let progress = ExportProgress()
    private var isCancelled = false

    public init() {}

    public func cancel() {
        isCancelled = true
    }

    /// Run the full export: decode -> composite -> encode.
    ///
    /// - Parameters:
    ///   - projectJSON: The project descriptor (tracks, timeline, effects).
    ///   - exportConfigJSON: Export settings (resolution, outputPath).
    /// - Returns: An `ExportResult` with output path and file metadata.
    public func run(projectJSON: String, exportConfigJSON: String) throws -> ExportResult {
        // ---- Parse project JSON ----
        guard let projectData = projectJSON.data(using: .utf8),
              let project = try? JSONSerialization.jsonObject(with: projectData) as? [String: Any] else {
            throw ExportError.invalidProject("Failed to parse project JSON")
        }

        // ---- Parse export config ----
        let decoder = JSONDecoder()
        guard let configData = exportConfigJSON.data(using: .utf8),
              let exportConfig = try? decoder.decode(ExportConfig.self, from: configData) else {
            throw ExportError.invalidProject("Failed to parse export config JSON")
        }

        // ---- Extract project fields ----
        guard let tracks = project["tracks"] as? [String: Any],
              let screenPath = tracks["screen"] as? String else {
            throw ExportError.invalidProject("Missing screen track path")
        }

        let timeline = project["timeline"] as? [String: Any] ?? [:]
        // Handle both camelCase (from Rust serde rename_all) and snake_case keys
        let inPointMs = (timeline["inPoint"] as? UInt64)
            ?? (timeline["in_point"] as? UInt64)
            ?? 0
        let outPointMs = (timeline["outPoint"] as? UInt64)
            ?? (timeline["out_point"] as? UInt64)
            ?? 0

        let effectsDict = project["effects"] as? [String: Any] ?? [:]
        let effects = ExportEffects(from: effectsDict)

        let cameraPath = tracks["camera"] as? String
        let micPath = tracks["mic"] as? String
        let systemAudioPath = tracks["systemAudio"] as? String
            ?? tracks["system_audio"] as? String

        // Parse zoom keyframes
        let zoomKeyframes: [ZoomKF] = {
            guard let kfs = effectsDict["zoomKeyframes"] as? [[String: Any]] else { return [] }
            return kfs.compactMap { kf in
                guard let t = kf["timeMs"] as? UInt64,
                      let x = kf["x"] as? Double,
                      let y = kf["y"] as? Double,
                      let s = kf["scale"] as? Double,
                      let d = kf["durationMs"] as? UInt64 else { return nil }
                return ZoomKF(timeMs: t, x: x, y: y, scale: s,
                              easing: kf["easing"] as? String ?? "ease-in-out", durationMs: d)
            }
        }()

        // Parse mouse events
        var mouseEvents: [MouseEvt] = []
        if let mouseEventsPath = tracks["mouseEvents"] as? String ?? tracks["mouse_events"] as? String {
            let mouseURL = URL(fileURLWithPath: mouseEventsPath)
            if let content = try? String(contentsOf: mouseURL, encoding: .utf8) {
                mouseEvents = content.split(separator: "\n").compactMap { line in
                    try? JSONDecoder().decode(MouseEvt.self, from: Data(line.utf8))
                }
            }
        }

        // ---- Set up video decoder ----
        let screenURL = URL(fileURLWithPath: screenPath)
        let screenDecoder = try VideoDecoder(
            url: screenURL, inPointMs: inPointMs, outPointMs: outPointMs
        )

        var cameraDecoder: VideoDecoder?
        if let camPath = cameraPath {
            cameraDecoder = try VideoDecoder(
                url: URL(fileURLWithPath: camPath),
                inPointMs: inPointMs, outPointMs: outPointMs
            )
        }

        // ---- Set up Metal compositor ----
        let compositor = try MetalCompositor()
        let outSize = LayoutMath.outputSize(
            resolution: exportConfig.resolution,
            recordingWidth: screenDecoder.naturalWidth,
            recordingHeight: screenDecoder.naturalHeight
        )
        try compositor.configure(width: outSize.width, height: outSize.height)

        // ---- Set up audio mixer ----
        let audioMixer = AudioMixer()
        if let micURL = micPath {
            try? audioMixer.addTrack(
                url: URL(fileURLWithPath: micURL),
                inPointMs: inPointMs, outPointMs: outPointMs
            )
        }
        if let sysURL = systemAudioPath {
            try? audioMixer.addTrack(
                url: URL(fileURLWithPath: sysURL),
                inPointMs: inPointMs, outPointMs: outPointMs
            )
        }

        // ---- Set up AVAssetWriter ----
        let outputURL = URL(fileURLWithPath: exportConfig.outputPath)
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: outSize.width,
            AVVideoHeightKey: outSize.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 20_000_000,
                AVVideoMaxKeyFrameIntervalKey: Int(screenDecoder.fps),
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ] as [String: Any],
        ]
        let videoInput = AVAssetWriterInput(
            mediaType: .video, outputSettings: videoSettings
        )
        videoInput.expectsMediaDataInRealTime = false
        let pixelBufferAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: outSize.width,
                kCVPixelBufferHeightKey as String: outSize.height,
                kCVPixelBufferMetalCompatibilityKey as String: true,
            ]
        )
        writer.add(videoInput)

        var audioInput: AVAssetWriterInput?
        if audioMixer.hasAudio {
            let aInput = AVAssetWriterInput(
                mediaType: .audio, outputSettings: audioMixer.outputSettings
            )
            aInput.expectsMediaDataInRealTime = false
            writer.add(aInput)
            audioInput = aInput
        }

        writer.startWriting()
        let startTime = CMTime(value: Int64(inPointMs), timescale: 1000)
        writer.startSession(atSourceTime: startTime)

        // ---- Frame loop ----
        let totalFrames = screenDecoder.trimmedFrameCount
        progress.start(totalFrames: totalFrames)
        var frameIndex = 0
        let frameDuration = CMTime(value: 1, timescale: CMTimeScale(screenDecoder.fps))

        while let screenBuffer = screenDecoder.nextFrame() {
            if isCancelled {
                writer.cancelWriting()
                screenDecoder.cancel()
                cameraDecoder?.cancel()
                audioMixer.cancel()
                throw ExportError.cancelled
            }

            let cameraBuffer = cameraDecoder?.nextFrame()

            let frameTimeMs = inPointMs + UInt64(Double(frameIndex) / Double(screenDecoder.fps) * 1000.0)
            let smoothedCursor = smoothedCursorPosition(mouseEvents, at: frameTimeMs)
            let (zx, zy, zs) = interpolateZoom(zoomKeyframes, at: frameTimeMs, cursor: smoothedCursor)
            let cursorPos = cursorPosition(mouseEvents, at: frameTimeMs)

            let composited = try compositor.renderFrame(
                screenPixelBuffer: screenBuffer,
                cameraPixelBuffer: cameraBuffer,
                effects: effects,
                screenWidth: screenDecoder.naturalWidth,
                screenHeight: screenDecoder.naturalHeight,
                zoomX: zx,
                zoomY: zy,
                zoomScale: zs,
                cursorX: cursorPos?.x,
                cursorY: cursorPos?.y
            )

            let presentationTime = CMTimeAdd(
                startTime,
                CMTimeMultiply(frameDuration, multiplier: Int32(frameIndex))
            )

            // Wait until the writer input is ready
            while !videoInput.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.001)
            }
            pixelBufferAdaptor.append(composited, withPresentationTime: presentationTime)

            // Interleave audio samples
            if let aInput = audioInput {
                while aInput.isReadyForMoreMediaData,
                      let audioSample = audioMixer.nextMixedSample() {
                    aInput.append(audioSample)
                }
            }

            frameIndex += 1
            progress.updateFrame(frameIndex)
        }

        // ---- Finalize ----
        progress.setPhase("finalizing")
        videoInput.markAsFinished()
        audioInput?.markAsFinished()

        let semaphore = DispatchSemaphore(value: 0)
        writer.finishWriting { semaphore.signal() }
        semaphore.wait()

        guard writer.status == .completed else {
            throw ExportError.writerFailed(
                writer.error?.localizedDescription ?? "Unknown writer error"
            )
        }

        let attrs = try FileManager.default.attributesOfItem(atPath: outputURL.path)
        let fileSize = attrs[.size] as? UInt64 ?? 0

        let durationMs = outPointMs - inPointMs
        progress.setPhase("done")

        return ExportResult(
            outputPath: exportConfig.outputPath,
            durationMs: durationMs,
            fileSizeBytes: fileSize
        )
    }

    // MARK: - Zoom / Cursor Interpolation

    private func interpolateZoom(_ keyframes: [ZoomKF], at timeMs: UInt64, cursor: (x: Double, y: Double)? = nil) -> (x: Double, y: Double, scale: Double) {
        guard !keyframes.isEmpty else { return (0.5, 0.5, 1.0) }
        if timeMs <= keyframes[0].timeMs { return (0.5, 0.5, 1.0) }

        if let last = keyframes.last, timeMs >= last.timeMs + last.durationMs {
            let tx = cursor?.x ?? last.x
            let ty = cursor?.y ?? last.y
            return (tx, ty, last.scale)
        }

        for (i, kf) in keyframes.enumerated() {
            let end = kf.timeMs + kf.durationMs
            if timeMs >= kf.timeMs && timeMs < end {
                let t = Double(timeMs - kf.timeMs) / Double(kf.durationMs)
                let et = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t

                let prev: (x: Double, y: Double, scale: Double) = i > 0
                    ? (keyframes[i-1].x, keyframes[i-1].y, keyframes[i-1].scale)
                    : (0.5, 0.5, 1.0)

                let targetX = cursor?.x ?? kf.x
                let targetY = cursor?.y ?? kf.y
                return (
                    prev.x + (targetX - prev.x) * et,
                    prev.y + (targetY - prev.y) * et,
                    prev.scale + (kf.scale - prev.scale) * et
                )
            }

            if i + 1 < keyframes.count && timeMs >= end && timeMs < keyframes[i+1].timeMs {
                let tx = cursor?.x ?? kf.x
                let ty = cursor?.y ?? kf.y
                return (tx, ty, kf.scale)
            }
        }
        return (0.5, 0.5, 1.0)
    }

    private func smoothedCursorPosition(_ events: [MouseEvt], at timeMs: UInt64, windowMs: UInt64 = 150) -> (x: Double, y: Double)? {
        let samples = 7
        var totalWeight = 0.0
        var wx = 0.0
        var wy = 0.0
        var hitCount = 0

        for i in 0..<samples {
            let t: UInt64
            if timeMs >= windowMs {
                t = timeMs - windowMs + (windowMs * UInt64(i)) / UInt64(samples - 1)
            } else {
                t = (timeMs * UInt64(i)) / UInt64(samples - 1)
            }
            guard let pos = cursorPosition(events, at: t) else { continue }

            let weight = exp(Double(i - (samples - 1)) / 2.0)
            wx += pos.x * weight
            wy += pos.y * weight
            totalWeight += weight
            hitCount += 1
        }

        guard hitCount > 0 else { return nil }
        return (wx / totalWeight, wy / totalWeight)
    }

    private func cursorPosition(_ events: [MouseEvt], at timeMs: UInt64) -> (x: Double, y: Double)? {
        guard !events.isEmpty else { return nil }
        // Binary search for last event at or before timeMs
        var lo = 0, hi = events.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if events[mid].timeMs <= timeMs { lo = mid } else { hi = mid - 1 }
        }
        if events[lo].timeMs > timeMs { return nil }
        return (events[lo].x, events[lo].y)
    }
}
