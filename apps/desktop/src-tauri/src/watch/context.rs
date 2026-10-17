//! `to_watch_context`: the single chokepoint between the probes and the model. Mirrors
//! `packages/core/src/explainer/watch-context.ts` so the serialised document is identical; the
//! rules come from the webview's last report (`report_store::load_last`), 64 rows at most.
//! `on_device_prompt` mirrors `buildOnDeviceWatchPrompt` with the same trim order.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::rate::bounds_for;
use super::signals::{GATED_SIGNALS, bad_flip, held, parse_ms, severity};
use super::types::{
    ExplainerProfile, GateAnswer, ReadingKind, RuleChange, RuleStatus, SignalReading, SignalValue,
    WatchContext, WatchCycle, WatchLastVerdict, WatchRecent, WatchRule, WatchSignal,
};
use super::{ActionId, Change, Freshness, ProbeId, Severity, SignalId};
use crate::state::Os;

pub const MAX_RULES: usize = 64;
pub const MAX_RECENT: usize = 20;
/// ON_DEVICE_LIMITS.maxPromptChars in core.
pub const ON_DEVICE_MAX_PROMPT_CHARS: usize = 7000;
pub const UNKNOWN_OS_VERSION: &str = "unknown";
/// Three acknowledgements of the same signal mute it (WATCH_MUTE_COUNT).
pub const MUTE_COUNT: u32 = 3;

/// The webview's acknowledgement memory, as far as the context needs it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ContextMemory {
    pub normal_for_me: BTreeSet<SignalId>,
    pub acknowledge_count: BTreeMap<SignalId, u32>,
}

impl ContextMemory {
    /// Reads `normalForMe` and `acknowledgeCount` from a parsed WatchMemory; unknown keys are dropped.
    pub fn from_json(value: &Value) -> Self {
        let mut memory = ContextMemory::default();
        if let Some(map) = value.get("normalForMe").and_then(Value::as_object) {
            for key in map.keys() {
                if let Some(id) = SignalId::parse(key) {
                    memory.normal_for_me.insert(id);
                }
            }
        }
        if let Some(map) = value.get("acknowledgeCount").and_then(Value::as_object) {
            for (key, count) in map {
                if let (Some(id), Some(n)) = (SignalId::parse(key), count.as_u64()) {
                    memory
                        .acknowledge_count
                        .insert(id, u32::try_from(n).unwrap_or(u32::MAX));
                }
            }
        }
        memory
    }

    fn muted(&self, signal: SignalId) -> bool {
        self.acknowledge_count
            .get(&signal)
            .is_some_and(|n| *n >= MUTE_COUNT)
    }
}

/// One stored change, newest first in the history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub signal_id: SignalId,
    pub change: Change,
    pub at: String,
}

pub struct ContextInput<'a> {
    pub previous_report: Option<&'a Value>,
    pub report: Option<&'a Value>,
    pub readings: &'a [SignalReading],
    pub memory: &'a ContextMemory,
    pub recent: &'a [RecentEntry],
    pub now: &'a str,
    pub os: Os,
    pub os_version: &'a str,
    pub profile: ExplainerProfile,
    pub cycle: WatchCycle,
    pub last_verdict: Option<WatchLastVerdict>,
}

/// Whole minutes from `from` to `to`, never negative; None when either is not a date.
pub fn minutes_between(from: &str, to: &str) -> Option<i64> {
    let a = parse_ms(from)?;
    let b = parse_ms(to)?;
    Some(((b - a) as f64 / 60_000.0).floor().max(0.0) as i64)
}

pub(super) fn rule_id_ok(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("TL-") else {
        return false;
    };
    let Some((os, tail)) = rest.split_once('-') else {
        return false;
    };
    matches!(os, "MAC" | "WIN" | "LNX" | "ANY")
        && !tail.is_empty()
        && tail.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn schema_one(report: &Value) -> bool {
    report.get("schemaVersion").and_then(Value::as_u64) == Some(1)
}

fn results(report: &Value) -> impl Iterator<Item = (&str, &str)> {
    report
        .get("results")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|row| Some((row.get("ruleId")?.as_str()?, row.get("status")?.as_str()?)))
}

