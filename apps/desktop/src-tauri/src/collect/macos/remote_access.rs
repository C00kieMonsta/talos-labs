//! Remote Login, Screen Sharing and Remote Management.

use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use super::{lit, run};
use crate::collect::{to_section, Fail, Shared};
use crate::exec::Bin;
use crate::state::{ListenerBind, Listeners, RemoteAccess, Section, ServiceState, UnavailableReason};

pub const SSHD_LABEL: &str = "com.openssh.sshd";
pub const SCREEN_SHARING_LABEL: &str = "com.apple.screensharing";
pub const REMOTE_MANAGEMENT_FILE: &str = "/Library/Application Support/Apple/Remote Desktop/RemoteManagement.launchd";

static OVERRIDE_RE: LazyLock<Regex> = LazyLock::new(|| lit(r#"^"([^"]+)"\s*=>\s*(enabled|disabled)$"#));

/// The `disabled services = { ... }` block of `launchctl print-disabled system`. None when the block is absent.
pub fn parse_print_disabled(text: &str) -> Option<HashMap<String, bool>> {
    let mut lines = text.lines().map(str::trim);
    lines.find(|l| l.starts_with("disabled services = {"))?;
    let mut map = HashMap::new();
    for line in lines {
        if line == "}" {
            break;
        }
        if let Some(caps) = OVERRIDE_RE.captures(line) {
            let label = caps.get(1).map_or("", |m| m.as_str());
            let enabled = caps.get(2).is_some_and(|m| m.as_str() == "enabled");
            map.insert(label.to_owned(), enabled);
        }
    }
    Some(map)
}

/// "=> enabled" gives true; "=> disabled" or absent gives false; no block gives None.
pub fn service_loaded(overrides: Option<&HashMap<String, bool>>, label: &str) -> Option<bool> {
    overrides.map(|map| map.get(label).copied().unwrap_or(false))
}

/// First of `ports` bound on a non-loopback interface.
pub fn non_loopback_port(listeners: &Listeners, ports: &[u16]) -> Option<u16> {
    ports.iter().copied().find(|port| {
        listeners
            .entries
            .iter()
            .any(|e| e.port == *port && e.bind != ListenerBind::Loopback)
    })
}

pub fn shared_listeners(shared: &Shared) -> Result<&Listeners, Fail> {
    let section = shared.listeners();
    section
        .as_ok()
        .ok_or_else(|| Fail::new(section.reason().unwrap_or(UnavailableReason::CollectorError), "shared: listeners"))
}

fn inner(shared: &Shared) -> Result<RemoteAccess, Fail> {
    let listeners = shared_listeners(shared)?;
    let out = run(Bin::Launchctl, &["print-disabled", "system"], &shared.cancel)?;
    let overrides = parse_print_disabled(&out.stdout);
    Ok(RemoteAccess {
        ssh: ServiceState {
            service_loaded: service_loaded(overrides.as_ref(), SSHD_LABEL),
            listening_port: non_loopback_port(listeners, &[22]),
        },
        screen_sharing: ServiceState {
            service_loaded: service_loaded(overrides.as_ref(), SCREEN_SHARING_LABEL),
            listening_port: non_loopback_port(listeners, &[5900]),
        },
        remote_management: Some(ServiceState {
            service_loaded: Some(Path::new(REMOTE_MANAGEMENT_FILE).exists()),
            listening_port: non_loopback_port(listeners, &[3283, 5900]),
        }),
    })
}

pub fn collect(shared: &Shared) -> Section<RemoteAccess> {
    to_section(inner(shared))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::state::{Listener, Protocol};

    const CAPTURED: &str = include_str!("../../../tests/fixtures/launchctl-print-disabled.txt");

    #[test]
    fn parses_captured_overrides() {
        let map = parse_print_disabled(CAPTURED).unwrap();
        assert_eq!(map.get("com.docker.vmnetd"), Some(&true));
        assert_eq!(map.get("com.apple.ftpd"), Some(&false));
        assert_eq!(map.len(), 9);
        assert_eq!(service_loaded(Some(&map), SSHD_LABEL), Some(false), "absent label means off");
        assert_eq!(service_loaded(Some(&map), SCREEN_SHARING_LABEL), Some(false));
    }

    #[test]
    fn enabled_and_disabled_labels() {
        let text = "\tdisabled services = {\n\t\t\"com.openssh.sshd\" => enabled\n\t\t\"com.apple.screensharing\" => disabled\n\t}\n";
        let map = parse_print_disabled(text).unwrap();
        assert_eq!(service_loaded(Some(&map), SSHD_LABEL), Some(true));
        assert_eq!(service_loaded(Some(&map), SCREEN_SHARING_LABEL), Some(false));
    }

    #[test]
    fn no_block_gives_null() {
        assert!(parse_print_disabled("Bad request.\nCould not find service\n").is_none());
        assert_eq!(service_loaded(None, SSHD_LABEL), None);
    }

    #[test]
    fn ports_ignore_loopback() {
        let listeners = Listeners {
            entries: vec![
                Listener { protocol: Protocol::Tcp, port: 22, bind: ListenerBind::Loopback, process_name: None, pid: None },
                Listener { protocol: Protocol::Tcp, port: 5900, bind: ListenerBind::All, process_name: Some("launchd".into()), pid: Some(1) },
            ],
            process_names_complete: false,
        };
        assert_eq!(non_loopback_port(&listeners, &[22]), None);
        assert_eq!(non_loopback_port(&listeners, &[3283, 5900]), Some(5900));
    }
}
