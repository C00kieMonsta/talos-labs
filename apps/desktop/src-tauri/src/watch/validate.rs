//! `validate_watch_verdict`: the model's answer against the context the call was built from.
//! Mirrors `packages/core/src/watch/validate.ts`; tests/watch_cases_contract.rs pins every case.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use super::playbook::{PLAYBOOK, PlaybookAction};
use super::rate::{max_rating, min_rating};
use super::types::{VerdictAction, VerdictProbe, WatchContext, WatchVerdict};
use super::{ActionId, Change, ProbeId, Rating, SignalId};

pub const MAX_REASON_CHARS: usize = 300;
pub const MAX_BASED_ON: usize = 6;
pub const MAX_PROBES: usize = 3;
pub const MAX_ACTIONS: usize = 3;

/// A token that reads like a path: a slash or tilde followed by a path character.
pub const PATH_LIKE: &str = r"[~/][A-Za-z0-9._-]";
/// A token that reads like a port.
pub const PORT_LIKE: &str = r":[0-9]{2,5}\b";
/// Words a model sentence may never carry: they read as an instruction to act on a program.
pub const BANNED_VERBS: &str = r"(?i)\b(pid|process|kill|delete|remove|rm|unload)\b";

const COMMAND_LINE_PREFIXES: [&str; 4] = ["sudo ", "$ ", "curl ", "bash "];

#[allow(clippy::expect_used)]
static PATH_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(PATH_LIKE).expect("literal regex"));
#[allow(clippy::expect_used)]
static PORT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(PORT_LIKE).expect("literal regex"));
#[allow(clippy::expect_used)]
static VERB_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(BANNED_VERBS).expect("literal regex"));

/// The whole answer is unusable; the fixed rules stand.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rejected;

impl Rejected {
    pub const CODE: &'static str = "rejected_output";
}

/// True when the text carries a fenced block or a line that looks like a shell command.
pub fn contains_command_text(text: &str) -> bool {
    if text.contains("```") || text.contains("~~~") {
        return true;
    }
    text.split(['\n', '\r']).any(|raw| {
        let line = raw.trim_start();
        COMMAND_LINE_PREFIXES.iter().any(|p| line.starts_with(p))
    })
}

/// True when the text may be shown: short, no command text, no path, no port, no banned verb.
pub fn safe_sentence(text: &str) -> bool {
    if text.encode_utf16().count() > MAX_REASON_CHARS {
        return false;
    }
    if contains_command_text(text) {
        return false;
    }
    !(PATH_RE.is_match(text) || PORT_RE.is_match(text) || VERB_RE.is_match(text))
}

/// A string is kept when safe and dropped to "" otherwise; anything but a string rejects.
fn read_sentence(value: Option<&Value>) -> Result<String, Rejected> {
    let text = value.and_then(Value::as_str).ok_or(Rejected)?;
    Ok(if safe_sentence(text) {
        text.to_owned()
    } else {
        String::new()
    })
}

fn read_list(value: Option<&Value>, max: usize) -> Result<&[Value], Rejected> {
    let list = value.and_then(Value::as_array).ok_or(Rejected)?;
    if list.len() > max {
        return Err(Rejected);
    }
    Ok(list.as_slice())
}

fn read_id<T: Copy + Ord>(
    value: &Value,
    known: &[T],
    parse: fn(&str) -> Option<T>,
    seen: &mut BTreeSet<T>,
) -> Result<T, Rejected> {
    let text = value.as_str().ok_or(Rejected)?;
    let id = parse(text).ok_or(Rejected)?;
    if !known.contains(&id) || !seen.insert(id) {
        return Err(Rejected);
    }
    Ok(id)
}

fn triggered(row: &PlaybookAction, context: &WatchContext) -> bool {
    context
        .signals
        .iter()
        .any(|s| s.change != Change::Same && row.triggers.contains(&s.signal_id))
}

