//! Admin membership, guest account and automatic login.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

use super::{check_exit, defaults, run};
use crate::collect::{Fail, to_section};
use crate::exec::{Bin, ExecError};
use crate::state::{Accounts, Section, Tri};

pub const LOGINWINDOW_DOMAIN: &str = "/Library/Preferences/com.apple.loginwindow";

/// macOS gives human accounts a UniqueID of 500 or more; system and service accounts sit below.
pub const FIRST_HUMAN_UID: i64 = 500;

/// Member names from `dscl . -read /Groups/admin GroupMembership`.
pub fn parse_group_membership(text: &str) -> Result<Vec<String>, Fail> {
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("GroupMembership:") {
            return Ok(rest.split_whitespace().map(str::to_owned).collect());
        }
    }
    Err(Fail::parse("dscl"))
}

/// name -> UniqueID from `dscl . -list /Users UniqueID`; one "name uid" pair per line. None when nothing parses.
pub fn parse_user_ids(text: &str) -> Option<HashMap<String, i64>> {
    let ids: HashMap<String, i64> = text
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let name = parts.next()?;
            let uid = parts.next()?.parse::<i64>().ok()?;
            Some((name.to_owned(), uid))
        })
        .collect();
    if ids.is_empty() { None } else { Some(ids) }
}

/// (currentUserIsAdmin, humanAdminCount). The current user's name is compared and discarded.
///
/// A member counts as a human admin when its name resolves to a user record with a UniqueID of
/// `FIRST_HUMAN_UID` or more. A deleted account leaves its name in the group with no record, so it is
/// dropped. Without the user listing the count falls back to excluding `root` and `_` service names.
pub fn summarise(
    members: &[String],
    current_user: &str,
    user_ids: Option<&HashMap<String, i64>>,
) -> (bool, u64) {
    let current_user = current_user.trim();
    let is_admin = !current_user.is_empty() && members.iter().any(|m| m == current_user);
    let humans = members
        .iter()
        .filter(|m| match user_ids {
            Some(ids) => ids
                .get(m.as_str())
                .is_some_and(|uid| *uid >= FIRST_HUMAN_UID),
            None => m.as_str() != "root" && !m.starts_with('_'),
        })
        .count();
    (is_admin, humans as u64)
}

/// (guestEnabled, autoLoginEnabled) from the loginwindow dump. The autoLoginUser value is never kept.
pub fn parse_login_window(dump: &str) -> (Tri, bool) {
    let map = defaults::parse_dump(dump);
    let guest = defaults::tri(&map, "GuestEnabled");
    let auto_login = map
        .get("autoLoginUser")
        .is_some_and(|v| !v.trim().is_empty());
    (guest, auto_login)
}

/// The user listing is a refinement; when it fails the section still reports with the name filter.
fn list_user_ids(cancel: &AtomicBool) -> Result<Option<HashMap<String, i64>>, Fail> {
    match run(Bin::Dscl, &[".", "-list", "/Users", "UniqueID"], cancel) {
        Ok(out) if out.success() => Ok(parse_user_ids(&out.stdout)),
        Ok(_) => Ok(None),
        Err(ExecError::Cancelled) => Err(Fail::from(ExecError::Cancelled)),
        Err(_) => Ok(None),
    }
}

fn inner(cancel: &AtomicBool) -> Result<Accounts, Fail> {
    let dscl = run(
        Bin::Dscl,
        &[".", "-read", "/Groups/admin", "GroupMembership"],
        cancel,
    )?;
    check_exit(&dscl, Bin::Dscl)?;
    let members = parse_group_membership(&dscl.stdout)?;
    let user_ids = list_user_ids(cancel)?;
    let whoami = run(Bin::Whoami, &[], cancel)?;
    check_exit(&whoami, Bin::Whoami)?;
    let (current_user_is_admin, human_admin_count) =
        summarise(&members, &whoami.stdout, user_ids.as_ref());
    let dump =
        defaults::read_domain(LOGINWINDOW_DOMAIN, "loginwindow", cancel)?.unwrap_or_default();
    let (guest_enabled, auto_login_enabled) = parse_login_window(&dump);
    Ok(Accounts {
        current_user_is_admin,
        human_admin_count,
        guest_enabled,
        auto_login_enabled,
    })
}

pub fn collect(cancel: &AtomicBool) -> Section<Accounts> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const USERS: &str = include_str!("../../../tests/fixtures/dscl-users-uniqueid.txt");

    #[test]
    fn parses_captured_membership() {
        let text = include_str!("../../../tests/fixtures/dscl-admin.txt");
        let members = parse_group_membership(text).unwrap();
        assert_eq!(members, ["root", "alice", "bob", "_mbsetupuser"]);
        assert_eq!(summarise(&members, "alice\n", None), (true, 2));
        assert_eq!(summarise(&members, "sam", None), (false, 2));
        assert_eq!(summarise(&members, "", None), (false, 2));
    }

    #[test]
    fn parses_user_listing_with_negative_and_service_ids() {
        let ids = parse_user_ids(USERS).unwrap();
        assert_eq!(ids.get("root"), Some(&0));
        assert_eq!(ids.get("alice"), Some(&501));
        assert_eq!(ids.get("_mbsetupuser"), Some(&248));
        assert_eq!(ids.get("nobody"), Some(&-2));
        assert_eq!(ids.get("com.example.helper.nobody"), Some(&1000));
        assert_eq!(ids.get("bob"), None);
        assert_eq!(parse_user_ids(""), None);
        assert_eq!(
            parse_user_ids("DS Error: -14009 (eDSUnknownNodeName)\n"),
            None
        );
    }

    #[test]
    fn a_deleted_admin_name_is_not_counted() {
        let members =
            parse_group_membership(include_str!("../../../tests/fixtures/dscl-admin.txt")).unwrap();
        let ids = parse_user_ids(USERS).unwrap();
        // bob has no user record; root and _mbsetupuser sit below 500.
        assert_eq!(summarise(&members, "alice\n", Some(&ids)), (true, 1));
        assert_eq!(
            summarise(&members, "bob", Some(&ids)),
            (true, 1),
            "the ghost name still matches whoami"
        );
        assert_eq!(summarise(&members, "sam", Some(&ids)), (false, 1));
    }

    #[test]
    fn a_second_human_admin_is_counted_when_it_resolves() {
        let members: Vec<String> = ["root", "alice", "carol", "_mbsetupuser"]
            .map(str::to_owned)
            .into();
        let ids = parse_user_ids(USERS).unwrap();
        assert_eq!(summarise(&members, "alice", Some(&ids)), (true, 2));
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
