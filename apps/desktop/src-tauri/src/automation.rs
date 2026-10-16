//! Automation permission probe for System Events, through `AEDeterminePermissionToAutomateTarget`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationStatus {
    Granted,
    Denied,
    NotDetermined,
}

/// `errAEEventWouldRequireUserConsent`: the user has not been asked yet.
pub const WOULD_REQUIRE_CONSENT: i32 = -1744;
/// `errAEEventNotPermitted`: the user said no.
pub const NOT_PERMITTED: i32 = -1743;
/// `procNotFound`: System Events is not running, so nothing can be asked.
pub const PROC_NOT_FOUND: i32 = -600;

/// 0 granted, -1744 not determined, -1743 denied, anything else (including -600) unknown.
pub fn map_status(status: i32) -> Option<AutomationStatus> {
    match status {
        0 => Some(AutomationStatus::Granted),
        WOULD_REQUIRE_CONSENT => Some(AutomationStatus::NotDetermined),
        NOT_PERMITTED => Some(AutomationStatus::Denied),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
mod ffi {
    use std::ffi::c_void;

    #[repr(C)]
    pub struct AEDesc {
        pub descriptor_type: u32,
        pub data_handle: *mut c_void,
    }

    /// 'bund'
    pub const TYPE_APPLICATION_BUNDLE_ID: u32 = 0x6275_6E64;
    /// '****'
    pub const TYPE_WILD_CARD: u32 = 0x2A2A_2A2A;

    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        pub fn AECreateDesc(
            type_code: u32,
            data_ptr: *const c_void,
            data_size: libc::c_long,
            result: *mut AEDesc,
        ) -> i16;
        pub fn AEDeterminePermissionToAutomateTarget(
            target: *const AEDesc,
            event_class: u32,
            event_id: u32,
            ask_user_if_needed: u8,
        ) -> i32;
        pub fn AEDisposeDesc(desc: *mut AEDesc) -> i16;
    }
}

/// The raw status for a bundle id, without prompting. None when the descriptor could not be built.
#[cfg(target_os = "macos")]
pub fn raw_status(bundle_id: &str) -> Option<i32> {
    let mut desc = ffi::AEDesc {
        descriptor_type: 0,
        data_handle: std::ptr::null_mut(),
    };
    // SAFETY: the bundle id bytes outlive the call; `desc` is a valid out-pointer and is disposed after use.
    unsafe {
        let created = ffi::AECreateDesc(
            ffi::TYPE_APPLICATION_BUNDLE_ID,
            bundle_id.as_ptr().cast(),
            bundle_id.len() as libc::c_long,
            &mut desc,
        );
        if created != 0 {
            return None;
        }
        let status = ffi::AEDeterminePermissionToAutomateTarget(
            &desc,
            ffi::TYPE_WILD_CARD,
            ffi::TYPE_WILD_CARD,
            0,
        );
        ffi::AEDisposeDesc(&mut desc);
        Some(status)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn raw_status(_bundle_id: &str) -> Option<i32> {
    None
}

pub const SYSTEM_EVENTS: &str = "com.apple.systemevents";

/// The Automation status for System Events on this machine.
pub fn check() -> Option<AutomationStatus> {
    raw_status(SYSTEM_EVENTS).and_then(map_status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_four_codes() {
        assert_eq!(map_status(0), Some(AutomationStatus::Granted));
        assert_eq!(map_status(-1744), Some(AutomationStatus::NotDetermined));
        assert_eq!(map_status(-1743), Some(AutomationStatus::Denied));
        assert_eq!(map_status(-600), None);
        assert_eq!(map_status(-1), None);
    }

    #[test]
    fn serialises_snake_case() {
        let json = serde_json::to_value(AutomationStatus::NotDetermined).unwrap();
        assert_eq!(json, serde_json::json!("not_determined"));
    }

    /// Prints the raw status on this machine. Depends on TCC state.
    #[test]
    #[ignore]
    fn probe_on_this_machine() {
        eprintln!(
            "raw = {:?} mapped = {:?}",
            raw_status(SYSTEM_EVENTS),
            check()
        );
    }
}
