//! The compiled-in probe table and the probe functions (docs/DESIGN-WATCH.md section 2). Every
//! probe is a read-only run of an `exec::Bin` with fixed arguments, a `stat`, a listing or a
//! `defaults read`; nothing here opens file contents beyond the launchd plists the existing
//! persistence collector already reads. Machine text (paths, labels, names, ports) stays in
//! `Member` values that the cycle digests or counts; it never reaches a `WatchSignal`.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::capabilities::Capabilities;
use crate::collect::Fail;
use crate::exec::{Bin, Output};
use crate::state::{LaunchItemScope, SectionKey, UnavailableReason};

use super::signals::{is_own_agent, is_temp_or_hidden, own_exe};
use super::types::DetailsScope;
use super::{ProbeId, SignalId};

#[cfg(target_os = "macos")]
use crate::collect::macos::{self, run};

/// The sweep's wall budget; probes still pending at the deadline read `timeout`.
pub const SWEEP_BUDGET: Duration = Duration::from_secs(20);
/// The full check runs at most this often unless asked for.
pub const FULL_CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cost {
    /// Part of the cheap sweep every tick.
    Cheap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Needs {
    None,
    Automation,
    FullDiskAccess,
}

#[derive(Debug, Clone, Copy)]
pub struct Probe {
    pub id: ProbeId,
    pub signals: &'static [SignalId],
    /// A model-chosen re-read waits at least this long after the probe last ran.
    pub min_interval: Duration,
    pub cost: Cost,
    pub needs: Needs,
    pub model_choosable: bool,
}

const M5: Duration = Duration::from_secs(5 * 60);
const M15: Duration = Duration::from_secs(15 * 60);
const H1: Duration = Duration::from_secs(60 * 60);

const fn probe(
    id: ProbeId,
    signals: &'static [SignalId],
    min_interval: Duration,
    model_choosable: bool,
) -> Probe {
    Probe {
        id,
        signals,
        min_interval,
        cost: Cost::Cheap,
        needs: Needs::None,
        model_choosable,
    }
}

/// The 21 probes in PROBE_IDS order. The two that touch file bytes are never model-choosable.
pub static PROBES: [Probe; 21] = [
    probe(
        ProbeId::PlatformIntegrity,
        &[SignalId::Gatekeeper, SignalId::Sip, SignalId::BootArgsSet],
        M5,
        true,
    ),
    probe(ProbeId::Firewall, &[SignalId::Firewall], M5, true),
    probe(
        ProbeId::MalwareProtection,
        &[
            SignalId::XprotectPresent,
            SignalId::XprotectVersion,
            SignalId::XprotectRemediatorVersion,
            SignalId::XprotectScansEnabled,
        ],
        M5,
        true,
    ),
    probe(ProbeId::RemoteAccess, &[SignalId::RemoteAccessOn], M5, true),
    probe(
        ProbeId::FileSharing,
        &[SignalId::GuestShare, SignalId::ShareCount],
        M5,
        true,
    ),
    probe(
        ProbeId::Listeners,
        &[
            SignalId::ListenerSet,
            SignalId::ListenerNewPorts,
            SignalId::EstablishedCount,
        ],
        M5,
        true,
    ),
    probe(
        ProbeId::Accounts,
        &[
            SignalId::AdminCount,
            SignalId::UserCount,
            SignalId::HiddenUserCount,
            SignalId::Autologin,
        ],
        M5,
        true,
    ),
    probe(
        ProbeId::Persistence,
        &[
            SignalId::PersistenceSet,
            SignalId::PersistenceNew,
            SignalId::PersistenceUnsigned,
            SignalId::PersistenceInTempOrHidden,
            SignalId::HelperToolsCount,
        ],
        M5,
        true,
    ),
    probe(
        ProbeId::PersistenceSignatures,
        &[SignalId::PersistenceUnsigned],
        M5,
        false,
    ),
    probe(
        ProbeId::NetworkConfig,
        &[
            SignalId::DnsManual,
            SignalId::ProxyOn,
            SignalId::PacUrlSet,
            SignalId::Resolvers,
        ],
        M15,
        true,
    ),
    probe(ProbeId::Hosts, &[SignalId::HostsChanged], M5, true),
    probe(
        ProbeId::Profiles,
        &[
            SignalId::ProfilesCount,
            SignalId::MdmEnrolled,
            SignalId::ManagedPrefsCount,
        ],
        M15,
        true,
    ),
    probe(
        ProbeId::SystemExtensions,
        &[SignalId::SysextCount, SignalId::KextCount],
        M15,
        true,
    ),
    probe(
        ProbeId::Backup,
        &[
            SignalId::BackupAuto,
            SignalId::BackupDestinations,
            SignalId::BackupAgeDays,
        ],
        M15,
        true,
    ),
    probe(ProbeId::LockdownMode, &[SignalId::LockdownMode], M5, true),
    probe(
        ProbeId::SudoConfig,
        &[SignalId::SudoersDCount, SignalId::PamSudoChanged],
        M5,
        true,
    ),
    probe(
        ProbeId::SshKeys,
        &[SignalId::AuthorizedKeysChanged, SignalId::SshdConfigChanged],
        M5,
        false,
    ),
    probe(
        ProbeId::HostMetrics,
        &[
            SignalId::LoadAvg,
            SignalId::DiskFreePct,
            SignalId::OnBattery,
        ],
        M5,
        true,
    ),
    probe(ProbeId::Updates, &[SignalId::PendingUpdates], H1, true),
    probe(
        ProbeId::ScheduledJobs,
        &[
            SignalId::CronLines,
            SignalId::AtJobs,
            SignalId::LegacyStartupCount,
        ],
        M5,
        true,
    ),
    probe(ProbeId::Logins, &[SignalId::RemoteLogins], M5, true),
];

/// The two sections the full check re-runs, each only when its permission is already granted,
/// so no system prompt ever appears from the background. Ssh, Dotfiles and every other key are absent.
pub const FULL_CHECK_SECTIONS: [(SectionKey, Needs); 2] = [
    (SectionKey::LoginItems, Needs::Automation),
    (SectionKey::Browsers, Needs::FullDiskAccess),
];

pub fn probe_for(id: ProbeId) -> Option<&'static Probe> {
    PROBES.iter().find(|p| p.id == id)
}

