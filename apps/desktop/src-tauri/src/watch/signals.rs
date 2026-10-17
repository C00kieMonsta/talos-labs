//! Per-signal tables (severity, kind, points, direction) mirrored from
//! `packages/core/src/watch/signals.ts`, plus the helpers the probes reduce machine text with:
//! path classes, the codesign binding rules, the own-agent exclusion and the noise hold.
//! No `String` field here ever leaves this module except through a count or a digest.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use super::types::{PreviousValue, SignalValue};
use super::{Change, FishyKind, Severity, SignalId};
use crate::exec::{self, Bin, ExecError, Output};

pub fn severity(signal: SignalId) -> Severity {
    use SignalId::*;
    match signal {
        PersistenceNew
        | PersistenceUnsigned
        | PersistenceInTempOrHidden
        | ListenerNewPorts
        | RemoteAccessOn
        | GuestShare
        | Firewall
        | Gatekeeper
        | Sip
        | BootArgsSet
        | XprotectPresent
        | XprotectVersion
        | XprotectScansEnabled
        | AdminCount
        | HiddenUserCount
        | Autologin
        | ProfilesCount
        | SysextCount
        | DnsManual
        | PacUrlSet
        | AuthorizedKeysChanged
        | BackupAuto
        | CronLines
        | SudoersDCount
        | PamSudoChanged
        | RemoteLogins
        | AppNewUnsigned
        | InternetSharingOn
        | LaunchLabelMasqueradeUnsigned
        | LoginHookSet
        | AuthenticatedRoot
        | PamAuthChanged => Severity::High,
        PersistenceSet
        | HelperToolsCount
        | LoginItemsCount
        | ListenerSet
        | ShareCount
        | XprotectRemediatorVersion
        | UserCount
        | MdmEnrolled
        | ManagedPrefsCount
        | KextCount
        | ProxyOn
        | HostsChanged
        | SshdConfigChanged
        | BackupDestinations
        | AtJobs
        | LegacyStartupCount
        | LockdownMode
        | BroadExtensionCount
        | ShellStartupChanged
        | SystemShellFilesCount
        | PathsDChanged
        | PathDirWritableCount
        | AppSet
        | AppNewUnquarantined
        | LibraryAppsCount
        | AirdropEveryone
        | LaunchLabelMasquerade
        | DyldInsertSet => Severity::Medium,
        EstablishedCount | Resolvers | BackupAgeDays | PendingUpdates => Severity::Low,
        LoadAvg | DiskFreePct | OnBattery => Severity::Info,
    }
}

/// The fishy kind a signal makes an item under; `None` for the context-only signals.
pub fn kind_of(signal: SignalId) -> Option<FishyKind> {
    use SignalId::*;
    match signal {
        PersistenceSet
        | PersistenceNew
        | PersistenceUnsigned
        | PersistenceInTempOrHidden
        | HelperToolsCount
        | LoginItemsCount
        | ProfilesCount
        | MdmEnrolled
        | ManagedPrefsCount
        | SysextCount
        | KextCount
        | CronLines
        | AtJobs
        | LegacyStartupCount
        | LaunchLabelMasquerade
        | LaunchLabelMasqueradeUnsigned
        | LoginHookSet
        | DyldInsertSet => Some(FishyKind::Persistence),
        ListenerSet | ListenerNewPorts => Some(FishyKind::Listener),
        Firewall
        | Gatekeeper
        | Sip
        | BootArgsSet
        | XprotectPresent
        | XprotectVersion
        | XprotectRemediatorVersion
        | XprotectScansEnabled
        | LockdownMode
        | AuthenticatedRoot => Some(FishyKind::Guard),
        RemoteAccessOn
        | GuestShare
        | ShareCount
        | AuthorizedKeysChanged
        | SshdConfigChanged
        | RemoteLogins => Some(FishyKind::Remote),
        AdminCount | UserCount | HiddenUserCount | Autologin | SudoersDCount | PamSudoChanged
        | PamAuthChanged => Some(FishyKind::Admin),
        DnsManual | ProxyOn | PacUrlSet | HostsChanged => Some(FishyKind::Dns),
        BackupAuto | BackupDestinations => Some(FishyKind::Backup),
        AppSet | AppNewUnsigned => Some(FishyKind::App),
        ShellStartupChanged | SystemShellFilesCount | PathsDChanged | PathDirWritableCount => {
            Some(FishyKind::Shell)
        }
        AirdropEveryone | InternetSharingOn => Some(FishyKind::Exposure),
        // Context only (spec rows 10, 13 and 18, and v2 rows 26 and 28): never a headline. An
        // unquarantined bundle narrows the unsigned count; a library app count names nothing.
        EstablishedCount | Resolvers | BackupAgeDays | LoadAvg | DiskFreePct | OnBattery
        | PendingUpdates | BroadExtensionCount | AppNewUnquarantined | LibraryAppsCount => None,
    }
}

pub fn points(severity: Severity) -> u32 {
    match severity {
        Severity::Critical => 10,
        Severity::High => 6,
        Severity::Medium => 3,
        Severity::Low => 1,
        Severity::Info => 0,
    }
}

/// Flips a person makes in System Settings: asked "Did you just change this?" first.
pub const GATED_SIGNALS: [SignalId; 7] = [
    SignalId::Firewall,
    SignalId::RemoteAccessOn,
    SignalId::GuestShare,
    SignalId::Autologin,
    SignalId::AdminCount,
    SignalId::BackupAuto,
    SignalId::InternetSharingOn,
];

