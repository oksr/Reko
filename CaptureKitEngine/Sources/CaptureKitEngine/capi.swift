import Foundation

@_cdecl("ck_get_version")
public func ck_get_version() -> UnsafeMutablePointer<CChar>? {
    return strdup(CaptureKitEngine.version)
}

@_cdecl("ck_free_string")
public func ck_free_string(ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}
