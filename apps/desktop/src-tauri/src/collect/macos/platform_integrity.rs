//! Gatekeeper from `spctl --status` and SIP from `csrutil status`.

use std::sync::atomic::AtomicBool;

use super::run;
use crate::collect::{to_section, Fail};
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

pub fn parse_csrutil(text: &str) -> Result<bool, Fail> {
    let text = text.to_ascii_lowercase();
    if text.contains("status: enabled") {
        Ok(true)
    } else if text.contains("status: disabled") {
        Ok(false)
    } else {
        Err(Fail::parse("csrutil"))
    }
}

fn inner(cancel: &AtomicBool) -> Result<PlatformIntegrity, Fail> {
    let spctl = run(Bin::Spctl, &["--status"], cancel)?;
    let exec_policy = parse_spctl(&format!("{}\n{}", spctl.stdout, spctl.stderr))?;
    let csrutil = run(Bin::Csrutil, &["status"], cancel)?;
    let sip = parse_csrutil(&format!("{}\n{}", csrutil.stdout, csrutil.stderr))?;
    Ok(PlatformIntegrity { exec_policy_enabled: Some(exec_policy), system_protection_enabled: Some(sip) })
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
        assert!(parse_csrutil("System Integrity Protection status: unknown (Custom Configuration).\n").is_err());
    }
}
