//! Remote Login, Screen Sharing, Remote Management, Remote Apple Events, Internet Sharing and
//! AirDrop. The section no longer fails with the listeners section: on an unsigned build every
//! `listening_port` is None and `service_loaded` decides alone.

use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use super::{defaults, lit, run};
use crate::collect::{Fail, Shared, to_section};
use crate::exec::Bin;
use crate::state::{
    AirdropMode, ListenerBind, Listeners, RemoteAccess, Section, ServiceState, Tri,
    UnavailableReason,
};

pub const SSHD_LABEL: &str = "com.openssh.sshd";
pub const SCREEN_SHARING_LABEL: &str = "com.apple.screensharing";
/// Remote Apple Events; `/System/Library/LaunchDaemons/com.apple.eppc.plist` ships `Disabled = 1`,
/// so an absent override row is off.
pub const AE_SERVER_LABEL: &str = "com.apple.AEServer";
pub const AE_SERVER_PORT: u16 = 3031;
pub const REMOTE_MANAGEMENT_FILE: &str =
    "/Library/Application Support/Apple/Remote Desktop/RemoteManagement.launchd";
/// Internet Sharing: `Enabled` under the `NAT` dictionary; the domain is absent until it was ever used.
pub const NAT_DOMAIN: &str = "/Library/Preferences/SystemConfiguration/com.apple.nat";
pub const SHARINGD_DOMAIN: &str = "com.apple.sharingd";
pub const DISCOVERABLE_MODE_KEY: &str = "DiscoverableMode";

static OVERRIDE_RE: LazyLock<Regex> =
    LazyLock::new(|| lit(r#"^"([^"]+)"\s*=>\s*(enabled|disabled)$"#));

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

/// First of `ports` bound on a non-loopback interface; None when the listeners section failed
/// (`None`). A plain `&Listeners` converts, so the file sharing collector passes its own.
pub fn non_loopback_port<'a>(
    listeners: impl Into<Option<&'a Listeners>>,
    ports: &[u16],
) -> Option<u16> {
    let listeners = listeners.into()?;
    ports.iter().copied().find(|port| {
        listeners
            .entries
            .iter()
            .any(|e| e.port == *port && e.bind != ListenerBind::Loopback)
    })
}

/// `defaults read <nat domain>`: None (domain absent) is `Unset`; `Enabled = 1` at the top level
/// or under the `NAT` dictionary is true; a dump without the key is false.
pub fn parse_internet_sharing(dump: Option<&str>) -> Tri {
    let Some(text) = dump else {
        return Tri::Unset;
    };
    if let Some(enabled) = defaults::bool_of(&defaults::parse_dump(text), "Enabled") {
        return Tri::from(enabled);
    }
    Tri::from(nat_enabled(text).unwrap_or(false))
}

/// `Enabled` inside the top-level `NAT = { ... }` block, skipping the nested `AirPort` and
/// interface dictionaries that carry an `Enabled` of their own.
fn nat_enabled(text: &str) -> Option<bool> {
    let mut depth: i32 = 0;
    let mut nat_depth: Option<i32> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line == "{" || line == "(" {
            depth += 1;
            continue;
        }
        if line.starts_with('}') || line.starts_with(')') {
            depth -= 1;
            if nat_depth.is_some_and(|d| depth < d) {
                nat_depth = None;
            }
            continue;
        }
        let opens = line.ends_with('{') || line.ends_with('(');
        if let Some((key, value)) = line.split_once('=') {
            let key = defaults::unquote(key.trim());
            if depth == 1 && opens && key == "NAT" {
                nat_depth = Some(depth + 1);
            } else if nat_depth == Some(depth) && !opens && key == "Enabled" {
                let value = value.trim();
                let value = value.strip_suffix(';').unwrap_or(value).trim();
                return defaults::as_bool(&defaults::unquote(value));
            }
        }
        if opens {
            depth += 1;
        }
    }
    None
}

/// `defaults read com.apple.sharingd DiscoverableMode`: the three words, else `Unset`.
pub fn parse_airdrop(value: Option<&str>) -> AirdropMode {
    match value.map(str::trim) {
        Some("Everyone") => AirdropMode::Everyone,
        Some("Contacts Only") => AirdropMode::ContactsOnly,
        Some("Off") => AirdropMode::Off,
        _ => AirdropMode::Unset,
    }
}

pub fn shared_listeners(shared: &Shared) -> Result<&Listeners, Fail> {
    let section = shared.listeners();
    section.as_ok().ok_or_else(|| {
        Fail::new(
            section
                .reason()
                .unwrap_or(UnavailableReason::CollectorError),
            "shared: listeners",
        )
    })
}

