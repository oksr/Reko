import Foundation
import AVFoundation
import CoreMedia
import CoreVideo

// MARK: - Export Config (decoded from JSON)

public struct ExportConfig: Codable {
    public let resolution: String
    public let quality: String
    public let bitrate: Int
    public let outputPath: String
}

// MARK: - Sequence Export Types

public struct ExportClip {
    public let sourceStartMs: UInt64
    public let sourceEndMs: UInt64
    public let speed: Double
    public let zoomKeyframes: [ExportZoomKeyframe]

    public init(sourceStartMs: UInt64, sourceEndMs: UInt64, speed: Double, zoomKeyframes: [ExportZoomKeyframe]) {
        self.sourceStartMs = sourceStartMs
        self.sourceEndMs = sourceEndMs
        self.speed = speed
        self.zoomKeyframes = zoomKeyframes
    }

    public var durationMs: UInt64 {
        UInt64(Double(sourceEndMs - sourceStartMs) / speed)
    }
}

public struct ExportZoomKeyframe {
    public let timeMs: UInt64
    public let x: Double
    public let y: Double
    public let scale: Double
    public let easing: String
    public let durationMs: UInt64?  // legacy, optional

    public init(timeMs: UInt64, x: Double, y: Double, scale: Double, easing: String, durationMs: UInt64? = nil) {
        self.timeMs = timeMs
        self.x = x
        self.y = y
        self.scale = scale
        self.easing = easing
        self.durationMs = durationMs
    }
}

public struct ExportTransition {
    public let type: String
    public let durationMs: UInt64

    public init(type: String, durationMs: UInt64) {
        self.type = type
        self.durationMs = durationMs
    }
}

// MARK: - Export Math (testable)

public enum ExportMath {
    /// Total duration of the sequence accounting for transition overlaps.
    /// Mirrors `getSequenceDuration()` from `src/lib/sequence.ts`.
    public static func sequenceDurationMs(clips: [ExportClip], transitions: [ExportTransition?]) -> UInt64 {
        var total: UInt64 = 0
        for clip in clips {
            total += clip.durationMs
        }
        for t in transitions {
            if let t = t, t.type != "cut" {
                total -= t.durationMs
            }
        }
        return total
    }

    // MARK: - Clip Output Ranges

    public struct ClipOutputRange {
        public let clipIndex: Int
        public let sourceStartMs: UInt64
        public let sourceEndMs: UInt64
        public let outputStartMs: UInt64
        public let outputEndMs: UInt64
        public let speed: Double
        public let zoomKeyframes: [ExportZoomKeyframe]
    }

    /// Compute the output time range for each clip, accounting for transition overlaps.
    /// Mirrors `sequenceTimeToSourceTime()` logic from `src/lib/sequence.ts`.
    public static func computeClipOutputRanges(clips: [ExportClip], transitions: [ExportTransition?]) -> [ClipOutputRange] {
        var ranges: [ClipOutputRange] = []
        var elapsed: UInt64 = 0

        for (i, clip) in clips.enumerated() {
            let clipDuration = clip.durationMs
            var overlapBefore: UInt64 = 0
            if i > 0 && (i - 1) < transitions.count, let t = transitions[i - 1], t.type != "cut" {
                overlapBefore = t.durationMs
            }
            let outputStart = elapsed >= overlapBefore ? elapsed - overlapBefore : 0

            ranges.append(ClipOutputRange(
                clipIndex: i,
                sourceStartMs: clip.sourceStartMs,
                sourceEndMs: clip.sourceEndMs,
                outputStartMs: outputStart,
                outputEndMs: outputStart + clipDuration,
                speed: clip.speed,
                zoomKeyframes: clip.zoomKeyframes
            ))

            elapsed += clipDuration
            if i < transitions.count, let t = transitions[i], t.type != "cut" {
                elapsed -= t.durationMs
            }
        }
        return ranges
    }

    // MARK: - JSON Parsing

