//! Collects a `SystemState`: one thread per section, a 60 s overall budget, a cancel flag.

#[cfg(target_os = "macos")]
pub mod macos;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::exec::ExecError;
use crate::state::*;

pub const OVERALL_BUDGET: Duration = Duration::from_secs(60);

/// Why a section could not be collected. Converted into `Section::Unavailable` at the section boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fail {
    pub reason: UnavailableReason,
    pub detail: Option<String>,
}

impl Fail {
    pub fn new(reason: UnavailableReason, detail: &str) -> Self {
        Fail { reason, detail: Some(detail.to_owned()) }
    }

    pub fn parse(parser: &str) -> Self {
        Fail::new(UnavailableReason::ParseError, &format!("parser: {parser}"))
    }

    pub fn collector(detail: &str) -> Self {
        Fail::new(UnavailableReason::CollectorError, detail)
    }

    /// Maps an I/O error from a read to a reason. `label` names the read ("read_dir: .ssh"), never the path contents.
    pub fn io(err: &std::io::Error, label: &str) -> Self {
        let reason = match err.raw_os_error() {
            Some(code) if code == libc::EPERM || code == libc::EACCES => UnavailableReason::PermissionDenied,
            _ => UnavailableReason::CollectorError,
        };
        Fail::new(reason, label)
    }

    pub fn into_section<T>(self) -> Section<T> {
        Section::Unavailable { reason: self.reason, detail: self.detail }
    }
}

impl From<ExecError> for Fail {
    fn from(err: ExecError) -> Self {
        match err {
            ExecError::ToolMissing(bin) => Fail::new(UnavailableReason::ToolMissing, &format!("bin: {}", bin.name())),
            ExecError::Timeout(bin) => Fail::new(UnavailableReason::Timeout, &format!("bin: {}", bin.name())),
            ExecError::Cancelled => Fail::collector("cancelled"),
            ExecError::Io(_) => Fail::collector("exec"),
        }
    }
}