/// Rating in the enum, then clamped between the context's floor and ceiling; every id in the
/// matching list of the context; duplicates and over-cap lists rejected; the two Rust-only
/// probes rejected. An action is dropped (the verdict kept) when its row's floor is above the
/// clamped rating or none of its triggers changed. Each sentence is dropped to "" when unsafe.
pub fn validate_watch_verdict(
    raw: &Value,
    context: &WatchContext,
    playbook: &[PlaybookAction],
) -> Result<WatchVerdict, Rejected> {
    let object = raw.as_object().ok_or(Rejected)?;
    let rating = object
        .get("rating")
        .and_then(Value::as_str)
        .and_then(Rating::parse)
        .ok_or(Rejected)?;
    let clamped = max_rating(context.floor, min_rating(rating, context.ceiling));
    let rating_reason = read_sentence(object.get("ratingReason"))?;

    let signal_ids: Vec<SignalId> = context.signals.iter().map(|s| s.signal_id).collect();
    let mut seen_signals = BTreeSet::new();
    let based_on = read_list(object.get("basedOn"), MAX_BASED_ON)?
        .iter()
        .map(|id| read_id(id, &signal_ids, SignalId::parse, &mut seen_signals))
        .collect::<Result<Vec<_>, _>>()?;

    let probe_ids: Vec<ProbeId> = context
        .probes_available
        .iter()
        .copied()
        .filter(|p| !p.rust_only())
        .collect();
    let mut seen_probes = BTreeSet::new();
    let probes = read_list(object.get("probes"), MAX_PROBES)?
        .iter()
        .map(|entry| {
            let entry = entry.as_object().ok_or(Rejected)?;
            let probe_id = read_id(
                entry.get("probeId").unwrap_or(&Value::Null),
                &probe_ids,
                ProbeId::parse,
                &mut seen_probes,
            )?;
            Ok(VerdictProbe {
                probe_id,
                reason: read_sentence(entry.get("reason"))?,
            })
        })
        .collect::<Result<Vec<_>, Rejected>>()?;

    let mut seen_actions = BTreeSet::new();
    let mut actions = Vec::new();
    for entry in read_list(object.get("actions"), MAX_ACTIONS)? {
        let entry = entry.as_object().ok_or(Rejected)?;
        let action_id = read_id(
            entry.get("actionId").unwrap_or(&Value::Null),
            &context.actions_available,
            ActionId::parse,
            &mut seen_actions,
        )?;
        let sentence = read_sentence(entry.get("sentence"))?;
        let row = playbook
            .iter()
            .find(|r| r.id == action_id)
            .ok_or(Rejected)?;
        if row.floor.rank() > clamped.rank() || !triggered(row, context) {
            continue;
        }
        actions.push(VerdictAction {
            action_id,
            sentence,
        });
    }
    Ok(WatchVerdict {
        rating: clamped,
        rating_reason,
        based_on,
        probes,
        actions,
    })
}

