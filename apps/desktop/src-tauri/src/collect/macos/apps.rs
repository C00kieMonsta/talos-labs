//! App bundles under `/Applications` and `~/Applications`, and the library inserts: the one
//! place for the apps probe, the check-up rule TL-MAC-035, TL-MAC-036 and the reveal binder.
//! No bytes of any file are read here: a directory listing, `stat`, `listxattr(2)` (attribute
//! names only, never a value), `defaults read`, `launchctl getenv` and `codesign` on a bundle,
//! which hashes it on the app's behalf. Bundle paths and names stay in the values the callers
//! digest, count or show in Details; they never reach a `WatchSignal`.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use super::{check_cancel, check_exit, defaults, home, is_not_found, run};
use crate::collect::{Fail, to_section};
use crate::exec::{self, Bin, ExecError, Output};
use crate::state::{AppsCheck, FlaggedBundle, LibraryInserts, Section, SignatureWord};
use crate::watch::signals::{
    CODESIGN_TIMEOUT, CodesignOutcome, classify_codesign, in_forbidden_folder, is_local_mount,
    normalise,
};

/// Bundles looked at by the check-up, in name order.
pub const CHECKUP_BUNDLE_CAP: usize = 60;
/// The check-up's wall budget for `codesign`; bundles past it stay unchecked.
pub const CHECKUP_CODESIGN_BUDGET: Duration = Duration::from_secs(15);
const SYSTEM_APPLICATIONS: &str = "/Applications";
const USER_APPLICATIONS: &str = "Applications";
const QUARANTINE_ATTR: &[u8] = b"com.apple.quarantine";
const LAUNCHD_CONF: &str = "/etc/launchd.conf";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleEntry {
    pub path: PathBuf,
    /// The `.app` name, the member key of the apps digest.
    pub name: String,
    pub mtime: i64,
}

/// A bundle is a codesign candidate only when it is absolute, canonicalises to itself, is a
/// directory named `*.app` directly under `/Applications` or `~/Applications`, is not under a
/// prompting folder or a mount root, and sits on a local filesystem. A symlink (Safari's), a
/// file, a path under `~/Downloads` or a nested bundle is refused.
pub fn bundle_candidate(path: &Path, home: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let canonical = path.canonicalize().ok()?;
    if canonical != path {
        return None;
    }
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_dir() {
        return None;
    }
    let name = path.file_name()?.to_str()?;
    if !name.ends_with(".app") || name == ".app" {
        return None;
    }
    let parent = normalise(path.parent()?);
    let allowed = [
        PathBuf::from(SYSTEM_APPLICATIONS),
        normalise(home).join(USER_APPLICATIONS),
    ];
    if !allowed.contains(&parent) {
        return None;
    }
    if in_forbidden_folder(&canonical, home) {
        return None;
    }
    if !is_local_mount(&canonical) {
        return None;
    }
    Some(canonical)
}

fn entries_of(dir: &Path, label: &str) -> Result<Vec<PathBuf>, Fail> {
    match std::fs::read_dir(dir) {
        Ok(entries) => Ok(entries.flatten().map(|e| e.path()).collect()),
        Err(err) if is_not_found(&err) => Ok(Vec::new()),
        Err(err) => Err(Fail::io(&err, &format!("read_dir: {label}"))),
    }
}

