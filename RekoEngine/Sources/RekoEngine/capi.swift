import Foundation
import ScreenCaptureKit
import AVFoundation
import ApplicationServices

private var activeSessions: [UInt64: RecordingPipeline] = [:]
private var nextSessionId: UInt64 = 1
private let sessionsLock = NSLock()

@_cdecl("ck_get_version")
public func ck_get_version() -> UnsafeMutablePointer<CChar>? {
    return strdup(RekoEngine.version)
}

@_cdecl("ck_free_string")
public func ck_free_string(ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

// MARK: - Permission Checks

@_cdecl("ck_check_microphone_permission")
public func ck_check_microphone_permission() -> Int32 {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return 1
    case .denied, .restricted: return 2
    case .notDetermined: return 0
    @unknown default: return 0
    }
}

@_cdecl("ck_check_camera_permission")
public func ck_check_camera_permission() -> Int32 {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return 1
    case .denied, .restricted: return 2
    case .notDetermined: return 0
    @unknown default: return 0
    }
}

@_cdecl("ck_check_accessibility_permission")
public func ck_check_accessibility_permission() -> Int32 {
    return AXIsProcessTrusted() ? 1 : 0
}

@_cdecl("ck_check_screen_recording_permission")
public func ck_check_screen_recording_permission() -> Int32 {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Int32 = 0

    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            result = content.displays.isEmpty ? 0 : 1
        } catch {
            result = 0
        }
        semaphore.signal()
    }

    semaphore.wait()
    return result
}

@_cdecl("ck_list_displays")
public func ck_list_displays(outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    let semaphore = DispatchSemaphore(value: 0)
    var resultJson = "[]"
    var errorCode: Int32 = 0

    Task {
        do {
            let displays = try await ScreenCapture.listDisplays()
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            let data = try encoder.encode(displays)
            resultJson = String(data: data, encoding: .utf8) ?? "[]"
        } catch {
            errorCode = -1
        }
        semaphore.signal()
    }

    semaphore.wait()
    outJson.pointee = strdup(resultJson)
    return errorCode
}

@_cdecl("ck_list_windows")
public func ck_list_windows(outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    // CG z-order query is thread-safe — call before async Task to avoid deadlock
    let zOrder = ScreenCapture.getWindowZOrder()

    let semaphore = DispatchSemaphore(value: 0)
    var resultJson = "[]"
    var errorCode: Int32 = 0

    Task {
        do {
            let windows = try await ScreenCapture.listWindows(zOrder: zOrder)
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            let data = try encoder.encode(windows)
            resultJson = String(data: data, encoding: .utf8) ?? "[]"
        } catch {
            errorCode = -1
        }
        semaphore.signal()
    }

    semaphore.wait()
    outJson.pointee = strdup(resultJson)
    return errorCode
}

@_cdecl("ck_list_audio_inputs")
public func ck_list_audio_inputs(outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    let inputs = MicCapture.listInputs()
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    guard let data = try? encoder.encode(inputs),
          let json = String(data: data, encoding: .utf8) else {
        outJson.pointee = strdup("[]")
        return -1
    }
    outJson.pointee = strdup(json)
    return 0
}

@_cdecl("ck_list_cameras")
public func ck_list_cameras(outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    let cameras = CameraCapture.listCameras()
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    guard let data = try? encoder.encode(cameras),
          let json = String(data: data, encoding: .utf8) else {
        outJson.pointee = strdup("[]")
        return -1
    }
    outJson.pointee = strdup(json)
    return 0
}

@_cdecl("ck_start_recording")
public func ck_start_recording(
    configJson: UnsafePointer<CChar>,
    outSessionId: UnsafeMutablePointer<UInt64>
) -> Int32 {
    let json = String(cString: configJson)
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase

    guard let data = json.data(using: .utf8),
          let config = try? decoder.decode(RecordingConfig.self, from: data) else {
        return -1
    }

    let pipeline = RecordingPipeline(config: config)

    sessionsLock.lock()
    let sessionId = nextSessionId
    nextSessionId += 1
    activeSessions[sessionId] = pipeline
    sessionsLock.unlock()

    outSessionId.pointee = sessionId

    let semaphore = DispatchSemaphore(value: 0)
    var errorCode: Int32 = 0

    Task {
        do {
            try await pipeline.start()
        } catch {
            errorCode = -1
            print("Recording start error: \(error)")
        }
        semaphore.signal()
    }

    semaphore.wait()
    return errorCode
}

@_cdecl("ck_pause_recording")
public func ck_pause_recording(sessionId: UInt64) -> Int32 {
    sessionsLock.lock()
    guard let pipeline = activeSessions[sessionId] else {
        sessionsLock.unlock()
        return -1
    }
    sessionsLock.unlock()
    pipeline.pause()
    return 0
}

@_cdecl("ck_resume_recording")
public func ck_resume_recording(sessionId: UInt64) -> Int32 {
    sessionsLock.lock()
    guard let pipeline = activeSessions[sessionId] else {
        sessionsLock.unlock()
        return -1
    }
    sessionsLock.unlock()
    pipeline.resume()
    return 0
}

@_cdecl("ck_get_audio_levels")
public func ck_get_audio_levels(
    sessionId: UInt64,
    outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    sessionsLock.lock()
    guard let pipeline = activeSessions[sessionId] else {
        sessionsLock.unlock()
        return -1
    }
    sessionsLock.unlock()

    let levels = pipeline.getAudioLevels()
    let json = "{\"mic_level\":\(levels.mic),\"system_audio_level\":\(levels.systemAudio)}"
    outJson.pointee = strdup(json)
    return 0
}

