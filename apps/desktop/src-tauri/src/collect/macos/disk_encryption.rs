//! FileVault state from `fdesetup status`.

use std::sync::atomic::AtomicBool;

use super::{check_exit, run};
use crate::collect::{Fail, to_section};
use crate::exec::Bin;
use crate::state::{DiskEncryption, DiskEncryptionMethod, Section};

/// true for "FileVault is On.", false for "FileVault is Off.".
pub fn parse_fdesetup(text: &str) -> Result<bool, Fail> {
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("FileVault is On") {
            return Ok(true);
        }
        if line.starts_with("FileVault is Off") {
            return Ok(false);
        }
    }
    Err(Fail::parse("fdesetup"))
}

/// FileVault off means the system volume has no encryption method at all.
fn from_status(on: bool) -> DiskEncryption {
    let method = if on {
        DiskEncryptionMethod::Filevault
    } else {
        DiskEncryptionMethod::None
    };
    DiskEncryption {
        system_volume_encrypted: on,
        method,
    }
}

fn inner(cancel: &AtomicBool) -> Result<DiskEncryption, Fail> {
    let out = run(Bin::Fdesetup, &["status"], cancel)?;
    check_exit(&out, Bin::Fdesetup)?;
    Ok(from_status(parse_fdesetup(&out.stdout)?))
}

pub fn collect(cancel: &AtomicBool) -> Section<DiskEncryption> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parses_captured_off() {
        let text = include_str!("../../../tests/fixtures/fdesetup.txt");
        assert!(!parse_fdesetup(text).unwrap());
    }

    #[test]
    fn parses_on_and_deferred() {
        assert!(parse_fdesetup("FileVault is On.\n").unwrap());
        assert!(
            parse_fdesetup(
                "FileVault is On.\nDeferred enablement appears to be active for user 'x'.\n"
            )
            .unwrap()
        );
        assert!(
            !parse_fdesetup(
                "FileVault is Off.\nDeferred enablement appears to be active for user 'x'.\n"
            )
            .unwrap()
        );
    }

    #[test]
    fn off_reports_no_encryption_method() {
        assert_eq!(from_status(false).method, DiskEncryptionMethod::None);
        assert!(!from_status(false).system_volume_encrypted);
        assert_eq!(from_status(true).method, DiskEncryptionMethod::Filevault);
    }

    #[test]
    fn rejects_unknown_output() {
        assert_eq!(
            parse_fdesetup("").unwrap_err().detail.as_deref(),
            Some("parser: fdesetup")
        );
    }
}