/// Every bundle directly under the two folders, sorted by name; a missing folder is empty.
pub fn list_bundles(home: &Path) -> Result<Vec<BundleEntry>, Fail> {
    use std::os::unix::fs::MetadataExt;
    let mut out = Vec::new();
    let folders = [
        (PathBuf::from(SYSTEM_APPLICATIONS), "Applications"),
        (home.join(USER_APPLICATIONS), "user Applications"),
    ];
    for (dir, label) in folders {
        for path in entries_of(&dir, label)? {
            let Some(canonical) = bundle_candidate(&path, home) else {
                continue;
            };
            let name = canonical
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let mtime = std::fs::metadata(&canonical)
                .map(|m| m.mtime())
                .unwrap_or(0);
            out.push(BundleEntry {
                path: canonical,
                name,
                mtime,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));
    Ok(out)
}

/// Whether the bundle folder carries `com.apple.quarantine`, from the attribute names alone;
/// None when the listing fails.
pub fn quarantined(path: &Path) -> Option<bool> {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: a NUL-terminated path, a null buffer and size 0 ask for the needed size only.
    let size = unsafe {
        libc::listxattr(
            c_path.as_ptr(),
            std::ptr::null_mut(),
            0,
            libc::XATTR_NOFOLLOW,
        )
    };
    if size < 0 {
        return None;
    }
    if size == 0 {
        return Some(false);
    }
    let mut names = vec![0u8; size as usize];
    // SAFETY: the buffer is exactly the size the first call reported; the kernel writes at most that many bytes.
    let got = unsafe {
        libc::listxattr(
            c_path.as_ptr(),
            names.as_mut_ptr().cast::<libc::c_char>(),
            names.len(),
            libc::XATTR_NOFOLLOW,
        )
    };
    if got < 0 {
        return None;
    }
    names.truncate(got as usize);
    Some(names.split(|b| *b == 0).any(|name| name == QUARANTINE_ATTR))
}

/// What a `codesign -dvv` listing says about a bundle that verified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignatureKind {
    Apple,
    AppStore,
    DeveloperId,
    Adhoc,
}

/// Reads the `-dvv` listing (on stderr): the leaf `Authority=` line names the signer, and an
/// ad-hoc signature has none. The text never leaves this function.
pub fn parse_signature(stderr: &str) -> Option<SignatureKind> {
    let mut adhoc = false;
    for line in stderr.lines().map(str::trim) {
        if let Some(authority) = line.strip_prefix("Authority=") {
            if authority.contains("Software Signing") {
                return Some(SignatureKind::Apple);
            }
            if authority == "Apple Mac OS Application Signing" {
                return Some(SignatureKind::AppStore);
            }
            if authority.starts_with("Developer ID Application:") {
                return Some(SignatureKind::DeveloperId);
            }
        }
        if line == "Signature=adhoc" {
            adhoc = true;
        }
    }
    adhoc.then_some(SignatureKind::Adhoc)
}

/// The closed word for a bundle: the kind when it verified and the listing named one, else
/// `invalid`; `unsigned` when `--verify` said so; `invalid` for anything that did not verify.
pub fn signature_word(outcome: CodesignOutcome, kind: Option<SignatureKind>) -> SignatureWord {
    match (outcome, kind) {
        (CodesignOutcome::Valid, Some(SignatureKind::Apple)) => SignatureWord::Apple,
        (CodesignOutcome::Valid, Some(SignatureKind::AppStore)) => SignatureWord::AppStore,
        (CodesignOutcome::Valid, Some(SignatureKind::DeveloperId)) => SignatureWord::DeveloperId,
        (CodesignOutcome::Valid, Some(SignatureKind::Adhoc)) => SignatureWord::Adhoc,
        (CodesignOutcome::Valid, None) => SignatureWord::Invalid,
        (CodesignOutcome::Unsigned, _) => SignatureWord::Unsigned,
        (CodesignOutcome::Invalid | CodesignOutcome::Missing | CodesignOutcome::Unbound, _) => {
            SignatureWord::Invalid
        }
    }
}

/// The two fixed argument lists `codesign` is run with on a bundle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodesignArgs {
    /// `--verify --strict -- <bundle>`
    Verify,
    /// `-dvv -- <bundle>`, on a bundle that verified only
    Dvv,
}

pub type CodesignRunner<'a> = dyn Fn(&Path, CodesignArgs) -> Result<Output, ExecError> + 'a;

/// Runs `codesign` on a bundle with one of the two fixed argument lists, honouring `cancel`.
pub fn run_codesign(
    path: &Path,
    args: CodesignArgs,
    cancel: &AtomicBool,
) -> Result<Output, ExecError> {
    let text = path.to_string_lossy();
    match args {
        CodesignArgs::Verify => exec::run(
            Bin::Codesign,
            &["--verify", "--strict", "--", text.as_ref()],
            CODESIGN_TIMEOUT,
            cancel,
        ),
        CodesignArgs::Dvv => exec::run(
            Bin::Codesign,
            &["-dvv", "--", text.as_ref()],
            CODESIGN_TIMEOUT,
            cancel,
        ),
    }
}