/// The validator over the compiled-in playbook.
pub fn validate(raw: &Value, context: &WatchContext) -> Result<WatchVerdict, Rejected> {
    validate_watch_verdict(raw, context, &PLAYBOOK)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watch::types::{
        ExplainerProfile, PreviousValue, SignalValue, WatchCycle, WatchSignal,
    };
    use crate::watch::{Freshness, Severity};
    use serde_json::json;

    fn context() -> WatchContext {
        WatchContext {
            schema_version: 1,
            os: crate::state::Os::Macos,
            os_version: "27.0.1".into(),
            profile: ExplainerProfile::default(),
            cycle: WatchCycle {
                index: 3,
                minutes_since_full_check: 90,
                minutes_since_last_change: Some(30),
                probes_left: 3,
            },
            floor: Rating::KeepAnEye,
            ceiling: Rating::ActNow,
            rules: vec![],
            signals: vec![WatchSignal {
                signal_id: SignalId::PersistenceNew,
                value: SignalValue::Int(1),
                previous: Some(PreviousValue::Int(0)),
                change: Change::Changed,
                severity: Severity::High,
                minutes_since_change: Some(5),
                freshness: Freshness::Fresh,
                acknowledged: false,
                gated: false,
            }],
            recent: vec![],
            probes_available: ProbeId::ALL
                .iter()
                .copied()
                .filter(|p| !p.rust_only())
                .collect(),
            actions_available: ActionId::ALL.to_vec(),
            last_verdict: None,
        }
    }

    fn raw(rating: &str) -> Value {
        json!({
            "rating": rating,
            "ratingReason": "A new program appeared.",
            "basedOn": ["sig.persistence_new"],
            "probes": [{ "probeId": "probe.persistence", "reason": "Read it again." }],
            "actions": [{ "actionId": "act.stop_background_program", "sentence": "Stop it for now." }]
        })
    }

    #[test]
    fn a_full_verdict_is_kept_and_clamped() {
        let verdict = validate(&raw("act_now"), &context()).unwrap();
        assert_eq!(verdict.rating, Rating::ActNow);
        assert_eq!(verdict.based_on, vec![SignalId::PersistenceNew]);
        assert_eq!(verdict.probes.len(), 1);
        assert_eq!(verdict.actions.len(), 1);
        let low = validate(&raw("calm"), &context()).unwrap();
        assert_eq!(low.rating, Rating::KeepAnEye, "clamped to the floor");
        assert!(
            low.actions.is_empty(),
            "an act_now row is dropped under a look rating"
        );
    }

    #[test]
    fn unknown_duplicate_over_cap_and_rust_only_ids_reject() {
        let mut v = raw("act_now");
        v["basedOn"] = json!(["sig.nope"]);
        assert_eq!(validate(&v, &context()), Err(Rejected));
        let mut v = raw("act_now");
        v["basedOn"] = json!(["sig.firewall"]);
        assert_eq!(
            validate(&v, &context()),
            Err(Rejected),
            "a signal not in the context"
        );
        let mut v = raw("act_now");
        v["basedOn"] = json!(["sig.persistence_new", "sig.persistence_new"]);
        assert_eq!(validate(&v, &context()), Err(Rejected));
        let mut v = raw("act_now");
        v["probes"] = json!([{ "probeId": "probe.persistence_signatures", "reason": "x" }]);
        assert_eq!(validate(&v, &context()), Err(Rejected));
        let mut v = raw("act_now");
        v["probes"] = json!([{ "probeId": "probe.ssh_keys", "reason": "x" }]);
        assert_eq!(validate(&v, &context()), Err(Rejected));
        let mut v = raw("act_now");
        v["actions"] = json!([{ "actionId": "act.a", "sentence": "x" }, { "actionId": "act.b", "sentence": "x" }, { "actionId": "act.c", "sentence": "x" }, { "actionId": "act.d", "sentence": "x" }]);
        assert_eq!(validate(&v, &context()), Err(Rejected));
        assert_eq!(validate(&json!("text"), &context()), Err(Rejected));
        assert_eq!(
            validate(&json!({ "rating": "urgent" }), &context()),
            Err(Rejected)
        );
        let mut v = raw("act_now");
        v["ratingReason"] = json!(7);
        assert_eq!(validate(&v, &context()), Err(Rejected));
    }

    #[test]
    fn unsafe_sentences_are_dropped_to_empty_but_the_verdict_stays() {
        for bad in [
            "run `sudo rm -rf` now\n$ ls",
            "look under /Library/LaunchAgents",
            "it listens on :8080 now",
            "kill the PID first",
            "please Remove it",
            "unload the agent",
            "a very long sentence ".repeat(20).as_str(),
            "```sh\nls\n```",
        ] {
            let mut v = raw("act_now");
            v["ratingReason"] = json!(bad);
            let verdict = validate(&v, &context()).unwrap();
            assert_eq!(verdict.rating_reason, "", "{bad}");
        }
        assert!(safe_sentence("A new program started on its own."));
        assert!(!safe_sentence("see ~/Library"));
        assert!(contains_command_text("  curl http://x"));
        assert!(!contains_command_text("curly hair"));
    }

    #[test]
    fn an_action_with_no_changed_trigger_is_dropped() {
        let mut v = raw("act_now");
        v["actions"] = json!([{ "actionId": "act.turn_on_firewall", "sentence": "Turn it on." }]);
        let verdict = validate(&v, &context()).unwrap();
        assert!(verdict.actions.is_empty());
    }
}