    /// Parse sequence clips and transitions from project JSON dictionary.
    /// Returns empty arrays if sequence key is missing (fallback to single-clip export).
    public static func parseSequenceClips(from project: [String: Any]) -> ([ExportClip], [ExportTransition?]) {
        guard let sequence = project["sequence"] as? [String: Any],
              let clipsArray = sequence["clips"] as? [[String: Any]],
              !clipsArray.isEmpty else {
            return ([], [])
        }

        let clips: [ExportClip] = clipsArray.compactMap { dict in
            guard let sourceStart = (dict["sourceStart"] as? NSNumber)?.uint64Value,
                  let sourceEnd = (dict["sourceEnd"] as? NSNumber)?.uint64Value else {
                return nil
            }
            let speed = (dict["speed"] as? NSNumber)?.doubleValue ?? 1.0

            var zoomKeyframes: [ExportZoomKeyframe] = []
            if let kfs = dict["zoomKeyframes"] as? [[String: Any]] {
                zoomKeyframes = kfs.compactMap { kf in
                    guard let t = (kf["timeMs"] as? NSNumber)?.uint64Value,
                          let x = (kf["x"] as? NSNumber)?.doubleValue,
                          let y = (kf["y"] as? NSNumber)?.doubleValue,
                          let s = (kf["scale"] as? NSNumber)?.doubleValue else { return nil }
                    let d = (kf["durationMs"] as? NSNumber)?.uint64Value  // optional legacy field
                    return ExportZoomKeyframe(
                        timeMs: t, x: x, y: y, scale: s,
                        easing: kf["easing"] as? String ?? "spring", durationMs: d
                    )
                }
            }

            return ExportClip(
                sourceStartMs: sourceStart, sourceEndMs: sourceEnd,
                speed: speed, zoomKeyframes: zoomKeyframes
            )
        }

        var transitions: [ExportTransition?] = []
        if let transArray = sequence["transitions"] as? [Any] {
            transitions = transArray.map { item in
                guard let dict = item as? [String: Any],
                      let type = dict["type"] as? String,
                      let duration = (dict["durationMs"] as? NSNumber)?.uint64Value else {
                    return nil
                }
                return ExportTransition(type: type, durationMs: duration)
            }
        }

        return (clips, transitions)
    }

    // MARK: - Spring Physics

    /// Spring response/damping for each speed setting
    public static func springParams(speed: String) -> (response: Double, damping: Double) {
        switch speed {
        case "slow": return (1.4, 1.0)
        case "fast": return (0.65, 0.95)
        default: return (1.0, 1.0) // medium
        }
    }

    /// Critically-damped (or underdamped) spring easing.
    /// Must match Rust `spring_ease` and TypeScript `springEase` exactly.
    public static func springEase(_ t: Double, response: Double, damping: Double) -> Double {
        if t <= 0 { return 0 }
        if t >= 1 { return 1 }

        let omega = 2.0 * Double.pi / response
        let actualT = t * response * 2.0
        let decay = exp(-damping * omega * actualT)

        if damping >= 1.0 {
            // Critically damped
            return 1.0 - (1.0 + omega * actualT) * decay
        } else {
            // Underdamped
            let dampedFreq = omega * sqrt(1.0 - damping * damping)
            return 1.0 - decay * (cos(dampedFreq * actualT) +
                   (damping * omega / dampedFreq) * sin(dampedFreq * actualT))
        }
    }

    private static func easeOut(_ t: Double) -> Double {
        if t <= 0 { return 0 }
        if t >= 1 { return 1 }
        return 1.0 - (1.0 - t) * (1.0 - t)
    }

    private static func applyEasing(_ t: Double, easing: String, response: Double, damping: Double) -> Double {
        switch easing {
        case "spring": return springEase(t, response: response, damping: damping)
        case "ease-out": return easeOut(t)
        default: return t // linear
        }
    }

    private static func applyCursorFollow(
        x: Double, y: Double,
        cursor: (x: Double, y: Double)?,
        strength: Double, scale: Double
    ) -> (x: Double, y: Double) {
        guard strength > 0, scale > 1.0, let cursor = cursor else {
            return (x, y)
        }
        let blend = strength * min((scale - 1.0) / 1.0, 1.0)
        return (
            x: x * (1.0 - blend) + cursor.x * blend,
            y: y * (1.0 - blend) + cursor.y * blend
        )
    }

