//! Login items through System Events. Needs the Automation permission.

use std::sync::atomic::AtomicBool;

use crate::collect::{to_section, Fail};
use crate::exec::{self, Bin, ExecError, OSASCRIPT_TIMEOUT};
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

/// The fixed script only stalls while the first-run Automation prompt is open, so the timeout names it.
/// The reason stays `timeout`: a permission card would be wrong when no decision was recorded.
pub fn map_exec(err: ExecError) -> Fail {
    match err {
        ExecError::Timeout(_) => Fail::new(UnavailableReason::Timeout, "osascript: no answer to the Automation prompt"),
        other => Fail::from(other),
    }
}

fn inner(cancel: &AtomicBool) -> Result<LoginItems, Fail> {
    let out = exec::run(Bin::Osascript, &["-e", SCRIPT], OSASCRIPT_TIMEOUT, cancel).map_err(map_exec)?;
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

    #[test]
    fn timeout_keeps_its_reason_and_names_the_prompt() {
        let fail = map_exec(ExecError::Timeout(Bin::Osascript));
        assert_eq!(fail.reason, UnavailableReason::Timeout);
        assert_eq!(fail.detail.as_deref(), Some("osascript: no answer to the Automation prompt"));
        assert_eq!(map_exec(ExecError::ToolMissing(Bin::Osascript)).reason, UnavailableReason::ToolMissing);
        assert!(OSASCRIPT_TIMEOUT < crate::collect::OVERALL_BUDGET);
    }
}