/// results[] joined with findings[] for the severity, diffed against the previous report.
fn rules_for(report: Option<&Value>, previous: Option<&Value>, now: &str) -> Vec<WatchRule> {
    let Some(report) = report.filter(|r| schema_one(r)) else {
        return Vec::new();
    };
    let mut severities: BTreeMap<&str, Severity> = BTreeMap::new();
    for finding in report
        .get("findings")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        if let (Some(id), Some(sev)) = (
            finding.get("ruleId").and_then(Value::as_str),
            finding
                .get("severity")
                .and_then(Value::as_str)
                .and_then(Severity::parse),
        ) {
            severities.insert(id, sev);
        }
    }
    let mut before: BTreeMap<&str, &str> = BTreeMap::new();
    if let Some(previous) = previous.filter(|p| schema_one(p)) {
        for (id, status) in results(previous) {
            before.entry(id).or_insert(status);
        }
    }
    let scanned_at = report
        .get("scannedAt")
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for (id, status_text) in results(report) {
        if !rule_id_ok(id) || seen.contains(id) {
            continue;
        }
        if out.len() >= MAX_RULES {
            break;
        }
        seen.insert(id);
        let Some(status) = RuleStatus::parse(status_text) else {
            continue;
        };
        let was = before.get(id).copied().and_then(RuleStatus::parse);
        let change = if status == RuleStatus::Unknown {
            RuleChange::Unreadable
        } else {
            match was {
                Some(was) if !was.attention() && status.attention() => RuleChange::Appeared,
                Some(was) if was.attention() && !status.attention() => RuleChange::Fixed,
                _ => RuleChange::None,
            }
        };
        out.push(WatchRule {
            rule_id: id.to_owned(),
            status,
            severity: severities.get(id).copied().unwrap_or(Severity::Info),
            change,
            minutes_since_change: if change == RuleChange::None {
                None
            } else {
                minutes_between(scanned_at, now)
            },
        });
    }
    out
}

fn is_held(reading: &SignalReading) -> bool {
    match (&reading.fixed_by_talos_at, &reading.changed_at) {
        (Some(fixed), Some(changed)) => held(changed, fixed),
        _ => false,
    }
}

/// The first cycle writes the baseline and counts nothing; a change only ever counts against
/// an existing baseline.
fn signal_for(
    reading: &SignalReading,
    memory: &ContextMemory,
    now: &str,
    first_cycle: bool,
) -> WatchSignal {
    let change = if first_cycle {
        Change::Same
    } else if reading.freshness == Freshness::Unavailable {
        if reading.previous_freshness == Some(Freshness::Fresh) {
            Change::Changed
        } else {
            Change::Same
        }
    } else if is_held(reading) {
        Change::Same
    } else {
        reading.change
    };
    let digest = reading.kind == ReadingKind::Digest;
    let value = match reading.value {
        Some(v) if !digest => v.into_signal_value(),
        _ => SignalValue::Change(change),
    };
    let previous = if digest { None } else { reading.previous };
    let acknowledged = reading.gate_answer == Some(GateAnswer::Mine)
        || memory.normal_for_me.contains(&reading.signal_id)
        || memory.muted(reading.signal_id);
    let gated = GATED_SIGNALS.contains(&reading.signal_id)
        && bad_flip(reading.signal_id, value, previous, change)
        && reading.gate_answer.is_none()
        && !acknowledged;
    WatchSignal {
        signal_id: reading.signal_id,
        value,
        previous,
        change,
        severity: severity(reading.signal_id),
        minutes_since_change: match (&reading.changed_at, change) {
            (_, Change::Same) | (None, _) => None,
            (Some(at), _) => minutes_between(at, now),
        },
        freshness: reading.freshness,
        acknowledged,
        gated,
    }
}

fn safe_os_version(text: &str) -> String {
    let count = text.chars().count();
    let ok = (1..=32).contains(&count)
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok {
        text.to_owned()
    } else {
        UNKNOWN_OS_VERSION.to_owned()
    }
}

/// The probes the model may name: PROBE_IDS minus the two Rust-only ones.
pub fn model_probes() -> Vec<ProbeId> {
    ProbeId::ALL
        .iter()
        .copied()
        .filter(|p| !p.rust_only())
        .collect()
}

