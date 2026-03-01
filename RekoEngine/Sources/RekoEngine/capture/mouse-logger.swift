import Foundation
import CoreGraphics
import AppKit

// MARK: - Mouse Log Event

public struct MouseLogEvent {
    public let timeMs: UInt64
    public let x: Double     // 0-1 normalized
    public let y: Double     // 0-1 normalized
    public let type: String  // "move", "click", "rightClick", "scroll"

    public let cursor: String?  // nil or "arrow" = default arrow; "pointer" = hand; "ibeam" = text

    public func toJSON() -> String {
        var json = "{\"timeMs\":\(timeMs),\"x\":\(String(format: "%.4f", x)),\"y\":\(String(format: "%.4f", y)),\"type\":\"\(type)\""
        if let cursor = cursor, cursor != "arrow" {
            json += ",\"cursor\":\"\(cursor)\""
        }
        json += "}"
        return json
    }

    public static func normalize(
        mouseX: CGFloat, mouseY: CGFloat,
        screenWidth: Int, screenHeight: Int
    ) -> (Double, Double) {
        let nx = min(max(Double(mouseX) / Double(screenWidth), 0), 1)
        let ny = min(max(Double(mouseY) / Double(screenHeight), 0), 1)
        return (nx, ny)
    }
}

// MARK: - Mouse Logger

/// Logs mouse events to a JSONL file using NSEvent global monitors.
/// Requires Accessibility permission.
///
/// Uses NSEvent.addGlobalMonitorForEvents (for events in other apps) and
/// NSEvent.addLocalMonitorForEvents (for events in our own app) instead
/// of CGEvent taps. NSEvent monitors are more reliable in production
/// builds — CGEvent taps can be permanently invalidated by macOS after
/// certain user interactions.
public final class MouseLogger {
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var fileHandle: FileHandle?
    private let outputURL: URL
    private let screenWidth: Int
    private let screenHeight: Int
    private var startTime: UInt64 = 0
    private let lock = NSLock()
    private var _isPaused = false

    // Throttle: skip move events if less than 16ms apart (~60fps)
    private var lastMoveTimeMs: UInt64 = 0
    private let moveThrottleMs: UInt64 = 16

    // Cursor type detection: throttle AX queries to ~15fps (every 66ms)
    private var lastCursorCheckMs: UInt64 = 0
    private let cursorCheckThrottleMs: UInt64 = 66
    private var cachedCursorType: String?

    // Cached timebase info (avoid syscall per event)
    private static let timebaseInfo: mach_timebase_info_data_t = {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return info
    }()

    public init(outputURL: URL, screenWidth: Int, screenHeight: Int) {
        self.outputURL = outputURL
        self.screenWidth = screenWidth
        self.screenHeight = screenHeight
    }

    public func start() -> Bool {
        guard AXIsProcessTrusted() else {
            print("MouseLogger: Accessibility permission not granted")
            return false
        }

        // Create output file
        FileManager.default.createFile(atPath: outputURL.path, contents: nil)
        fileHandle = FileHandle(forWritingAtPath: outputURL.path)

        startTime = Self.currentTimeMs()

        let eventMask: NSEvent.EventTypeMask = [
            .mouseMoved,
            .leftMouseDown,
            .rightMouseDown,
            .leftMouseDragged,
            .scrollWheel,
        ]

        // Global monitor: receives events directed at other applications
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: eventMask) { [weak self] event in
            self?.handleNSEvent(event)
        }

