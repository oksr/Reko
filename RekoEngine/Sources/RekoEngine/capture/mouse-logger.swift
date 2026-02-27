import Foundation
import CoreGraphics
import ApplicationServices

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
/// Creates the event tap and its run loop on a dedicated thread — the tap's
/// CFMachPort must be created on the same thread whose CFRunLoop pumps it,
/// and Tauri's main thread doesn't pump CFRunLoop at all.
public final class MouseLogger {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var tapRunLoop: CFRunLoop?
    private var tapThread: Thread?
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

        // Use a semaphore so start() blocks until the tap thread reports success/failure.
        let semaphore = DispatchSemaphore(value: 0)
        var tapOK = false

        let thread = Thread { [self] in
            let eventMask: CGEventMask = (
                (1 << CGEventType.mouseMoved.rawValue) |
                (1 << CGEventType.leftMouseDown.rawValue) |
                (1 << CGEventType.rightMouseDown.rawValue) |
                (1 << CGEventType.leftMouseDragged.rawValue) |
                (1 << CGEventType.scrollWheel.rawValue)
            )

            guard let tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap,
                place: .headInsertEventTap,
                options: .listenOnly,
                eventsOfInterest: eventMask,
                callback: mouseEventCallback,
                userInfo: Unmanaged.passUnretained(self).toOpaque()
            ) else {
                print("MouseLogger: CGEvent.tapCreate failed on tap thread")
                semaphore.signal()
                return
            }

            self.eventTap = tap
            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            self.runLoopSource = source

            let rl = CFRunLoopGetCurrent()!
            self.tapRunLoop = rl
            CFRunLoopAddSource(rl, source, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)

            tapOK = true
            semaphore.signal()

            // Run forever until stop() calls CFRunLoopStop
            CFRunLoopRun()
        }
        thread.name = "MouseLogger-EventTap"
        thread.qualityOfService = .userInteractive
        tapThread = thread
        thread.start()

        // Wait for the tap thread to finish setup (up to 2 seconds)
        let result = semaphore.wait(timeout: .now() + 2)
        if result == .timedOut {
            print("MouseLogger: Tap thread timed out during setup")
            return false
        }

        return tapOK
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
        // Disable the tap first — prevents new callbacks from firing
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        // Stop the run loop so the tap thread exits
        if let rl = tapRunLoop {
            if let source = runLoopSource {
                CFRunLoopRemoveSource(rl, source, .commonModes)
            }
            CFRunLoopStop(rl)
        }
        tapRunLoop = nil
        tapThread = nil
        eventTap = nil
        runLoopSource = nil

        lock.lock()
        fileHandle?.closeFile()
        fileHandle = nil
        lock.unlock()
    }

    // Called from the C callback on the tap thread
    fileprivate func handleEvent(_ event: CGEvent) {
        let location = event.location
        let (nx, ny) = MouseLogEvent.normalize(
            mouseX: location.x, mouseY: location.y,
            screenWidth: screenWidth, screenHeight: screenHeight
        )

        let now = Self.currentTimeMs()
        let base = startTime
        // Guard against underflow when resetStartTime() moves the origin forward
        let timeMs = now >= base ? now - base : 0

        let eventType: String
        switch event.type {
        case .mouseMoved, .leftMouseDragged:
            // Throttle move events (use >= comparison to avoid underflow)
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

        let logEvent = MouseLogEvent(timeMs: timeMs, x: nx, y: ny, type: eventType)
        let line = logEvent.toJSON() + "\n"
        guard let data = line.data(using: .utf8) else { return }

        // Hold the lock across the write so stop() cannot close the
        // file handle while we are writing to it.
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

// C-compatible callback for CGEvent tap
private func mouseEventCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let userInfo = userInfo else { return Unmanaged.passUnretained(event) }
    let logger = Unmanaged<MouseLogger>.fromOpaque(userInfo).takeUnretainedValue()
    logger.handleEvent(event)
    return Unmanaged.passUnretained(event)
}
