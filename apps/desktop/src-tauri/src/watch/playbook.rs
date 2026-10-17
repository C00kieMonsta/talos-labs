//! The playbook catalogue from docs/DESIGN-WATCH.md section 4. Every suggested action is a row
//! here and nowhere else; `packages/core/src/watch/playbook.ts` holds the same rows and
//! tests/playbook_contract.rs pins both to fixtures/playbook.json. The URL opens only from
//! `watch_open_source`, by action id.

use super::{ActionId, Rating, SignalId};
use crate::settings_pane::SettingsPane;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    N3,
    N2,
    CSr,
    CMc,
    CTr,
    SHb,
    S504,
    Ncsc,
    APsg,
    AAcct,
    APs1,
    APsAcct,
    APsLdm,
    ALdm,
    ALogin,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::N3 => "N3",
            Source::N2 => "N2",
            Source::CSr => "C-SR",
            Source::CMc => "C-MC",
            Source::CTr => "C-TR",
            Source::SHb => "S-HB",
            Source::S504 => "S-504",
            Source::Ncsc => "NCSC",
            Source::APsg => "A-PSG",
            Source::AAcct => "A-ACCT",
            Source::APs1 => "A-PS1",
            Source::APsAcct => "A-PS-ACCT",
            Source::APsLdm => "A-PS-LDM",
            Source::ALdm => "A-LDM",
            Source::ALogin => "A-LOGIN",
        }
    }

    pub fn url(self) -> &'static str {
        source_url(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionKind {
    /// A FixSpec id: a TL-MAC rule in FIX_CATALOG or a watch.* id in WATCH_CATALOG.
    Fix {
        spec: &'static str,
    },
    Pane(SettingsPane),
    Reveal {
        rule: &'static str,
    },
    Recheck,
    Advise,
}

#[derive(Debug, Clone, Copy)]
pub struct PlaybookAction {
    pub id: ActionId,
    pub source: Source,
    pub step: &'static str,
    pub url: &'static str,
    pub kind: ActionKind,
    pub floor: Rating,
    pub triggers: &'static [SignalId],
    pub title: &'static str,
    pub what_experts_do: &'static str,
    pub phase: &'static str,
    pub outcome: &'static str,
}

/// Every signal that can put the watch into act now: stand-alone, gated, then pair.
pub const ALARM: [SignalId; 22] = [
    SignalId::Sip,
    SignalId::Gatekeeper,
    SignalId::XprotectPresent,
    SignalId::XprotectScansEnabled,
    SignalId::XprotectVersion,
    SignalId::HiddenUserCount,
    SignalId::Firewall,
    SignalId::RemoteAccessOn,
    SignalId::GuestShare,
    SignalId::Autologin,
    SignalId::AdminCount,
    SignalId::BackupAuto,
    SignalId::PersistenceNew,
    SignalId::PersistenceUnsigned,
    SignalId::PersistenceInTempOrHidden,
    SignalId::ListenerNewPorts,
    SignalId::DnsManual,
    SignalId::PacUrlSet,
    SignalId::ProfilesCount,
    SignalId::SysextCount,
    SignalId::AuthorizedKeysChanged,
    SignalId::CronLines,
];

const PERSISTENCE: [SignalId; 9] = [
    SignalId::PersistenceSet,
    SignalId::PersistenceNew,
    SignalId::PersistenceUnsigned,
    SignalId::PersistenceInTempOrHidden,
    SignalId::HelperToolsCount,
    SignalId::LoginItemsCount,
    SignalId::CronLines,
    SignalId::AtJobs,
    SignalId::LegacyStartupCount,
];

const REMOTE: [SignalId; 4] = [
    SignalId::RemoteAccessOn,
    SignalId::AuthorizedKeysChanged,
    SignalId::SshdConfigChanged,
    SignalId::RemoteLogins,
];

const GUARDS: [SignalId; 6] = [
    SignalId::Gatekeeper,
    SignalId::Sip,
    SignalId::XprotectPresent,
    SignalId::XprotectScansEnabled,
    SignalId::XprotectVersion,
    SignalId::BootArgsSet,
];

const STOP_TRIGGERS: [SignalId; 5] = [
    SignalId::PersistenceSet,
    SignalId::PersistenceNew,
    SignalId::PersistenceUnsigned,
    SignalId::PersistenceInTempOrHidden,
    SignalId::ListenerNewPorts,
];

const GUEST: [SignalId; 2] = [SignalId::GuestShare, SignalId::ShareCount];
const FIREWALL: [SignalId; 1] = [SignalId::Firewall];

const ALARM_PLUS_UPDATES: [SignalId; 23] = [
    SignalId::Sip,
    SignalId::Gatekeeper,
    SignalId::XprotectPresent,
    SignalId::XprotectScansEnabled,
    SignalId::XprotectVersion,
    SignalId::HiddenUserCount,
    SignalId::Firewall,
    SignalId::RemoteAccessOn,
    SignalId::GuestShare,
    SignalId::Autologin,
    SignalId::AdminCount,
    SignalId::BackupAuto,
    SignalId::PersistenceNew,
    SignalId::PersistenceUnsigned,
    SignalId::PersistenceInTempOrHidden,
    SignalId::ListenerNewPorts,
    SignalId::DnsManual,
    SignalId::PacUrlSet,
    SignalId::ProfilesCount,
    SignalId::SysextCount,
    SignalId::AuthorizedKeysChanged,
    SignalId::CronLines,
    SignalId::PendingUpdates,
];

const ALARM_PLUS_LOCKDOWN: [SignalId; 23] = [
    SignalId::Sip,
    SignalId::Gatekeeper,
    SignalId::XprotectPresent,
    SignalId::XprotectScansEnabled,
    SignalId::XprotectVersion,
    SignalId::HiddenUserCount,
    SignalId::Firewall,
    SignalId::RemoteAccessOn,
    SignalId::GuestShare,
    SignalId::Autologin,
    SignalId::AdminCount,
    SignalId::BackupAuto,
    SignalId::PersistenceNew,
    SignalId::PersistenceUnsigned,
    SignalId::PersistenceInTempOrHidden,
    SignalId::ListenerNewPorts,
    SignalId::DnsManual,
    SignalId::PacUrlSet,
    SignalId::ProfilesCount,
    SignalId::SysextCount,
    SignalId::AuthorizedKeysChanged,
    SignalId::CronLines,
    SignalId::LockdownMode,
];

// One positional row builder keeps the table readable; the eleven fields are the contract.
#[allow(clippy::too_many_arguments)]
const fn row(
    id: ActionId,
    source: Source,
    step: &'static str,
    kind: ActionKind,
    floor: Rating,
    triggers: &'static [SignalId],
    title: &'static str,
    what_experts_do: &'static str,
    phase: &'static str,
    outcome: &'static str,
) -> PlaybookAction {
    PlaybookAction {
        id,
        source,
        step,
        url: source_url(source),
        kind,
        floor,
        triggers,
        title,
        what_experts_do,
        phase,
        outcome,
    }
}

const fn source_url(source: Source) -> &'static str {
    match source {
        Source::N3 => "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r3.pdf",
        Source::N2 => "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r2.pdf",
        Source::CSr => {
            "https://www.cisa.gov/sites/default/files/2025-03/StopRansomware-Guide%20508.pdf"
        }
        Source::CMc => "https://www.cisa.gov/news-events/news/protecting-against-malicious-code",
        Source::CTr => "https://www.cisa.gov/sites/default/files/publications/trojan-recovery.pdf",
        Source::SHb => "https://www.sans.org/white-papers/33901/",
        Source::S504 => "https://www.sans.org/media/score/504-incident-response-cycle.pdf",
        Source::Ncsc => {
            "https://www.ncsc.gov.uk/guidance/mitigating-malware-and-ransomware-attacks"
        }
        Source::APsg => {
            "https://support.apple.com/guide/security/protecting-against-malware-sec469d47bd8/web"
        }
        Source::AAcct => "https://support.apple.com/en-us/102560",
        Source::APs1 => {
            "https://support.apple.com/guide/personal-safety/checklist-1-limit-device-and-account-access-ipsb8deced49/web"
        }
        Source::APsAcct => {
            "https://support.apple.com/guide/personal-safety/keep-your-apple-account-secure-ips7d5628cc5/web"
        }
        Source::APsLdm => {
            "https://support.apple.com/guide/personal-safety/harden-your-devices-with-lockdown-mode-ipsd5baf79d0/web"
        }
        Source::ALdm => "https://support.apple.com/en-us/105120",
        Source::ALogin => {
            "https://support.apple.com/guide/mac-help/change-login-items-extensions-settings-mtusr003/mac"
        }
    }
}

