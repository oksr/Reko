import Foundation
import AVFoundation
import CoreGraphics
import CoreVideo
import CoreMedia
import CoreImage

/// Renders composited preview frames on demand using the Metal compositor.
/// Lives for the duration of an editor session. Thread-safe for sequential calls.
///
/// Thread safety note: `ck_preview_frame` grabs a strong reference to the renderer
/// under the preview lock, then releases the lock before calling `renderFrame()`.
/// If `ck_preview_destroy` is called concurrently, it nils `activePreview` but ARC
/// keeps the object alive via the local strong reference. The local `comp`/`screenGen`
/// captures in `renderFrame()` are taken before any external mutation can affect them.
public class PreviewRenderer {
    private var compositor: MetalCompositor?
    private var screenGenerator: AVAssetImageGenerator?
    private var cameraGenerator: AVAssetImageGenerator?
    private var mouseEvents: [MouseEvt] = []
    private var outputWidth: Int = 1280
    private var outputHeight: Int = 720
    private var screenWidth: Int = 1920
    private var screenHeight: Int = 1080

    // Cached for performance — avoid per-frame allocation
    private var ciContext: CIContext?
    private var screenBufferPool: CVPixelBufferPool?
    private var cameraBufferPool: CVPixelBufferPool?

    public init() {}

    // MARK: - Public API

