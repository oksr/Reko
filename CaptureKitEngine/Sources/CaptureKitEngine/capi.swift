import Foundation
import ScreenCaptureKit

@_cdecl("ck_get_version")
public func ck_get_version() -> UnsafeMutablePointer<CChar>? {
    return strdup(CaptureKitEngine.version)
}

@_cdecl("ck_free_string")
public func ck_free_string(ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
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
