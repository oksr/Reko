use std::ffi::{CStr, CString};
use std::os::raw::c_char;

extern "C" {
    fn ck_get_version() -> *const c_char;
    fn ck_list_displays(out_json: *mut *const c_char) -> i32;
    fn ck_list_audio_inputs(out_json: *mut *const c_char) -> i32;
    fn ck_list_cameras(out_json: *mut *const c_char) -> i32;
    fn ck_list_windows(out_json: *mut *const c_char) -> i32;
    fn ck_start_recording(config_json: *const c_char, out_session_id: *mut u64) -> i32;
    fn ck_pause_recording(session_id: u64) -> i32;
    fn ck_resume_recording(session_id: u64) -> i32;
    fn ck_get_audio_levels(session_id: u64, out_json: *mut *const c_char) -> i32;
    fn ck_stop_recording(session_id: u64, out_result_json: *mut *const c_char) -> i32;
    fn ck_free_string(ptr: *mut c_char);
    fn ck_prewarm_camera(device_id: *const c_char) -> i32;
    fn ck_stop_camera_prewarm() -> i32;
    fn ck_check_microphone_permission() -> i32;
    fn ck_check_camera_permission() -> i32;
    fn ck_request_microphone_permission() -> i32;
    fn ck_request_camera_permission() -> i32;
    fn ck_check_accessibility_permission() -> i32;
    fn ck_check_screen_recording_permission() -> i32;
}

unsafe fn call_json(call: impl FnOnce(*mut *const c_char) -> i32) -> Result<String, String> {
    let mut json_ptr: *const c_char = std::ptr::null();
    let result = call(&mut json_ptr);
    if result != 0 || json_ptr.is_null() {
        return Err("Swift call failed".into());
    }
    let json = CStr::from_ptr(json_ptr).to_string_lossy().into_owned();
    ck_free_string(json_ptr as *mut c_char);
    Ok(json)
}

pub struct RekoEngine;

impl RekoEngine {
    pub fn version() -> String {
        unsafe {
            let ptr = ck_get_version();
            if ptr.is_null() {
                return "unknown".to_string();
            }
            let v = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            ck_free_string(ptr as *mut c_char);
            v
        }
    }

    pub fn list_displays() -> Result<String, String> {
        unsafe { call_json(|p| ck_list_displays(p)) }
    }

    pub fn list_audio_inputs() -> Result<String, String> {
        unsafe { call_json(|p| ck_list_audio_inputs(p)) }
    }

    pub fn list_cameras() -> Result<String, String> {
        unsafe { call_json(|p| ck_list_cameras(p)) }
    }

    pub fn list_windows() -> Result<String, String> {
        unsafe { call_json(|p| ck_list_windows(p)) }
    }

    pub fn start_recording(config_json: &str) -> Result<u64, String> {
        let c = CString::new(config_json).map_err(|e| e.to_string())?;
        let mut session_id: u64 = 0;
        unsafe {
            let result = ck_start_recording(c.as_ptr(), &mut session_id);
            if result != 0 {
                return Err("Failed to start recording".into());
            }
        }
        Ok(session_id)
    }

    pub fn pause_recording(session_id: u64) -> Result<(), String> {
        unsafe {
            if ck_pause_recording(session_id) != 0 {
                return Err("Failed to pause recording".into());
            }
        }
        Ok(())
    }

    pub fn resume_recording(session_id: u64) -> Result<(), String> {
        unsafe {
            if ck_resume_recording(session_id) != 0 {
                return Err("Failed to resume recording".into());
            }
        }
        Ok(())
    }

    pub fn get_audio_levels(session_id: u64) -> Result<String, String> {
        unsafe { call_json(|p| ck_get_audio_levels(session_id, p)) }
    }

    pub fn stop_recording(session_id: u64) -> Result<String, String> {
        unsafe { call_json(|p| ck_stop_recording(session_id, p)) }
    }

    pub fn prewarm_camera(device_id: &str) -> Result<(), String> {
        let c = CString::new(device_id).map_err(|e| e.to_string())?;
        unsafe {
            if ck_prewarm_camera(c.as_ptr()) != 0 {
                return Err("Failed to prewarm camera".into());
            }
        }
        Ok(())
    }

    pub fn stop_camera_prewarm() -> Result<(), String> {
        unsafe {
            if ck_stop_camera_prewarm() != 0 {
                return Err("Failed to stop camera prewarm".into());
            }
        }
        Ok(())
    }

    pub fn check_microphone_permission() -> i32 {
        unsafe { ck_check_microphone_permission() }
    }

    pub fn check_camera_permission() -> i32 {
        unsafe { ck_check_camera_permission() }
    }

    pub fn request_microphone_permission() -> i32 {
        unsafe { ck_request_microphone_permission() }
    }

    pub fn request_camera_permission() -> i32 {
        unsafe { ck_request_camera_permission() }
    }

    pub fn check_accessibility_permission() -> i32 {
        unsafe { ck_check_accessibility_permission() }
    }

    pub fn check_screen_recording_permission() -> i32 {
        unsafe { ck_check_screen_recording_permission() }
    }
}
