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
    public let zoomEvents: [ExportZoomEvent]

    public init(sourceStartMs: UInt64, sourceEndMs: UInt64, speed: Double, zoomEvents: [ExportZoomEvent]) {
        self.sourceStartMs = sourceStartMs
        self.sourceEndMs = sourceEndMs
        self.speed = speed
        self.zoomEvents = zoomEvents
    }

    public var durationMs: UInt64 {
        UInt64(Double(sourceEndMs - sourceStartMs) / speed)
    }
}

public struct ExportZoomEvent {
    public let id: String
    public let timeMs: UInt64
    public let durationMs: UInt64
    public let x: Double
    public let y: Double
    public let scale: Double

    public init(id: String, timeMs: UInt64, durationMs: UInt64, x: Double, y: Double, scale: Double) {
        self.id = id
        self.timeMs = timeMs
        self.durationMs = durationMs
        self.x = x
        self.y = y
        self.scale = scale
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
        public let zoomEvents: [ExportZoomEvent]
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
                zoomEvents: clip.zoomEvents
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

            var zoomEvents: [ExportZoomEvent] = []
            if let evts = dict["zoomEvents"] as? [[String: Any]] {
                zoomEvents = evts.compactMap { evt in
                    guard let id = evt["id"] as? String,
                          let t = (evt["timeMs"] as? NSNumber)?.uint64Value,
                          let dur = (evt["durationMs"] as? NSNumber)?.uint64Value,
                          let x = (evt["x"] as? NSNumber)?.doubleValue,
                          let y = (evt["y"] as? NSNumber)?.doubleValue,
                          let s = (evt["scale"] as? NSNumber)?.doubleValue else { return nil }
                    return ExportZoomEvent(id: id, timeMs: t, durationMs: dur, x: x, y: y, scale: s)
                }
            }

            return ExportClip(
                sourceStartMs: sourceStart, sourceEndMs: sourceEnd,
                speed: speed, zoomEvents: zoomEvents
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

    private static let springResponse = 1.0
    private static let springDamping = 1.0
    private static let transitionMs: UInt64 = 450

    /// Critically-damped spring easing. Must match TypeScript `springEase` exactly.
    public static func springEase(_ t: Double, response: Double = 1.0, damping: Double = 1.0) -> Double {
        if t <= 0 { return 0 }
        if t >= 1 { return 1 }

        let omega = 2.0 * Double.pi / response
        let actualT = t * response * 2.0
        let decay = exp(-damping * omega * actualT)

        if damping >= 1.0 {
            return 1.0 - (1.0 + omega * actualT) * decay
        } else {
            let dampedFreq = omega * sqrt(1.0 - damping * damping)
            return 1.0 - decay * (cos(dampedFreq * actualT) +
                   (damping * omega / dampedFreq) * sin(dampedFreq * actualT))
        }
    }

    // MARK: - Zoom Event Interpolation (matches frontend interpolateZoomEvents)

    public static func interpolateZoomEvents(
        _ events: [ExportZoomEvent],
        at timeMs: UInt64
    ) -> (x: Double, y: Double, scale: Double) {
        let none = (x: 0.5, y: 0.5, scale: 1.0)
        guard !events.isEmpty else { return none }

        var bestScale = 1.0
        var bestX = 0.5
        var bestY = 0.5

        for evt in events {
            let leadInStart = evt.timeMs >= transitionMs ? evt.timeMs - transitionMs : 0
            let holdStart = evt.timeMs
            let holdEnd = evt.timeMs + evt.durationMs
            let leadOutEnd = holdEnd + transitionMs

            if timeMs < leadInStart || timeMs > leadOutEnd { continue }

            let scale: Double
            let blend: Double

            if timeMs < holdStart {
                // Lead-in
                let t = Double(timeMs - leadInStart) / Double(transitionMs)
                let eased = springEase(t, response: springResponse, damping: springDamping)
                scale = 1.0 + (evt.scale - 1.0) * eased
                blend = eased
            } else if timeMs <= holdEnd {
                // Hold
                scale = evt.scale
                blend = 1.0
            } else {
                // Lead-out
                let t = Double(timeMs - holdEnd) / Double(transitionMs)
                let eased = springEase(t, response: springResponse, damping: springDamping)
                scale = evt.scale + (1.0 - evt.scale) * eased
                blend = 1.0 - eased
            }

            if scale > bestScale {
                bestScale = scale
                bestX = 0.5 + (evt.x - 0.5) * blend
                bestY = 0.5 + (evt.y - 0.5) * blend
            }
        }

        return (x: bestX, y: bestY, scale: bestScale)
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

// MARK: - Cursor helper types (private, used internally by ExportPipeline)

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

        let clips: [ExportClip]
        let transitions: [ExportTransition?]
        if !seqClips.isEmpty {
            clips = seqClips
            transitions = seqTransitions
        } else {
            // Single synthetic clip from timeline in/out
            clips = [ExportClip(
                sourceStartMs: inPointMs,
                sourceEndMs: outPointMs,
                speed: 1.0,
                zoomEvents: []
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

        // Load background image if the user selected a wallpaper/image/custom background
        if let bgImagePath = effects.bgImagePath {
            try compositor.loadBackgroundImage(
                path: bgImagePath,
                blur: effects.bgImageBlur,
                exportWidth: outSize.width
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

                let (zx, zy, zs) = ExportMath.interpolateZoomEvents(
                    range.zoomEvents, at: clipRelativeTimeMs
                )
                let cursorPos = cursorPosition(mouseEvents, at: sourceTimeMs)
                let click = activeClick(mouseEvents, at: sourceTimeMs)

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
                    cursorY: cursorPos?.y,
                    clickX: click?.x,
                    clickY: click?.y,
                    clickProgress: click?.progress ?? 0.0
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

    private let clickDurationMs: UInt64 = 500

    private func activeClick(_ events: [MouseEvt], at timeMs: UInt64) -> (x: Double, y: Double, progress: Double)? {
        guard !events.isEmpty else { return nil }

        // Binary search for last event at or before timeMs
        var lo = 0, hi = events.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if events[mid].timeMs <= timeMs { lo = mid } else { hi = mid - 1 }
        }
        if events[lo].timeMs > timeMs { return nil }

        // Scan backwards from lo within clickDurationMs window
        for i in stride(from: lo, through: 0, by: -1) {
            let e = events[i]
            if timeMs - e.timeMs > clickDurationMs { break }
            if e.type == "click" || e.type == "rightClick" {
                let progress = Double(timeMs - e.timeMs) / Double(clickDurationMs)
                return (e.x, e.y, progress)
            }
        }
        return nil
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
