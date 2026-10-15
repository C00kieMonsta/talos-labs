//! Full Disk Access probe. `stat` succeeds on TCC-protected directories; only listing fails.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    /// null when no probe directory exists on this machine.
    pub full_disk_access: Option<bool>,
}

pub const PROBE_DIRS: [&str; 6] = [
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/BraveSoftware/Brave-Browser",
    "Library/Application Support/Microsoft Edge",
    "Library/Application Support/Arc/User Data",
    "Library/Application Support/Firefox",
    "Library/Safari",
];

/// The first existing probe directory under `home`.
pub fn probe_dir(home: &Path) -> Option<PathBuf> {
    PROBE_DIRS.iter().map(|rel| home.join(rel)).find(|p| std::fs::metadata(p).is_ok())
}

/// Some(true) when the directory lists, Some(false) on EPERM or EACCES, None when nothing to probe.
pub fn probe(home: &Path) -> Capabilities {
    let Some(dir) = probe_dir(home) else {
        return Capabilities { full_disk_access: None };
    };
    let full_disk_access = match std::fs::read_dir(&dir) {
        Ok(_) => Some(true),
        Err(err) => match err.raw_os_error() {
            Some(code) if code == libc::EPERM || code == libc::EACCES => Some(false),
            _ => None,
        },
    };
    Capabilities { full_disk_access }
}

pub fn check() -> Capabilities {
    match dirs::home_dir() {
        Some(home) => probe(&home),
        None => Capabilities { full_disk_access: None },
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn no_probe_dir_gives_null() {
        assert_eq!(probe(Path::new("/nonexistent/talos-home")), Capabilities { full_disk_access: None });
    }

    #[test]
    fn serialises_camel_case() {
        let json = serde_json::to_value(Capabilities { full_disk_access: Some(false) }).unwrap();
        assert_eq!(json, serde_json::json!({ "fullDiskAccess": false }));
    }

    /// Reports false without Full Disk Access and true with it. Depends on this machine's TCC state.
    #[test]
    #[ignore]
    fn probe_reflects_tcc_on_this_machine() {
        let caps = check();
        assert!(caps.full_disk_access.is_some());
        eprintln!("fullDiskAccess = {:?}", caps.full_disk_access);
    }
}