/// The single chokepoint between the probes and the model. Nothing machine-originated survives it.
pub fn to_watch_context(input: &ContextInput<'_>) -> WatchContext {
    let rules = rules_for(input.report, input.previous_report, input.now);
    let first_cycle = input.cycle.index == 0;
    let signals: Vec<WatchSignal> = input
        .readings
        .iter()
        .map(|r| signal_for(r, input.memory, input.now, first_cycle))
        .collect();
    let bounds = bounds_for(&signals, &rules);
    let recent = input
        .recent
        .iter()
        .take(MAX_RECENT)
        .map(|entry| WatchRecent {
            signal_id: entry.signal_id,
            change: entry.change,
            minutes_ago: minutes_between(&entry.at, input.now).unwrap_or(0),
        })
        .collect();
    WatchContext {
        schema_version: 1,
        os: input.os,
        os_version: safe_os_version(input.os_version),
        profile: input.profile,
        cycle: input.cycle,
        floor: bounds.floor,
        ceiling: bounds.ceiling,
        rules,
        signals,
        recent,
        probes_available: model_probes(),
        actions_available: ActionId::ALL.to_vec(),
        last_verdict: input.last_verdict,
    }
}

#[derive(Serialize)]
struct Envelope<'a> {
    task: &'static str,
    context: &'a WatchContext,
}

/// `JSON.stringify({ task: "watch", context })`.
pub fn render(context: &WatchContext) -> String {
    serde_json::to_string(&Envelope {
        task: "watch",
        context,
    })
    .unwrap_or_default()
}

/// The on-device instructions, read from the core fixture so both sides stay equal.
pub const ON_DEVICE_INSTRUCTIONS: &str =
    include_str!("../../../../../packages/core/fixtures/watch-instructions-on-device.txt");

