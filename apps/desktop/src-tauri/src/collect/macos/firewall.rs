//! Application firewall state from `socketfilterfw`.

use std::sync::atomic::AtomicBool;

use super::run;
use crate::collect::{to_section, Fail};
use crate::exec::Bin;
use crate::state::{Firewall, Section};

/// Parses the three `--getglobalstate --getstealthmode --getblockall` lines.
pub fn parse_firewall(text: &str) -> Result<Firewall, Fail> {
    let mut enabled = None;
    let mut stealth = None;
    let mut block_all = None;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("Firewall is enabled") {
            enabled = Some(true);
        } else if line.starts_with("Firewall is disabled") {
            enabled = Some(false);
        } else if line.starts_with("Firewall stealth mode is on") {
            stealth = Some(true);
        } else if line.starts_with("Firewall stealth mode is off") {
            stealth = Some(false);
        } else if line.starts_with("Firewall has block all state set to enabled") {
            block_all = Some(true);
        } else if line.starts_with("Firewall has block all state set to disabled") {
            block_all = Some(false);
        }
    }
    let enabled = enabled.ok_or_else(|| Fail::parse("socketfilterfw"))?;
    Ok(Firewall { enabled, stealth_mode: stealth, block_all_incoming: block_all })
}

fn inner(cancel: &AtomicBool) -> Result<Firewall, Fail> {
    let out = run(Bin::Socketfilterfw, &["--getglobalstate", "--getstealthmode", "--getblockall"], cancel)?;
    parse_firewall(&out.stdout)
}

pub fn collect(cancel: &AtomicBool) -> Section<Firewall> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parses_captured_disabled_state() {
        let text = include_str!("../../../tests/fixtures/socketfilterfw.txt");
        let fw = parse_firewall(text).unwrap();
        assert_eq!(fw, Firewall { enabled: false, stealth_mode: Some(false), block_all_incoming: Some(false) });
    }

    #[test]
    fn parses_enabled_variants() {
        let fw = parse_firewall("Firewall is enabled. (State = 1)\nFirewall stealth mode is on\nFirewall has block all state set to disabled.\n").unwrap();
        assert_eq!(fw, Firewall { enabled: true, stealth_mode: Some(true), block_all_incoming: Some(false) });
        let fw = parse_firewall("Firewall is enabled. (State = 2)\nFirewall stealth mode is on\nFirewall has block all state set to enabled.\n").unwrap();
        assert_eq!(fw, Firewall { enabled: true, stealth_mode: Some(true), block_all_incoming: Some(true) });
    }

    #[test]
    fn global_state_alone_gives_nulls() {
        let text = include_str!("../../../tests/fixtures/socketfilterfw-globalstate.txt");
        let fw = parse_firewall(text).unwrap();
        assert_eq!(fw, Firewall { enabled: false, stealth_mode: None, block_all_incoming: None });
    }

    #[test]
    fn rejects_missing_state_line() {
        assert!(parse_firewall("Firewall stealth mode is on\n").is_err());
    }
}