fn inner(shared: &Shared) -> Result<RemoteAccess, Fail> {
    let listeners = shared_listeners(shared).ok();
    let cancel = shared.cancel.as_ref();
    let out = run(Bin::Launchctl, &["print-disabled", "system"], cancel)?;
    let overrides = parse_print_disabled(&out.stdout);
    let nat = defaults::read_domain(NAT_DOMAIN, "nat", cancel)?;
    let airdrop = defaults::read_key(SHARINGD_DOMAIN, DISCOVERABLE_MODE_KEY, "sharingd", cancel)?;
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
        remote_apple_events: Some(ServiceState {
            service_loaded: service_loaded(overrides.as_ref(), AE_SERVER_LABEL),
            listening_port: non_loopback_port(listeners, &[AE_SERVER_PORT]),
        }),
        internet_sharing: parse_internet_sharing(nat.as_deref()),
        airdrop: parse_airdrop(airdrop.as_deref()),
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
        assert_eq!(
            service_loaded(Some(&map), SSHD_LABEL),
            Some(false),
            "absent label means off"
        );
        assert_eq!(
            service_loaded(Some(&map), SCREEN_SHARING_LABEL),
            Some(false)
        );
        assert_eq!(
            service_loaded(Some(&map), AE_SERVER_LABEL),
            Some(false),
            "no AEServer row on this Mac: the launchd default is off"
        );
    }

    #[test]
    fn enabled_and_disabled_labels() {
        let text = "\tdisabled services = {\n\t\t\"com.openssh.sshd\" => enabled\n\t\t\"com.apple.screensharing\" => disabled\n\t\t\"com.apple.AEServer\" => enabled\n\t}\n";
        let map = parse_print_disabled(text).unwrap();
        assert_eq!(service_loaded(Some(&map), SSHD_LABEL), Some(true));
        assert_eq!(
            service_loaded(Some(&map), SCREEN_SHARING_LABEL),
            Some(false)
        );
        assert_eq!(service_loaded(Some(&map), AE_SERVER_LABEL), Some(true));
        let off = "\tdisabled services = {\n\t\t\"com.apple.AEServer\" => disabled\n\t}\n";
        assert_eq!(
            service_loaded(Some(&parse_print_disabled(off).unwrap()), AE_SERVER_LABEL),
            Some(false)
        );
    }

    #[test]
    fn internet_sharing_reads_the_nat_block_and_absent_is_unset() {
        assert_eq!(parse_internet_sharing(None), Tri::Unset, "domain not found");
        let on = "{\n    NAT =     {\n        AirPort =         {\n            40BitEncrypt = 1;\n            Channel = 0;\n            Enabled = 0;\n        };\n        Enabled = 1;\n        NatPortMapDisabled = 0;\n        PrimaryInterface =         {\n            Enabled = 0;\n            HardwareKey = \"\";\n        };\n        SharingDevices =         (\n            en0\n        );\n    };\n}\n";
        assert_eq!(parse_internet_sharing(Some(on)), Tri::True);
        let off = on.replace("        Enabled = 1;", "        Enabled = 0;");
        assert_eq!(parse_internet_sharing(Some(&off)), Tri::False);
        let no_key = "{\n    NAT =     {\n        NatPortMapDisabled = 0;\n    };\n}\n";
        assert_eq!(
            parse_internet_sharing(Some(no_key)),
            Tri::False,
            "present without the key"
        );
        assert_eq!(parse_internet_sharing(Some("{\n}\n")), Tri::False);
        assert_eq!(
            parse_internet_sharing(Some("{\n    Enabled = 1;\n}\n")),
            Tri::True,
            "a flat dump is read too"
        );
        let airport_only = "{\n    NAT =     {\n        AirPort =         {\n            Enabled = 1;\n        };\n    };\n}\n";
        assert_eq!(
            parse_internet_sharing(Some(airport_only)),
            Tri::False,
            "a nested Enabled is not the NAT switch"
        );
    }

    #[test]
    fn airdrop_reads_the_three_words_and_anything_else_is_unset() {
        assert_eq!(parse_airdrop(Some("Everyone")), AirdropMode::Everyone);
        assert_eq!(parse_airdrop(Some("Everyone\n")), AirdropMode::Everyone);
        assert_eq!(
            parse_airdrop(Some("Contacts Only")),
            AirdropMode::ContactsOnly
        );
        assert_eq!(parse_airdrop(Some("Off")), AirdropMode::Off);
        assert_eq!(
            parse_airdrop(None),
            AirdropMode::Unset,
            "missing key or domain"
        );
        assert_eq!(parse_airdrop(Some("Friends")), AirdropMode::Unset);
        assert_eq!(parse_airdrop(Some("")), AirdropMode::Unset);
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
                Listener {
                    protocol: Protocol::Tcp,
                    port: 22,
                    bind: ListenerBind::Loopback,
                    process_name: None,
                    pid: None,
                },
                Listener {
                    protocol: Protocol::Tcp,
                    port: 5900,
                    bind: ListenerBind::All,
                    process_name: Some("launchd".into()),
                    pid: Some(1),
                },
            ],
            process_names_complete: false,
        };
        assert_eq!(non_loopback_port(Some(&listeners), &[22]), None);
        assert_eq!(
            non_loopback_port(Some(&listeners), &[3283, 5900]),
            Some(5900)
        );
        assert_eq!(
            non_loopback_port(None, &[5900]),
            None,
            "a failed listeners section gives no port"
        );
        assert_eq!(
            non_loopback_port(&listeners, &[5900]),
            Some(5900),
            "a plain reference converts"
        );
        assert_eq!(non_loopback_port(Some(&listeners), &[AE_SERVER_PORT]), None);
    }
}