/// A runner bound to a cancel flag: the check-up passes the collector's, the watch a fresh one.
pub fn codesign_runner(
    cancel: &AtomicBool,
) -> impl Fn(&Path, CodesignArgs) -> Result<Output, ExecError> + '_ {
    move |path, args| run_codesign(path, args, cancel)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppCheck {
    /// None when `listxattr` failed.
    pub quarantined: Option<bool>,
    /// None when no `codesign` run was left for it (budget, deadline or cancel).
    pub signature: Option<SignatureWord>,
}

fn past(deadline: Option<Instant>) -> bool {
    deadline.is_some_and(|d| Instant::now() >= d)
}

/// `--verify --strict`, then `-dvv` on `Valid`; both runs decrement the budget. No run starts
/// past the deadline or on an empty budget, and a cancelled run empties the budget.
fn check_signature(
    path: &Path,
    budget: &mut usize,
    deadline: Option<Instant>,
    run: &CodesignRunner<'_>,
) -> Option<SignatureWord> {
    if *budget == 0 || past(deadline) {
        return None;
    }
    *budget -= 1;
    let verify = run(path, CodesignArgs::Verify);
    if matches!(verify, Err(ExecError::Cancelled)) {
        *budget = 0;
        return None;
    }
    let outcome = classify_codesign(&verify);
    if outcome != CodesignOutcome::Valid {
        return Some(signature_word(outcome, None));
    }
    if *budget == 0 || past(deadline) {
        return None;
    }
    *budget -= 1;
    match run(path, CodesignArgs::Dvv) {
        Ok(out) => Some(signature_word(outcome, parse_signature(&out.stderr))),
        Err(ExecError::Cancelled) => {
            *budget = 0;
            None
        }
        Err(_) => None,
    }
}

/// `listxattr` first, then the signature within the budget and the deadline. The path is
/// re-bound through `bundle_candidate` right before its `codesign` runs: a bundle swapped for a
/// symlink since the listing is left unchecked, and spends nothing.
pub fn check_bundles(
    paths: &[PathBuf],
    home: &Path,
    budget: &mut usize,
    deadline: Option<Instant>,
    run: &CodesignRunner<'_>,
) -> Vec<AppCheck> {
    paths
        .iter()
        .map(|path| AppCheck {
            quarantined: quarantined(path),
            signature: if bundle_candidate(path, home).as_deref() == Some(path.as_path()) {
                check_signature(path, budget, deadline, run)
            } else {
                None
            },
        })
        .collect()
}

/// A bundle Gatekeeper never saw that is `adhoc` or `unsigned`.
pub fn flagged(check: &AppCheck) -> bool {
    matches!(
        check.signature,
        Some(SignatureWord::Adhoc | SignatureWord::Unsigned)
    ) && check.quarantined == Some(false)
}

fn apps_inner(cancel: &AtomicBool) -> Result<AppsCheck, Fail> {
    check_cancel(cancel)?;
    let home = home()?;
    let bundles = list_bundles(&home)?;
    let bundle_count = bundles.len() as u64;
    let looked: Vec<&BundleEntry> = bundles.iter().take(CHECKUP_BUNDLE_CAP).collect();
    let paths: Vec<PathBuf> = looked.iter().map(|b| b.path.clone()).collect();
    let mut budget = CHECKUP_BUNDLE_CAP * 2;
    let deadline = Some(Instant::now() + CHECKUP_CODESIGN_BUDGET);
    let run = codesign_runner(cancel);
    let checks = check_bundles(&paths, &home, &mut budget, deadline, &run);
    let checked_count = checks.iter().filter(|c| c.signature.is_some()).count() as u64;
    let flagged_bundles = looked
        .iter()
        .zip(&checks)
        .filter(|(_, check)| flagged(check))
        .filter_map(|(bundle, check)| {
            Some(FlaggedBundle {
                path: bundle.path.to_string_lossy().into_owned(),
                name: bundle.name.clone(),
                signature: check.signature?,
                quarantined: check.quarantined.unwrap_or(false),
            })
        })
        .collect();
    Ok(AppsCheck {
        bundle_count,
        checked_count,
        flagged: flagged_bundles,
    })
}

/// The check-up's app scan: at most `CHECKUP_BUNDLE_CAP` bundles, 120 runs and 15 s of
/// `codesign`; the section is ok even when unchecked bundles remain.
pub fn collect_apps(cancel: &AtomicBool) -> Section<AppsCheck> {
    to_section(apps_inner(cancel))
}

