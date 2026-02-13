use std::ffi::CStr;
use std::os::raw::c_char;

extern "C" {
    fn ck_get_version() -> *const c_char;
    fn ck_free_string(ptr: *mut c_char);
}

pub struct CaptureKitEngine;

impl CaptureKitEngine {
    pub fn version() -> String {
        unsafe {
            let ptr = ck_get_version();
            if ptr.is_null() {
                return "unknown".to_string();
            }
            let version = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            ck_free_string(ptr as *mut c_char);
            version
        }
    }
}