    // MARK: - Zoom Interpolation (keyframe-pair model, matches frontend)

    /// Keyframe-pair zoom interpolation matching `interpolateZoom()` from `src/lib/zoom-interpolation.ts`.
    /// Finds the surrounding keyframe pair and interpolates using the target keyframe's easing.
    public static func interpolateZoom(
        _ keyframes: [ExportZoomKeyframe],
        at timeMs: UInt64,
        cursor: (x: Double, y: Double)? = nil,
        cursorFollowStrength: Double = 0,
        transitionSpeed: String = "medium"
    ) -> (x: Double, y: Double, scale: Double) {
        let none = (x: 0.5, y: 0.5, scale: 1.0)
        guard !keyframes.isEmpty else { return none }

        let (response, damping) = springParams(speed: transitionSpeed)

        // Before first keyframe
        if timeMs <= keyframes[0].timeMs {
            let kf = keyframes[0]
            let pos = applyCursorFollow(x: kf.x, y: kf.y, cursor: cursor, strength: cursorFollowStrength, scale: kf.scale)
            return (x: pos.x, y: pos.y, scale: kf.scale)
        }

        // After last keyframe
        if timeMs >= keyframes[keyframes.count - 1].timeMs {
            let kf = keyframes[keyframes.count - 1]
            let pos = applyCursorFollow(x: kf.x, y: kf.y, cursor: cursor, strength: cursorFollowStrength, scale: kf.scale)
            return (x: pos.x, y: pos.y, scale: kf.scale)
        }

        // Find surrounding pair
        var nextIdx = 0
        for (i, kf) in keyframes.enumerated() {
            if kf.timeMs > timeMs {
                nextIdx = i
                break
            }
        }

        let prev = keyframes[nextIdx - 1]
        let next = keyframes[nextIdx]

        let duration = Double(next.timeMs - prev.timeMs)
        let rawT = duration > 0 ? Double(timeMs - prev.timeMs) / duration : 1.0

        let easedT = applyEasing(rawT, easing: next.easing, response: response, damping: damping)

        let x = prev.x + (next.x - prev.x) * easedT
        let y = prev.y + (next.y - prev.y) * easedT
        let scale = prev.scale + (next.scale - prev.scale) * easedT

        let pos = applyCursorFollow(x: x, y: y, cursor: cursor, strength: cursorFollowStrength, scale: scale)
        return (x: pos.x, y: pos.y, scale: scale)
    }

    // MARK: - Audio Timestamp Remapping

    /// Shift a CMSampleBuffer's presentation timestamp by offsetMs (output - source time).
    public static func remapAudioTimestamp(_ buffer: CMSampleBuffer, offsetMs: Int64) -> CMSampleBuffer? {
        let pts = CMSampleBufferGetPresentationTimeStamp(buffer)
        let offset = CMTime(value: offsetMs, timescale: 1000)
        let newPts = CMTimeAdd(pts, offset)

        var timing = CMSampleTimingInfo(
            duration: CMSampleBufferGetDuration(buffer),
            presentationTimeStamp: newPts,
            decodeTimeStamp: .invalid
        )

        var newBuffer: CMSampleBuffer?
        let status = CMSampleBufferCreateCopyWithNewTiming(
            allocator: nil,
            sampleBuffer: buffer,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleBufferOut: &newBuffer
        )
        return status == noErr ? newBuffer : nil
    }
}

// MARK: - Zoom / Cursor helper types (private, used internally by ExportPipeline)

