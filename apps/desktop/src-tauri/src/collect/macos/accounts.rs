//! Admin membership, guest account and automatic login.

use std::sync::atomic::AtomicBool;

use super::{check_exit, defaults, run};
use crate::collect::{to_section, Fail};
use crate::exec::Bin;
use crate::state::{Accounts, Section, Tri};

pub const LOGINWINDOW_DOMAIN: &str = "/Library/Preferences/com.apple.loginwindow";

/// Member names from `dscl . -read /Groups/admin GroupMembership`.
pub fn parse_group_membership(text: &str) -> Result<Vec<String>, Fail> {
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("GroupMembership:") {
            return Ok(rest.split_whitespace().map(str::to_owned).collect());
        }
    }
    Err(Fail::parse("dscl"))
}

/// (currentUserIsAdmin, humanAdminCount). The current user's name is compared and discarded.
pub fn summarise(members: &[String], current_user: &str) -> (bool, u64) {
    let current_user = current_user.trim();
    let is_admin = !current_user.is_empty() && members.iter().any(|m| m == current_user);
    let humans = members.iter().filter(|m| m.as_str() != "root" && !m.starts_with('_')).count();
    (is_admin, humans as u64)
}

/// (guestEnabled, autoLoginEnabled) from the loginwindow dump. The autoLoginUser value is never kept.
pub fn parse_login_window(dump: &str) -> (Tri, bool) {
    let map = defaults::parse_dump(dump);
    let guest = defaults::tri(&map, "GuestEnabled");
    let auto_login = map.get("autoLoginUser").is_some_and(|v| !v.trim().is_empty());
    (guest, auto_login)
}

fn inner(cancel: &AtomicBool) -> Result<Accounts, Fail> {
    let dscl = run(Bin::Dscl, &[".", "-read", "/Groups/admin", "GroupMembership"], cancel)?;
    check_exit(&dscl, Bin::Dscl)?;
    let members = parse_group_membership(&dscl.stdout)?;
    let whoami = run(Bin::Whoami, &[], cancel)?;
    check_exit(&whoami, Bin::Whoami)?;
    let (current_user_is_admin, human_admin_count) = summarise(&members, &whoami.stdout);
    let dump = defaults::read_domain(LOGINWINDOW_DOMAIN, "loginwindow", cancel)?.unwrap_or_default();
    let (guest_enabled, auto_login_enabled) = parse_login_window(&dump);
    Ok(Accounts { current_user_is_admin, human_admin_count, guest_enabled, auto_login_enabled })
}

pub fn collect(cancel: &AtomicBool) -> Section<Accounts> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parses_captured_membership() {
        let text = include_str!("../../../tests/fixtures/dscl-admin.txt");
        let members = parse_group_membership(text).unwrap();
        assert_eq!(members, ["root", "alice", "bob", "_mbsetupuser"]);
        assert_eq!(summarise(&members, "alice\n"), (true, 2));
        assert_eq!(summarise(&members, "sam"), (false, 2));
        assert_eq!(summarise(&members, ""), (false, 2));
    }

    #[test]
    fn rejects_output_without_membership() {
        assert!(parse_group_membership("No such key: GroupMembership\n").is_err());
    }

    #[test]
    fn login_window_values() {
        let dump = "{\n    GuestEnabled = 0;\n    lastUserName = someone;\n}\n";
        assert_eq!(parse_login_window(dump), (Tri::False, false));
        let dump = "{\n    GuestEnabled = 1;\n    autoLoginUser = someone;\n}\n";
        assert_eq!(parse_login_window(dump), (Tri::True, true));
        assert_eq!(parse_login_window(""), (Tri::Unset, false));
    }
}