/// (instructions, prompt) for the on-device model. Over the limit, unchanged rules are dropped
/// first, then unchanged signals, then recent entries from the end.
pub fn on_device_prompt(context: &WatchContext) -> (String, String) {
    let mut current = context.clone();
    let mut text = render(&current);
    if text.chars().count() > ON_DEVICE_MAX_PROMPT_CHARS {
        current.rules.retain(|r| r.change != RuleChange::None);
        text = render(&current);
    }
    if text.chars().count() > ON_DEVICE_MAX_PROMPT_CHARS {
        current.signals.retain(|s| s.change != Change::Same);
        text = render(&current);
    }
    while text.chars().count() > ON_DEVICE_MAX_PROMPT_CHARS && current.recent.pop().is_some() {
        text = render(&current);
    }
    (ON_DEVICE_INSTRUCTIONS.to_owned(), text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watch::types::PreviousValue;
    use serde_json::json;

    fn reading(
        id: SignalId,
        value: PreviousValue,
        previous: PreviousValue,
        change: Change,
    ) -> SignalReading {
        SignalReading {
            signal_id: id,
            kind: ReadingKind::Bool,
            value: Some(value),
            previous: Some(previous),
            change,
            changed_at: Some("2026-10-17T11:50:00.000Z".into()),
            freshness: Freshness::Fresh,
            previous_freshness: Some(Freshness::Fresh),
            gate_answer: None,
            codesign_valid: None,
            fixed_by_talos_at: None,
            has_startup_entry: None,
            is_listener: None,
        }
    }

    fn input<'a>(
        readings: &'a [SignalReading],
        memory: &'a ContextMemory,
        report: Option<&'a Value>,
        index: u64,
    ) -> ContextInput<'a> {
        ContextInput {
            previous_report: None,
            report,
            readings,
            memory,
            recent: &[],
            now: "2026-10-17T12:00:00.000Z",
            os: Os::Macos,
            os_version: "27.0.1",
            profile: ExplainerProfile::default(),
            cycle: WatchCycle {
                index,
                minutes_since_full_check: 10,
                minutes_since_last_change: None,
                probes_left: 3,
            },
            last_verdict: None,
        }
    }

    #[test]
    fn a_gated_flip_is_gated_until_answered_and_the_first_cycle_counts_nothing() {
        let readings = [reading(
            SignalId::Firewall,
            PreviousValue::Bool(false),
            PreviousValue::Bool(true),
            Change::Changed,
        )];
        let memory = ContextMemory::default();
        let context = to_watch_context(&input(&readings, &memory, None, 2));
        let signal = &context.signals[0];
        assert!(signal.gated);
        assert_eq!(signal.minutes_since_change, Some(10));
        assert_eq!(context.floor, crate::watch::Rating::KeepAnEye);
        let first = to_watch_context(&input(&readings, &memory, None, 0));
        assert_eq!(first.signals[0].change, Change::Same);
        assert!(!first.signals[0].gated);
        assert_eq!(first.signals[0].minutes_since_change, None);
    }

    #[test]
    fn acknowledgement_memory_and_the_mute_count_clear_a_change() {
        let readings = [reading(
            SignalId::Sip,
            PreviousValue::Bool(false),
            PreviousValue::Bool(true),
            Change::Changed,
        )];
        let memory = ContextMemory::from_json(
            &json!({ "normalForMe": { "sig.sip": "2026-10-17T11:00:00.000Z", "sig.nope": "x" }, "acknowledgeCount": { "sig.firewall": 3 } }),
        );
        assert!(memory.normal_for_me.contains(&SignalId::Sip));
        assert_eq!(memory.normal_for_me.len(), 1);
        assert!(memory.muted(SignalId::Firewall));
        let context = to_watch_context(&input(&readings, &memory, None, 2));
        assert!(context.signals[0].acknowledged);
        assert_eq!(context.floor, crate::watch::Rating::Calm);
    }

    #[test]
    fn a_talos_fix_within_ten_minutes_holds_the_change() {
        let mut held_reading = reading(
            SignalId::Firewall,
            PreviousValue::Bool(true),
            PreviousValue::Bool(false),
            Change::Changed,
        );
        held_reading.fixed_by_talos_at = Some("2026-10-17T11:45:00.000Z".into());
        let memory = ContextMemory::default();
        let context = to_watch_context(&input(
            std::slice::from_ref(&held_reading),
            &memory,
            None,
            2,
        ));
        assert_eq!(context.signals[0].change, Change::Same);
    }

    #[test]
    fn an_unavailable_reading_changes_only_when_it_was_fresh_before() {
        let mut gone = reading(
            SignalId::ListenerSet,
            PreviousValue::Bool(true),
            PreviousValue::Bool(true),
            Change::Same,
        );
        gone.kind = ReadingKind::Digest;
        gone.value = None;
        gone.freshness = Freshness::Unavailable;
        let memory = ContextMemory::default();
        let context = to_watch_context(&input(std::slice::from_ref(&gone), &memory, None, 2));
        assert_eq!(context.signals[0].change, Change::Changed);
        assert_eq!(
            context.signals[0].value,
            SignalValue::Change(Change::Changed)
        );
        assert_eq!(context.signals[0].previous, None);
        gone.previous_freshness = Some(Freshness::Unavailable);
        let context = to_watch_context(&input(std::slice::from_ref(&gone), &memory, None, 2));
        assert_eq!(context.signals[0].change, Change::Same);
    }

    #[test]
    fn rules_join_results_with_findings_dedupe_and_cap_at_64() {
        let mut results = Vec::new();
        for i in 0..100 {
            results.push(json!({ "ruleId": format!("TL-MAC-{:03}", i % 70), "status": if i % 7 == 0 { "fail" } else { "pass" } }));
        }
        results.push(json!({ "ruleId": "bad id", "status": "fail" }));
        results.push(json!({ "ruleId": "TL-MAC-900", "status": "weird" }));
        let report = json!({
            "schemaVersion": 1,
            "scannedAt": "2026-10-17T11:30:00.000Z",
            "results": results,
            "findings": [{ "ruleId": "TL-MAC-000", "severity": "critical" }],
        });
        let previous = json!({ "schemaVersion": 1, "results": [{ "ruleId": "TL-MAC-000", "status": "pass" }, { "ruleId": "TL-MAC-001", "status": "fail" }] });
        let rules = rules_for(Some(&report), Some(&previous), "2026-10-17T12:00:00.000Z");
        assert_eq!(rules.len(), 64);
        let ids: BTreeSet<&str> = rules.iter().map(|r| r.rule_id.as_str()).collect();
        assert_eq!(ids.len(), 64, "unique");
        assert_eq!(rules[0].severity, Severity::Critical);
        assert_eq!(rules[0].change, RuleChange::Appeared);
        assert_eq!(rules[0].minutes_since_change, Some(30));
        assert_eq!(rules[1].change, RuleChange::Fixed);
        assert_eq!(rules[2].severity, Severity::Info);
        assert_eq!(rules[2].change, RuleChange::None);
        assert!(
            rules_for(
                Some(&json!({ "schemaVersion": 2, "results": results_of(3) })),
                None,
                "2026-10-17T12:00:00.000Z"
            )
            .is_empty()
        );
        assert!(rule_id_ok("TL-ANY-1a") && !rule_id_ok("TL-MAC-") && !rule_id_ok("TL-IOS-001"));
    }

    fn results_of(n: usize) -> Vec<Value> {
        (0..n)
            .map(|i| json!({ "ruleId": format!("TL-MAC-{i:03}"), "status": "pass" }))
            .collect()
    }

    #[test]
    fn the_os_version_is_pattern_checked_and_recent_is_capped() {
        let memory = ContextMemory::default();
        let recent: Vec<RecentEntry> = (0..25)
            .map(|i| RecentEntry {
                signal_id: SignalId::Firewall,
                change: Change::Changed,
                at: format!("2026-10-17T11:{:02}:00.000Z", 59 - i),
            })
            .collect();
        let mut i = input(&[], &memory, None, 1);
        i.recent = &recent;
        i.os_version = "27.0.1 (26A434)";
        let context = to_watch_context(&i);
        assert_eq!(context.os_version, "unknown");
        assert_eq!(context.recent.len(), 20);
        assert_eq!(context.recent[0].minutes_ago, 1);
        assert_eq!(context.probes_available.len(), 19);
        assert_eq!(context.actions_available.len(), 24);
        assert_eq!(
            minutes_between("2026-10-17T12:30:00.000Z", "2026-10-17T12:00:00.000Z"),
            Some(0)
        );
        assert_eq!(minutes_between("nope", "2026-10-17T12:00:00.000Z"), None);
    }

    #[test]
    fn the_on_device_prompt_trims_rules_then_signals_then_recent() {
        let memory = ContextMemory::default();
        let readings: Vec<SignalReading> = SignalId::ALL
            .iter()
            .map(|id| {
                reading(
                    *id,
                    PreviousValue::Bool(true),
                    PreviousValue::Bool(true),
                    Change::Same,
                )
            })
            .collect();
        let recent: Vec<RecentEntry> = (0..20)
            .map(|_| RecentEntry {
                signal_id: SignalId::Firewall,
                change: Change::Changed,
                at: "2026-10-17T11:00:00.000Z".into(),
            })
            .collect();
        let results: Vec<Value> = (0..64)
            .map(|i| json!({ "ruleId": format!("TL-MAC-{i:03}"), "status": "pass" }))
            .collect();
        let report = json!({ "schemaVersion": 1, "scannedAt": "2026-10-17T11:30:00.000Z", "results": results, "findings": [] });
        let mut i = input(&readings, &memory, Some(&report), 2);
        i.recent = &recent;
        let context = to_watch_context(&i);
        assert!(render(&context).len() > ON_DEVICE_MAX_PROMPT_CHARS);
        let (instructions, prompt) = on_device_prompt(&context);
        assert!(
            instructions.ends_with("The ids are the only vocabulary.\n")
                || instructions.ends_with("The ids are the only vocabulary.")
        );
        assert!(
            prompt.chars().count() <= ON_DEVICE_MAX_PROMPT_CHARS,
            "{}",
            prompt.len()
        );
        assert!(prompt.starts_with("{\"task\":\"watch\",\"context\":{\"schemaVersion\":1,"));
        let trimmed: Value = serde_json::from_str(&prompt).unwrap();
        assert_eq!(
            trimmed["context"]["rules"].as_array().unwrap().len(),
            0,
            "unchanged rules dropped first"
        );
        assert_eq!(
            trimmed["context"]["signals"].as_array().unwrap().len(),
            0,
            "then unchanged signals"
        );
    }
}
