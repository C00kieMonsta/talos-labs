//! TCP listeners from `netstat -anv -p tcp`.

use std::sync::LazyLock;
use std::sync::atomic::AtomicBool;

use regex::Regex;

use super::{lit, run};
use crate::collect::{Fail, to_section};
use crate::exec::Bin;
use crate::state::{Listener, ListenerBind, Listeners, Protocol, Section, UnavailableReason};

static PID_TOKEN_RE: LazyLock<Regex> = LazyLock::new(|| lit(r":\d+$"));

/// Any 127/8 address counts as loopback, including the IPv4-mapped form netstat prints for tcp46 sockets.
pub fn classify_bind(host: &str) -> ListenerBind {
    if host == "*" {
        ListenerBind::All
    } else if host == "::1" || host.starts_with("127.") || host.starts_with("::ffff:127.") {
        ListenerBind::Loopback
    } else if host.starts_with("fe80:") {
        ListenerBind::LinkLocal
    } else {
        ListenerBind::Specific
    }
}

/// Scans the fields after the state column for the first `name:pid` token.
/// The name is every token after the last all-numeric token before it.
pub fn process_token(rest: &[&str]) -> (Option<String>, Option<u32>) {
    let Some(end) = rest.iter().position(|t| PID_TOKEN_RE.is_match(t)) else {
        return (None, None);
    };
    let start = rest
        .iter()
        .take(end)
        .rposition(|t| !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit()))
        .map_or(0, |i| i + 1);
    let joined = rest.get(start..=end).unwrap_or(&[]).join(" ");
    match joined.rsplit_once(':') {
        Some((name, pid)) if !name.is_empty() => (Some(name.to_owned()), pid.parse().ok()),
        _ => (None, None),
    }
}

/// Empty output, or a header with no socket rows, means the kernel withheld the table: on macOS 27
/// the `pcblist_n` sysctl returns an empty list to process trees whose ancestor is ad-hoc signed.
pub fn parse_netstat(text: &str) -> Result<Listeners, Fail> {
    let socket_rows = text
        .lines()
        .filter(|l| l.starts_with("tcp") || l.starts_with("udp"))
        .count();
    if text.trim().is_empty() || (socket_rows == 0 && text.contains("Proto")) {
        return Err(Fail::new(
            UnavailableReason::PermissionDenied,
            "netstat: empty socket table",
        ));
    }
    if !text.lines().any(|l| l.trim_start().starts_with("Proto")) {
        return Err(Fail::parse("netstat"));
    }
    let mut entries: Vec<Listener> = Vec::new();
    let mut complete = true;
    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.get(5) != Some(&"LISTEN") {
            continue;
        }
        let protocol = match fields.first() {
            Some(p) if p.starts_with("tcp") => Protocol::Tcp,
            Some(p) if p.starts_with("udp") => Protocol::Udp,
            _ => continue,
        };
        let Some((host, port)) = fields.get(3).and_then(|local| local.rsplit_once('.')) else {
            continue;
        };
        let Ok(port) = port.parse::<u16>() else {
            continue;
        };
        let (process_name, pid) = process_token(fields.get(6..).unwrap_or(&[]));
        if process_name.is_none() {
            complete = false;
        }
        let entry = Listener {
            protocol,
            port,
            bind: classify_bind(host),
            process_name,
            pid,
        };
        if !entries.contains(&entry) {
            entries.push(entry);
        }
    }
    Ok(Listeners {
        entries,
        process_names_complete: complete,
    })
}

fn inner(cancel: &AtomicBool) -> Result<Listeners, Fail> {
    let out = run(Bin::Netstat, &["-anv", "-p", "tcp"], cancel)?;
    parse_netstat(&out.stdout)
}

