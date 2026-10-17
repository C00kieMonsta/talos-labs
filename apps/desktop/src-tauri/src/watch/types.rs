//! The documents that cross the model and webview boundary. Every type mirrors
//! `packages/core/src/ports/watch-port.ts` field for field and in the same key order, so a
//! context serialised here equals the TypeScript `toWatchContext` output byte for byte.

use serde::{Deserialize, Serialize};

use super::{ActionId, Change, Freshness, ProbeId, Rating, Severity, SignalId};
use crate::state::{Os, SignatureWord};

/// `boolean | number | Change`. Digest kinds and null readings carry the Change.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SignalValue {
    Bool(bool),
    Int(i64),
    Float(f64),
    Change(Change),
}

impl SignalValue {
    pub fn as_number(self) -> Option<f64> {
        match self {
            SignalValue::Int(n) => Some(n as f64),
            SignalValue::Float(n) => Some(n),
            SignalValue::Bool(_) | SignalValue::Change(_) => None,
        }
    }
}

/// `boolean | number`; null is `None`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PreviousValue {
    Bool(bool),
    Int(i64),
    Float(f64),
}

impl PreviousValue {
    pub fn as_number(self) -> Option<f64> {
        match self {
            PreviousValue::Int(n) => Some(n as f64),
            PreviousValue::Float(n) => Some(n),
            PreviousValue::Bool(_) => None,
        }
    }

