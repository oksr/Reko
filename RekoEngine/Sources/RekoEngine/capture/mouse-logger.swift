import Foundation
import CoreGraphics

// MARK: - Mouse Log Event

public struct MouseLogEvent {
    public let timeMs: UInt64
    public let x: Double     // 0-1 normalized
    public let y: Double     // 0-1 normalized
    public let type: String  // "move", "click", "rightClick", "scroll"

    public func toJSON() -> String {
        return "{\"timeMs\":\(timeMs),\"x\":\(String(format: "%.4f", x)),\"y\":\(String(format: "%.4f", y)),\"type\":\"\(type)\"}"
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

/// Logs mouse events to a JSONL file using CGEvent tap.
/// Requires Accessibility permission (Input Monitoring on macOS 14+).
public final class MouseLogger {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var fileHandle: FileHandle?
    private let outputURL: URL
    private let screenWidth: Int
    private let screenHeight: Int
    private var startTime: UInt64 = 0
    private var isPaused = false

    // Throttle: skip move events if less than 16ms apart (~60fps)
    private var lastMoveTimeMs: UInt64 = 0
    private let moveThrottleMs: UInt64 = 16

    public init(outputURL: URL, screenWidth: Int, screenHeight: Int) {
        self.outputURL = outputURL
        self.screenWidth = screenWidth
        self.screenHeight = screenHeight
    }

    public func start() -> Bool {
        // Create output file
        FileManager.default.createFile(atPath: outputURL.path, contents: nil)
        fileHandle = FileHandle(forWritingAtPath: outputURL.path)

        startTime = currentTimeMs()

        // Create event tap for mouse events
        let eventMask: CGEventMask = (
            (1 << CGEventType.mouseMoved.rawValue) |
            (1 << CGEventType.leftMouseDown.rawValue) |
            (1 << CGEventType.rightMouseDown.rawValue) |
            (1 << CGEventType.leftMouseDragged.rawValue) |
            (1 << CGEventType.scrollWheel.rawValue)
        )

        // The callback needs to be a C function pointer — use a static wrapper
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,     // passive — doesn't block or modify events
            eventsOfInterest: eventMask,
            callback: mouseEventCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            print("MouseLogger: Failed to create event tap. Check Accessibility permissions.")
            return false
        }

        eventTap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        runLoopSource = source
        // Must use main run loop — CGEvent taps deliver events there,
        // and start() may be called from a background thread.
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)

        return true
    }

    public func pause() { isPaused = true }
    public func resume() { isPaused = false }

    public func stop() {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        if let source = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        }
        eventTap = nil
        runLoopSource = nil
        fileHandle?.closeFile()
        fileHandle = nil
    }

    // Called from the C callback
    fileprivate func handleEvent(_ event: CGEvent) {
        guard !isPaused else { return }

        let location = event.location
        let (nx, ny) = MouseLogEvent.normalize(
            mouseX: location.x, mouseY: location.y,
            screenWidth: screenWidth, screenHeight: screenHeight
        )

        let timeMs = currentTimeMs() - startTime

        let eventType: String
        switch event.type {
        case .mouseMoved, .leftMouseDragged:
            // Throttle move events
            guard timeMs - lastMoveTimeMs >= moveThrottleMs else { return }
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

        let logEvent = MouseLogEvent(timeMs: timeMs, x: nx, y: ny, type: eventType)
        let line = logEvent.toJSON() + "\n"
        if let data = line.data(using: .utf8) {
            fileHandle?.write(data)
        }
    }

    private func currentTimeMs() -> UInt64 {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return mach_absolute_time() * UInt64(info.numer) / UInt64(info.denom) / 1_000_000
    }
}

// C-compatible callback for CGEvent tap
private func mouseEventCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let userInfo = userInfo else { return Unmanaged.passRetained(event) }
    let logger = Unmanaged<MouseLogger>.fromOpaque(userInfo).takeUnretainedValue()
    logger.handleEvent(event)
    return Unmanaged.passRetained(event)
}