pub fn collect(cancel: &AtomicBool) -> Section<Listeners> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const CAPTURED: &str = include_str!("../../../tests/fixtures/netstat.txt");

    fn find(listeners: &Listeners, port: u16) -> Vec<&Listener> {
        listeners
            .entries
            .iter()
            .filter(|e| e.port == port)
            .collect()
    }

    #[test]
    fn parses_captured_header_and_rows() {
        let l = parse_netstat(CAPTURED).unwrap();
        assert!(l.process_names_complete);
        assert!(l.entries.iter().all(|e| e.protocol == Protocol::Tcp));
        let helper = find(&l, 57709);
        assert_eq!(helper.len(), 1);
        assert_eq!(helper[0].process_name.as_deref(), Some("Code Helper (Plu"));
        assert_eq!(helper[0].pid, Some(47351));
        assert_eq!(helper[0].bind, ListenerBind::Loopback);
        let rapportd = find(&l, 55880);
        assert_eq!(rapportd[0].process_name.as_deref(), Some("rapportd"));
        assert_eq!(rapportd[0].pid, Some(522));
        assert_eq!(rapportd[0].bind, ListenerBind::All);
        let cc = find(&l, 5000);
        assert_eq!(
            cc.len(),
            1,
            "tcp4 and tcp6 rows for the same socket collapse"
        );
        assert_eq!(cc[0].process_name.as_deref(), Some("ControlCenter"));
        assert_eq!(cc[0].pid, Some(515));
        assert!(
            l.entries
                .iter()
                .all(|e| !e.process_name.as_deref().unwrap_or("").contains("131072"))
        );
        assert!(
            !l.entries.iter().any(|e| e.port == 56643),
            "ESTABLISHED rows are dropped"
        );
    }

    #[test]
    fn classifies_binds() {
        let header = "Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)          rxbytes      txbytes  rhiwat  shiwat          process:pid    state  options           gencnt    flags   flags1 usecnt rtncnt fltrs\n";
        let rows = concat!(
            "tcp4       0      0  *.22                   *.*                    LISTEN                 0            0  131072  131072          launchd:1      00100 00000006 0000000000000c1d 00000001 00000800      1      0 000000\n",
            "tcp4       0      0  127.0.0.1.5432         *.*                    LISTEN                 0            0  131072  131072         postgres:4821   00100 00000106 0000000000b3111a 00000001 00000800      1      0 000000\n",
            "tcp6       0      0  ::1.631                *.*                    LISTEN                 0            0  131072  131072            cupsd:300    00100 00000006 00000000000010e9 00000000 00000800      1      0 000000\n",
            "tcp6       0      0  fe80::86c:3c1f:d.8080  *.*                    LISTEN                 0            0  131072  131072             node:7515   00100 00000106 0000000000b12014 00000001 00000800      1      0 000000\n",
            "tcp4       0      0  10.0.0.5.8443          *.*                    LISTEN                 0            0  131072  131072             java:5951   00000 00000006 0000000000a599da 00000000 00000800      2      0 000000\n",
            "tcp4       0      0  127.0.0.2.8081         *.*                    LISTEN                 0            0  131072  131072             node:7516   00100 00000106 0000000000b12015 00000001 00000800      1      0 000000\n",
            "tcp4       0      0  127.0.0.53.5353        *.*                    LISTEN                 0            0  131072  131072          dnsmasq:7517   00100 00000106 0000000000b12016 00000001 00000800      1      0 000000\n",
            "tcp46      0      0  ::ffff:127.0.0.1.8082  *.*                    LISTEN                 0            0  131072  131072             node:7518   00100 00000106 0000000000b12017 00000001 00000800      1      0 000000\n",
        );
        let l = parse_netstat(&format!("{header}{rows}")).unwrap();
        assert_eq!(find(&l, 22)[0].bind, ListenerBind::All);
        assert_eq!(find(&l, 22)[0].process_name.as_deref(), Some("launchd"));
        assert_eq!(find(&l, 5432)[0].bind, ListenerBind::Loopback);
        assert_eq!(find(&l, 631)[0].bind, ListenerBind::Loopback);
        assert_eq!(find(&l, 8080)[0].bind, ListenerBind::LinkLocal);
        assert_eq!(find(&l, 8443)[0].bind, ListenerBind::Specific);
        assert_eq!(
            find(&l, 8081)[0].bind,
            ListenerBind::Loopback,
            "lo0 aliases are loopback"
        );
        assert_eq!(find(&l, 5353)[0].bind, ListenerBind::Loopback);
        assert_eq!(
            find(&l, 8082)[0].bind,
            ListenerBind::Loopback,
            "IPv4-mapped loopback"
        );
        assert_eq!(classify_bind("127.1.2.3"), ListenerBind::Loopback);
        assert_eq!(classify_bind("128.0.0.1"), ListenerBind::Specific);
        assert_eq!(classify_bind("1270.0.0.1"), ListenerBind::Specific);
    }

    #[test]
    fn missing_process_token_marks_incomplete() {
        let text = "Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)\ntcp4       0      0  *.8080                 *.*                    LISTEN\n";
        let l = parse_netstat(text).unwrap();
        assert!(!l.process_names_complete);
        assert_eq!(l.entries[0].process_name, None);
        assert_eq!(l.entries[0].pid, None);
    }

    #[test]
    fn process_token_joins_from_the_last_numeric_column() {
        let (name, pid) = process_token(&[
            "0",
            "0",
            "131072",
            "131072",
            "Code",
            "Helper",
            "(Plu:47351",
            "00100",
        ]);
        assert_eq!(name.as_deref(), Some("Code Helper (Plu"));
        assert_eq!(pid, Some(47351));
        assert_eq!(process_token(&["0", "0"]), (None, None));
    }

    #[test]
    fn output_without_header_is_a_parse_error() {
        let fail = parse_netstat("garbage\n").unwrap_err();
        assert_eq!(fail.reason, UnavailableReason::ParseError);
    }

    #[test]
    fn empty_output_is_permission_denied() {
        let fail = parse_netstat("").unwrap_err();
        assert_eq!(fail.reason, UnavailableReason::PermissionDenied);
        assert_eq!(
            parse_netstat("\n").unwrap_err().reason,
            UnavailableReason::PermissionDenied
        );
    }

    #[test]
    fn header_without_rows_is_permission_denied() {
        let text = "Active Internet connections (including servers)\nProto Recv-Q Send-Q  Local Address          Foreign Address        (state)\n";
        let fail = parse_netstat(text).unwrap_err();
        assert_eq!(fail.reason, UnavailableReason::PermissionDenied);
        assert_eq!(fail.detail.as_deref(), Some("netstat: empty socket table"));
    }

    #[test]
    fn rows_without_listeners_give_an_empty_table() {
        let text = "Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)\ntcp4       0      0  10.0.0.5.56643         203.0.113.10.443       ESTABLISHED\n";
        let l = parse_netstat(text).unwrap();
        assert!(l.entries.is_empty());
        assert!(l.process_names_complete);
    }
}