/// The 24 rows in section 4 order.
pub static PLAYBOOK: [PlaybookAction; 24] = [
    row(
        ActionId::DisconnectNetwork,
        Source::CSr,
        "CISA #StopRansomware v3.0, Part 2, step 1",
        ActionKind::Fix {
            spec: "watch.wifi_off",
        },
        Rating::ActNow,
        &ALARM,
        "Cut it off from the internet",
        "Experts cut the machine off from the network first, before anything else.",
        "containment",
        "RS.MI-01",
    ),
    row(
        ActionId::BlockIncoming,
        Source::CSr,
        "CISA #StopRansomware v3.0, Part 2, step 1",
        ActionKind::Fix {
            spec: "watch.block_incoming",
        },
        Rating::ActNow,
        &ALARM,
        "Block incoming connections",
        "When the cable cannot be pulled, experts stop what the machine accepts from the network.",
        "containment",
        "RS.MI-01",
    ),
    row(
        ActionId::DoNotPowerOff,
        Source::CSr,
        "CISA #StopRansomware v3.0, Part 2, step 2",
        ActionKind::Advise,
        Rating::ActNow,
        &ALARM,
        "Keep the Mac running",
        "Experts keep the machine on so the trace of what happened is not lost.",
        "containment",
        "RS.AN-07",
    ),
    row(
        ActionId::NoteWhatYouSaw,
        Source::N2,
        "NIST SP 800-61 (2012 edition), section 3.3.2",
        ActionKind::Advise,
        Rating::KeepAnEye,
        &ALARM,
        "Write down what you saw",
        "Experts note what they saw and when, and delete nothing.",
        "containment",
        "RS.AN-07",
    ),
    row(
        ActionId::DoNotWait,
        Source::N2,
        "NIST SP 800-61 (2012 edition), section 3.3.1",
        ActionKind::Advise,
        Rating::ActNow,
        &ALARM,
        "Do not wait",
        "Experts say a delay lets an attacker go further.",
        "containment",
        "RS.MI-01",
    ),
    row(
        ActionId::StopBackgroundProgram,
        Source::CSr,
        "CISA #StopRansomware v3.0, Part 2, step 11",
        ActionKind::Fix {
            spec: "watch.stop_user_agent",
        },
        Rating::ActNow,
        &STOP_TRIGGERS,
        "Stop the program",
        "Experts stop the program from running and keep the file for a closer look.",
        "eradication",
        "RS.MI-01",
    ),
    row(
        ActionId::ReviewBackgroundPrograms,
        Source::N3,
        "NIST SP 800-61 (2025), RS.MI-02",
        ActionKind::Pane(SettingsPane::LoginItems),
        Rating::KeepAnEye,
        &PERSISTENCE,
        "Keep it from starting again",
        "Experts remove the entry that starts the program, then check the list again.",
        "eradication",
        "RS.MI-02",
    ),
    row(
        ActionId::TurnOffRemoteAccess,
        Source::CSr,
        "CISA #StopRansomware v3.0, Part 2, step 13",
        ActionKind::Fix { spec: "TL-MAC-019" },
        Rating::KeepAnEye,
        &REMOTE,
        "Turn off remote access",
        "Experts close the ways in from outside before cleaning up.",
        "containment",
        "RS.MI-02",
    ),
    row(
        ActionId::StopGuestSharing,
        Source::N3,
        "NIST SP 800-61 (2025), RS.MI-02",
        ActionKind::Fix { spec: "TL-MAC-022" },
        Rating::KeepAnEye,
        &GUEST,
        "Stop guest sharing",
        "Experts close shared folders that anyone can reach.",
        "eradication",
        "RS.MI-02",
    ),
    row(
        ActionId::TurnOnFirewall,
        Source::N2,
        "NIST SP 800-61 (2012 edition), section 3.3.4",
        ActionKind::Fix { spec: "TL-MAC-002" },
        Rating::KeepAnEye,
        &FIREWALL,
        "Turn the firewall on",
        "Experts tighten what the machine accepts from the network.",
        "recovery",
        "RC",
    ),
    row(
        ActionId::TurnOnBuiltinProtection,
        Source::APsg,
        "Apple Platform Security, Protecting against malware in macOS",
        ActionKind::Pane(SettingsPane::Security),
        Rating::KeepAnEye,
        &GUARDS,
        "Turn built-in protection back on",
        "Experts make sure the Mac's own protection is on before anything else.",
        "recovery",
        "RC",
    ),
    row(
        ActionId::Report,
        Source::CSr,
        "CISA #StopRansomware v3.0, Part 2, step 7",
        ActionKind::Advise,
        Rating::KeepAnEye,
        &ALARM,
        "Tell someone",
        "Experts tell the police, a cyber security centre, or their IT person.",
        "identification",
        "RS.CO-03",
    ),
    row(
        ActionId::ChangePasswords,
        Source::CSr,
        "CISA #StopRansomware v3.0, Part 2, step 17",
        ActionKind::Advise,
        Rating::ActNow,
        &ALARM,
        "Change your passwords",
        "Experts change passwords once the machine is clean, from another device.",
        "recovery",
        "RC",
    ),
    row(
        ActionId::ReviewAppleAccountDevices,
        Source::AAcct,
        "Apple, If you think your Apple Account has been compromised",
        ActionKind::Advise,
        Rating::ActNow,
        &ALARM,
        "Check your Apple Account devices",
        "Experts remove any device they do not know from the account.",
        "recovery",
        "RC",
    ),
    row(
        ActionId::TurnOn2fa,
        Source::AAcct,
        "Apple, If you think your Apple Account has been compromised",
        ActionKind::Advise,
        Rating::ActNow,
        &ALARM,
        "Turn on two-factor sign-in",
        "Experts add a second step to signing in.",
        "recovery",
        "RC",
    ),
    row(
        ActionId::ScanOrReinstall,
        Source::CTr,
        "CISA, Recovering from a Trojan Horse or Virus, steps 4 and 5",
        ActionKind::Advise,
        Rating::ActNow,
        &ALARM,
        "Wipe and reinstall if unsure",
        "Experts wipe the Mac and reinstall macOS when cleaning cannot be trusted.",
        "eradication",
        "RS.MI-02",
    ),
    row(
        ActionId::CheckBackupBeforeRestore,
        Source::N3,
        "NIST SP 800-61 (2025), RC.RP-03",
        ActionKind::Pane(SettingsPane::TimeMachine),
        Rating::ActNow,
        &ALARM,
        "Check a backup before restoring",
        "Experts restore only from a backup made before the trouble, and check it first.",
        "recovery",
        "RC.RP-03",
    ),
    row(
        ActionId::UpdateNow,
        Source::N2,
        "NIST SP 800-61 (2012 edition), section 3.3.4",
        ActionKind::Pane(SettingsPane::SoftwareUpdate),
        Rating::KeepAnEye,
        &ALARM_PLUS_UPDATES,
        "Install the update",
        "Experts install waiting updates so the same way in is closed.",
        "recovery",
        "RC",
    ),
    row(
        ActionId::DoNotPay,
        Source::CSr,
        "CISA #StopRansomware v3.0, Part 2",
        ActionKind::Advise,
        Rating::ActNow,
        &ALARM,
        "Do not pay",
        "Experts say paying gives no guarantee of getting anything back.",
        "containment",
        "RS.MI-01",
    ),
    row(
        ActionId::LockdownMode,
        Source::ALdm,
        "Apple, About Lockdown Mode",
        ActionKind::Advise,
        Rating::KeepAnEye,
        &ALARM_PLUS_LOCKDOWN,
        "Consider Lockdown Mode",
        "Apple offers it for the very few people who may be singled out.",
        "recovery",
        "RC",
    ),
    row(
        ActionId::ReconnectAndWatch,
        Source::N2,
        "NIST SP 800-61 (2012 edition), section 3.3.4",
        ActionKind::Fix {
            spec: "watch.wifi_on",
        },
        Rating::KeepAnEye,
        &ALARM,
        "Turn Wi-Fi back on",
        "Experts plug back in and watch the machine more closely for a while.",
        "recovery",
        "RC.RP-04",
    ),
    row(
        ActionId::LessonsLearned,
        Source::N2,
        "NIST SP 800-61 (2012 edition), section 3.4.1",
        ActionKind::Advise,
        Rating::KeepAnEye,
        &ALARM,
        "Look back at what happened",
        "Experts look back within two weeks at what to watch for next time.",
        "lessons learned",
        "ID.IM",
    ),
    row(
        ActionId::RunFullCheckup,
        Source::N3,
        "NIST SP 800-61 (2025), DE.CM-09",
        ActionKind::Recheck,
        Rating::KeepAnEye,
        &ALARM,
        "Run a full check-up",
        "Experts check the whole machine against what it looked like before.",
        "identification",
        "DE.CM-09",
    ),
    row(
        ActionId::GetHelp,
        Source::CTr,
        "CISA, Recovering from a Trojan Horse or Virus, step 1",
        ActionKind::Advise,
        Rating::KeepAnEye,
        &ALARM,
        "Get help",
        "Experts call the people whose job it is: Apple Support, a repair shop, or IT.",
        "identification",
        "RS.CO-03",
    ),
];