        // Local monitor: receives events directed at our own application
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: eventMask) { [weak self] event in
            self?.handleNSEvent(event)
            return event
        }

        return globalMonitor != nil
    }

    /// Reset the logger's time origin so that subsequent events are
    /// timestamped relative to this moment. Call after video recording
    /// actually begins to synchronize mouse events with video frames.
    public func resetStartTime() {
        lock.lock()
        startTime = Self.currentTimeMs()
        lastMoveTimeMs = 0
        lock.unlock()
    }

    public func pause() {
        lock.lock()
        _isPaused = true
        lock.unlock()
    }

    public func resume() {
        lock.lock()
        _isPaused = false
        lock.unlock()
    }

    public func stop() {
        if let monitor = globalMonitor {
            NSEvent.removeMonitor(monitor)
            globalMonitor = nil
        }
        if let monitor = localMonitor {
            NSEvent.removeMonitor(monitor)
            localMonitor = nil
        }

        lock.lock()
        fileHandle?.closeFile()
        fileHandle = nil
        lock.unlock()
    }

    /// Pre-computed image data for known system cursors.
    /// Apps like Chrome create their own NSCursor instances that look identical
    /// to system cursors but are different objects, so identity comparison fails.
    /// We compare image data instead.
    private static let knownCursors: [(data: Data, type: String?)] = {
        let cursors: [(NSCursor, String?)] = [
            (.pointingHand, "pointer"),
            (.iBeam, "ibeam"),
            (.iBeamCursorForVerticalLayout, "ibeam"),
            (.arrow, nil),
        ]
        return cursors.compactMap { cursor, type in
            guard let data = cursor.image.tiffRepresentation else { return nil }
            return (data, type)
        }
    }()

    /// Detect cursor type by comparing the current system cursor's image
    /// against known system cursor images.
    private static func currentCursorType() -> String? {
        guard let cursor = NSCursor.currentSystem,
              let currentData = cursor.image.tiffRepresentation else { return nil }

        for known in knownCursors {
            if currentData == known.data {
                return known.type
            }
        }
        return nil
    }

    /// Called on the main thread by NSEvent monitors (both global and local).
    /// `lastMoveTimeMs`, `lastCursorCheckMs`, and `cachedCursorType` are safe
    /// to access without the lock because delivery is always on the main run loop.
    private func handleNSEvent(_ event: NSEvent) {
        // NSEvent gives mouse location in screen coordinates (bottom-left origin).
        // Use CGEvent location for top-left origin consistency with our coordinate system.
        let cgEvent = event.cgEvent
        let location = cgEvent?.location ?? NSEvent.mouseLocation
        // NSEvent.mouseLocation uses bottom-left origin; flip Y if using fallback
        let useFlippedY = cgEvent == nil
        let screenH = CGFloat(screenHeight)
        let finalY = useFlippedY ? (screenH - location.y) : location.y

        let (nx, ny) = MouseLogEvent.normalize(
            mouseX: location.x, mouseY: finalY,
            screenWidth: screenWidth, screenHeight: screenHeight
        )

        let now = Self.currentTimeMs()
        let base = startTime
        let timeMs = now >= base ? now - base : 0

        let eventType: String
        switch event.type {
        case .mouseMoved, .leftMouseDragged:
            guard timeMs >= lastMoveTimeMs &+ moveThrottleMs else { return }
            lastMoveTimeMs = timeMs
            eventType = "move"
        case .leftMouseDown:
            eventType = "click"
        case .rightMouseDown:
            eventType = "rightClick"
        case .scrollWheel:
            eventType = "scroll"
        default:
            return
        }

        // Detect cursor type from NSCursor.currentSystemCursor.
        // Throttled to ~15fps to avoid querying on every move event.
        if timeMs >= lastCursorCheckMs &+ cursorCheckThrottleMs || eventType != "move" {
            cachedCursorType = Self.currentCursorType()
            lastCursorCheckMs = timeMs
        }
        let cursorType = cachedCursorType

        let logEvent = MouseLogEvent(timeMs: timeMs, x: nx, y: ny, type: eventType, cursor: cursorType)
        let line = logEvent.toJSON() + "\n"
        guard let data = line.data(using: .utf8) else { return }

        lock.lock()
        defer { lock.unlock() }
        guard !_isPaused, let handle = fileHandle else { return }
        handle.write(data)
    }

    private static func currentTimeMs() -> UInt64 {
        let info = timebaseInfo
        return mach_absolute_time() * UInt64(info.numer) / UInt64(info.denom) / 1_000_000
    }
}