pub fn to_section<T>(result: Result<T, Fail>) -> Section<T> {
    match result {
        Ok(data) => Section::ok(data),
        Err(fail) => fail.into_section(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgressStatus {
    Started,
    Ok,
    Unavailable,
}

pub type ProgressFn = dyn Fn(SectionKey, ProgressStatus) + Send + Sync;

/// State shared by the section threads of one scan.
pub struct Shared {
    pub cancel: Arc<AtomicBool>,
    listeners: OnceLock<Section<Listeners>>,
}

impl Shared {
    pub fn new(cancel: Arc<AtomicBool>) -> Self {
        Shared { cancel, listeners: OnceLock::new() }
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// netstat parsed once, shared by listeners, remoteAccess and fileSharing.
    pub fn listeners(&self) -> &Section<Listeners> {
        self.listeners.get_or_init(|| {
            #[cfg(target_os = "macos")]
            {
                macos::listeners::collect(&self.cancel)
            }
            #[cfg(not(target_os = "macos"))]
            {
                Section::unavailable(UnavailableReason::NotSupportedOnOs, None)
            }
        })
    }
}

/// One collected section of any kind. Serialises as the bare `Section<T>`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum AnySection {
    DiskEncryption(Section<DiskEncryption>),
    Firewall(Section<Firewall>),
    PlatformIntegrity(Section<PlatformIntegrity>),
    MalwareProtection(Section<MalwareProtection>),
    Updates(Section<Updates>),
    ScreenLock(Section<ScreenLock>),
    Accounts(Section<Accounts>),
    PasswordPolicy(Section<PasswordPolicy>),
    Listeners(Section<Listeners>),
    RemoteAccess(Section<RemoteAccess>),
    FileSharing(Section<FileSharing>),
    Persistence(Section<Persistence>),
    LoginItems(Section<LoginItems>),
    Backup(Section<Backup>),
    Browsers(Section<Browsers>),
    Ssh(Section<Ssh>),
    Dotfiles(Section<Dotfiles>),
}

impl AnySection {
    pub fn key(&self) -> SectionKey {
        match self {
            AnySection::DiskEncryption(_) => SectionKey::DiskEncryption,
            AnySection::Firewall(_) => SectionKey::Firewall,
            AnySection::PlatformIntegrity(_) => SectionKey::PlatformIntegrity,
            AnySection::MalwareProtection(_) => SectionKey::MalwareProtection,
            AnySection::Updates(_) => SectionKey::Updates,
            AnySection::ScreenLock(_) => SectionKey::ScreenLock,
            AnySection::Accounts(_) => SectionKey::Accounts,
            AnySection::PasswordPolicy(_) => SectionKey::PasswordPolicy,
            AnySection::Listeners(_) => SectionKey::Listeners,
            AnySection::RemoteAccess(_) => SectionKey::RemoteAccess,
            AnySection::FileSharing(_) => SectionKey::FileSharing,
            AnySection::Persistence(_) => SectionKey::Persistence,
            AnySection::LoginItems(_) => SectionKey::LoginItems,
            AnySection::Backup(_) => SectionKey::Backup,
            AnySection::Browsers(_) => SectionKey::Browsers,
            AnySection::Ssh(_) => SectionKey::Ssh,
            AnySection::Dotfiles(_) => SectionKey::Dotfiles,
        }
    }

    pub fn is_ok(&self) -> bool {
        match self {
            AnySection::DiskEncryption(s) => s.is_ok(),
            AnySection::Firewall(s) => s.is_ok(),
            AnySection::PlatformIntegrity(s) => s.is_ok(),
            AnySection::MalwareProtection(s) => s.is_ok(),
            AnySection::Updates(s) => s.is_ok(),
            AnySection::ScreenLock(s) => s.is_ok(),
            AnySection::Accounts(s) => s.is_ok(),
            AnySection::PasswordPolicy(s) => s.is_ok(),
            AnySection::Listeners(s) => s.is_ok(),
            AnySection::RemoteAccess(s) => s.is_ok(),
            AnySection::FileSharing(s) => s.is_ok(),
            AnySection::Persistence(s) => s.is_ok(),
            AnySection::LoginItems(s) => s.is_ok(),
            AnySection::Backup(s) => s.is_ok(),
            AnySection::Browsers(s) => s.is_ok(),
            AnySection::Ssh(s) => s.is_ok(),
            AnySection::Dotfiles(s) => s.is_ok(),
        }
    }

    pub fn unavailable(key: SectionKey, reason: UnavailableReason, detail: Option<&str>) -> Self {
        match key {
            SectionKey::DiskEncryption => AnySection::DiskEncryption(Section::unavailable(reason, detail)),
            SectionKey::Firewall => AnySection::Firewall(Section::unavailable(reason, detail)),
            SectionKey::PlatformIntegrity => AnySection::PlatformIntegrity(Section::unavailable(reason, detail)),
            SectionKey::MalwareProtection => AnySection::MalwareProtection(Section::unavailable(reason, detail)),
            SectionKey::Updates => AnySection::Updates(Section::unavailable(reason, detail)),
            SectionKey::ScreenLock => AnySection::ScreenLock(Section::unavailable(reason, detail)),
            SectionKey::Accounts => AnySection::Accounts(Section::unavailable(reason, detail)),
            SectionKey::PasswordPolicy => AnySection::PasswordPolicy(Section::unavailable(reason, detail)),
            SectionKey::Listeners => AnySection::Listeners(Section::unavailable(reason, detail)),
            SectionKey::RemoteAccess => AnySection::RemoteAccess(Section::unavailable(reason, detail)),
            SectionKey::FileSharing => AnySection::FileSharing(Section::unavailable(reason, detail)),
            SectionKey::Persistence => AnySection::Persistence(Section::unavailable(reason, detail)),
            SectionKey::LoginItems => AnySection::LoginItems(Section::unavailable(reason, detail)),
            SectionKey::Backup => AnySection::Backup(Section::unavailable(reason, detail)),
            SectionKey::Browsers => AnySection::Browsers(Section::unavailable(reason, detail)),
            SectionKey::Ssh => AnySection::Ssh(Section::unavailable(reason, detail)),
            SectionKey::Dotfiles => AnySection::Dotfiles(Section::unavailable(reason, detail)),
        }
    }

    fn put(self, sections: &mut SystemStateSections) {
        match self {
            AnySection::DiskEncryption(s) => sections.disk_encryption = s,
            AnySection::Firewall(s) => sections.firewall = s,
            AnySection::PlatformIntegrity(s) => sections.platform_integrity = s,
            AnySection::MalwareProtection(s) => sections.malware_protection = s,
            AnySection::Updates(s) => sections.updates = s,
            AnySection::ScreenLock(s) => sections.screen_lock = s,
            AnySection::Accounts(s) => sections.accounts = s,
            AnySection::PasswordPolicy(s) => sections.password_policy = s,
            AnySection::Listeners(s) => sections.listeners = s,
            AnySection::RemoteAccess(s) => sections.remote_access = s,
            AnySection::FileSharing(s) => sections.file_sharing = s,
            AnySection::Persistence(s) => sections.persistence = s,
            AnySection::LoginItems(s) => sections.login_items = s,
            AnySection::Backup(s) => sections.backup = s,
            AnySection::Browsers(s) => sections.browsers = s,
            AnySection::Ssh(s) => sections.ssh = s,
            AnySection::Dotfiles(s) => sections.dotfiles = s,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CollectError {
    #[error("cancelled")]
    Cancelled,
}

fn collect_one(key: SectionKey, shared: &Shared) -> AnySection {
    #[cfg(target_os = "macos")]
    {
        macos::collect_one(key, shared)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = shared;
        AnySection::unavailable(key, UnavailableReason::NotSupportedOnOs, None)
    }
}

fn collect_host(cancel: &AtomicBool) -> Host {
    #[cfg(target_os = "macos")]
    {
        macos::host::collect(cancel)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = cancel;
        Host {
            os: if cfg!(target_os = "windows") { Os::Windows } else { Os::Linux },
            os_version: "unknown".to_owned(),
            os_build: None,
            arch: current_arch(),
            collector_version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }
}

pub fn current_arch() -> Arch {
    if std::env::consts::ARCH == "aarch64" { Arch::Arm64 } else { Arch::X86_64 }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Runs one collector and turns a panic into an unavailable section instead of ending the scan.
fn guarded(key: SectionKey, collect: impl FnOnce() -> AnySection) -> AnySection {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(collect))
        .unwrap_or_else(|_| AnySection::unavailable(key, UnavailableReason::CollectorError, Some("panic")))
}

/// Collects one section on the calling thread, for "I've done this, check again".
pub fn collect_section(key: SectionKey, cancel: Arc<AtomicBool>) -> AnySection {
    let shared = Shared::new(cancel);
    guarded(key, || collect_one(key, &shared))
}

/// Collects every section in parallel. Sections still pending at the deadline become `timeout`.
pub fn collect_all(progress: Arc<ProgressFn>, cancel: Arc<AtomicBool>) -> Result<SystemState, CollectError> {
    let collected_at = now_iso();
    let started = Instant::now();
    let shared = Arc::new(Shared::new(cancel));
    let (tx, rx) = mpsc::channel::<AnySection>();

    let mut pending: Vec<SectionKey> = Vec::new();
    let mut sections =
        SystemStateSections::all_unavailable(UnavailableReason::Timeout, Some("budget: 60s"));

    for key in SectionKey::ALL {
        let shared = Arc::clone(&shared);
        let thread_progress = Arc::clone(&progress);
        let tx = tx.clone();
        let spawned = std::thread::Builder::new()
            .name(format!("talos-collect-{}", key.as_str()))
            .spawn(move || {
                thread_progress(key, ProgressStatus::Started);
                let section = guarded(key, || collect_one(key, &shared));
                thread_progress(key, if section.is_ok() { ProgressStatus::Ok } else { ProgressStatus::Unavailable });
                let _ = tx.send(section);
            });
        match spawned {
            Ok(_) => pending.push(key),
            Err(_) => {
                progress(key, ProgressStatus::Unavailable);
                AnySection::unavailable(key, UnavailableReason::CollectorError, Some("thread: spawn")).put(&mut sections);
            }
        }
    }
    drop(tx);

    while !pending.is_empty() {
        let remaining = OVERALL_BUDGET.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining) {
            Ok(section) => {
                pending.retain(|k| *k != section.key());
                section.put(&mut sections);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    for key in pending {
        progress(key, ProgressStatus::Unavailable);
    }

    if shared.cancelled() {
        return Err(CollectError::Cancelled);
    }
    let host = collect_host(&shared.cancel);
    Ok(SystemState { schema_version: SCHEMA_VERSION, collected_at, host, sections })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn fail_maps_exec_errors() {
        let f = Fail::from(ExecError::ToolMissing(crate::exec::Bin::Fdesetup));
        assert_eq!(f.reason, UnavailableReason::ToolMissing);
        assert_eq!(f.detail.as_deref(), Some("bin: fdesetup"));
        let f = Fail::from(ExecError::Timeout(crate::exec::Bin::Netstat));
        assert_eq!(f.reason, UnavailableReason::Timeout);
        assert_eq!(f.detail.as_deref(), Some("bin: netstat"));
    }

    #[test]
    fn fail_maps_io_errors() {
        let eperm = std::io::Error::from_raw_os_error(libc::EPERM);
        assert_eq!(Fail::io(&eperm, "read_dir: .ssh").reason, UnavailableReason::PermissionDenied);
        let eacces = std::io::Error::from_raw_os_error(libc::EACCES);
        assert_eq!(Fail::io(&eacces, "read").reason, UnavailableReason::PermissionDenied);
        let other = std::io::Error::from_raw_os_error(libc::EIO);
        assert_eq!(Fail::io(&other, "read").reason, UnavailableReason::CollectorError);
    }

    #[test]
    fn any_section_serialises_as_bare_section() {
        let s = AnySection::unavailable(SectionKey::Ssh, UnavailableReason::PermissionDenied, Some("read_dir: .ssh"));
        assert_eq!(s.key(), SectionKey::Ssh);
        assert!(!s.is_ok());
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json, serde_json::json!({ "status": "unavailable", "reason": "permission_denied", "detail": "read_dir: .ssh" }));
    }

    #[test]
    fn a_panicking_collector_becomes_an_unavailable_section() {
        let section = guarded(SectionKey::Ssh, || panic!("parser bug"));
        assert_eq!(section.key(), SectionKey::Ssh);
        assert!(!section.is_ok());
        let json = serde_json::to_value(&section).unwrap();
        assert_eq!(json["reason"], "collector_error");
        assert_eq!(json["detail"], "panic");
        let ok = guarded(SectionKey::Ssh, || AnySection::Ssh(Section::ok(Ssh { dir_exists: false, dir_mode: None, keys: vec![] })));
        assert!(ok.is_ok());
    }

    #[test]
    fn every_key_has_an_unavailable_slot() {
        let mut sections = SystemStateSections::all_unavailable(UnavailableReason::Timeout, None);
        for key in SectionKey::ALL {
            AnySection::unavailable(key, UnavailableReason::CollectorError, Some("x")).put(&mut sections);
        }
        let json = serde_json::to_value(&sections).unwrap();
        for key in SectionKey::ALL {
            assert_eq!(json[key.as_str()]["reason"], "collector_error");
        }
    }
}