/// The probe that produces a signal; the two full-check signals have none.
pub fn probe_of(signal: SignalId) -> Option<ProbeId> {
    PROBES
        .iter()
        .find(|p| p.signals.contains(&signal) && p.id != ProbeId::PersistenceSignatures)
        .map(|p| p.id)
}

/// The ids the model may name.
pub fn model_probes() -> Vec<ProbeId> {
    PROBES
        .iter()
        .filter(|p| p.model_choosable)
        .map(|p| p.id)
        .collect()
}

/// Every probe of the cheap sweep.
pub fn sweep_probes() -> Vec<ProbeId> {
    PROBES
        .iter()
        .filter(|p| p.id != ProbeId::PersistenceSignatures)
        .map(|p| p.id)
        .collect()
}

// ---------- observations ----------

/// Machine text about one member of a listing; digested or counted by the cycle, shown only in Details.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberDetail {
    None,
    Launch {
        plist_path: String,
        label: String,
        program: Option<String>,
        scope: DetailsScope,
        temp_or_hidden: bool,
        own_agent: bool,
    },
    Listener {
        port: u16,
        process_name: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    /// The text that is digested; stable across cycles for an unchanged entry.
    pub key: String,
    pub detail: MemberDetail,
}

impl Member {
    pub fn plain(key: impl Into<String>) -> Self {
        Member {
            key: key.into(),
            detail: MemberDetail::None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Observed {
    Bool(bool),
    Count(u64),
    Version(u64),
    /// A listing; the cycle digests it and counts the members not in the baseline.
    Set(Vec<Member>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Observation {
    pub signal: SignalId,
    pub value: Observed,
}

fn obs(signal: SignalId, value: Observed) -> Observation {
    Observation { signal, value }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProbeOutcome {
    pub probe: ProbeId,
    pub result: Result<Vec<Observation>, UnavailableReason>,
}

// ---------- parsers (pure; fixtures under tests/fixtures) ----------

/// `nvram boot-args`: not found is the good state; any value set reads true.
pub fn parse_boot_args(out: &Output) -> bool {
    if out.success() {
        return !out.stdout.trim().is_empty();
    }
    !out.stderr.to_ascii_lowercase().contains("not found")
}

/// "Version: 5367 Installed: ..." from `xprotect version`.
pub fn parse_xprotect_version(text: &str) -> Option<u64> {
    text.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("Version:")?;
        leading_number(rest.trim())
    })
}

/// Every "... scans: <state>" line of `xprotect status` must say enabled.
pub fn parse_xprotect_status(text: &str) -> Option<bool> {
    let states: Vec<bool> = text
        .lines()
        .filter_map(|line| {
            let (_, state) = line.split_once("scans:")?;
            Some(state.trim().eq_ignore_ascii_case("enabled"))
        })
        .collect();
    if states.is_empty() {
        None
    } else {
        Some(states.iter().all(|s| *s))
    }
}

/// The leading digits of a version string, so "5367" and "2.5.1" both reduce to a number.
pub fn leading_number(text: &str) -> Option<u64> {
    let digits: String = text.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Profiles installed for the user: one `profileIdentifier:` line each; the "no profiles" line gives 0.
pub fn parse_profiles_count(text: &str) -> u64 {
    text.lines()
        .filter(|l| l.contains("profileIdentifier:"))
        .count() as u64
}

pub fn parse_mdm_enrolled(text: &str) -> bool {
    text.lines().any(|line| {
        line.trim()
            .strip_prefix("MDM enrollment:")
            .is_some_and(|v| v.trim().to_ascii_lowercase().starts_with("yes"))
    })
}

/// Activated extensions: the rows of `systemextensionsctl list` carrying an `[activated` state.
pub fn parse_sysext_count(text: &str) -> u64 {
    text.lines().filter(|l| l.contains("[activated")).count() as u64
}

/// Loaded kexts whose bundle id is not Apple's, from `kmutil showloaded --list-only`.
pub fn parse_kext_count(text: &str) -> u64 {
    text.lines()
        .filter_map(|line| {
            line.split_whitespace().find(|t| {
                t.contains('.')
                    && !t.starts_with("0x")
                    && t.chars().next().is_some_and(char::is_alphabetic)
            })
        })
        .filter(|id| !id.starts_with("com.apple."))
        .count() as u64
}

/// The device of the Wi-Fi hardware port, when the listing has one.
pub fn parse_wifi_device(text: &str) -> Option<String> {
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        if line.trim() == "Hardware Port: Wi-Fi" {
            return lines
                .next()
                .and_then(|l| l.trim().strip_prefix("Device:"))
                .map(|d| d.trim().to_owned());
        }
    }
    None
}

/// Service names from `-listallnetworkservices`; the first line is a note, `*` marks a disabled one.
pub fn parse_network_services(text: &str) -> Vec<String> {
    text.lines()
        .skip(1)
        .map(|l| l.trim().trim_start_matches('*').trim().to_owned())
        .filter(|l| !l.is_empty())
        .collect()
}

/// `-getdnsservers`: a manual server list unless the "There aren't any" line.
pub fn parse_dns_manual(text: &str) -> bool {
    let trimmed = text.trim();
    !trimmed.is_empty() && !trimmed.starts_with("There aren't any")
}

/// `-getwebproxy` and friends: "Enabled: Yes".
pub fn parse_proxy_enabled(text: &str) -> bool {
    text.lines().any(|line| {
        line.trim()
            .strip_prefix("Enabled:")
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("yes"))
    })
}

/// Nameservers from `scutil --dns`, deduplicated and sorted.
pub fn parse_resolvers(text: &str) -> Vec<String> {
    let mut servers: Vec<String> = text
        .lines()
        .filter_map(|line| {
            let (key, value) = line.trim().split_once(':')?;
            key.trim()
                .starts_with("nameserver[")
                .then(|| value.trim().to_owned())
        })
        .collect();
    servers.sort_unstable();
    servers.dedup();
    servers
}

/// `pmset -g batt`: true on battery power.
pub fn parse_on_battery(text: &str) -> bool {
    text.lines()
        .next()
        .is_some_and(|l| l.contains("Battery Power"))
}

/// Non-empty, non-comment crontab lines; "no crontab" gives 0.
pub fn parse_cron_lines(out: &Output) -> u64 {
    if !out.success() {
        return 0;
    }
    out.stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .count() as u64
}

pub fn parse_at_jobs(text: &str) -> u64 {
    text.lines().filter(|l| !l.trim().is_empty()).count() as u64
}

const WEEKDAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// Rows of `last -n 50` with a host column: the third field is not a weekday.
pub fn parse_remote_logins(text: &str) -> u64 {
    text.lines()
        .filter(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            match (fields.first(), fields.get(1), fields.get(2)) {
                (Some(user), Some(_), Some(third)) => {
                    *user != "reboot"
                        && *user != "shutdown"
                        && *user != "wtmp"
                        && !WEEKDAYS.contains(third)
                }
                _ => false,
            }
        })
        .count() as u64
}

/// ESTABLISHED rows of the same netstat output the listener parser reads.
pub fn count_established(text: &str) -> u64 {
    text.lines()
        .filter(|l| l.split_whitespace().nth(5) == Some("ESTABLISHED"))
        .count() as u64
}

/// Users with a UID of 500 or more whose IsHidden is 1.
pub fn parse_hidden_users(
    hidden: &str,
    ids: Option<&std::collections::HashMap<String, i64>>,
) -> u64 {
    hidden
        .lines()
        .filter(|line| {
            let mut parts = line.split_whitespace();
            let (Some(name), Some(flag)) = (parts.next(), parts.next()) else {
                return false;
            };
            flag == "1" && ids.is_none_or(|ids| ids.get(name).is_some_and(|uid| *uid >= 500))
        })
        .count() as u64
}

/// Days into a coarse bucket so a daily drift is not a change: 0 (<= 1 day), 1 (<= 7), 2 (<= 30), 3 (older).
pub fn age_bucket(days: u64) -> u64 {
    match days {
        0..=1 => 0,
        2..=7 => 1,
        8..=30 => 2,
        _ => 3,
    }
}

/// Connection counts into a coarse bucket: 0, 1 (< 10), 2 (< 100), 3 (100 or more).
pub fn count_bucket(count: u64) -> u64 {
    match count {
        0 => 0,
        1..=9 => 1,
        10..=99 => 2,
        _ => 3,
    }
}

/// Free space into tenths.
pub fn pct_bucket(pct: u64) -> u64 {
    pct / 10
}

fn dir_count(path: &str) -> u64 {
    std::fs::read_dir(path)
        .map(|entries| entries.flatten().count() as u64)
        .unwrap_or(0)
}

/// size, mode and mtime of a file as one member key; "absent" when it does not exist.
fn stat_key(path: &Path) -> String {
    use std::os::unix::fs::MetadataExt;
    match std::fs::metadata(path) {
        Ok(meta) => format!("{}|{:o}|{}", meta.len(), meta.mode() & 0o7777, meta.mtime()),
        Err(_) => "absent".to_owned(),
    }
}

// ---------- the probe functions (macOS) ----------

#[cfg(target_os = "macos")]
mod live {
    use super::*;
    use crate::collect::macos::{
        accounts, backup, defaults, file_sharing, firewall, listeners, malware_protection,
        persistence, platform_integrity, remote_access, updates,
    };
    use crate::state::ListenerBind;

    fn platform_integrity(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let spctl = run(Bin::Spctl, &["--status"], cancel)?;
        macos::check_exit(&spctl, Bin::Spctl)?;
        let gatekeeper =
            platform_integrity::parse_spctl(&format!("{}\n{}", spctl.stdout, spctl.stderr))?;
        let csrutil = run(Bin::Csrutil, &["status"], cancel)?;
        macos::check_exit(&csrutil, Bin::Csrutil)?;
        let sip =
            platform_integrity::parse_csrutil(&format!("{}\n{}", csrutil.stdout, csrutil.stderr))?;
        let nvram = run(Bin::Nvram, &["boot-args"], cancel)?;
        Ok(vec![
            obs(SignalId::Gatekeeper, Observed::Bool(gatekeeper)),
            obs(SignalId::Sip, Observed::Bool(sip)),
            obs(
                SignalId::BootArgsSet,
                Observed::Bool(parse_boot_args(&nvram)),
            ),
        ])
    }

    fn firewall_probe(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let out = run(Bin::Socketfilterfw, &["--getglobalstate"], cancel)?;
        macos::check_exit(&out, Bin::Socketfilterfw)?;
        let fw = firewall::parse_firewall(&out.stdout)?;
        Ok(vec![obs(SignalId::Firewall, Observed::Bool(fw.enabled))])
    }

    fn malware(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let present = Path::new(malware_protection::XPROTECT_INFO_PLIST).exists();
        let mut out = vec![obs(SignalId::XprotectPresent, Observed::Bool(present))];
        if present {
            let version = run(
                Bin::Defaults,
                &[
                    "read",
                    malware_protection::XPROTECT_INFO_PLIST,
                    "CFBundleShortVersionString",
                ],
                cancel,
            )?;
            if let Some(v) = malware_protection::parse_version(&version.stdout)
                .as_deref()
                .and_then(leading_number)
            {
                out.push(obs(SignalId::XprotectVersion, Observed::Version(v)));
            }
        }
        let version = run(Bin::Xprotect, &["version"], cancel)?;
        if let Some(v) = parse_xprotect_version(&version.stdout) {
            out.push(obs(
                SignalId::XprotectRemediatorVersion,
                Observed::Version(v),
            ));
        }
        let status = run(Bin::Xprotect, &["status"], cancel)?;
        if let Some(enabled) = parse_xprotect_status(&status.stdout) {
            out.push(obs(SignalId::XprotectScansEnabled, Observed::Bool(enabled)));
        }
        Ok(out)
    }

    fn remote(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let out = run(Bin::Launchctl, &["print-disabled", "system"], cancel)?;
        let overrides = remote_access::parse_print_disabled(&out.stdout);
        let ssh = remote_access::service_loaded(overrides.as_ref(), remote_access::SSHD_LABEL)
            .unwrap_or(false);
        let screen =
            remote_access::service_loaded(overrides.as_ref(), remote_access::SCREEN_SHARING_LABEL)
                .unwrap_or(false);
        let management = Path::new(remote_access::REMOTE_MANAGEMENT_FILE).exists();
        Ok(vec![obs(
            SignalId::RemoteAccessOn,
            Observed::Bool(ssh || screen || management),
        )])
    }

    fn sharing(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let out = run(Bin::Sharing, &["-l"], cancel)?;
        if !out.success() {
            return Err(Fail::collector("sharing: exit"));
        }
        let shares = file_sharing::parse_sharing(&out.stdout);
        Ok(vec![
            obs(
                SignalId::GuestShare,
                Observed::Bool(shares.iter().any(|s| s.guest_access)),
            ),
            obs(SignalId::ShareCount, Observed::Count(shares.len() as u64)),
        ])
    }

    fn listeners_probe(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let out = run(Bin::Netstat, &["-anv", "-p", "tcp"], cancel)?;
        let parsed = listeners::parse_netstat(&out.stdout)?;
        let members: Vec<Member> = parsed
            .entries
            .iter()
            .filter(|e| e.bind != ListenerBind::Loopback)
            .map(|e| Member {
                key: format!("{}|{:?}", e.port, e.bind),
                detail: MemberDetail::Listener {
                    port: e.port,
                    process_name: e.process_name.clone(),
                },
            })
            .collect();
        Ok(vec![
            obs(SignalId::ListenerSet, Observed::Set(members)),
            obs(
                SignalId::EstablishedCount,
                Observed::Count(count_bucket(count_established(&out.stdout))),
            ),
        ])
    }

    fn accounts_probe(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let dscl = run(
            Bin::Dscl,
            &[".", "-read", "/Groups/admin", "GroupMembership"],
            cancel,
        )?;
        macos::check_exit(&dscl, Bin::Dscl)?;
        let members = accounts::parse_group_membership(&dscl.stdout)?;
        let ids_out = run(Bin::Dscl, &[".", "-list", "/Users", "UniqueID"], cancel)?;
        let ids = if ids_out.success() {
            accounts::parse_user_ids(&ids_out.stdout)
        } else {
            None
        };
        let (_, admins) = accounts::summarise(&members, "", ids.as_ref());
        let users = ids
            .as_ref()
            .map(|ids| {
                ids.values()
                    .filter(|uid| **uid >= accounts::FIRST_HUMAN_UID)
                    .count() as u64
            })
            .unwrap_or(0);
        let hidden_out = run(Bin::Dscl, &[".", "-list", "/Users", "IsHidden"], cancel)?;
        let hidden = if hidden_out.success() {
            parse_hidden_users(&hidden_out.stdout, ids.as_ref())
        } else {
            0
        };
        let auto = defaults::read_key(
            accounts::LOGINWINDOW_DOMAIN,
            "autoLoginUser",
            "loginwindow",
            cancel,
        )?;
        Ok(vec![
            obs(SignalId::AdminCount, Observed::Count(admins)),
            obs(SignalId::UserCount, Observed::Count(users)),
            obs(SignalId::HiddenUserCount, Observed::Count(hidden)),
            obs(
                SignalId::Autologin,
                Observed::Bool(auto.is_some_and(|v| !v.trim().is_empty())),
            ),
        ])
    }

    fn scope_of(scope: LaunchItemScope) -> DetailsScope {
        match scope {
            LaunchItemScope::UserAgent => DetailsScope::UserAgent,
            LaunchItemScope::SystemAgent => DetailsScope::SystemAgent,
            LaunchItemScope::SystemDaemon => DetailsScope::SystemDaemon,
        }
    }

    fn persistence_probe(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let section = persistence::collect(cancel);
        let items = section.as_ok().map(|p| p.items.clone()).ok_or_else(|| {
            Fail::new(
                section
                    .reason()
                    .unwrap_or(UnavailableReason::CollectorError),
                "persistence",
            )
        })?;
        let home = macos::home()?;
        let exe = own_exe();
        let members: Vec<Member> = items
            .iter()
            .map(|item| {
                let stat = stat_key(Path::new(&item.plist_path));
                Member {
                    key: format!(
                        "{}|{}|{}",
                        item.plist_path,
                        stat,
                        item.program_exists.unwrap_or(false)
                    ),
                    detail: MemberDetail::Launch {
                        plist_path: item.plist_path.clone(),
                        label: item.label.clone(),
                        program: item.program.clone(),
                        scope: scope_of(item.scope),
                        temp_or_hidden: item
                            .program
                            .as_deref()
                            .is_some_and(|p| is_temp_or_hidden(p, &home)),
                        own_agent: is_own_agent(item.program.as_deref(), exe.as_deref()),
                    },
                }
            })
            .collect();
        Ok(vec![
            obs(SignalId::PersistenceSet, Observed::Set(members)),
            obs(
                SignalId::HelperToolsCount,
                Observed::Count(dir_count("/Library/PrivilegedHelperTools")),
            ),
        ])
    }

    fn network_config(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let listing = run(Bin::Networksetup, &["-listallnetworkservices"], cancel)?;
        macos::check_exit(&listing, Bin::Networksetup)?;
        let mut dns = false;
        let mut proxy = false;
        let mut pac = false;
        for service in parse_network_services(&listing.stdout) {
            let servers = run(Bin::Networksetup, &["-getdnsservers", &service], cancel)?;
            dns |= servers.success() && parse_dns_manual(&servers.stdout);
            for flag in [
                "-getwebproxy",
                "-getsecurewebproxy",
                "-getsocksfirewallproxy",
            ] {
                let out = run(Bin::Networksetup, &[flag, &service], cancel)?;
                proxy |= parse_proxy_enabled(&out.stdout);
            }
            let auto = run(Bin::Networksetup, &["-getautoproxyurl", &service], cancel)?;
            pac |= parse_proxy_enabled(&auto.stdout);
        }
        let scutil = run(Bin::Scutil, &["--dns"], cancel)?;
        let resolvers = parse_resolvers(&scutil.stdout)
            .into_iter()
            .map(Member::plain)
            .collect();
        Ok(vec![
            obs(SignalId::DnsManual, Observed::Bool(dns)),
            obs(SignalId::ProxyOn, Observed::Bool(proxy)),
            obs(SignalId::PacUrlSet, Observed::Bool(pac)),
            obs(SignalId::Resolvers, Observed::Set(resolvers)),
        ])
    }

    fn hosts(_cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        Ok(vec![obs(
            SignalId::HostsChanged,
            Observed::Set(vec![Member::plain(stat_key(Path::new("/etc/hosts")))]),
        )])
    }

    fn profiles(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let list = run(Bin::Profiles, &["list"], cancel)?;
        let status = run(Bin::Profiles, &["status", "-type", "enrollment"], cancel)?;
        Ok(vec![
            obs(
                SignalId::ProfilesCount,
                Observed::Count(parse_profiles_count(&list.stdout)),
            ),
            obs(
                SignalId::MdmEnrolled,
                Observed::Bool(parse_mdm_enrolled(&status.stdout)),
            ),
            obs(
                SignalId::ManagedPrefsCount,
                Observed::Count(dir_count("/Library/Managed Preferences")),
            ),
        ])
    }

    fn extensions(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let sysext = run(Bin::Systemextensionsctl, &["list"], cancel)?;
        let kmutil = run(Bin::Kmutil, &["showloaded", "--list-only"], cancel)?;
        Ok(vec![
            obs(
                SignalId::SysextCount,
                Observed::Count(parse_sysext_count(&sysext.stdout)),
            ),
            obs(
                SignalId::KextCount,
                Observed::Count(parse_kext_count(&kmutil.stdout)),
            ),
        ])
    }

    fn backup_probe(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let info = run(Bin::Tmutil, &["destinationinfo"], cancel)?;
        let destinations = backup::parse_destination_count(&info.stdout);
        let auto = defaults::read_key(
            backup::TIME_MACHINE_DOMAIN,
            "AutoBackup",
            "TimeMachine AutoBackup",
            cancel,
        )?;
        let mut out = vec![
            obs(
                SignalId::BackupAuto,
                Observed::Bool(auto.as_deref().and_then(defaults::as_bool).unwrap_or(false)),
            ),
            obs(SignalId::BackupDestinations, Observed::Count(destinations)),
        ];
        if destinations > 0 {
            let latest = run(Bin::Tmutil, &["latestbackup"], cancel)?;
            let (_, at) = backup::parse_latest_backup(&latest.stdout, &latest.stderr);
            if let Some(ms) = at.as_deref().and_then(super::super::signals::parse_ms) {
                let days = (chrono::Utc::now().timestamp_millis() - ms).max(0) / 86_400_000;
                out.push(obs(
                    SignalId::BackupAgeDays,
                    Observed::Count(age_bucket(days as u64)),
                ));
            }
        }
        Ok(out)
    }

    fn lockdown(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let value = defaults::read_key("-g", "LDMGlobalEnabled", "LDMGlobalEnabled", cancel)?;
        Ok(vec![obs(
            SignalId::LockdownMode,
            Observed::Bool(
                value
                    .as_deref()
                    .and_then(defaults::as_bool)
                    .unwrap_or(false),
            ),
        )])
    }

    fn sudo_config(_cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let key = format!(
            "sudo:{}|sudo_local:{}",
            stat_key(Path::new("/etc/pam.d/sudo")),
            stat_key(Path::new("/etc/pam.d/sudo_local"))
        );
        Ok(vec![
            obs(
                SignalId::SudoersDCount,
                Observed::Count(dir_count("/etc/sudoers.d")),
            ),
            obs(
                SignalId::PamSudoChanged,
                Observed::Set(vec![Member::plain(key)]),
            ),
        ])
    }

    fn ssh_keys(_cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let home = macos::home()?;
        let authorized = stat_key(&home.join(".ssh/authorized_keys"));
        let sshd = format!(
            "{}|{}",
            stat_key(Path::new("/etc/ssh/sshd_config")),
            dir_count("/etc/ssh/sshd_config.d")
        );
        Ok(vec![
            obs(
                SignalId::AuthorizedKeysChanged,
                Observed::Set(vec![Member::plain(authorized)]),
            ),
            obs(
                SignalId::SshdConfigChanged,
                Observed::Set(vec![Member::plain(sshd)]),
            ),
        ])
    }

    fn host_metrics(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let mut loads = [0f64; 3];
        // SAFETY: getloadavg writes at most three doubles into the array it is given.
        let got = unsafe { libc::getloadavg(loads.as_mut_ptr(), 3) };
        let load = if got > 0 {
            loads.first().copied().unwrap_or(0.0).round().max(0.0) as u64
        } else {
            0
        };
        let pct = free_pct("/").unwrap_or(0);
        let batt = run(Bin::Pmset, &["-g", "batt"], cancel)?;
        Ok(vec![
            obs(SignalId::LoadAvg, Observed::Count(load)),
            obs(SignalId::DiskFreePct, Observed::Count(pct_bucket(pct))),
            obs(
                SignalId::OnBattery,
                Observed::Bool(parse_on_battery(&batt.stdout)),
            ),
        ])
    }

    fn free_pct(path: &str) -> Option<u64> {
        let c_path = std::ffi::CString::new(path).ok()?;
        let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
        // SAFETY: a NUL-terminated path and a zeroed statfs buffer of the right size.
        let rc = unsafe { libc::statfs(c_path.as_ptr(), &mut stat) };
        if rc != 0 || stat.f_blocks == 0 {
            return None;
        }
        Some((stat.f_bavail as u128 * 100 / stat.f_blocks as u128) as u64)
    }

    fn updates_probe(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let section = updates::collect(cancel);
        let data = section.as_ok().ok_or_else(|| {
            Fail::new(
                section
                    .reason()
                    .unwrap_or(UnavailableReason::CollectorError),
                "updates",
            )
        })?;
        Ok(vec![obs(
            SignalId::PendingUpdates,
            Observed::Count(data.pending_count.unwrap_or(0)),
        )])
    }

    fn scheduled(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let cron = run(Bin::Crontab, &["-l"], cancel)?;
        let at = run(Bin::Atq, &[], cancel)?;
        let legacy = dir_count("/Library/StartupItems")
            + dir_count("/Library/ScriptingAdditions")
            + dir_count("/Library/Security/SecurityAgentPlugins");
        Ok(vec![
            obs(
                SignalId::CronLines,
                Observed::Count(parse_cron_lines(&cron)),
            ),
            obs(SignalId::AtJobs, Observed::Count(parse_at_jobs(&at.stdout))),
            obs(SignalId::LegacyStartupCount, Observed::Count(legacy)),
        ])
    }

    fn logins(cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        let out = run(Bin::Last, &["-n", "50"], cancel)?;
        Ok(vec![obs(
            SignalId::RemoteLogins,
            Observed::Count(parse_remote_logins(&out.stdout)),
        )])
    }

    pub fn run_probe(id: ProbeId, cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
        match id {
            ProbeId::PlatformIntegrity => platform_integrity(cancel),
            ProbeId::Firewall => firewall_probe(cancel),
            ProbeId::MalwareProtection => malware(cancel),
            ProbeId::RemoteAccess => remote(cancel),
            ProbeId::FileSharing => sharing(cancel),
            ProbeId::Listeners => listeners_probe(cancel),
            ProbeId::Accounts => accounts_probe(cancel),
            ProbeId::Persistence => persistence_probe(cancel),
            ProbeId::PersistenceSignatures => Ok(Vec::new()),
            ProbeId::NetworkConfig => network_config(cancel),
            ProbeId::Hosts => hosts(cancel),
            ProbeId::Profiles => profiles(cancel),
            ProbeId::SystemExtensions => extensions(cancel),
            ProbeId::Backup => backup_probe(cancel),
            ProbeId::LockdownMode => lockdown(cancel),
            ProbeId::SudoConfig => sudo_config(cancel),
            ProbeId::SshKeys => ssh_keys(cancel),
            ProbeId::HostMetrics => host_metrics(cancel),
            ProbeId::Updates => updates_probe(cancel),
            ProbeId::ScheduledJobs => scheduled(cancel),
            ProbeId::Logins => logins(cancel),
        }
    }

    /// The two full-check sections, each only when its permission is granted.
    pub fn run_full_check(caps: &Capabilities, cancel: &AtomicBool) -> Vec<Observation> {
        use crate::collect::macos::{browsers, login_items};
        let mut out = Vec::new();
        for (key, needs) in FULL_CHECK_SECTIONS {
            let granted = match needs {
                Needs::Automation => {
                    caps.automation == Some(crate::automation::AutomationStatus::Granted)
                }
                Needs::FullDiskAccess => caps.full_disk_access == Some(true),
                Needs::None => true,
            };
            if !granted {
                continue;
            }
            match key {
                SectionKey::LoginItems => {
                    if let Some(items) = login_items::collect(cancel).as_ok() {
                        out.push(obs(SignalId::LoginItemsCount, Observed::Count(items.count)));
                    }
                }
                SectionKey::Browsers => {
                    if let Some(report) = browsers::collect(cancel).as_ok() {
                        let broad = report
                            .installed
                            .iter()
                            .filter_map(|b| b.extensions.as_ok())
                            .flat_map(|list| list.iter())
                            .filter(|e| e.broad_host_access)
                            .count() as u64;
                        out.push(obs(SignalId::BroadExtensionCount, Observed::Count(broad)));
                    }
                }
                _ => {}
            }
        }
        out
    }
}

#[cfg(target_os = "macos")]
pub use live::{run_full_check, run_probe};

#[cfg(not(target_os = "macos"))]
pub fn run_probe(_id: ProbeId, _cancel: &AtomicBool) -> Result<Vec<Observation>, Fail> {
    Err(Fail::new(UnavailableReason::NotSupportedOnOs, "watch"))
}

#[cfg(not(target_os = "macos"))]
pub fn run_full_check(_caps: &Capabilities, _cancel: &AtomicBool) -> Vec<Observation> {
    Vec::new()
}

/// Runs the probes in parallel; the ones still pending at the budget read `timeout`.
pub fn run_sweep(ids: &[ProbeId], budget: Duration) -> Vec<ProbeOutcome> {
    let started = Instant::now();
    let (tx, rx) = mpsc::channel::<ProbeOutcome>();
    let mut pending: Vec<ProbeId> = Vec::new();
    let mut outcomes: Vec<ProbeOutcome> = Vec::new();
    for id in ids.iter().copied() {
        let tx = tx.clone();
        let spawned = std::thread::Builder::new()
            .name(format!("talos-watch-{}", id.as_str()))
            .spawn(move || {
                let result = std::panic::catch_unwind(|| run_probe(id, &AtomicBool::new(false)))
                    .unwrap_or_else(|_| Err(Fail::collector("panic")))
                    .map_err(|fail| fail.reason);
                let _ = tx.send(ProbeOutcome { probe: id, result });
            });
        match spawned {
            Ok(_) => pending.push(id),
            Err(_) => outcomes.push(ProbeOutcome {
                probe: id,
                result: Err(UnavailableReason::CollectorError),
            }),
        }
    }
    drop(tx);
    while !pending.is_empty() {
        let remaining = budget.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining) {
            Ok(outcome) => {
                pending.retain(|p| *p != outcome.probe);
                outcomes.push(outcome);
            }
            Err(_) => break,
        }
    }
    for id in pending {
        outcomes.push(ProbeOutcome {
            probe: id,
            result: Err(UnavailableReason::Timeout),
        });
    }
    outcomes.sort_by_key(|o| PROBES.iter().position(|p| p.id == o.probe));
    outcomes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures")
                .join(name),
        )
        .unwrap()
    }

    fn output(code: i32, stdout: &str, stderr: &str) -> Output {
        Output {
            stdout: stdout.to_owned(),
            stderr: stderr.to_owned(),
            exit_code: Some(code),
            truncated: false,
        }
    }

    #[test]
    fn the_full_check_is_exactly_login_items_and_browsers() {
        assert_eq!(FULL_CHECK_SECTIONS.len(), 2);
        assert_eq!(
            FULL_CHECK_SECTIONS[0],
            (SectionKey::LoginItems, Needs::Automation)
        );
        assert_eq!(
            FULL_CHECK_SECTIONS[1],
            (SectionKey::Browsers, Needs::FullDiskAccess)
        );
        for key in SectionKey::ALL {
            let present = FULL_CHECK_SECTIONS.iter().any(|(k, _)| *k == key);
            assert_eq!(
                present,
                matches!(key, SectionKey::LoginItems | SectionKey::Browsers),
                "{}",
                key.as_str()
            );
        }
    }

    #[test]
    fn the_table_covers_every_probe_and_the_rust_only_two_are_never_model_choosable() {
        assert_eq!(PROBES.len(), ProbeId::ALL.len());
        for (row, id) in PROBES.iter().zip(ProbeId::ALL) {
            assert_eq!(row.id, *id);
            assert_eq!(row.model_choosable, !id.rust_only(), "{}", id.as_str());
            assert!(!row.signals.is_empty());
        }
        assert_eq!(model_probes().len(), 19);
        assert_eq!(sweep_probes().len(), 20);
        assert_eq!(
            probe_of(SignalId::PersistenceUnsigned),
            Some(ProbeId::Persistence)
        );
        assert_eq!(probe_of(SignalId::LoginItemsCount), None);
        assert!(probe_for(ProbeId::Updates).is_some_and(|p| p.min_interval == H1));
    }

    #[test]
    fn parsers_read_the_captured_fixtures() {
        assert!(!parse_boot_args(&output(
            1,
            "",
            &fixture("nvram-boot-args.txt")
        )));
        assert!(parse_boot_args(&output(0, "boot-args\t-v\n", "")));
        assert!(
            parse_boot_args(&output(1, "", "nvram: some other error")),
            "an unknown error is not the good state"
        );
        assert_eq!(
            parse_xprotect_version(&fixture("xprotect-version.txt")),
            Some(5367)
        );
        assert_eq!(
            parse_xprotect_status(&fixture("xprotect-status.txt")),
            Some(true)
        );
        assert_eq!(
            parse_xprotect_status(
                "XProtect launch scans: enabled\nXProtect background scans: disabled\n"
            ),
            Some(false)
        );
        assert_eq!(parse_xprotect_status(""), None);
        assert_eq!(parse_profiles_count(&fixture("profiles-list.txt")), 0);
        assert_eq!(
            parse_profiles_count(
                "_computerlevel[1] attribute: profileIdentifier: com.x\nalice[1] attribute: profileIdentifier: com.y\n"
            ),
            2
        );
        assert!(!parse_mdm_enrolled(&fixture("profiles-status.txt")));
        assert!(parse_mdm_enrolled(
            "Enrolled via DEP: No\nMDM enrollment: Yes (User Approved)\n"
        ));
        assert_eq!(
            parse_sysext_count(&fixture("systemextensionsctl-list.txt")),
            0
        );
        assert_eq!(
            parse_sysext_count(
                "1 extension(s)\n--- com.apple.system_extension.network_extension\nenabled\tactive\tteamID\tbundleID (version)\tname\t[state]\n*\t*\tABC\tcom.x.vpn (1.0/1)\tVPN\t[activated enabled]\n"
            ),
            1
        );
        assert_eq!(
            parse_kext_count(&fixture("kmutil-showloaded.txt")),
            0,
            "every loaded kext on this Mac is Apple's"
        );
        assert_eq!(
            parse_kext_count(
                "   10    6 0xfffffe0007130000 0x7098     0x7098     com.example.kext (1) 4E36 <6>\n"
            ),
            1
        );
        assert_eq!(
            parse_wifi_device(&fixture("networksetup-hardwareports.txt")).as_deref(),
            Some("en0")
        );
        assert_eq!(
            parse_wifi_device("Hardware Port: Ethernet\nDevice: en4\n"),
            None
        );
        assert!(!parse_dns_manual(&fixture("networksetup-dns.txt")));
        assert!(parse_dns_manual("192.0.2.1\n192.0.2.2\n"));
        assert!(!parse_proxy_enabled(&fixture("networksetup-proxy.txt")));
        assert!(parse_proxy_enabled(
            "Enabled: Yes\nServer: proxy.example\nPort: 8080\n"
        ));
        assert_eq!(
            parse_resolvers(&fixture("scutil-dns.txt")),
            vec![
                "192.0.2.53".to_owned(),
                "192.0.2.54".to_owned(),
                "192.0.2.55".to_owned()
            ]
        );
        assert!(fixture("scutil-proxy.txt").contains("<dictionary>"));
        assert!(!parse_on_battery(&fixture("pmset-batt.txt")));
        assert!(parse_on_battery(
            "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t80%; discharging; 3:00 remaining present: true\n"
        ));
        assert_eq!(
            parse_cron_lines(&output(1, "", &fixture("crontab-l.txt"))),
            0
        );
        assert_eq!(
            parse_cron_lines(&output(
                0,
                "# comment\n\n*/5 * * * * /tmp/x\n0 1 * * * /tmp/y\n",
                ""
            )),
            2
        );
        assert_eq!(parse_at_jobs(&fixture("atq.txt")), 0);
        assert_eq!(parse_at_jobs("1\talice\tFri Oct 17 12:00:00 2026\n"), 1);
        assert_eq!(parse_remote_logins(&fixture("last-n50.txt")), 0);
        assert_eq!(
            parse_remote_logins(
                "alice     ttys001  203.0.113.5      Thu Oct 16 10:00 - 10:05  (00:05)\nalice     console                   Thu Oct  8 16:22   still logged in\nreboot    time                      Thu Oct  8 16:21\n"
            ),
            1
        );
        assert_eq!(
            parse_network_services(
                "An asterisk (*) denotes that a network service is disabled.\nThunderbolt Bridge\n*Wi-Fi\n"
            ),
            vec!["Thunderbolt Bridge".to_owned(), "Wi-Fi".to_owned()]
        );
        assert_eq!(
            count_established(&fixture("netstat.txt")),
            fixture("netstat.txt")
                .lines()
                .filter(|l| l.contains("ESTABLISHED"))
                .count() as u64
        );
        assert_eq!(leading_number("2.5.1"), Some(2));
        assert_eq!(leading_number("x"), None);
    }

    #[test]
    fn hidden_users_need_a_human_uid_and_the_flag() {
        let ids: std::collections::HashMap<String, i64> = [
            ("alice".to_owned(), 501),
            ("_svc".to_owned(), 200),
            ("ghost".to_owned(), 502),
        ]
        .into_iter()
        .collect();
        let text = "alice 0\n_svc 1\nghost 1\nunknown 1\n";
        assert_eq!(parse_hidden_users(text, Some(&ids)), 1);
        assert_eq!(parse_hidden_users(text, None), 3);
    }

    #[test]
    fn buckets_are_coarse() {
        assert_eq!(
            (
                age_bucket(0),
                age_bucket(1),
                age_bucket(2),
                age_bucket(7),
                age_bucket(8),
                age_bucket(31)
            ),
            (0, 0, 1, 1, 2, 3)
        );
        assert_eq!(
            (
                count_bucket(0),
                count_bucket(9),
                count_bucket(10),
                count_bucket(100)
            ),
            (0, 1, 2, 3)
        );
        assert_eq!(pct_bucket(47), 4);
        assert_eq!(stat_key(Path::new("/nonexistent/talos")), "absent");
        assert!(stat_key(Path::new("/etc/hosts")).contains('|'));
    }

    #[test]
    fn a_sweep_over_a_pending_probe_reads_timeout_at_the_budget() {
        let outcomes = run_sweep(
            &[ProbeId::Hosts, ProbeId::SudoConfig],
            Duration::from_secs(5),
        );
        assert_eq!(outcomes.len(), 2);
        assert!(outcomes.iter().all(|o| o.result.is_ok()), "{outcomes:?}");
        let empty = run_sweep(&[], Duration::from_millis(10));
        assert!(empty.is_empty());
    }
}
