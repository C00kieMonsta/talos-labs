//! Login items through System Events. Needs the Automation permission.

use std::sync::atomic::AtomicBool;

use crate::collect::{to_section, Fail};
use crate::exec::{self, Bin, OSASCRIPT_TIMEOUT};
use crate::state::{LoginItems, Section, UnavailableReason};

pub const SCRIPT: &str = "tell application \"System Events\" to get the name of every login item";

/// osascript prints the list comma-separated on one line; an empty list prints an empty line.
pub fn parse_login_items(stdout: &str) -> Vec<String> {
    let line = stdout.trim();
    if line.is_empty() {
        return Vec::new();
    }
    line.split(", ").map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned).collect()
}

fn inner(cancel: &AtomicBool) -> Result<LoginItems, Fail> {
    let out = exec::run(Bin::Osascript, &["-e", SCRIPT], OSASCRIPT_TIMEOUT, cancel)?;
    if !out.success() {
        if out.stderr.contains("-1743") {
            return Err(Fail::new(UnavailableReason::NeedsAutomationPermission, "osascript: -1743"));
        }
        return Err(Fail::collector("osascript: exit"));
    }
    let names = parse_login_items(&out.stdout);
    Ok(LoginItems { count: names.len() as u64, names })
}

pub fn collect(cancel: &AtomicBool) -> Section<LoginItems> {
    to_section(inner(cancel))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lists() {
        assert_eq!(parse_login_items("Docker, Raycast\n"), ["Docker", "Raycast"]);
        assert_eq!(parse_login_items("Docker\n"), ["Docker"]);
        assert!(parse_login_items("\n").is_empty());
        assert!(parse_login_items("").is_empty());
    }
}