    /// Configure the preview renderer with project data.
    /// Returns (outputWidth, outputHeight) for the frontend to size its canvas.
    public func configure(projectJson: String) throws -> (width: Int, height: Int) {
        guard let data = projectJson.data(using: .utf8) else {
            throw PreviewError.invalidJson("Could not parse project JSON")
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]

        // Parse tracks
        guard let tracks = json["tracks"] as? [String: Any],
              let screenPath = tracks["screen"] as? String else {
            throw PreviewError.invalidJson("Missing tracks.screen")
        }

        // Probe screen video for dimensions
        let screenURL = URL(fileURLWithPath: screenPath)
        let screenAsset = AVURLAsset(url: screenURL)
        let screenTrack = screenAsset.tracks(withMediaType: .video).first
        if let track = screenTrack {
            let size = track.naturalSize.applying(track.preferredTransform)
            screenWidth = Int(abs(size.width))
            screenHeight = Int(abs(size.height))
        }

        // Compute 1080p output preserving aspect ratio (sharp on Retina displays)
        let aspect = Double(screenWidth) / Double(screenHeight)
        outputHeight = 1080
        // Round width to even number (required for video)
        outputWidth = Int(round(1080.0 * aspect / 2.0)) * 2

        // Screen image generator — use tolerance for fast seeking (preview, not export)
        let sg = AVAssetImageGenerator(asset: screenAsset)
        sg.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 10) // 100ms
        sg.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 10)
        sg.appliesPreferredTrackTransform = true
        // Decode at output resolution instead of full native resolution
        sg.maximumSize = CGSize(width: outputWidth, height: outputHeight)
        screenGenerator = sg

        // Camera image generator (optional)
        if let cameraPath = tracks["camera"] as? String {
            let cameraURL = URL(fileURLWithPath: cameraPath)
            let cameraAsset = AVURLAsset(url: cameraURL)
            let cg = AVAssetImageGenerator(asset: cameraAsset)
            cg.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 10)
            cg.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 10)
            cg.appliesPreferredTrackTransform = true
            cg.maximumSize = CGSize(width: outputWidth, height: outputHeight)
            cameraGenerator = cg
        }

        // Load mouse events
        if let mouseEventsPath = tracks["mouseEvents"] as? String ?? tracks["mouse_events"] as? String {
            mouseEvents = loadMouseEvents(path: mouseEventsPath)
        }

        // Set up Metal compositor
        let comp = try MetalCompositor()
        try comp.configure(width: outputWidth, height: outputHeight)

        // Load background image if configured
        if let effects = json["effects"] as? [String: Any],
           let bg = effects["background"] as? [String: Any],
           let imageUrl = bg["imageUrl"] as? String, !imageUrl.isEmpty {
            let blur = bg["imageBlur"] as? Double ?? 0
            try comp.loadBackgroundImage(path: imageUrl, blur: blur, exportWidth: outputWidth)
        }

        compositor = comp

        // Cache CIContext for JPEG encoding (expensive to create, ~5-10ms)
        ciContext = CIContext()

        // Create pixel buffer pools at output resolution (maximumSize makes generators
        // decode at this size, avoiding full-resolution decode + downscale)
        screenBufferPool = createPixelBufferPool(width: outputWidth, height: outputHeight)
        if cameraGenerator != nil {
            cameraBufferPool = createPixelBufferPool(width: outputWidth, height: outputHeight)
        }

        return (width: outputWidth, height: outputHeight)
    }

    /// Render a single composited preview frame.
    ///
    /// - Parameters:
    ///   - sourceTimeMs: Source video time in milliseconds (frontend maps sequence→source time)
    ///   - effectsJson: JSON string of Effects object
    ///   - zoomEventsJson: JSON string of ZoomEvent[] for the active clip (frontend provides per-clip zoom events)
    /// - Returns: JPEG-encoded frame data
    public func renderFrame(sourceTimeMs: UInt64, effectsJson: String, zoomEventsJson: String) throws -> Data {
        guard let comp = compositor, let screenGen = screenGenerator else {
            throw PreviewError.notConfigured
        }

        // Parse effects
        guard let effectsData = effectsJson.data(using: .utf8),
              let effectsDict = try? JSONSerialization.jsonObject(with: effectsData) as? [String: Any] else {
            throw PreviewError.invalidJson("Could not parse effects JSON")
        }
        let effects = ExportEffects(from: effectsDict)

        // Extract screen frame
        let cmTime = CMTime(value: Int64(sourceTimeMs), timescale: 1000)
        let screenCGImage = try screenGen.copyCGImage(at: cmTime, actualTime: nil)
        guard let screenBuffer = pixelBuffer(from: screenCGImage, pool: screenBufferPool) else {
            throw PreviewError.frameExtractionFailed
        }

        // Extract camera frame (optional)
        var cameraBuffer: CVPixelBuffer? = nil
        if let cameraGen = cameraGenerator {
            if let cameraCGImage = try? cameraGen.copyCGImage(at: cmTime, actualTime: nil) {
                cameraBuffer = pixelBuffer(from: cameraCGImage, pool: cameraBufferPool)
            }
        }

        // Compute zoom state from frontend-provided zoom events for the active clip
        var zoomX: Double = 0.5
        var zoomY: Double = 0.5
        var zoomScale: Double = 1.0
        if let zoomData = zoomEventsJson.data(using: .utf8),
           let zoomArr = try? JSONSerialization.jsonObject(with: zoomData) as? [[String: Any]] {
            let events = zoomArr.compactMap { ze -> ExportZoomEvent? in
                guard let id = ze["id"] as? String,
                      let t = ze["timeMs"] as? Double,
                      let d = ze["durationMs"] as? Double,
                      let x = ze["x"] as? Double,
                      let y = ze["y"] as? Double,
                      let scale = ze["scale"] as? Double else { return nil }
                return ExportZoomEvent(id: id, timeMs: UInt64(t), durationMs: UInt64(d), x: x, y: y, scale: scale)
            }
            if !events.isEmpty {
                let zoom = ExportMath.interpolateZoomEvents(events, at: sourceTimeMs)
                zoomX = zoom.x
                zoomY = zoom.y
                zoomScale = zoom.scale
            }
        }

        // Compute cursor position (binary search on source time)
        let cursor = cursorPosition(mouseEvents, at: sourceTimeMs)

        // Compute click state
        let click = activeClick(mouseEvents, at: sourceTimeMs)

        // Render composited frame
        let outputBuffer = try comp.renderFrame(
            screenPixelBuffer: screenBuffer,
            cameraPixelBuffer: cameraBuffer,
            effects: effects,
            screenWidth: screenWidth,
            screenHeight: screenHeight,
            zoomX: zoomX,
            zoomY: zoomY,
            zoomScale: zoomScale,
            cursorX: cursor?.x,
            cursorY: cursor?.y,
            clickX: click?.x,
            clickY: click?.y,
            clickProgress: click?.progress ?? 0
        )

        // JPEG encode using cached CIContext
        guard let jpegData = jpegEncode(pixelBuffer: outputBuffer) else {
            throw PreviewError.frameExtractionFailed
        }

        return jpegData
    }

    public func destroy() {
        compositor = nil
        screenGenerator = nil
        cameraGenerator = nil
        mouseEvents = []
        ciContext = nil
        screenBufferPool = nil
        cameraBufferPool = nil
    }

    // MARK: - Error Type

    private enum PreviewError: Error, LocalizedError {
        case invalidJson(String)
        case notConfigured
        case frameExtractionFailed

        var errorDescription: String? {
            switch self {
            case .invalidJson(let msg): return "Preview: \(msg)"
            case .notConfigured: return "Preview: not configured"
            case .frameExtractionFailed: return "Preview: frame extraction failed"
            }
        }
    }

    // MARK: - Mouse Events

    private func loadMouseEvents(path: String) -> [MouseEvt] {
        guard let content = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
        return content.split(separator: "\n").compactMap { line in
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let timeMs = obj["timeMs"] as? Double,
                  let x = obj["x"] as? Double,
                  let y = obj["y"] as? Double else { return nil }
            let type = obj["type"] as? String ?? "move"
            return MouseEvt(timeMs: UInt64(timeMs), x: x, y: y, type: type)
        }
    }

    // MARK: - Pixel Buffer Conversion

    private func createPixelBufferPool(width: Int, height: Int) -> CVPixelBufferPool? {
        let poolAttrs: [String: Any] = [
            kCVPixelBufferPoolMinimumBufferCountKey as String: 3,
        ]
        let bufferAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ]
        var pool: CVPixelBufferPool?
        CVPixelBufferPoolCreate(kCFAllocatorDefault,
                                poolAttrs as CFDictionary,
                                bufferAttrs as CFDictionary,
                                &pool)
        return pool
    }

    private func pixelBuffer(from cgImage: CGImage, pool: CVPixelBufferPool?) -> CVPixelBuffer? {
        var buffer: CVPixelBuffer?

        // Try pool first (avoids per-frame allocation)
        if let pool = pool,
           cgImage.width == outputWidth && cgImage.height == outputHeight {
            CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &buffer)
        }

        // Fallback: direct allocation (handles mismatched dimensions)
        if buffer == nil {
            let attrs: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferMetalCompatibilityKey as String: true,
            ]
            CVPixelBufferCreate(kCFAllocatorDefault, cgImage.width, cgImage.height,
                                kCVPixelFormatType_32BGRA, attrs as CFDictionary, &buffer)
        }

        guard let buf = buffer else { return nil }
        CVPixelBufferLockBaseAddress(buf, [])
        let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf),
                            width: cgImage.width, height: cgImage.height,
                            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buf),
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue |
                                        CGImageAlphaInfo.premultipliedFirst.rawValue)
        ctx?.draw(cgImage, in: CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))
        CVPixelBufferUnlockBaseAddress(buf, [])
        return buf
    }

    // MARK: - JPEG Encoding

    private func jpegEncode(pixelBuffer: CVPixelBuffer) -> Data? {
        guard let ctx = ciContext else { return nil }
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        return ctx.jpegRepresentation(of: ciImage, colorSpace: colorSpace, options: [
            kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7
        ])
    }

    // MARK: - Cursor & Click (same logic as ExportPipeline in export-pipeline.swift)

    private func cursorPosition(_ events: [MouseEvt], at timeMs: UInt64) -> (x: Double, y: Double)? {
        guard !events.isEmpty else { return nil }
        var lo = 0, hi = events.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if events[mid].timeMs <= timeMs { lo = mid } else { hi = mid - 1 }
        }
        if events[lo].timeMs > timeMs { return nil }
        return (events[lo].x, events[lo].y)
    }

    private func activeClick(_ events: [MouseEvt], at timeMs: UInt64) -> (x: Double, y: Double, progress: Double)? {
        guard !events.isEmpty else { return nil }
        var lo = 0, hi = events.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if events[mid].timeMs <= timeMs { lo = mid } else { hi = mid - 1 }
        }
        if events[lo].timeMs > timeMs { return nil }
        // Scan backwards for click within 500ms window
        let clickDuration: UInt64 = 500
        for i in stride(from: lo, through: 0, by: -1) {
            let e = events[i]
            if timeMs - e.timeMs > clickDuration { break }
            if e.type == "click" || e.type == "rightClick" {
                let elapsed = timeMs - e.timeMs
                let progress = Double(elapsed) / Double(clickDuration)
                return (e.x, e.y, min(1.0, progress))
            }
        }
        return nil
    }
}
