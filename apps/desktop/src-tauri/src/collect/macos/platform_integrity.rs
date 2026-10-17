//! Gatekeeper from `spctl --status`, SIP from `csrutil status`, then the app bundle check and
//! the library inserts from `apps.rs`, each as a nested section.

use std::sync::atomic::AtomicBool;

use super::{apps, check_exit, run};
use crate::collect::{Fail, to_section};
use crate::exec::Bin;
use crate::state::{PlatformIntegrity, Section};

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

fn inner(cancel: &AtomicBool) -> Result<PlatformIntegrity, Fail> {
    let spctl = run(Bin::Spctl, &["--status"], cancel)?;
    check_exit(&spctl, Bin::Spctl)?;
    let exec_policy = parse_spctl(&format!("{}\n{}", spctl.stdout, spctl.stderr))?;
    let csrutil = run(Bin::Csrutil, &["status"], cancel)?;
    check_exit(&csrutil, Bin::Csrutil)?;
    let sip = parse_csrutil(&format!("{}\n{}", csrutil.stdout, csrutil.stderr))?;
    Ok(PlatformIntegrity {
        exec_policy_enabled: Some(exec_policy),
        system_protection_enabled: Some(sip),
        apps: apps::collect_apps(cancel),
        inserts: apps::collect_inserts(cancel),
    })
}

pub fn collect(cancel: &AtomicBool) -> Section<PlatformIntegrity> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

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
}