/// Flips that need Recovery or root, and an unsigned agent wearing Apple's label: one alone is act now.
pub const STAND_ALONE_SIGNALS: [SignalId; 8] = [
    SignalId::Sip,
    SignalId::Gatekeeper,
    SignalId::XprotectPresent,
    SignalId::XprotectScansEnabled,
    SignalId::XprotectVersion,
    SignalId::HiddenUserCount,
    SignalId::AuthenticatedRoot,
    SignalId::LaunchLabelMasqueradeUnsigned,
];

/// Two of these (or a gated flip) within 24 h is act now.
pub const PAIR_SIGNALS: [SignalId; 18] = [
    SignalId::PersistenceNew,
    SignalId::PersistenceUnsigned,
    SignalId::PersistenceInTempOrHidden,
    SignalId::ListenerNewPorts,
    SignalId::DnsManual,
    SignalId::PacUrlSet,
    SignalId::ProfilesCount,
    SignalId::SysextCount,
    SignalId::AuthorizedKeysChanged,
    SignalId::CronLines,
    SignalId::ShellStartupChanged,
    SignalId::SystemShellFilesCount,
    SignalId::PathsDChanged,
    SignalId::AppNewUnsigned,
    SignalId::LaunchLabelMasquerade,
    SignalId::LoginHookSet,
    SignalId::DyldInsertSet,
    SignalId::PamAuthChanged,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BadDirection {
    True,
    False,
    Up,
    Down,
    /// A stat digest: any change is the bad direction.
    Any,
}

/// The direction that counts for every kinded boolean, count and version signal: the headlines
/// all name a bad direction, so a Remediator update or a share removed makes no item. The stat
/// digests of single files read `Any`; the listing digests have no row.
pub fn bad_direction(signal: SignalId) -> Option<BadDirection> {
    use SignalId::*;
    match signal {
        Sip | Gatekeeper | XprotectPresent | XprotectScansEnabled | Firewall | BackupAuto
        | LockdownMode | AuthenticatedRoot => Some(BadDirection::False),
        BootArgsSet => Some(BadDirection::True),
        ShellStartupChanged | PathsDChanged | PamAuthChanged | AuthorizedKeysChanged => {
            Some(BadDirection::Any)
        }
        XprotectVersion | XprotectRemediatorVersion | BackupDestinations => {
            Some(BadDirection::Down)
        }
        HiddenUserCount
        | AdminCount
        | PersistenceNew
        | PersistenceUnsigned
        | PersistenceInTempOrHidden
        | ListenerNewPorts
        | ProfilesCount
        | SysextCount
        | CronLines
        | ShareCount
        | UserCount
        | LoginItemsCount
        | HelperToolsCount
        | KextCount
        | ManagedPrefsCount
        | AtJobs
        | LegacyStartupCount
        | SudoersDCount
        | BroadExtensionCount
        | RemoteLogins
        | SystemShellFilesCount
        | PathDirWritableCount
        | AppNewUnquarantined
        | AppNewUnsigned
        | LibraryAppsCount
        | LaunchLabelMasquerade
        | LaunchLabelMasqueradeUnsigned => Some(BadDirection::Up),
        RemoteAccessOn | GuestShare | Autologin | DnsManual | PacUrlSet | MdmEnrolled | ProxyOn
        | AirdropEveryone | InternetSharingOn | LoginHookSet | DyldInsertSet => {
            Some(BadDirection::True)
        }
        _ => None,
    }
}

/// True when the signal changed in the direction its row names. Mirrors `badFlip`.
pub fn bad_flip(
    signal: SignalId,
    value: SignalValue,
    previous: Option<PreviousValue>,
    change: Change,
) -> bool {
    if change == Change::Same {
        return false;
    }
    let Some(direction) = bad_direction(signal) else {
        return false;
    };
    match direction {
        BadDirection::True => value == SignalValue::Bool(true),
        BadDirection::False => value == SignalValue::Bool(false),
        BadDirection::Up => match value.as_number() {
            Some(v) => v > previous.and_then(PreviousValue::as_number).unwrap_or(0.0),
            None => false,
        },
        BadDirection::Down => match (
            value.as_number(),
            previous.and_then(PreviousValue::as_number),
        ) {
            (Some(v), Some(p)) => v < p,
            _ => false,
        },
        BadDirection::Any => value == SignalValue::Change(Change::Changed),
    }
}

/// Counts derived from a listing each cycle: their baseline is always 0, never the last count.
pub const DERIVED_COUNTS: [SignalId; 8] = [
    SignalId::PersistenceNew,
    SignalId::PersistenceUnsigned,
    SignalId::PersistenceInTempOrHidden,
    SignalId::ListenerNewPorts,
    SignalId::AppNewUnquarantined,
    SignalId::AppNewUnsigned,
    SignalId::LaunchLabelMasquerade,
    SignalId::LaunchLabelMasqueradeUnsigned,
];

/// The listing a pair signal comes from, so three counters from one listing count once.
pub fn pair_group(signal: SignalId) -> SignalId {
    siblings(signal).first().copied().unwrap_or(signal)
}

/// Signals derived from one listing: acknowledging or re-baselining one re-baselines the group.
pub fn siblings(signal: SignalId) -> Vec<SignalId> {
    use SignalId::*;
    match signal {
        PersistenceSet
        | PersistenceNew
        | PersistenceUnsigned
        | PersistenceInTempOrHidden
        | LaunchLabelMasquerade
        | LaunchLabelMasqueradeUnsigned => vec![
            PersistenceSet,
            PersistenceNew,
            PersistenceUnsigned,
            PersistenceInTempOrHidden,
            LaunchLabelMasquerade,
            LaunchLabelMasqueradeUnsigned,
        ],
        ListenerSet | ListenerNewPorts => vec![ListenerSet, ListenerNewPorts],
        ShellStartupChanged | SystemShellFilesCount | PathsDChanged | PathDirWritableCount => vec![
            ShellStartupChanged,
            SystemShellFilesCount,
            PathsDChanged,
            PathDirWritableCount,
        ],
        AppSet | AppNewUnquarantined | AppNewUnsigned => {
            vec![AppSet, AppNewUnquarantined, AppNewUnsigned]
        }
        other => vec![other],
    }
}

// ---------- path classes ----------

/// Dot-folders under home that package managers own; an item there is not "hidden".
pub const PACKAGE_FOLDERS: [&str; 7] = [
    ".local", ".cargo", ".nvm", ".rustup", ".bun", ".deno", ".docker",
];

const TEMP_PREFIXES: [&str; 7] = [
    "/tmp/",
    "/private/tmp/",
    "/var/folders/",
    "/private/var/folders/",
    "/Users/Shared/",
    "/var/tmp/",
    "/private/var/tmp/",
];

/// A dot-folder directly under this home folder is hidden too (the demo's own fixture lives there).
const APP_SUPPORT: &str = "Library/Application Support";

/// The data-volume firmlink and the `/private` symlink: `realpath` leaves both as written, so a
/// path spelt through either is compared in its short form.
const SPELLING_PREFIXES: [&str; 2] = ["/System/Volumes/Data", "/private"];

/// The short spelling of a path: `/System/Volumes/Data/Users/x` and `/private/tmp/x` read as
/// `/Users/x` and `/tmp/x`. Component-wise, so `/privateer` is left alone.
pub fn normalise(path: &Path) -> PathBuf {
    let mut out = path.to_path_buf();
    for prefix in SPELLING_PREFIXES {
        if let Ok(rest) = out.strip_prefix(prefix) {
            out = Path::new("/").join(rest);
        }
    }
    out
}

/// True for a program under a temp folder, under `/Users/Shared`, in a dot-folder under home
/// other than the package folders, or in a dot-folder directly under `~/Library/Application Support`.
pub fn is_temp_or_hidden(program: &str, home: &Path) -> bool {
    let program = normalise(Path::new(program));
    let text = program.to_string_lossy();
    if TEMP_PREFIXES.iter().any(|p| text.starts_with(p)) {
        return true;
    }
    let Ok(rest) = program.strip_prefix(normalise(home)) else {
        return false;
    };
    let first = rest
        .components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .unwrap_or_default();
    if first.starts_with('.') && !PACKAGE_FOLDERS.contains(&first.as_str()) {
        return true;
    }
    rest.strip_prefix(APP_SUPPORT).is_ok_and(|under| {
        under
            .components()
            .next()
            .is_some_and(|c| c.as_os_str().to_string_lossy().starts_with('.'))
    })
}

// ---------- codesign binding ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CodesignOutcome {
    Valid,
    Invalid,
    Unsigned,
    Missing,
    /// The program value could not be bound to a regular file under the rules; counts as unsigned.
    Unbound,
}