/// The running session's insert variable, the three login hook keys and the legacy file.
pub fn read_inserts(cancel: &AtomicBool) -> Result<LibraryInserts, Fail> {
    check_cancel(cancel)?;
    let dyld = run(Bin::Launchctl, &["getenv", "DYLD_INSERT_LIBRARIES"], cancel)?;
    check_exit(&dyld, Bin::Launchctl)?;
    let dyld_insert_set = !dyld.stdout.trim().is_empty();
    let hooks = [
        ("/Library/Preferences/com.apple.loginwindow", "LoginHook"),
        ("/Library/Preferences/com.apple.loginwindow", "LogoutHook"),
        ("com.apple.loginwindow", "LoginHook"),
    ];
    let mut login_hook_set = false;
    for (domain, key) in hooks {
        let value = defaults::read_key(domain, key, "loginwindow hook", cancel)?;
        login_hook_set |= value.is_some_and(|v| !v.trim().is_empty());
    }
    Ok(LibraryInserts {
        dyld_insert_set,
        login_hook_set,
        launchd_conf_present: Path::new(LAUNCHD_CONF).exists(),
    })
}

pub fn collect_inserts(cancel: &AtomicBool) -> Section<LibraryInserts> {
    to_section(read_inserts(cancel))
}

/// Every bundle path of a fresh listing, for the 035 reveal binder.
pub fn fresh_bundles() -> Vec<String> {
    home()
        .ok()
        .and_then(|home| list_bundles(&home).ok())
        .map(|bundles| {
            bundles
                .into_iter()
                .map(|b| b.path.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::sync::atomic::Ordering;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures")
                .join(name),
        )
        .unwrap()
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("talos-apps-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn out(code: i32, stderr: &str) -> Result<Output, ExecError> {
        Ok(Output {
            stdout: String::new(),
            stderr: stderr.to_owned(),
            exit_code: Some(code),
            truncated: false,
        })
    }

    #[test]
    fn parse_signature_reads_the_four_dvv_fixtures() {
        assert_eq!(
            parse_signature(&fixture("codesign-dvv-adhoc.txt")),
            Some(SignatureKind::Adhoc)
        );
        assert_eq!(
            parse_signature(&fixture("codesign-dvv-app-store.txt")),
            Some(SignatureKind::AppStore)
        );
        assert_eq!(
            parse_signature(&fixture("codesign-dvv-developer-id.txt")),
            Some(SignatureKind::DeveloperId)
        );
        assert_eq!(
            parse_signature(&fixture("codesign-dvv-apple.txt")),
            Some(SignatureKind::Apple)
        );
        assert_eq!(parse_signature(""), None);
        assert_eq!(
            parse_signature("Authority=Apple Root CA\n"),
            None,
            "a root alone names no signer"
        );
        assert_eq!(
            parse_signature("Authority=Developer ID Certification Authority\n"),
            None
        );
        assert_eq!(
            classify_codesign(&out(1, "/x: code object is not signed at all\n")),
            CodesignOutcome::Unsigned
        );
    }

    #[test]
    fn signature_words_follow_the_outcome_then_the_kind() {
        assert_eq!(
            signature_word(CodesignOutcome::Valid, Some(SignatureKind::Apple)),
            SignatureWord::Apple
        );
        assert_eq!(
            signature_word(CodesignOutcome::Valid, Some(SignatureKind::AppStore)),
            SignatureWord::AppStore
        );
        assert_eq!(
            signature_word(CodesignOutcome::Valid, Some(SignatureKind::DeveloperId)),
            SignatureWord::DeveloperId
        );
        assert_eq!(
            signature_word(CodesignOutcome::Valid, Some(SignatureKind::Adhoc)),
            SignatureWord::Adhoc
        );
        assert_eq!(
            signature_word(CodesignOutcome::Valid, None),
            SignatureWord::Invalid
        );
        assert_eq!(
            signature_word(CodesignOutcome::Unsigned, None),
            SignatureWord::Unsigned
        );
        for outcome in [
            CodesignOutcome::Invalid,
            CodesignOutcome::Missing,
            CodesignOutcome::Unbound,
        ] {
            assert_eq!(
                signature_word(outcome, Some(SignatureKind::Apple)),
                SignatureWord::Invalid
            );
        }
    }

    #[test]
    fn flagged_is_adhoc_or_unsigned_with_no_quarantine_flag() {
        let check = |signature: Option<SignatureWord>, quarantined: Option<bool>| AppCheck {
            quarantined,
            signature,
        };
        assert!(flagged(&check(Some(SignatureWord::Unsigned), Some(false))));
        assert!(flagged(&check(Some(SignatureWord::Adhoc), Some(false))));
        assert!(!flagged(&check(Some(SignatureWord::Unsigned), Some(true))));
        assert!(!flagged(&check(Some(SignatureWord::Unsigned), None)));
        assert!(!flagged(&check(Some(SignatureWord::Invalid), Some(false))));
        assert!(!flagged(&check(
            Some(SignatureWord::DeveloperId),
            Some(false)
        )));
        assert!(!flagged(&check(Some(SignatureWord::AppStore), Some(false))));
        assert!(!flagged(&check(Some(SignatureWord::Apple), Some(false))));
        assert!(!flagged(&check(None, Some(false))));
    }

    #[test]
    fn the_binder_refuses_symlinks_files_downloads_and_nested_bundles() {
        let home = tmp("binder");
        let apps = home.join("Applications");
        std::fs::create_dir_all(&apps).unwrap();
        let good = apps.join("Good.app");
        std::fs::create_dir_all(good.join("Contents/MacOS")).unwrap();
        let nested = good.join("Contents/Helpers/Nested.app");
        std::fs::create_dir_all(&nested).unwrap();
        let link = apps.join("Link.app");
        symlink(&good, &link).unwrap();
        let file = apps.join("File.app");
        std::fs::write(&file, b"x").unwrap();
        let plain = apps.join("Plain");
        std::fs::create_dir_all(&plain).unwrap();
        let downloads = home.join("Downloads/Dl.app");
        std::fs::create_dir_all(&downloads).unwrap();
        let elsewhere = home.join("Elsewhere/Other.app");
        std::fs::create_dir_all(&elsewhere).unwrap();

        assert_eq!(bundle_candidate(&good, &home), Some(good.clone()));
        assert_eq!(bundle_candidate(&link, &home), None, "symlink");
        assert_eq!(bundle_candidate(&file, &home), None, "a file");
        assert_eq!(bundle_candidate(&plain, &home), None, "not .app");
        assert_eq!(bundle_candidate(&nested, &home), None, "nested bundle");
        assert_eq!(bundle_candidate(&downloads, &home), None, "~/Downloads");
        assert_eq!(
            bundle_candidate(&elsewhere, &home),
            None,
            "not an Applications folder"
        );
        assert_eq!(
            bundle_candidate(Path::new("Good.app"), &home),
            None,
            "relative"
        );
        assert_eq!(
            bundle_candidate(Path::new("/Applications/Nonexistent-Talos.app"), &home),
            None
        );
        assert_eq!(
            bundle_candidate(Path::new("/Applications/Safari.app"), &home),
            None,
            "Safari's symlink into the cryptex is refused"
        );

        let listed = list_bundles(&home).unwrap();
        let names: Vec<&str> = listed
            .iter()
            .filter(|b| b.path.starts_with(&home))
            .map(|b| b.name.as_str())
            .collect();
        assert_eq!(names, ["Good.app"]);
        let good_entry = listed.iter().find(|b| b.name == "Good.app").unwrap();
        assert!(good_entry.mtime > 0);
        let mut sorted = listed.iter().map(|b| b.name.clone()).collect::<Vec<_>>();
        sorted.sort();
        assert_eq!(
            listed.iter().map(|b| b.name.clone()).collect::<Vec<_>>(),
            sorted,
            "sorted by name"
        );
        let no_user_apps = tmp("binder-empty");
        let only_system = list_bundles(&no_user_apps).unwrap();
        assert!(
            only_system
                .iter()
                .all(|b| b.path.starts_with("/Applications")),
            "a missing ~/Applications is empty"
        );
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&no_user_apps);
    }

    #[test]
    fn quarantine_is_read_from_attribute_names_only() {
        use std::os::unix::ffi::OsStrExt;
        let dir = tmp("xattr");
        let clean = dir.join("Clean.app");
        std::fs::create_dir_all(&clean).unwrap();
        assert_eq!(quarantined(&clean), Some(false));
        assert_eq!(quarantined(Path::new("/nonexistent/talos/x.app")), None);
        let flagged_dir = dir.join("Flagged.app");
        std::fs::create_dir_all(&flagged_dir).unwrap();
        let c_path = std::ffi::CString::new(flagged_dir.as_os_str().as_bytes()).unwrap();
        let name = std::ffi::CString::new("com.apple.quarantine").unwrap();
        let value = b"0083;00000000;Talos;";
        // SAFETY: NUL-terminated path and name, a value buffer of the given length, on a temp dir we own.
        let rc = unsafe {
            libc::setxattr(
                c_path.as_ptr(),
                name.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
                0,
            )
        };
        if rc == 0 {
            assert_eq!(quarantined(&flagged_dir), Some(true));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn check_bundles_stops_at_the_budget_and_the_deadline_and_on_cancel() {
        let home = tmp("budget");
        let dir = home.join("Applications");
        let paths: Vec<PathBuf> = (0..4)
            .map(|i| {
                let p = dir.join(format!("A{i}.app"));
                std::fs::create_dir_all(&p).unwrap();
                p
            })
            .collect();
        let runs = std::cell::Cell::new(0usize);
        let valid_developer = |_: &Path, args: CodesignArgs| {
            runs.set(runs.get() + 1);
            match args {
                CodesignArgs::Verify => out(0, ""),
                CodesignArgs::Dvv => out(0, &fixture("codesign-dvv-developer-id.txt")),
            }
        };
        let mut budget = 5usize;
        let checks = check_bundles(&paths, &home, &mut budget, None, &valid_developer);
        assert_eq!(runs.get(), 5, "two runs per valid bundle until the budget");
        assert_eq!(budget, 0);
        assert_eq!(checks[0].signature, Some(SignatureWord::DeveloperId));
        assert_eq!(checks[1].signature, Some(SignatureWord::DeveloperId));
        assert_eq!(
            checks[2].signature, None,
            "a verify with no -dvv left is unchecked"
        );
        assert_eq!(checks[3].signature, None);
        assert!(checks.iter().all(|c| c.quarantined == Some(false)));

        let unsigned = |_: &Path, args: CodesignArgs| match args {
            CodesignArgs::Verify => out(1, "/x: code object is not signed at all\n"),
            CodesignArgs::Dvv => panic!("never -dvv on an unsigned bundle"),
        };
        let mut budget = 10usize;
        let checks = check_bundles(&paths, &home, &mut budget, None, &unsigned);
        assert_eq!(budget, 6, "one run per unsigned bundle");
        assert!(
            checks
                .iter()
                .all(|c| c.signature == Some(SignatureWord::Unsigned))
        );
        assert!(checks.iter().all(flagged));

        let invalid = |_: &Path, _: CodesignArgs| out(1, "/x: invalid signature\n");
        let mut budget = 10usize;
        let checks = check_bundles(&paths, &home, &mut budget, None, &invalid);
        assert!(
            checks
                .iter()
                .all(|c| c.signature == Some(SignatureWord::Invalid))
        );
        assert!(checks.iter().all(|c| !flagged(c)));

        let sleepy = |_: &Path, args: CodesignArgs| {
            std::thread::sleep(Duration::from_millis(60));
            match args {
                CodesignArgs::Verify => out(0, ""),
                CodesignArgs::Dvv => out(0, &fixture("codesign-dvv-app-store.txt")),
            }
        };
        let mut budget = 100usize;
        let deadline = Some(Instant::now() + Duration::from_millis(50));
        let checks = check_bundles(&paths, &home, &mut budget, deadline, &sleepy);
        assert_eq!(
            checks[0].signature, None,
            "the deadline passed during the first verify, so no -dvv"
        );
        assert!(
            checks.iter().skip(1).all(|c| c.signature.is_none()),
            "past the deadline no codesign runs"
        );
        assert_eq!(budget, 99);

        let cancel = AtomicBool::new(false);
        let runs = std::cell::Cell::new(0usize);
        let cancelling = |_: &Path, _: CodesignArgs| {
            runs.set(runs.get() + 1);
            cancel.store(true, Ordering::SeqCst);
            Err(ExecError::Cancelled)
        };
        let mut budget = 100usize;
        let checks = check_bundles(&paths, &home, &mut budget, None, &cancelling);
        assert_eq!(runs.get(), 1, "a cancelled runner stops");
        assert_eq!(budget, 0);
        assert!(checks.iter().all(|c| c.signature.is_none()));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_bundle_swapped_for_a_symlink_after_the_listing_is_left_unchecked() {
        let home = tmp("swap");
        let apps = home.join("Applications");
        let real = apps.join("Real.app");
        let kept = apps.join("Kept.app");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::create_dir_all(&kept).unwrap();
        let paths: Vec<PathBuf> = list_bundles(&home)
            .unwrap()
            .into_iter()
            .map(|b| b.path)
            .filter(|p| p.starts_with(&home))
            .collect();
        assert_eq!(paths, vec![kept.clone(), real.clone()]);
        // Between the listing and the check, Real.app becomes a link to a folder under ~/Documents.
        let target = home.join("Documents/Target.app");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::remove_dir_all(&real).unwrap();
        symlink(&target, &real).unwrap();
        let seen = std::cell::RefCell::new(Vec::<PathBuf>::new());
        let runner = |path: &Path, _: CodesignArgs| {
            seen.borrow_mut().push(path.to_path_buf());
            out(1, "/x: code object is not signed at all\n")
        };
        let mut budget = 10usize;
        let checks = check_bundles(&paths, &home, &mut budget, None, &runner);
        assert_eq!(
            checks[0].signature,
            Some(SignatureWord::Unsigned),
            "Kept.app is checked"
        );
        assert_eq!(
            checks[1].signature, None,
            "the swapped path runs no codesign"
        );
        assert_eq!(seen.borrow().as_slice(), std::slice::from_ref(&kept));
        assert_eq!(budget, 9, "the swapped path spends nothing");
        // A path that is gone is unchecked too.
        std::fs::remove_file(&real).unwrap();
        let mut budget = 10usize;
        let checks = check_bundles(&paths, &home, &mut budget, None, &runner);
        assert_eq!(checks[1].signature, None);
        assert_eq!(budget, 9);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_real_runner_reads_a_system_binary_and_an_unsigned_file() {
        let cancel = AtomicBool::new(false);
        let run = codesign_runner(&cancel);
        let verify = run(Path::new("/bin/ls"), CodesignArgs::Verify);
        assert_eq!(classify_codesign(&verify), CodesignOutcome::Valid);
        let dvv = run(Path::new("/bin/ls"), CodesignArgs::Dvv).unwrap();
        assert_eq!(parse_signature(&dvv.stderr), Some(SignatureKind::Apple));
        let dir = tmp("real");
        let file = dir.join("plain");
        std::fs::write(&file, b"#!/bin/sh\n").unwrap();
        assert_eq!(
            classify_codesign(&run(&file, CodesignArgs::Verify)),
            CodesignOutcome::Unsigned
        );
        cancel.store(true, Ordering::SeqCst);
        assert!(matches!(
            run(Path::new("/bin/ls"), CodesignArgs::Verify),
            Err(ExecError::Cancelled)
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_check_up_scan_stays_ok_with_a_sleeping_runner() {
        let home = tmp("checkup");
        let dir = home.join("Applications");
        let paths: Vec<PathBuf> = (0..3)
            .map(|i| {
                let p = dir.join(format!("B{i}.app"));
                std::fs::create_dir_all(&p).unwrap();
                p
            })
            .collect();
        let sleepy = |_: &Path, _: CodesignArgs| {
            std::thread::sleep(Duration::from_millis(40));
            out(0, "")
        };
        let mut budget = CHECKUP_BUNDLE_CAP * 2;
        let deadline = Some(Instant::now() + Duration::from_millis(10));
        let checks = check_bundles(&paths, &home, &mut budget, deadline, &sleepy);
        let checked = checks.iter().filter(|c| c.signature.is_some()).count();
        assert_eq!(checked, 0, "later bundles stay unchecked");
        assert_eq!(checks.len(), paths.len(), "every bundle keeps its row");
        assert_eq!(CHECKUP_CODESIGN_BUDGET, Duration::from_secs(15));
        assert_eq!(CHECKUP_BUNDLE_CAP, 60);
        let _ = std::fs::remove_dir_all(&home);
    }
}
