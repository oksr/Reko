import Foundation
import ScreenCaptureKit
import CoreMedia
import AppKit

public struct WindowInfo: Codable {
    public let id: UInt32
    public let appName: String
    public let title: String
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int
    public let bundleId: String
    public let appIcon: String  // base64-encoded 64x64 PNG
}

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

    /// Build a z-order map from CGWindowListCopyWindowInfo (CoreGraphics, thread-safe).
    /// Returns [windowID: orderIndex] where 0 = frontmost.
    /// Only includes windows at the normal layer (0) to skip system overlays,
    /// screenshot tools, and other non-user windows.
    public static func getWindowZOrder() -> [UInt32: Int] {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[CFString: Any]] else {
            return [:]
        }
        var order: [UInt32: Int] = [:]
        var idx = 0
        for info in list {
            // Only include normal-layer windows (layer 0). System overlays,
            // screenshot tools, menu bars etc. live at higher layers.
            let layer = info[kCGWindowLayer] as? Int ?? -1
            guard layer == 0 else { continue }
            if let wid = info[kCGWindowNumber] as? UInt32 {
                order[wid] = idx
                idx += 1
            }
        }
        return order
    }

    /// Returns a base64-encoded PNG of the app icon for the given bundle ID, or "" on failure.
    private static func appIconBase64(bundleId: String) -> String {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            return ""
        }
        let icon = NSWorkspace.shared.icon(forFile: url.path)
        // Render at 128x128 so the icon stays crisp on Retina displays
        let size = NSSize(width: 128, height: 128)
        let bitmapRep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )
        guard let rep = bitmapRep else { return "" }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        icon.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        guard let pngData = rep.representation(using: .png, properties: [:]) else { return "" }
        return pngData.base64EncodedString()
    }

    public static func listWindows(zOrder: [UInt32: Int]) async throws -> [WindowInfo] {
        let content = try await SCShareableContent.excludingDesktopWindows(
            true, onScreenWindowsOnly: true
        )

        let excludedBundleIds: Set<String> = [
            "com.reko.app",
            "com.apple.dock",
            "com.apple.SystemUIServer",
            "com.apple.WindowManager",
            "com.apple.controlcenter",
            "com.apple.notificationcenterui",
            "com.apple.Screenshot",
            "com.apple.screencaptureui",
        ]

        // Also exclude our own process (bundle ID may differ in dev mode)
        let ownPid = ProcessInfo.processInfo.processIdentifier

        let minSize = 50

        let unsorted = content.windows.compactMap { window -> WindowInfo? in
            guard let app = window.owningApplication else { return nil }
            guard app.processID != ownPid else { return nil }
            let bundleId = app.bundleIdentifier
            guard !excludedBundleIds.contains(bundleId) else { return nil }

            let frame = window.frame
            guard Int(frame.width) >= minSize && Int(frame.height) >= minSize else { return nil }

            // Use window title, fall back to app name for windows with empty titles
            let title = window.title ?? ""
            let displayTitle = title.isEmpty ? app.applicationName : title

            return WindowInfo(
                id: window.windowID,
                appName: app.applicationName,
                title: displayTitle,
                x: Int(frame.origin.x),
                y: Int(frame.origin.y),
                width: Int(frame.width),
                height: Int(frame.height),
                bundleId: bundleId,
                appIcon: appIconBase64(bundleId: bundleId)
            )
        }

        // Only keep windows that exist in the z-order map (normal-layer windows).
        // This filters out system overlays, screenshot tools, etc.
        let filtered = unsorted.filter { zOrder[$0.id] != nil }

        // Sort by z-order (front-to-back).
        return filtered.sorted { a, b in
            let orderA = zOrder[a.id]!
            let orderB = zOrder[b.id]!
            return orderA < orderB
        }
    }

    public func startCapture(
        displayID: UInt32,
        area: AreaRect? = nil,
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

        // Exclude our own windows so the recording bar doesn't appear in capture
        let ownPid = ProcessInfo.processInfo.processIdentifier
        let ownWindows = content.windows.filter { $0.owningApplication?.processID == ownPid }

        let filter = SCContentFilter(display: display, excludingWindows: ownWindows)
        let config = SCStreamConfiguration()

        if let area = area {
            // Area capture: crop to the selected region using sourceRect
            // sourceRect uses top-left origin in points (non-scaled coordinates)
            config.sourceRect = CGRect(x: area.x, y: area.y, width: area.width, height: area.height)
            config.width = Int(area.width) * 2
            config.height = Int(area.height) * 2
        } else {
            config.width = display.width * 2
            config.height = display.height * 2
        }

        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        config.capturesAudio = captureAudio
        if captureAudio {
            config.sampleRate = 48000
            config.channelCount = 2
        }

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        let videoQueue = DispatchQueue(label: "com.reko.video", qos: .userInteractive)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: videoQueue)
        if captureAudio {
            let audioQueue = DispatchQueue(label: "com.reko.audio", qos: .userInteractive)
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
        }

        try await stream.startCapture()
        self.stream = stream
    }

    public func startWindowCapture(
        windowID: UInt32,
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
        guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
            throw CaptureError.windowNotFound
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.width = Int(window.frame.width) * 2
        config.height = Int(window.frame.height) * 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        config.capturesAudio = captureAudio
        if captureAudio {
            config.sampleRate = 48000
            config.channelCount = 2
        }

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        let videoQueue = DispatchQueue(label: "com.reko.video", qos: .userInteractive)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: videoQueue)
        if captureAudio {
            let audioQueue = DispatchQueue(label: "com.reko.audio", qos: .userInteractive)
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

    // MARK: - Frame filtering

    /// Returns true only if the sample buffer has SCFrameStatus.complete.
    /// ScreenCaptureKit delivers frames with various statuses (.complete, .idle,
    /// .blank, .started, .suspended). Only .complete frames contain actual pixel
    /// data. Forwarding non-complete frames to AVAssetWriter corrupts its internal
    /// state, causing it to silently drop all subsequent valid frames.
    public static func isCompleteFrame(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let attachments = attachmentsArray.first,
              let statusRawValue = attachments[SCStreamFrameInfo.status] as? Int,
              let status = SCFrameStatus(rawValue: statusRawValue),
              status == .complete else {
            return false
        }
        return true
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
            guard Self.isCompleteFrame(sampleBuffer) else { return }
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
    case windowNotFound
    case cameraNotFound
}
