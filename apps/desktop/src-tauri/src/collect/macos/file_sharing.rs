//! Share points from `sharing -l` and File Sharing state from the 445 listener.

use super::remote_access::{non_loopback_port, shared_listeners};
use super::run;
use crate::collect::{to_section, Fail, Shared};
use crate::exec::Bin;
use crate::state::{FileSharing, Section, Share};

/// Keeps `path:` and `guest access:` only. The user-authored `name:` line is never collected.
pub fn parse_sharing(text: &str) -> Vec<Share> {
    let mut shares = Vec::new();
    let mut path: Option<String> = None;
    let mut guest = false;
    let flush = |path: &mut Option<String>, guest: &mut bool, shares: &mut Vec<Share>| {
        if let Some(p) = path.take() {
            shares.push(Share { path: p, guest_access: *guest });
        }
        *guest = false;
    };
    for line in text.lines() {
        if line.starts_with("name:") {
            flush(&mut path, &mut guest, &mut shares);
        } else if let Some(rest) = line.strip_prefix("path:") {
            path = Some(rest.trim().to_owned());
        } else if let Some(rest) = line.trim().strip_prefix("guest access:") {
            guest = rest.trim() == "1";
        }
    }
    flush(&mut path, &mut guest, &mut shares);
    shares
}

fn inner(shared: &Shared) -> Result<FileSharing, Fail> {
    let listeners = shared_listeners(shared)?;
    let enabled = non_loopback_port(listeners, &[445]).is_some();
    let out = run(Bin::Sharing, &["-l"], &shared.cancel)?;
    if !out.success() {
        return Err(Fail::collector("sharing: exit"));
    }
    Ok(FileSharing { enabled, shares: parse_sharing(&out.stdout) })
}

pub fn collect(shared: &Shared) -> Section<FileSharing> {
    to_section(inner(shared))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const CAPTURED: &str = include_str!("../../../tests/fixtures/sharing.txt");

    #[test]
    fn parses_captured_guest_share_without_name() {
        let shares = parse_sharing(CAPTURED);
        assert_eq!(shares, vec![Share { path: "/Users/antoine/Public".into(), guest_access: true }]);
        let json = serde_json::to_string(&shares).unwrap();
        assert!(!json.contains("Public Folder"), "the name line must not appear in the output");
    }

    #[test]
    fn guest_access_zero_and_two_shares() {
        let text = "List of Share Points\nname:\t\tFirst\npath:\t\t/Users/x/First\n\tsmb:\t{\n\t\tname:\tFirst\n\t\tshared:\t1\n\t\tguest access:\t0\n\t}\nname:\t\tSecond\npath:\t\t/Users/x/Second\n\tsmb:\t{\n\t\tguest access:\t1\n\t}\n";
        let shares = parse_sharing(text);
        assert_eq!(shares.len(), 2);
        assert_eq!(shares[0], Share { path: "/Users/x/First".into(), guest_access: false });
        assert_eq!(shares[1], Share { path: "/Users/x/Second".into(), guest_access: true });
    }

    #[test]
    fn no_share_points() {
        assert!(parse_sharing("\n\t\t\tList of Share Points\n").is_empty());
    }
}
