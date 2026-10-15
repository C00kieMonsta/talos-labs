//! macOS collectors. Each module has `collect() -> Section<T>` and pure `parse_*` functions.

pub mod accounts;
pub mod backup;
pub mod browsers;
pub mod defaults;
pub mod disk_encryption;
pub mod dotfiles;
pub mod file_sharing;
pub mod firewall;
pub mod host;
pub mod listeners;
pub mod login_items;
pub mod malware_protection;
pub mod password_policy;
pub mod persistence;
pub mod platform_integrity;
pub mod remote_access;
pub mod screen_lock;
pub mod ssh;
pub mod updates;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use regex::{Regex, RegexSet};

use super::{AnySection, Fail, Shared};
use crate::exec::{self, Bin, ExecError, Output, DEFAULT_TIMEOUT};
use crate::state::SectionKey;

pub fn collect_one(key: SectionKey, shared: &Shared) -> AnySection {
    let cancel = shared.cancel.as_ref();
    match key {
        SectionKey::DiskEncryption => AnySection::DiskEncryption(disk_encryption::collect(cancel)),
        SectionKey::Firewall => AnySection::Firewall(firewall::collect(cancel)),
        SectionKey::PlatformIntegrity => AnySection::PlatformIntegrity(platform_integrity::collect(cancel)),
        SectionKey::MalwareProtection => AnySection::MalwareProtection(malware_protection::collect(cancel)),
        SectionKey::Updates => AnySection::Updates(updates::collect(cancel)),
        SectionKey::ScreenLock => AnySection::ScreenLock(screen_lock::collect(cancel)),
        SectionKey::Accounts => AnySection::Accounts(accounts::collect(cancel)),
        SectionKey::PasswordPolicy => AnySection::PasswordPolicy(password_policy::collect(cancel)),
        SectionKey::Listeners => AnySection::Listeners(shared.listeners().clone()),
        SectionKey::RemoteAccess => AnySection::RemoteAccess(remote_access::collect(shared)),
        SectionKey::FileSharing => AnySection::FileSharing(file_sharing::collect(shared)),
        SectionKey::Persistence => AnySection::Persistence(persistence::collect(cancel)),
        SectionKey::LoginItems => AnySection::LoginItems(login_items::collect(cancel)),
        SectionKey::Backup => AnySection::Backup(backup::collect(cancel)),
        SectionKey::Browsers => AnySection::Browsers(browsers::collect(cancel)),
        SectionKey::Ssh => AnySection::Ssh(ssh::collect(cancel)),
        SectionKey::Dotfiles => AnySection::Dotfiles(dotfiles::collect(cancel)),
    }
}

/// Runs a binary with the default 5 s timeout.
pub fn run(bin: Bin, args: &[&str], cancel: &AtomicBool) -> Result<Output, ExecError> {
    exec::run(bin, args, DEFAULT_TIMEOUT, cancel)
}

/// A non-zero exit with nothing on stdout is a tool failure, not a parser failure.
/// Output with a non-zero exit still goes to the parser, which decides.
pub fn check_exit(out: &Output, bin: Bin) -> Result<(), Fail> {
    if !out.success() && out.stdout.trim().is_empty() {
        return Err(Fail::collector(&format!("{}: exit", bin.name())));
    }
    Ok(())
}

pub fn check_cancel(cancel: &AtomicBool) -> Result<(), Fail> {
    if cancel.load(Ordering::SeqCst) { Err(Fail::collector("cancelled")) } else { Ok(()) }
}

pub fn home() -> Result<PathBuf, Fail> {
    dirs::home_dir().ok_or_else(|| Fail::collector("home: unknown"))
}

pub fn is_permission_error(err: &std::io::Error) -> bool {
    matches!(err.raw_os_error(), Some(code) if code == libc::EPERM || code == libc::EACCES)
}

pub fn is_not_found(err: &std::io::Error) -> bool {
    err.kind() == std::io::ErrorKind::NotFound
}

/// Permission bits as an octal string such as "600".
pub fn mode_string(mode: u32) -> String {
    format!("{:o}", mode & 0o777)
}

/// Compiles a literal pattern. Every pattern passed here is covered by a unit test.
#[allow(clippy::expect_used)]
pub fn lit(pattern: &str) -> Regex {
    Regex::new(pattern).expect("literal regex")
}

/// Compiles literal patterns into a set. Every set built here is covered by a unit test.
#[allow(clippy::expect_used)]
pub fn lit_set(patterns: &[&str]) -> RegexSet {
    RegexSet::new(patterns).expect("literal regex set")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_tool_with_no_output_is_a_collector_error() {
        let out = |code: Option<i32>, stdout: &str| Output { stdout: stdout.to_owned(), stderr: "DS Error: -14136\n".to_owned(), exit_code: code, truncated: false };
        let fail = check_exit(&out(Some(56), ""), Bin::Dscl).unwrap_err();
        assert_eq!(fail.reason, crate::state::UnavailableReason::CollectorError);
        assert_eq!(fail.detail.as_deref(), Some("dscl: exit"));
        assert!(check_exit(&out(None, "\n"), Bin::Dscl).is_err(), "killed by a signal");
        assert!(check_exit(&out(Some(1), "assessments disabled\n"), Bin::Spctl).is_ok(), "output goes to the parser");
        assert!(check_exit(&out(Some(0), ""), Bin::Sysadminctl).is_ok(), "stderr-only tools exit 0");
    }

    #[test]
    fn mode_string_keeps_permission_bits_only() {
        assert_eq!(mode_string(0o100600), "600");
        assert_eq!(mode_string(0o40700), "700");
        assert_eq!(mode_string(0o644), "644");
    }
}