    pub fn into_signal_value(self) -> SignalValue {
        match self {
            PreviousValue::Bool(b) => SignalValue::Bool(b),
            PreviousValue::Int(n) => SignalValue::Int(n),
            PreviousValue::Float(n) => SignalValue::Float(n),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSignal {
    pub signal_id: SignalId,
    pub value: SignalValue,
    pub previous: Option<PreviousValue>,
    pub change: Change,
    pub severity: Severity,
    pub minutes_since_change: Option<i64>,
    pub freshness: Freshness,
    pub acknowledged: bool,
    pub gated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleStatus {
    Pass,
    Fail,
    Review,
    Unknown,
    NotApplicable,
}

impl RuleStatus {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "pass" => Some(RuleStatus::Pass),
            "fail" => Some(RuleStatus::Fail),
            "review" => Some(RuleStatus::Review),
            "unknown" => Some(RuleStatus::Unknown),
            "not_applicable" => Some(RuleStatus::NotApplicable),
            _ => None,
        }
    }

    /// fail or review: the statuses that need attention.
    pub fn attention(self) -> bool {
        matches!(self, RuleStatus::Fail | RuleStatus::Review)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleChange {
    None,
    Appeared,
    Fixed,
    Unreadable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchRule {
    pub rule_id: String,
    pub status: RuleStatus,
    pub severity: Severity,
    pub change: RuleChange,
    pub minutes_since_change: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchCycle {
    pub index: u64,
    pub minutes_since_full_check: i64,
    pub minutes_since_last_change: Option<i64>,
    pub probes_left: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchRecent {
    pub signal_id: SignalId,
    pub change: Change,
    pub minutes_ago: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchLastVerdict {
    pub rating: Rating,
    pub minutes_ago: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileRole {
    Individual,
    Freelancer,
    SmallBusiness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileTechnical {
    Low,
    Medium,
    High,
}

/// Mirrors core's `ExplainerProfile`: closed enums and booleans only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainerProfile {
    pub role: ProfileRole,
    pub technical: ProfileTechnical,
    pub handles_client_data: bool,
    pub laptop_leaves_home: bool,
}

impl Default for ExplainerProfile {
    /// The desktop's DEFAULT_SETTINGS.profile.
    fn default() -> Self {
        ExplainerProfile {
            role: ProfileRole::Individual,
            technical: ProfileTechnical::Low,
            handles_client_data: false,
            laptop_leaves_home: true,
        }
    }
}

/// The only document the model receives for the watch task.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchContext {
    pub schema_version: u8,
    pub os: Os,
    pub os_version: String,
    pub profile: ExplainerProfile,
    pub cycle: WatchCycle,
    pub floor: Rating,
    pub ceiling: Rating,
    pub rules: Vec<WatchRule>,
    pub signals: Vec<WatchSignal>,
    pub recent: Vec<WatchRecent>,
    pub probes_available: Vec<ProbeId>,
    pub actions_available: Vec<ActionId>,
    pub last_verdict: Option<WatchLastVerdict>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerdictProbe {
    pub probe_id: ProbeId,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerdictAction {
    pub action_id: ActionId,
    pub sentence: String,
}

/// A validated model answer. `rating` is already clamped between the context's floor and ceiling.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchVerdict {
    pub rating: Rating,
    pub rating_reason: String,
    pub based_on: Vec<SignalId>,
    pub probes: Vec<VerdictProbe>,
    pub actions: Vec<VerdictAction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetailsScope {
    UserAgent,
    SystemAgent,
    SystemDaemon,
}

/// One row of machine text for the Details disclosure. Never persisted, never an adapter argument.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchDetailsItem {
    pub signal_id: SignalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plist_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<DetailsScope>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    /// The shell kind: the stat'd file that changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    /// The app kind: the bundle's signature in the closed words.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<SignatureWord>,
}

impl WatchDetailsItem {
    /// A row with every optional field absent.
    pub fn blank(signal_id: SignalId) -> Self {
        WatchDetailsItem {
            signal_id,
            plist_path: None,
            label: None,
            program_path: None,
            scope: None,
            port: None,
            process_name: None,
            file_path: None,
            signature: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchDetails {
    pub items: Vec<WatchDetailsItem>,
    pub wifi_available: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadingKind {
    Bool,
    Count,
    Version,
    Digest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateAnswer {
    Mine,
    NotMine,
}

/// What a probe reduced a signal to, before `to_watch_context` turns it into a `WatchSignal`.
/// Mirrors core's `SignalReading`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalReading {
    pub signal_id: SignalId,
    pub kind: ReadingKind,
    pub value: Option<PreviousValue>,
    pub previous: Option<PreviousValue>,
    pub change: Change,
    pub changed_at: Option<String>,
    pub freshness: Freshness,
    pub previous_freshness: Option<Freshness>,
    pub gate_answer: Option<GateAnswer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codesign_valid: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_by_talos_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_startup_entry: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_listener: Option<bool>,
}

impl Rating {
    pub fn rank(self) -> u8 {
        match self {
            Rating::Calm => 0,
            Rating::KeepAnEye => 1,
            Rating::ActNow => 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signal_values_round_trip_with_integers_kept_as_integers() {
        let cases = [
            ("true", SignalValue::Bool(true)),
            ("2", SignalValue::Int(2)),
            ("2.5", SignalValue::Float(2.5)),
            ("\"changed\"", SignalValue::Change(Change::Changed)),
        ];
        for (text, value) in cases {
            let parsed: SignalValue = serde_json::from_str(text).unwrap();
            assert_eq!(parsed, value);
            assert_eq!(serde_json::to_string(&parsed).unwrap(), text);
        }
        assert!(serde_json::from_str::<SignalValue>("\"nope\"").is_err());
        let previous: Option<PreviousValue> = serde_json::from_str("null").unwrap();
        assert_eq!(previous, None);
        assert_eq!(
            serde_json::from_str::<Option<PreviousValue>>("7").unwrap(),
            Some(PreviousValue::Int(7))
        );
    }

    #[test]
    fn a_signal_serialises_in_the_typescript_key_order() {
        let signal = WatchSignal {
            signal_id: SignalId::Firewall,
            value: SignalValue::Bool(false),
            previous: Some(PreviousValue::Bool(true)),
            change: Change::Changed,
            severity: Severity::High,
            minutes_since_change: Some(5),
            freshness: Freshness::Fresh,
            acknowledged: false,
            gated: true,
        };
        assert_eq!(
            serde_json::to_string(&signal).unwrap(),
            r#"{"signalId":"sig.firewall","value":false,"previous":true,"change":"changed","severity":"high","minutesSinceChange":5,"freshness":"fresh","acknowledged":false,"gated":true}"#
        );
    }

    #[test]
    fn the_profile_default_is_the_desktop_default() {
        let json = serde_json::to_value(ExplainerProfile::default()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "role": "individual", "technical": "low", "handlesClientData": false, "laptopLeavesHome": true })
        );
        assert!(serde_json::from_str::<ExplainerProfile>(r#"{"role":"other","technical":"low","handlesClientData":false,"laptopLeavesHome":false}"#).is_err());
    }

    #[test]
    fn details_items_omit_absent_fields() {
        let item = WatchDetailsItem {
            signal_id: SignalId::ListenerNewPorts,
            port: Some(8080),
            ..WatchDetailsItem::blank(SignalId::ListenerNewPorts)
        };
        assert_eq!(
            serde_json::to_value(&item).unwrap(),
            serde_json::json!({ "signalId": "sig.listener_new_ports", "port": 8080 })
        );
        let app = WatchDetailsItem {
            label: Some("Helper.app".into()),
            program_path: Some("/Applications/Helper.app".into()),
            signature: Some(SignatureWord::Unsigned),
            ..WatchDetailsItem::blank(SignalId::AppSet)
        };
        assert_eq!(
            serde_json::to_value(&app).unwrap(),
            serde_json::json!({ "signalId": "sig.app_set", "label": "Helper.app", "programPath": "/Applications/Helper.app", "signature": "unsigned" })
        );
        let file = WatchDetailsItem {
            file_path: Some("/Users/demo/.zshrc".into()),
            ..WatchDetailsItem::blank(SignalId::ShellStartupChanged)
        };
        assert_eq!(
            serde_json::to_value(&file).unwrap(),
            serde_json::json!({ "signalId": "sig.shell_startup_changed", "filePath": "/Users/demo/.zshrc" })
        );
    }

    #[test]
    fn rule_status_parses_the_five_names() {
        for (name, status) in [
            ("pass", RuleStatus::Pass),
            ("fail", RuleStatus::Fail),
            ("review", RuleStatus::Review),
            ("unknown", RuleStatus::Unknown),
            ("not_applicable", RuleStatus::NotApplicable),
        ] {
            assert_eq!(RuleStatus::parse(name), Some(status));
        }
        assert_eq!(RuleStatus::parse("ok"), None);
        assert!(RuleStatus::Fail.attention() && RuleStatus::Review.attention());
        assert!(!RuleStatus::Pass.attention());
        assert!(Rating::ActNow.rank() > Rating::KeepAnEye.rank());
    }
}