impl CodesignOutcome {
    pub fn counts_as_unsigned(self) -> bool {
        self != CodesignOutcome::Valid
    }
}

/// Folders a background read must never touch: a Files and Folders prompt could rise from them.
/// iCloud Drive lives under `~/Library/Mobile Documents` and is in the same TCC class.
const PROMPTING_DIRS: [&str; 4] = [
    "Desktop",
    "Documents",
    "Downloads",
    "Library/Mobile Documents",
];

/// Mount roots a background read must never touch: removable disks and autofs network mounts.
const MOUNT_DIRS: [&str; 2] = ["/Volumes", "/Network"];

/// The program a plist names is a codesign candidate only when it starts with `/`, canonicalises
/// to itself, is a regular file, and is not under ~/Desktop, ~/Documents, ~/Downloads, iCloud
/// Drive, /Volumes, /Network or a network mount. The folder rules run on the canonical path in
/// its short spelling, so the data-volume firmlink and `/private` forms are caught too. A bare
/// name, an all-digit value (a pid to codesign) or a `-` prefix is unbound.
pub fn codesign_candidate(program: &str, home: &Path) -> Option<PathBuf> {
    if program.is_empty()
        || !program.starts_with('/')
        || program.starts_with('-')
        || program.bytes().all(|b| b.is_ascii_digit())
        || program.contains(['\n', '\0'])
    {
        return None;
    }
    let path = PathBuf::from(program);
    let canonical = path.canonicalize().ok()?;
    if canonical != path {
        return None;
    }
    if in_forbidden_folder(&canonical, home) {
        return None;
    }
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    if !is_local_mount(&canonical) {
        return None;
    }
    Some(canonical)
}

/// True when the canonical path, in its short spelling, is under a mount root or one of the
/// prompting folders of this home. Shared by the launch item binder and the app bundle binder.
pub fn in_forbidden_folder(canonical: &Path, home: &Path) -> bool {
    let short = normalise(canonical);
    if MOUNT_DIRS.iter().any(|dir| short.starts_with(dir)) {
        return true;
    }
    let short_home = normalise(home);
    PROMPTING_DIRS
        .iter()
        .any(|dir| short.starts_with(short_home.join(dir)))
}