pub fn action_for(id: ActionId) -> Option<&'static PlaybookAction> {
    PLAYBOOK.iter().find(|row| row.id == id)
}

fn kind_json(kind: ActionKind) -> serde_json::Value {
    match kind {
        ActionKind::Fix { spec } => serde_json::json!({ "kind": "fix", "spec": spec }),
        ActionKind::Pane(pane) => serde_json::json!({ "kind": "pane", "pane": pane }),
        ActionKind::Reveal { rule } => serde_json::json!({ "kind": "reveal", "rule": rule }),
        ActionKind::Recheck => serde_json::json!({ "kind": "recheck" }),
        ActionKind::Advise => serde_json::json!({ "kind": "advise" }),
    }
}

pub fn row_json(row: &PlaybookAction) -> serde_json::Value {
    serde_json::json!({
        "id": row.id,
        "source": row.source.as_str(),
        "step": row.step,
        "url": row.url,
        "kind": kind_json(row.kind),
        "floor": row.floor,
        "triggers": row.triggers,
        "title": row.title,
        "whatExpertsDo": row.what_experts_do,
        "phase": row.phase,
        "outcome": row.outcome,
    })
}

/// The table as JSON, one object per row with the eleven fields of fixtures/playbook.json.
pub fn dump_json() -> String {
    let rows: Vec<serde_json::Value> = PLAYBOOK.iter().map(row_json).collect();
    serde_json::to_string_pretty(&rows).unwrap_or_else(|_| "[]".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watch::signals::{GATED_SIGNALS, PAIR_SIGNALS, STAND_ALONE_SIGNALS};

    #[test]
    fn twenty_four_unique_rows_in_action_id_order_with_https_urls() {
        assert_eq!(PLAYBOOK.len(), ActionId::ALL.len());
        for (row, id) in PLAYBOOK.iter().zip(ActionId::ALL) {
            assert_eq!(row.id, *id);
            assert!(row.url.starts_with("https://"), "{}", row.id.as_str());
            assert_eq!(row.url, row.source.url());
            assert!(
                !row.step.is_empty() && !row.title.is_empty() && !row.what_experts_do.is_empty()
            );
            assert!(!row.phase.is_empty() && !row.outcome.is_empty());
            assert!(!row.triggers.is_empty());
        }
        assert_eq!(
            action_for(ActionId::DoNotPay).map(|r| r.title),
            Some("Do not pay")
        );
    }

    #[test]
    fn alarm_is_stand_alone_then_gated_then_pair() {
        let expected: Vec<SignalId> = STAND_ALONE_SIGNALS
            .iter()
            .chain(GATED_SIGNALS.iter())
            .chain(PAIR_SIGNALS.iter())
            .copied()
            .collect();
        assert_eq!(ALARM.to_vec(), expected);
        assert_eq!(
            ALARM_PLUS_UPDATES.get(..22).map(<[SignalId]>::to_vec),
            Some(expected.clone())
        );
        assert_eq!(ALARM_PLUS_UPDATES.get(22), Some(&SignalId::PendingUpdates));
        assert_eq!(
            ALARM_PLUS_LOCKDOWN.get(..22).map(<[SignalId]>::to_vec),
            Some(expected)
        );
        assert_eq!(ALARM_PLUS_LOCKDOWN.get(22), Some(&SignalId::LockdownMode));
    }

    #[test]
    fn dump_json_carries_the_eleven_fields() {
        let dump: serde_json::Value = serde_json::from_str(&dump_json()).unwrap();
        let first = &dump[0];
        for key in [
            "id",
            "source",
            "step",
            "url",
            "kind",
            "floor",
            "triggers",
            "title",
            "whatExpertsDo",
            "phase",
            "outcome",
        ] {
            assert!(first.get(key).is_some(), "{key}");
        }
        assert_eq!(
            first["kind"],
            serde_json::json!({ "kind": "fix", "spec": "watch.wifi_off" })
        );
        assert_eq!(
            dump[6]["kind"],
            serde_json::json!({ "kind": "pane", "pane": "login_items" })
        );
        assert_eq!(dump[22]["kind"], serde_json::json!({ "kind": "recheck" }));
        assert_eq!(dump[2]["kind"], serde_json::json!({ "kind": "advise" }));
    }
}