private typealias ZoomKF = ExportZoomKeyframe

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
            ? min(100.0, Double(_framesRendered) / Double(_totalFrames) * 100.0)
            : 0
        let msPerFrame = _framesRendered > 0
            ? Double(elapsedMs) / Double(_framesRendered)
            : 0
        let remaining: UInt64 = {
            guard _framesRendered > 0 && _totalFrames > _framesRendered else { return 0 }
            return UInt64(msPerFrame * Double(_totalFrames - _framesRendered))
        }()

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

        // ---- Parse sequence clips or create single-clip fallback ----
        let (seqClips, seqTransitions) = ExportMath.parseSequenceClips(from: project)

        // Parse global zoom keyframes from effects (used as fallback for legacy single-clip)
        let globalZoomKeyframes: [ExportZoomKeyframe] = {
            guard let kfs = effectsDict["zoomKeyframes"] as? [[String: Any]] else { return [] }
            return kfs.compactMap { kf in
                guard let t = kf["timeMs"] as? UInt64,
                      let x = kf["x"] as? Double,
                      let y = kf["y"] as? Double,
                      let s = kf["scale"] as? Double else { return nil }
                let d = kf["durationMs"] as? UInt64  // optional legacy field
                return ExportZoomKeyframe(
                    timeMs: t, x: x, y: y, scale: s,
                    easing: kf["easing"] as? String ?? "spring", durationMs: d
                )
            }
        }()

        let clips: [ExportClip]
        let transitions: [ExportTransition?]
        if !seqClips.isEmpty {
            clips = seqClips
            transitions = seqTransitions
        } else {
            // Single synthetic clip from timeline in/out with global zoom keyframes
            clips = [ExportClip(
                sourceStartMs: inPointMs,
                sourceEndMs: outPointMs,
                speed: 1.0,
                zoomKeyframes: globalZoomKeyframes
            )]
            transitions = []
        }

        let clipRanges = ExportMath.computeClipOutputRanges(clips: clips, transitions: transitions)

        // ---- Probe screen file for dimensions & fps ----
        let screenURL = URL(fileURLWithPath: screenPath)
        let probeDecoder = try VideoDecoder(url: screenURL, inPointMs: inPointMs, outPointMs: outPointMs)
        let fps = probeDecoder.fps
        let naturalWidth = probeDecoder.naturalWidth
        let naturalHeight = probeDecoder.naturalHeight
        probeDecoder.cancel()

        // ---- Set up Metal compositor ----
        let compositor = try MetalCompositor()
        let outSize = LayoutMath.outputSize(
            resolution: exportConfig.resolution,
            recordingWidth: naturalWidth,
            recordingHeight: naturalHeight
        )
        try compositor.configure(width: outSize.width, height: outSize.height)

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
                AVVideoAverageBitRateKey: exportConfig.bitrate,
                AVVideoMaxKeyFrameIntervalKey: Int(fps),
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

        // Audio input will be set up if any clip has audio
        var audioInput: AVAssetWriterInput?
        // Check if audio exists by probing
        let hasAudio = micPath != nil || systemAudioPath != nil
        if hasAudio {
            let audioOutputSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48000,
                AVNumberOfChannelsKey: 2,
                AVEncoderBitRateKey: 192_000,
            ]
            let aInput = AVAssetWriterInput(
                mediaType: .audio, outputSettings: audioOutputSettings
            )
            aInput.expectsMediaDataInRealTime = false
            writer.add(aInput)
            audioInput = aInput
        }

        writer.startWriting()
        writer.startSession(atSourceTime: .zero)

        // ---- Compute total frames for progress ----
        let frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps))
        var totalFrames = 0
        for range in clipRanges {
            let clipDurationSec = Double(range.outputEndMs - range.outputStartMs) / 1000.0
            totalFrames += max(1, Int(clipDurationSec * Double(fps)))
        }
        progress.start(totalFrames: totalFrames)
        var globalFrameIndex = 0

        // ---- Clip-by-clip frame loop ----
        for range in clipRanges {
            if isCancelled { break }

            // Create decoders scoped to this clip's source range
            let screenDecoder = try VideoDecoder(
                url: screenURL, inPointMs: range.sourceStartMs, outPointMs: range.sourceEndMs
            )

            var cameraDecoder: VideoDecoder?
            if let camPath = cameraPath {
                cameraDecoder = try VideoDecoder(
                    url: URL(fileURLWithPath: camPath),
                    inPointMs: range.sourceStartMs, outPointMs: range.sourceEndMs
                )
            }

            // Create audio mixer scoped to this clip's source range
            let audioMixer = AudioMixer()
            if let micURL = micPath {
                try? audioMixer.addTrack(
                    url: URL(fileURLWithPath: micURL),
                    inPointMs: range.sourceStartMs, outPointMs: range.sourceEndMs
                )
            }
            if let sysURL = systemAudioPath {
                try? audioMixer.addTrack(
                    url: URL(fileURLWithPath: sysURL),
                    inPointMs: range.sourceStartMs, outPointMs: range.sourceEndMs
                )
            }
            // Audio offset: shift from source time to output time
            let audioOffsetMs = Int64(range.outputStartMs) - Int64(range.sourceStartMs)

            var clipFrameIndex = 0

            while let screenBuffer = screenDecoder.nextFrame() {
                if isCancelled {
                    writer.cancelWriting()
                    screenDecoder.cancel()
                    cameraDecoder?.cancel()
                    audioMixer.cancel()
                    throw ExportError.cancelled
                }

                let cameraBuffer = cameraDecoder?.nextFrame()

                // clipRelativeTimeMs — for zoom keyframes (stored clip-relative)
                let clipRelativeTimeMs = UInt64(Double(clipFrameIndex) / Double(fps) * 1000.0)
                // sourceTimeMs — for mouse events (recorded at absolute source time)
                let sourceTimeMs = range.sourceStartMs + clipRelativeTimeMs

                let smoothedCursor = smoothedCursorPosition(mouseEvents, at: sourceTimeMs)
                let (zx, zy, zs) = ExportMath.interpolateZoom(
                    range.zoomKeyframes, at: clipRelativeTimeMs, cursor: smoothedCursor
                )
                let cursorPos = cursorPosition(mouseEvents, at: sourceTimeMs)

                let composited = try compositor.renderFrame(
                    screenPixelBuffer: screenBuffer,
                    cameraPixelBuffer: cameraBuffer,
                    effects: effects,
                    screenWidth: naturalWidth,
                    screenHeight: naturalHeight,
                    zoomX: zx,
                    zoomY: zy,
                    zoomScale: zs,
                    cursorX: cursorPos?.x,
                    cursorY: cursorPos?.y
                )

                // Monotonic presentation time from globalFrameIndex
                let presentationTime = CMTimeMultiply(frameDuration, multiplier: Int32(globalFrameIndex))

                while !videoInput.isReadyForMoreMediaData {
                    Thread.sleep(forTimeInterval: 0.001)
                }
                pixelBufferAdaptor.append(composited, withPresentationTime: presentationTime)

                // Interleave audio samples with timestamp remapping
                if let aInput = audioInput, audioMixer.hasAudio {
                    while aInput.isReadyForMoreMediaData,
                          let audioSample = audioMixer.nextMixedSample() {
                        if let remapped = ExportMath.remapAudioTimestamp(audioSample, offsetMs: audioOffsetMs) {
                            aInput.append(remapped)
                        } else {
                            aInput.append(audioSample)
                        }
                    }
                }

                clipFrameIndex += 1
                globalFrameIndex += 1
                progress.updateFrame(globalFrameIndex)
            }

            // Drain remaining audio for this clip
            if let aInput = audioInput, audioMixer.hasAudio {
                while aInput.isReadyForMoreMediaData,
                      let audioSample = audioMixer.nextMixedSample() {
                    if let remapped = ExportMath.remapAudioTimestamp(audioSample, offsetMs: audioOffsetMs) {
                        aInput.append(remapped)
                    } else {
                        aInput.append(audioSample)
                    }
                }
            }
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

        let totalDurationMs = ExportMath.sequenceDurationMs(clips: clips, transitions: transitions)
        progress.setPhase("done")

        return ExportResult(
            outputPath: exportConfig.outputPath,
            durationMs: totalDurationMs,
            fileSizeBytes: fileSize
        )
    }

    // MARK: - Cursor Helpers (private)

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