/// `statfs` reports its flags as `u32`; libc declares the bits as `i32`.
const MNT_LOCAL: u32 = libc::MNT_LOCAL as u32;

/// True when the `statfs` flags say the filesystem is local, not a network mount.
pub fn local_mount_flags(f_flags: u32) -> bool {
    f_flags & MNT_LOCAL != 0
}

/// `statfs` on the path; a path that cannot be stat'ed is not local.
pub fn is_local_mount(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: a NUL-terminated path and a zeroed statfs buffer of the right size.
    let rc = unsafe { libc::statfs(c_path.as_ptr(), &mut stat) };
    rc == 0 && local_mount_flags(stat.f_flags)
}

/// At most this many `codesign` runs per cycle.
pub const CODESIGN_CAP: usize = 10;
pub const CODESIGN_TIMEOUT: Duration = Duration::from_secs(5);

/// `codesign --verify --strict -- <path>`; the app's own code reads no bytes of the file.
pub fn run_codesign(path: &Path) -> Result<Output, ExecError> {
    let text = path.to_string_lossy();
    exec::run(
        Bin::Codesign,
        &["--verify", "--strict", "--", text.as_ref()],
        CODESIGN_TIMEOUT,
        &AtomicBool::new(false),
    )
}

/// Reduces a codesign result to the closed enum. The stderr text never leaves this function.
pub fn classify_codesign(result: &Result<Output, ExecError>) -> CodesignOutcome {
    match result {
        Ok(out) if out.success() => CodesignOutcome::Valid,
        Ok(out) => {
            let err = out.stderr.to_ascii_lowercase();
            if err.contains("not signed at all") {
                CodesignOutcome::Unsigned
            } else if err.contains("no such file") {
                CodesignOutcome::Missing
            } else {
                CodesignOutcome::Invalid
            }
        }
        Err(ExecError::ToolMissing(_)) | Err(ExecError::Timeout(_)) => CodesignOutcome::Invalid,
        Err(_) => CodesignOutcome::Invalid,
    }
}

/// Binds and verifies up to `CODESIGN_CAP` programs; the rest are left unverified (`None`).
pub fn verify_programs(
    programs: &[Option<String>],
    home: &Path,
    run: &dyn Fn(&Path) -> Result<Output, ExecError>,
) -> Vec<Option<CodesignOutcome>> {
    let mut budget = CODESIGN_CAP;
    verify_programs_within(programs, home, run, &mut budget)
}

/// The same over a shared budget: every run decrements it, so the app bundles that follow the
/// launch items in a cycle see what is left of the cap.
pub fn verify_programs_within(
    programs: &[Option<String>],
    home: &Path,
    run: &dyn Fn(&Path) -> Result<Output, ExecError>,
    budget: &mut usize,
) -> Vec<Option<CodesignOutcome>> {
    programs
        .iter()
        .map(|program| {
            let Some(program) = program else {
                return Some(CodesignOutcome::Unbound);
            };
            let Some(path) = codesign_candidate(program, home) else {
                return Some(CodesignOutcome::Unbound);
            };
            if *budget == 0 {
                return None;
            }
            *budget -= 1;
            Some(classify_codesign(&run(&path)))
        })
        .collect()
}

// ---------- own agent ----------

/// The app's own LaunchAgent (start at login) is the one entry excluded from the baseline.
pub fn is_own_agent(program: Option<&str>, own_exe: Option<&Path>) -> bool {
    match (program, own_exe) {
        (Some(program), Some(exe)) => Path::new(program)
            .canonicalize()
            .is_ok_and(|canonical| canonical == exe),
        _ => false,
    }
}

/// `current_exe().canonicalize()`, or None when the path cannot be read.
pub fn own_exe() -> Option<PathBuf> {
    std::env::current_exe().ok()?.canonicalize().ok()
}

// ---------- noise hold ----------

/// A change within this window of a Talos fix or a valid-signed persistence change is held.
pub const NOISE_HOLD: Duration = Duration::from_secs(10 * 60);

/// True when the two instants are within `NOISE_HOLD` of each other. Mirrors `held` in core.
pub fn held(changed_at: &str, fixed_at: &str) -> bool {
    let (Some(a), Some(b)) = (parse_ms(changed_at), parse_ms(fixed_at)) else {
        return false;
    };
    (a - b).abs() <= NOISE_HOLD.as_millis() as i64
}

