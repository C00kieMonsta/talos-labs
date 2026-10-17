//! Gatekeeper from `spctl --status`, SIP from `csrutil status`, then the app bundle check and
//! the library inserts from `apps.rs`, each as a nested section. The app scan runs on the full
//! check-up only; a section recheck ("check again" on Gatekeeper, polled every 3 s by the show
//! step) carries the last check-up's `apps` and `inserts` through unchanged, so it never spends
//! a `codesign` run.

use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

use super::{apps, check_exit, run};
use crate::collect::{Fail, to_section};
use crate::exec::Bin;
use crate::state::{AppsCheck, LibraryInserts, PlatformIntegrity, Section, UnavailableReason};

/// Whether this read is the full check-up or one section's recheck.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// Lists the bundles, runs `codesign` within the budget, reads the inserts, and remembers both.
    FullCheck,
    /// Gatekeeper and SIP only; `apps` and `inserts` are the last full check-up's.
    Recheck,
}

/// The detail on a recheck that has no full check-up to carry from (the `talos-collect` binary).
pub const NOT_CARRIED: &str = "apps: no full check-up to carry";

/// The last full check-up's two nested sections, kept in the process for the next recheck.
#[derive(Debug, Default)]
pub struct Carried(Mutex<Option<(Section<AppsCheck>, Section<LibraryInserts>)>>);

impl Carried {
    pub const fn new() -> Self {
        Carried(Mutex::new(None))
    }

    fn remember(&self, apps: &Section<AppsCheck>, inserts: &Section<LibraryInserts>) {
        let mut slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        *slot = Some((apps.clone(), inserts.clone()));
    }

    fn take(&self) -> (Section<AppsCheck>, Section<LibraryInserts>) {
        let slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        slot.clone().unwrap_or_else(|| {
            (
                Section::unavailable(UnavailableReason::CollectorError, Some(NOT_CARRIED)),
                Section::unavailable(UnavailableReason::CollectorError, Some(NOT_CARRIED)),
            )
        })
    }
}

static CARRIED: Carried = Carried::new();

pub fn parse_spctl(text: &str) -> Result<bool, Fail> {
    let text = text.to_ascii_lowercase();
    if text.contains("assessments enabled") {
        Ok(true)
    } else if text.contains("assessments disabled") {
        Ok(false)
    } else {
        Err(Fail::parse("spctl"))
    }
}

/// `status: unknown (Custom Configuration)` is a partially disabled SIP; CIS 5.1.2 wants it fully enabled.
pub fn parse_csrutil(text: &str) -> Result<bool, Fail> {
    let text = text.to_ascii_lowercase();
    if text.contains("status: enabled") {
        Ok(true)
    } else if text.contains("status: disabled") || text.contains("status: unknown") {
        Ok(false)
    } else {
        Err(Fail::parse("csrutil"))
    }
}

/// The two nested sections for this scope: a fresh scan on the full check-up, the carried pair
/// on a recheck. The only place `apps::collect_apps` is called.
fn nested(
    cancel: &AtomicBool,
    scope: Scope,
    carried: &Carried,
) -> (Section<AppsCheck>, Section<LibraryInserts>) {
    match scope {
        Scope::FullCheck => {
            let apps = apps::collect_apps(cancel);
            let inserts = apps::collect_inserts(cancel);
            carried.remember(&apps, &inserts);
            (apps, inserts)
        }
        Scope::Recheck => carried.take(),
    }
}

fn inner(cancel: &AtomicBool, scope: Scope, carried: &Carried) -> Result<PlatformIntegrity, Fail> {
    let spctl = run(Bin::Spctl, &["--status"], cancel)?;
    check_exit(&spctl, Bin::Spctl)?;
    let exec_policy = parse_spctl(&format!("{}\n{}", spctl.stdout, spctl.stderr))?;
    let csrutil = run(Bin::Csrutil, &["status"], cancel)?;
    check_exit(&csrutil, Bin::Csrutil)?;
    let sip = parse_csrutil(&format!("{}\n{}", csrutil.stdout, csrutil.stderr))?;
    let (apps, inserts) = nested(cancel, scope, carried);
    Ok(PlatformIntegrity {
        exec_policy_enabled: Some(exec_policy),
        system_protection_enabled: Some(sip),
        apps,
        inserts,
    })
}

pub fn collect(cancel: &AtomicBool, scope: Scope) -> Section<PlatformIntegrity> {
    to_section(inner(cancel, scope, &CARRIED))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn parses_spctl() {
        assert!(parse_spctl("assessments enabled\n").unwrap());
        assert!(!parse_spctl("assessments disabled\n").unwrap());
        assert!(parse_spctl("").is_err());
    }

    #[test]
    fn parses_csrutil() {
        assert!(parse_csrutil("System Integrity Protection status: enabled.\n").unwrap());
        assert!(!parse_csrutil("System Integrity Protection status: disabled.\n").unwrap());
        let custom = "System Integrity Protection status: unknown (Custom Configuration).\n\nConfiguration:\n\tApple Internal: disabled\n\tKext Signing: enabled\n\tDebugging Restrictions: disabled\n";
        assert!(
            !parse_csrutil(custom).unwrap(),
            "a custom configuration is not fully enabled"
        );
        assert!(parse_csrutil("").is_err());
        assert!(parse_csrutil("csrutil: unrecognized command\n").is_err());
    }

    #[test]
    fn a_recheck_carries_the_last_full_check_up_and_never_scans() {
        let cancel = AtomicBool::new(false);
        let carried = Carried::new();
        // No full check-up yet: the recheck reads the two sections unavailable, with no scan.
        let started = Instant::now();
        let (apps, inserts) = nested(&cancel, Scope::Recheck, &carried);
        assert!(
            started.elapsed() < std::time::Duration::from_millis(500),
            "a recheck spends no codesign runs"
        );
        for section in [
            serde_json::to_value(&apps).unwrap(),
            serde_json::to_value(&inserts).unwrap(),
        ] {
            assert_eq!(section["status"], "unavailable");
            assert_eq!(section["reason"], "collector_error");
            assert_eq!(section["detail"], NOT_CARRIED);
        }
        // A seeded check-up is handed back as is, a cancelled one included.
        let scanned = Section::ok(AppsCheck {
            bundle_count: 3,
            checked_count: 2,
            flagged: Vec::new(),
        });
        let read = Section::ok(LibraryInserts {
            dyld_insert_set: false,
            login_hook_set: true,
            launchd_conf_present: false,
        });
        carried.remember(&scanned, &read);
        assert_eq!(
            nested(&cancel, Scope::Recheck, &carried),
            (scanned.clone(), read.clone())
        );
        assert_eq!(
            nested(&cancel, Scope::Recheck, &carried),
            (scanned, read),
            "carried through every recheck, not taken once"
        );
    }

    #[test]
    fn a_cancelled_full_check_remembers_its_unavailable_pair() {
        let cancel = AtomicBool::new(true);
        let carried = Carried::new();
        let (apps, inserts) = nested(&cancel, Scope::FullCheck, &carried);
        assert!(!apps.is_ok(), "a set cancel flag scans nothing");
        assert!(!inserts.is_ok());
        assert_eq!(
            nested(&cancel, Scope::Recheck, &carried),
            (apps, inserts),
            "the recheck carries whatever the last full check-up read"
        );
    }
}