@_cdecl("ck_stop_recording")
public func ck_stop_recording(
    sessionId: UInt64,
    outResultJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    sessionsLock.lock()
    guard let pipeline = activeSessions.removeValue(forKey: sessionId) else {
        sessionsLock.unlock()
        return -1
    }
    sessionsLock.unlock()

    let semaphore = DispatchSemaphore(value: 0)
    var resultJson = "{}"
    var errorCode: Int32 = 0

    Task {
        do {
            let result = try await pipeline.stop()
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            resultJson = String(data: try encoder.encode(result), encoding: .utf8) ?? "{}"
        } catch {
            errorCode = -1
        }
        semaphore.signal()
    }

    semaphore.wait()
    outResultJson.pointee = strdup(resultJson)
    return errorCode
}

// MARK: - Export API

private var activeExports: [UInt64: ExportPipeline] = [:]
private var nextExportId: UInt64 = 1
private let exportsLock = NSLock()

@_cdecl("ck_start_export")
public func ck_start_export(
    projectJson: UnsafePointer<CChar>,
    exportConfigJson: UnsafePointer<CChar>,
    outExportId: UnsafeMutablePointer<UInt64>
) -> Int32 {
    let projectStr = String(cString: projectJson)
    let configStr = String(cString: exportConfigJson)

    let pipeline = ExportPipeline()

    exportsLock.lock()
    let exportId = nextExportId
    nextExportId += 1
    activeExports[exportId] = pipeline
    exportsLock.unlock()

    outExportId.pointee = exportId

    // Run export on background queue
    DispatchQueue.global(qos: .userInitiated).async {
        do {
            let result = try pipeline.run(projectJSON: projectStr, exportConfigJSON: configStr)
            print("Export completed: \(result.outputPath)")
        } catch {
            pipeline.progress.setError("\(error)")
            print("Export error: \(error)")
        }
    }

    return 0
}

@_cdecl("ck_get_export_progress")
public func ck_get_export_progress(
    exportId: UInt64,
    outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    exportsLock.lock()
    guard let pipeline = activeExports[exportId] else {
        exportsLock.unlock()
        return -1
    }
    exportsLock.unlock()

    outJson.pointee = strdup(pipeline.progress.toJSON())
    return 0
}

@_cdecl("ck_cancel_export")
public func ck_cancel_export(exportId: UInt64) -> Int32 {
    exportsLock.lock()
    guard let pipeline = activeExports[exportId] else {
        exportsLock.unlock()
        return -1
    }
    exportsLock.unlock()

    pipeline.cancel()
    return 0
}

@_cdecl("ck_finish_export")
public func ck_finish_export(exportId: UInt64) -> Int32 {
    exportsLock.lock()
    activeExports.removeValue(forKey: exportId)
    exportsLock.unlock()
    return 0
}

// MARK: - Preview API

private var activePreview: PreviewRenderer? = nil
private let previewLock = NSLock()

/// Configure the preview renderer. Returns JSON: {"width": N, "height": N} or error code.
@_cdecl("ck_preview_configure")
public func ck_preview_configure(
    projectJson: UnsafePointer<CChar>,
    outJson: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>
) -> Int32 {
    let json = String(cString: projectJson)
    let renderer = PreviewRenderer()

    do {
        let dims = try renderer.configure(projectJson: json)
        previewLock.lock()
        activePreview = renderer
        previewLock.unlock()
        outJson.pointee = strdup("{\"width\":\(dims.width),\"height\":\(dims.height)}")
        return 0
    } catch {
        print("Preview configure error: \(error)")
        return -1
    }
}

/// Render a preview frame. Returns malloc'd JPEG bytes via pointer + length.
/// Caller must call ck_preview_free_bytes() on the returned pointer.
@_cdecl("ck_preview_frame")
public func ck_preview_frame(
    sourceTimeMs: UInt64,
    effectsJson: UnsafePointer<CChar>,
    zoomEventsJson: UnsafePointer<CChar>,
    outLength: UnsafeMutablePointer<Int>
) -> UnsafeMutablePointer<UInt8>? {
    // Grab strong reference under lock (ARC keeps object alive even if
    // ck_preview_destroy nils activePreview concurrently)
    previewLock.lock()
    guard let renderer = activePreview else {
        previewLock.unlock()
        outLength.pointee = 0
        return nil
    }
    previewLock.unlock()

    let effects = String(cString: effectsJson)
    let zoomEvents = String(cString: zoomEventsJson)

    do {
        let jpegData = try renderer.renderFrame(
            sourceTimeMs: sourceTimeMs,
            effectsJson: effects,
            zoomEventsJson: zoomEvents
        )
        let length = jpegData.count
        let ptr = UnsafeMutablePointer<UInt8>.allocate(capacity: length)
        jpegData.copyBytes(to: ptr, count: length)
        outLength.pointee = length
        return ptr
    } catch {
        print("Preview frame error: \(error)")
        outLength.pointee = 0
        return nil
    }
}

@_cdecl("ck_preview_free_bytes")
public func ck_preview_free_bytes(ptr: UnsafeMutablePointer<UInt8>?) {
    ptr?.deallocate()
}

@_cdecl("ck_preview_destroy")
public func ck_preview_destroy() {
    previewLock.lock()
    activePreview?.destroy()
    activePreview = nil
    previewLock.unlock()
}