/// Milliseconds since the epoch, like `Date.parse`; None when the text is not a date.
pub fn parse_ms(text: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|d| d.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn tmp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("talos-watch-sig-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn every_signal_has_a_severity_and_the_tables_match_the_fixture_sizes() {
        let high = SignalId::ALL
            .iter()
            .filter(|s| severity(**s) == Severity::High)
            .count();
        let medium = SignalId::ALL
            .iter()
            .filter(|s| severity(**s) == Severity::Medium)
            .count();
        let low = SignalId::ALL
            .iter()
            .filter(|s| severity(**s) == Severity::Low)
            .count();
        let info = SignalId::ALL
            .iter()
            .filter(|s| severity(**s) == Severity::Info)
            .count();
        assert_eq!((high, medium, low, info), (32, 28, 4, 3));
        let kinded = SignalId::ALL
            .iter()
            .filter(|s| kind_of(**s).is_some())
            .count();
        assert_eq!(kinded, 57);
        assert_eq!(GATED_SIGNALS.len(), 7);
        assert_eq!(STAND_ALONE_SIGNALS.len(), 8);
        assert_eq!(PAIR_SIGNALS.len(), 18);
        assert_eq!(DERIVED_COUNTS.len(), 8);
        assert_eq!(TEMP_PREFIXES.len(), 7);
        assert_eq!(kind_of(SignalId::AppNewUnsigned), Some(FishyKind::App));
        assert_eq!(kind_of(SignalId::PathsDChanged), Some(FishyKind::Shell));
        assert_eq!(
            kind_of(SignalId::InternetSharingOn),
            Some(FishyKind::Exposure)
        );
        assert_eq!(
            kind_of(SignalId::LaunchLabelMasqueradeUnsigned),
            Some(FishyKind::Persistence)
        );
        assert_eq!(kind_of(SignalId::AuthenticatedRoot), Some(FishyKind::Guard));
        assert_eq!(kind_of(SignalId::PamAuthChanged), Some(FishyKind::Admin));
        for context_only in [
            SignalId::EstablishedCount,
            SignalId::Resolvers,
            SignalId::BackupAgeDays,
            SignalId::AppNewUnquarantined,
            SignalId::LibraryAppsCount,
        ] {
            assert_eq!(
                kind_of(context_only),
                None,
                "{context_only:?} is context only"
            );
        }
        assert_eq!(points(Severity::High), 6);
        for gated in GATED_SIGNALS {
            assert!(bad_direction(gated).is_some(), "{gated:?}");
        }
    }

    #[test]
    fn bad_flip_follows_the_direction_table() {
        let up = bad_flip(
            SignalId::AdminCount,
            SignalValue::Int(2),
            Some(PreviousValue::Int(1)),
            Change::Changed,
        );
        assert!(up);
        assert!(!bad_flip(
            SignalId::AdminCount,
            SignalValue::Int(1),
            Some(PreviousValue::Int(2)),
            Change::Changed
        ));
        assert!(
            bad_flip(
                SignalId::HiddenUserCount,
                SignalValue::Int(1),
                None,
                Change::Changed
            ),
            "null previous reads as 0"
        );
        assert!(bad_flip(
            SignalId::Sip,
            SignalValue::Bool(false),
            Some(PreviousValue::Bool(true)),
            Change::Changed
        ));
        assert!(!bad_flip(
            SignalId::Sip,
            SignalValue::Bool(true),
            Some(PreviousValue::Bool(false)),
            Change::Changed
        ));
        assert!(bad_flip(
            SignalId::XprotectVersion,
            SignalValue::Int(5000),
            Some(PreviousValue::Int(5367)),
            Change::Changed
        ));
        assert!(!bad_flip(
            SignalId::XprotectVersion,
            SignalValue::Int(5000),
            None,
            Change::Changed
        ));
        assert!(!bad_flip(
            SignalId::Sip,
            SignalValue::Bool(false),
            Some(PreviousValue::Bool(true)),
            Change::Same
        ));
        assert!(
            !bad_flip(
                SignalId::LoadAvg,
                SignalValue::Int(9),
                Some(PreviousValue::Int(1)),
                Change::Changed
            ),
            "no row never flips"
        );
        for id in [
            SignalId::ShellStartupChanged,
            SignalId::PathsDChanged,
            SignalId::PamAuthChanged,
            SignalId::AuthorizedKeysChanged,
        ] {
            assert_eq!(bad_direction(id), Some(BadDirection::Any), "{id:?}");
            assert!(
                bad_flip(
                    id,
                    SignalValue::Change(Change::Changed),
                    None,
                    Change::Changed
                ),
                "{id:?}: any change is the bad direction"
            );
            assert!(!bad_flip(
                id,
                SignalValue::Change(Change::Same),
                None,
                Change::Changed
            ));
            assert!(!bad_flip(
                id,
                SignalValue::Change(Change::Cleared),
                None,
                Change::Cleared
            ));
            assert!(
                !bad_flip(id, SignalValue::Bool(true), None, Change::Changed),
                "{id:?}: a boolean is never a digest change"
            );
        }
        assert!(bad_flip(
            SignalId::AuthenticatedRoot,
            SignalValue::Bool(false),
            Some(PreviousValue::Bool(true)),
            Change::Changed
        ));
        assert!(bad_flip(
            SignalId::InternetSharingOn,
            SignalValue::Bool(true),
            Some(PreviousValue::Bool(false)),
            Change::Changed
        ));
        assert!(bad_flip(
            SignalId::AppNewUnsigned,
            SignalValue::Int(1),
            Some(PreviousValue::Int(0)),
            Change::Changed
        ));
    }

    #[test]
    fn every_kinded_bool_count_and_version_signal_has_a_direction_and_the_digest_kinds_have_none() {
        use SignalId::*;
        let no_row = [
            PersistenceSet,
            ListenerSet,
            AppSet,
            HostsChanged,
            SshdConfigChanged,
            PamSudoChanged,
        ];
        for id in SignalId::ALL {
            if no_row.contains(id) {
                assert_eq!(bad_direction(*id), None, "{id:?} counts on any change");
            } else if kind_of(*id).is_some() {
                assert!(
                    bad_direction(*id).is_some(),
                    "{id:?} needs a direction for its headline"
                );
            }
        }
        assert!(
            !bad_flip(
                XprotectRemediatorVersion,
                SignalValue::Int(150),
                Some(PreviousValue::Int(149)),
                Change::Changed
            ),
            "a Remediator update is not a guard switched off"
        );
        assert!(bad_flip(
            XprotectRemediatorVersion,
            SignalValue::Int(148),
            Some(PreviousValue::Int(149)),
            Change::Changed
        ));
        assert!(
            !bad_flip(
                ShareCount,
                SignalValue::Int(1),
                Some(PreviousValue::Int(2)),
                Change::Changed
            ),
            "a share removed is not remote access turned on"
        );
        assert!(bad_flip(
            ShareCount,
            SignalValue::Int(2),
            Some(PreviousValue::Int(1)),
            Change::Changed
        ));
        assert!(
            !bad_flip(
                LockdownMode,
                SignalValue::Bool(true),
                Some(PreviousValue::Bool(false)),
                Change::Changed
            ),
            "Lockdown Mode turned on is not a guard switched off"
        );
        assert!(bad_flip(
            LockdownMode,
            SignalValue::Bool(false),
            Some(PreviousValue::Bool(true)),
            Change::Changed
        ));
        assert!(
            bad_flip(
                BackupDestinations,
                SignalValue::Int(0),
                Some(PreviousValue::Int(1)),
                Change::Changed
            ),
            "a backup disk gone is the bad direction"
        );
        assert!(!bad_flip(
            BackupDestinations,
            SignalValue::Int(2),
            Some(PreviousValue::Int(1)),
            Change::Changed
        ));
        assert!(bad_flip(
            MdmEnrolled,
            SignalValue::Bool(true),
            Some(PreviousValue::Bool(false)),
            Change::Changed
        ));
        assert!(bad_flip(
            ProxyOn,
            SignalValue::Bool(true),
            Some(PreviousValue::Bool(false)),
            Change::Changed
        ));
        assert!(!bad_flip(
            KextCount,
            SignalValue::Int(0),
            Some(PreviousValue::Int(1)),
            Change::Changed
        ));
    }

    #[test]
    fn temp_and_hidden_paths_are_classed_without_the_package_folders() {
        let home = Path::new("/Users/alice");
        assert!(is_temp_or_hidden("/tmp/x/agent", home));
        assert!(is_temp_or_hidden("/private/tmp/agent", home));
        assert!(is_temp_or_hidden("/var/folders/ab/cd/T/agent", home));
        assert!(is_temp_or_hidden("/Users/alice/.hidden/agent", home));
        assert!(!is_temp_or_hidden("/Users/alice/.local/bin/agent", home));
        assert!(!is_temp_or_hidden("/Users/alice/.cargo/bin/agent", home));
        assert!(!is_temp_or_hidden("/Users/alice/Applications/x", home));
        assert!(
            !is_temp_or_hidden("/Users/alicia/.x/agent", home),
            "a prefix match of another home is not home"
        );
        assert!(!is_temp_or_hidden("/usr/local/bin/agent", home));
        assert!(is_temp_or_hidden("/Users/Shared/x", home));
        assert!(is_temp_or_hidden("/var/tmp/x", home));
        assert!(is_temp_or_hidden("/private/var/tmp/x", home));
        assert!(is_temp_or_hidden(
            "/Users/alice/Library/Application Support/.h/x",
            home
        ));
        assert!(!is_temp_or_hidden(
            "/Users/alice/Library/Application Support/Code/x",
            home
        ));
        assert!(
            !is_temp_or_hidden("/Users/alice/Library/Application Support/x", home),
            "a file directly under Application Support is not a dot-folder"
        );
        assert!(
            !is_temp_or_hidden("/Users/alice/Library/.hidden/x", home),
            "only Application Support carries the rule"
        );
    }

    #[test]
    fn the_firmlink_and_private_spellings_class_the_same_as_the_short_ones() {
        let home = Path::new("/Users/alice");
        assert!(is_temp_or_hidden("/private/var/folders/x/agent", home));
        assert!(is_temp_or_hidden(
            "/System/Volumes/Data/private/tmp/agent",
            home
        ));
        assert!(is_temp_or_hidden(
            "/System/Volumes/Data/Users/alice/.hidden/agent",
            home
        ));
        assert!(!is_temp_or_hidden(
            "/System/Volumes/Data/Users/alice/.cargo/bin/agent",
            home
        ));
        assert!(
            is_temp_or_hidden(
                "/Users/alice/.hidden/agent",
                Path::new("/System/Volumes/Data/Users/alice")
            ),
            "home may be spelt long too"
        );
        assert!(
            !is_temp_or_hidden("/privateer/tmp/agent", home),
            "a prefix is a component, not text"
        );
        assert_eq!(
            normalise(Path::new("/System/Volumes/Data/Users/alice")),
            PathBuf::from("/Users/alice")
        );
        assert_eq!(
            normalise(Path::new("/private/var/folders/x")),
            PathBuf::from("/var/folders/x")
        );
        assert_eq!(
            normalise(Path::new("/System/Volumes/Data/private/etc")),
            PathBuf::from("/etc")
        );
        assert_eq!(normalise(Path::new("/usr/bin")), PathBuf::from("/usr/bin"));
    }

    #[test]
    fn codesign_binding_refuses_bare_names_digits_dashes_symlinks_and_prompting_folders() {
        let home = tmp("home");
        let downloads = home.join("Downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        let real = home.join("bin");
        std::fs::create_dir_all(&real).unwrap();
        let file = real.join("agent");
        std::fs::write(&file, b"#!/bin/sh\n").unwrap();
        let link = real.join("agent-link");
        symlink(&file, &link).unwrap();
        let in_downloads = downloads.join("agent");
        std::fs::write(&in_downloads, b"x").unwrap();
        let icloud = home.join("Library/Mobile Documents/com~apple~CloudDocs");
        std::fs::create_dir_all(&icloud).unwrap();
        let in_icloud = icloud.join("agent");
        std::fs::write(&in_icloud, b"x").unwrap();

        assert_eq!(
            codesign_candidate(&file.to_string_lossy(), &home),
            Some(file.clone())
        );
        assert_eq!(codesign_candidate("agent", &home), None, "bare name");
        assert_eq!(
            codesign_candidate("12345", &home),
            None,
            "all digits read as a pid"
        );
        assert_eq!(codesign_candidate("-v", &home), None, "dash prefix");
        assert_eq!(
            codesign_candidate(&link.to_string_lossy(), &home),
            None,
            "symlink"
        );
        assert_eq!(
            codesign_candidate(&in_downloads.to_string_lossy(), &home),
            None,
            "~/Downloads"
        );
        assert_eq!(
            codesign_candidate(&in_icloud.to_string_lossy(), &home),
            None,
            "iCloud Drive"
        );
        assert_eq!(
            codesign_candidate(&real.to_string_lossy(), &home),
            None,
            "a directory"
        );
        assert_eq!(codesign_candidate("/Volumes/Disk/agent", &home), None);
        assert_eq!(codesign_candidate("/Network/Servers/x/agent", &home), None);
        assert_eq!(codesign_candidate("/nonexistent/talos/agent", &home), None);
        assert_eq!(codesign_candidate("", &home), None);
        // The data-volume firmlink spelling canonicalises to itself; the folder rule must still see Downloads.
        let long = format!("/System/Volumes/Data{}", in_downloads.to_string_lossy());
        assert_eq!(
            Path::new(&long).canonicalize().ok(),
            Some(PathBuf::from(&long)),
            "realpath leaves the firmlink as written"
        );
        assert_eq!(
            codesign_candidate(&long, &home),
            None,
            "~/Downloads spelt through the firmlink"
        );
        let long_home = PathBuf::from(format!("/System/Volumes/Data{}", home.to_string_lossy()));
        assert_eq!(
            codesign_candidate(&in_downloads.to_string_lossy(), &long_home),
            None,
            "home spelt through the firmlink"
        );
        assert_eq!(
            codesign_candidate(
                &format!("/System/Volumes/Data{}", file.to_string_lossy()),
                &home
            ),
            Some(PathBuf::from(format!(
                "/System/Volumes/Data{}",
                file.to_string_lossy()
            ))),
            "a plain file keeps its spelling"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_network_mount_is_never_a_candidate() {
        let rdonly = libc::MNT_RDONLY as u32;
        let nosuid = libc::MNT_NOSUID as u32;
        assert!(local_mount_flags(MNT_LOCAL));
        assert!(local_mount_flags(MNT_LOCAL | rdonly));
        assert!(
            !local_mount_flags(0),
            "a fake statfs with the local bit clear"
        );
        assert!(!local_mount_flags(rdonly | nosuid));
        assert!(is_local_mount(Path::new("/bin/ls")));
        assert!(!is_local_mount(Path::new("/nonexistent/talos")));
        assert_eq!(
            codesign_candidate("/bin/ls", Path::new("/Users/nobody")),
            Some(PathBuf::from("/bin/ls"))
        );
    }

    #[test]
    fn codesign_runs_are_capped_at_ten_per_cycle_and_unbound_counts_as_unsigned() {
        let home = tmp("cap");
        let mut programs = Vec::new();
        for i in 0..12 {
            let file = home.join(format!("p{i}"));
            std::fs::write(&file, b"x").unwrap();
            programs.push(Some(file.to_string_lossy().into_owned()));
        }
        programs.push(Some("bare".into()));
        programs.push(None);
        let runs = std::cell::Cell::new(0usize);
        let fake = |_: &Path| {
            runs.set(runs.get() + 1);
            Ok(Output {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: Some(0),
                truncated: false,
            })
        };
        let outcomes = verify_programs(&programs, &home, &fake);
        assert_eq!(runs.get(), CODESIGN_CAP);
        assert_eq!(
            outcomes
                .iter()
                .filter(|o| **o == Some(CodesignOutcome::Valid))
                .count(),
            10
        );
        assert_eq!(
            outcomes.iter().filter(|o| o.is_none()).count(),
            2,
            "beyond the cap stays unverified"
        );
        assert_eq!(
            outcomes
                .iter()
                .filter(|o| **o == Some(CodesignOutcome::Unbound))
                .count(),
            2
        );
        assert!(CodesignOutcome::Unbound.counts_as_unsigned());
        assert!(!CodesignOutcome::Valid.counts_as_unsigned());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn codesign_output_is_reduced_to_the_closed_enum() {
        let out = |code: i32, stderr: &str| {
            Ok::<Output, ExecError>(Output {
                stdout: String::new(),
                stderr: stderr.to_owned(),
                exit_code: Some(code),
                truncated: false,
            })
        };
        assert_eq!(classify_codesign(&out(0, "")), CodesignOutcome::Valid);
        assert_eq!(
            classify_codesign(&out(1, "/x: code object is not signed at all\n")),
            CodesignOutcome::Unsigned
        );
        assert_eq!(
            classify_codesign(&out(1, "/x: No such file or directory\n")),
            CodesignOutcome::Missing
        );
        assert_eq!(
            classify_codesign(&out(
                1,
                "/x: invalid signature (code or signature have been modified)\n"
            )),
            CodesignOutcome::Invalid
        );
        assert_eq!(
            classify_codesign(&Err(ExecError::Timeout(Bin::Codesign))),
            CodesignOutcome::Invalid
        );
    }

    #[test]
    fn codesign_runs_with_the_separator_on_a_real_binary() {
        let outcome = classify_codesign(&run_codesign(Path::new("/bin/ls")));
        assert_eq!(outcome, CodesignOutcome::Valid);
        let dir = tmp("unsigned");
        let file = dir.join("plain");
        std::fs::write(&file, b"#!/bin/sh\n").unwrap();
        assert_eq!(
            classify_codesign(&run_codesign(&file)),
            CodesignOutcome::Unsigned
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_own_agent_is_excluded_by_canonical_path() {
        let dir = tmp("own");
        let exe = dir.join("talos-desktop");
        std::fs::write(&exe, b"x").unwrap();
        let link = dir.join("link");
        symlink(&exe, &link).unwrap();
        let canon = exe.canonicalize().unwrap();
        assert!(is_own_agent(Some(&exe.to_string_lossy()), Some(&canon)));
        assert!(
            is_own_agent(Some(&link.to_string_lossy()), Some(&canon)),
            "a symlink to the exe is the exe"
        );
        assert!(!is_own_agent(Some("/bin/ls"), Some(&canon)));
        assert!(!is_own_agent(None, Some(&canon)));
        assert!(!is_own_agent(Some(&exe.to_string_lossy()), None));
        assert!(own_exe().is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_noise_hold_is_ten_minutes_either_way() {
        assert!(held("2026-10-17T12:00:00.000Z", "2026-10-17T12:09:59.000Z"));
        assert!(held("2026-10-17T12:10:00.000Z", "2026-10-17T12:00:00.000Z"));
        assert!(!held(
            "2026-10-17T12:00:00.000Z",
            "2026-10-17T12:10:01.000Z"
        ));
        assert!(!held("nope", "2026-10-17T12:10:01.000Z"));
        let expected = chrono::DateTime::parse_from_rfc3339("2026-10-17T12:00:00.000Z")
            .unwrap()
            .timestamp_millis();
        assert_eq!(parse_ms("2026-10-17T12:00:00.000Z"), Some(expected));
    }

    #[test]
    fn siblings_group_the_derived_signals() {
        assert_eq!(siblings(SignalId::PersistenceNew).len(), 6);
        assert_eq!(
            siblings(SignalId::ListenerSet),
            vec![SignalId::ListenerSet, SignalId::ListenerNewPorts]
        );
        assert_eq!(siblings(SignalId::Firewall), vec![SignalId::Firewall]);
        assert_eq!(
            pair_group(SignalId::PersistenceUnsigned),
            SignalId::PersistenceSet
        );
        assert_eq!(
            pair_group(SignalId::PersistenceInTempOrHidden),
            pair_group(SignalId::PersistenceNew)
        );
        assert_eq!(
            pair_group(SignalId::ListenerNewPorts),
            SignalId::ListenerSet
        );
        assert_eq!(pair_group(SignalId::DnsManual), SignalId::DnsManual);
        for id in DERIVED_COUNTS {
            assert!(siblings(id).len() > 1, "{id:?} comes from a listing");
        }
        for id in [
            SignalId::ShellStartupChanged,
            SignalId::SystemShellFilesCount,
            SignalId::PathsDChanged,
            SignalId::PathDirWritableCount,
        ] {
            assert_eq!(pair_group(id), SignalId::ShellStartupChanged, "{id:?}");
            assert_eq!(siblings(id).len(), 4);
        }
        for id in [
            SignalId::LaunchLabelMasquerade,
            SignalId::LaunchLabelMasqueradeUnsigned,
        ] {
            assert_eq!(pair_group(id), SignalId::PersistenceSet, "{id:?}");
            assert_eq!(siblings(id).len(), 6);
        }
        assert_eq!(
            siblings(SignalId::AppNewUnsigned),
            vec![
                SignalId::AppSet,
                SignalId::AppNewUnquarantined,
                SignalId::AppNewUnsigned
            ]
        );
        assert_eq!(pair_group(SignalId::AppNewUnsigned), SignalId::AppSet);
        assert_eq!(pair_group(SignalId::LoginHookSet), SignalId::LoginHookSet);
    }

    #[test]
    fn a_shared_budget_is_spent_by_launch_items_first() {
        let home = tmp("budget");
        let mut programs = Vec::new();
        for i in 0..4 {
            let file = home.join(format!("p{i}"));
            std::fs::write(&file, b"x").unwrap();
            programs.push(Some(file.to_string_lossy().into_owned()));
        }
        let fake = |_: &Path| {
            Ok(Output {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: Some(0),
                truncated: false,
            })
        };
        let mut budget = 3usize;
        let outcomes = verify_programs_within(&programs, &home, &fake, &mut budget);
        assert_eq!(budget, 0);
        assert_eq!(outcomes.iter().filter(|o| o.is_none()).count(), 1);
        let outcomes = verify_programs_within(&programs, &home, &fake, &mut budget);
        assert!(
            outcomes.iter().all(|o| o.is_none()),
            "nothing runs on an empty budget"
        );
        assert!(in_forbidden_folder(&home.join("Downloads/x"), &home));
        assert!(in_forbidden_folder(Path::new("/Volumes/Disk/x"), &home));
        assert!(!in_forbidden_folder(&home.join("bin/x"), &home));
        let _ = std::fs::remove_dir_all(&home);
    }
}
