use std::ffi::CStr;
use std::os::raw::c_char;

extern "C" {
    fn ck_get_version() -> *const c_char;
    fn ck_list_displays(out_json: *mut *const c_char) -> i32;
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

    pub fn list_displays() -> Result<String, String> {
        unsafe {
            let mut json_ptr: *const c_char = std::ptr::null();
            let result = ck_list_displays(&mut json_ptr);
            if result != 0 || json_ptr.is_null() {
                return Err("Failed to list displays".into());
            }
            let json = CStr::from_ptr(json_ptr).to_string_lossy().into_owned();
            ck_free_string(json_ptr as *mut c_char);
            Ok(json)
        }
    }
}
