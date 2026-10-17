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

/// `probes[].reason` and `actions[].sentence`: the fishy flow's Advise rows.
pub const MAX_SENTENCE_CHARS: usize = 300;
/// `ratingReason`: the window line, three lines at 14 px in a 288 px column.
pub const MAX_REASON_CHARS: usize = 120;
pub const MAX_BASED_ON: usize = 6;
pub const MAX_PROBES: usize = 3;
pub const MAX_ACTIONS: usize = 3;

/// A token that reads like a path: a slash or tilde at a word start followed by path
/// characters, so "and/or" and "24/7" pass.
pub const PATH_LIKE: &str = r"(^|[^A-Za-z0-9])[~/][A-Za-z0-9._-]+";
/// A token that reads like a port: a colon not preceded by a digit, so "18:00" passes, or a
/// dotted digit host before the colon, so "127.0.0.1:8080" does not. The regex crate has no
/// lookbehind, so the preceding character is matched instead.
pub const PORT_LIKE: &str = r"(^|[^0-9]):[0-9]{2,5}\b|\d\.\d+:[0-9]{2,5}\b";
/// Words a model sentence may never carry: they read as an instruction to act on a program.
pub const BANNED_VERBS: &str = r"(?i)\b(pid|process|kill|delete|remove|rm|unload)\b";
/// A rule, signal, probe or action id: the judge's vocabulary, never a word in the window.
pub const ID_LIKE: &str = r"\bTL-[A-Z]{3}-[A-Za-z0-9]+|\b(sig|probe|act)\.[a-z_]+\b";
/// The window line speaks to the reader, never as the app.
pub const APP_VOICE: &str = r"(?i)\b(I'll|I've|I'm|I'd|me|my|mine|we|us|our|let's)\b";
/// The bare pronoun, case-sensitive so "i" inside a word or a lower-case "i" is not it.
pub const APP_VOICE_I: &str = r"\bI\b";
/// The window line never claims the app did something.
pub const ACTION_CLAIM: &str =
    r"(?i)(^\s*done\b|\bI've turned\b|\bhas been turned\b|\bis now (on|off)\b)";
/// The window line never tells the reader what to click or run.
pub const IMPERATIVE_START: &str = r"(?i)(^|[.!?]\s+)(click|press|open|go|run|type|turn|switch|tap|enable|disable|delete|remove|check|set|change|choose|select|install|uninstall|update|restart|lock|unlock|use|make|do|don't|start|stop)\b";
/// The window line never says the Mac is safe.
pub const REASSURANCE: &str = r"(?i)\b(safe|safely|protected|secure|secured|clean|fine|all clear|no threat|no malware|no virus)\b";
/// On calm the app shows the time; a duration in the sentence is wrong by the afternoon.
pub const DURATION: &str = r"(?i)\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minutes?|hours?|days?|weeks?)\b";
/// A second sentence: a terminal stop, a space and any non-space character.
pub const SECOND_SENTENCE: &str = r"[.!?]\s+\S";

/// The guided banned words (apps/desktop/src/guided/copy.test.ts, mirrored as
/// `WATCH_BANNED_WORDS` in core and pinned by `watch-cases.json`'s `bannedWords`).
pub const BANNED_WORDS: [&str; 19] = [
    "finding",
    "findings",
    "severity",
    "CIS",
    "rule",
    "rules",
    "policy",
    "configuration",
    "SSH",
    "launchd",
    "plist",
    "daemon",
    "sudo",
    "Terminal",
    "TCC",
    "stealth",
    "sysadminctl",
    "command",
    "points",
];

const COMMAND_LINE_PREFIXES: [&str; 4] = ["sudo ", "$ ", "curl ", "bash "];

#[allow(clippy::expect_used)]
static PATH_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(PATH_LIKE).expect("literal regex"));
#[allow(clippy::expect_used)]
static PORT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(PORT_LIKE).expect("literal regex"));
#[allow(clippy::expect_used)]
static VERB_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(BANNED_VERBS).expect("literal regex"));
#[allow(clippy::expect_used)]
static ID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(ID_LIKE).expect("literal regex"));
#[allow(clippy::expect_used)]
static APP_VOICE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(APP_VOICE).expect("literal regex"));
#[allow(clippy::expect_used)]
static APP_VOICE_I_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(APP_VOICE_I).expect("literal regex"));
#[allow(clippy::expect_used)]
static ACTION_CLAIM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(ACTION_CLAIM).expect("literal regex"));
#[allow(clippy::expect_used)]
static IMPERATIVE_START_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(IMPERATIVE_START).expect("literal regex"));
#[allow(clippy::expect_used)]
static BANNED_WORDS_RE: LazyLock<Regex> = LazyLock::new(|| {
    let words: Vec<String> = BANNED_WORDS.iter().map(|w| regex::escape(w)).collect();
    Regex::new(&format!(r"(?i)\b({})\b", words.join("|"))).expect("literal regex")
});
#[allow(clippy::expect_used)]
static REASSURANCE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(REASSURANCE).expect("literal regex"));
#[allow(clippy::expect_used)]
static DURATION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(DURATION).expect("literal regex"));
#[allow(clippy::expect_used)]
static SECOND_SENTENCE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(SECOND_SENTENCE).expect("literal regex"));

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
    if text.encode_utf16().count() > MAX_SENTENCE_CHARS {
        return false;
    }
    if contains_command_text(text) {
        return false;
    }
    !(PATH_RE.is_match(text) || PORT_RE.is_match(text) || VERB_RE.is_match(text))
}

/// True when `ratingReason` may be drawn in the menu bar window (DESIGN-WATCH-WINDOW section
/// 3): at most 120 UTF-16 units and not blank, then every `safe_sentence` rule, then no id, no
/// app voice, no action claim, no imperative sentence start, no guided banned word, no
/// reassurance, no duration on calm, and one sentence only. False on the first hit.
pub fn safe_window_sentence(text: &str, rating: Rating) -> bool {
    // One line only: a line break would hide a second sentence from the rules below.
    if text.contains(['\n', '\r']) {
        return false;
    }
    // Curly apostrophes fold to the ASCII one so "Don’t" and "Let’s" meet the same rules.
    let folded = text.replace(['\u{2019}', '\u{02BC}'], "'");
    // The rules run on the trimmed text, so a leading space never hides an imperative.
    let text = folded.trim();
    if text.encode_utf16().count() > MAX_REASON_CHARS || text.is_empty() {
        return false;
    }
    if contains_command_text(text) {
        return false;
    }
    if PATH_RE.is_match(text) || PORT_RE.is_match(text) || VERB_RE.is_match(text) {
        return false;
    }
    if ID_RE.is_match(text) {
        return false;
    }
    if APP_VOICE_I_RE.is_match(text) || APP_VOICE_RE.is_match(text) {
        return false;
    }
    if ACTION_CLAIM_RE.is_match(text) || IMPERATIVE_START_RE.is_match(text) {
        return false;
    }
    if BANNED_WORDS_RE.is_match(text) || REASSURANCE_RE.is_match(text) {
        return false;
    }
    if rating == Rating::Calm && DURATION_RE.is_match(text) {
        return false;
    }
    !SECOND_SENTENCE_RE.is_match(text)
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

/// The window line: kept trimmed when it passes `safe_window_sentence` for the clamped rating,
/// else "".
fn read_window_sentence(value: Option<&Value>, rating: Rating) -> Result<String, Rejected> {
    let text = value.and_then(Value::as_str).ok_or(Rejected)?;
    Ok(if safe_window_sentence(text, rating) {
        text.trim().to_owned()
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
/// clamped rating or none of its triggers changed. Each sentence is dropped to "" when unsafe;
/// `ratingReason` goes through the stricter window rule for the clamped rating.
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
    let rating_reason = read_window_sentence(object.get("ratingReason"), clamped)?;

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

    /// Contract D's case list: kept on both ratings, kept on keep_an_eye only, dropped on both.
    const KEPT_ON_BOTH: [&str; 4] = [
        "The one thing still open is the update you have been putting off, and it closes the hole attackers try first.",
        "It comes back at 18:00.",
        "Nothing here is and/or stuck.",
        "A new start-up program is how malware usually stays on a Mac.",
    ];
    const DURATION_CASE: &str = "Three days without a change.";
    const DROPPED_ON_BOTH: [&str; 13] = [
        "I'll keep an eye on it for you.",
        "Something listens on 127.0.0.1:8080 now.",
        "It is open on 0.0.0.0:22.",
        "TL-MAC-004 is still open.",
        "sig.persistence_new moved again.",
        "Your Mac is safe for now.",
        "There is no malware here.",
        "Done, the firewall is back on.",
        "Turn the firewall on first.",
        "A new rule appeared.",
        "~/Library/LaunchAgents changed.",
        "port :8080 opened.",
        "Two things changed. One of them is new.",
    ];

    #[test]
    fn the_window_sentence_keeps_the_plain_lines_and_drops_the_rest() {
        for text in KEPT_ON_BOTH {
            assert!(safe_window_sentence(text, Rating::Calm), "calm: {text}");
            assert!(
                safe_window_sentence(text, Rating::KeepAnEye),
                "look: {text}"
            );
            assert!(safe_window_sentence(text, Rating::ActNow), "act: {text}");
        }
        assert!(
            !safe_window_sentence(DURATION_CASE, Rating::Calm),
            "a duration is wrong by the afternoon on calm"
        );
        assert!(safe_window_sentence(DURATION_CASE, Rating::KeepAnEye));
        assert!(safe_window_sentence(DURATION_CASE, Rating::ActNow));
        for text in DROPPED_ON_BOTH {
            assert!(!safe_window_sentence(text, Rating::Calm), "calm: {text}");
            assert!(
                !safe_window_sentence(text, Rating::KeepAnEye),
                "look: {text}"
            );
        }
        let long = "a".repeat(121);
        assert!(
            !safe_window_sentence(&long, Rating::KeepAnEye),
            "121 characters"
        );
        assert!(
            safe_window_sentence(&"a".repeat(120), Rating::KeepAnEye),
            "120 is the cap"
        );
        assert!(!safe_window_sentence("", Rating::KeepAnEye));
        assert!(!safe_window_sentence("   ", Rating::KeepAnEye));
        assert!(
            !safe_window_sentence("The firewall is now off.", Rating::ActNow),
            "an action claim"
        );
        assert!(
            !safe_window_sentence("Check the login items first.", Rating::ActNow),
            "an imperative start"
        );
        assert!(
            !safe_window_sentence("Something changed. check it.", Rating::ActNow),
            "an imperative after a stop is also a second sentence"
        );
        assert!(
            !safe_window_sentence(" Turn the firewall on.", Rating::ActNow),
            "a leading space hides no imperative"
        );
        assert!(
            !safe_window_sentence("Something changed\nTurn it off now", Rating::ActNow),
            "a line break is never one sentence"
        );
        assert!(
            !safe_window_sentence("Two things changed. 3 of them are new.", Rating::ActNow),
            "a second sentence may start with a digit"
        );
        assert!(
            safe_window_sentence("  Nothing changed since yesterday.  ", Rating::ActNow),
            "surrounding whitespace is trimmed"
        );
        assert!(
            !safe_window_sentence("A new daemon appeared.", Rating::ActNow),
            "a banned word"
        );
        assert!(
            !safe_window_sentence("Your Mac is all clear.", Rating::Calm),
            "a two-word reassurance"
        );
        assert!(
            !safe_window_sentence("Let's look at it together.", Rating::Calm),
            "the app's voice"
        );
        assert!(
            safe_window_sentence("A new program listens at 18:00.", Rating::ActNow),
            "a clock time is not a port"
        );
        assert!(safe_window_sentence(
            "Nothing is open 24/7 here.",
            Rating::Calm
        ));
        assert!(
            safe_window_sentence(
                "The option i on that screen is still off.",
                Rating::KeepAnEye
            ),
            "a lower-case i is not the bare pronoun"
        );
        assert!(
            !safe_window_sentence("I think the option is off.", Rating::KeepAnEye),
            "the bare pronoun"
        );
        for text in ["probe.hosts could not run.", "act.report is the next step."] {
            assert!(!safe_window_sentence(text, Rating::ActNow), "an id: {text}");
            assert!(
                safe_sentence(text),
                "an action sentence keeps the looser rule: {text}"
            );
        }
        assert!(
            safe_window_sentence("It is time to act, nothing else moved.", Rating::ActNow),
            "a word is not an id"
        );
        assert_eq!(MAX_REASON_CHARS, 120);
        assert_eq!(MAX_SENTENCE_CHARS, 300);
        assert_eq!(BANNED_WORDS.len(), 19);
    }

    #[test]
    fn a_dropped_window_line_leaves_the_verdict_standing_and_an_action_keeps_the_looser_rule() {
        for bad in DROPPED_ON_BOTH {
            let mut v = raw("act_now");
            v["ratingReason"] = json!(bad);
            let verdict = validate(&v, &context()).unwrap();
            assert_eq!(verdict.rating_reason, "", "{bad}");
            assert_eq!(verdict.rating, Rating::ActNow, "{bad}: the verdict stands");
        }
        let mut v = raw("act_now");
        v["ratingReason"] = json!(KEPT_ON_BOTH[0]);
        assert_eq!(
            validate(&v, &context()).unwrap().rating_reason,
            KEPT_ON_BOTH[0]
        );
        // The context floors at keep_an_eye, so the clamped rating is what the duration rule
        // sees: a calm verdict with a duration is kept because the shown rating is not calm.
        let mut v = raw("calm");
        v["ratingReason"] = json!(DURATION_CASE);
        let verdict = validate(&v, &context()).unwrap();
        assert_eq!(verdict.rating, Rating::KeepAnEye);
        assert_eq!(verdict.rating_reason, DURATION_CASE);
        // Action sentences keep today's rule: the reassurance words and a duration are allowed.
        let mut v = raw("act_now");
        v["actions"] = json!([{ "actionId": "act.stop_background_program", "sentence": "Your Mac is safe now." }]);
        assert_eq!(
            validate(&v, &context()).unwrap().actions[0].sentence,
            "Your Mac is safe now."
        );
        let mut v = raw("act_now");
        v["actions"] =
            json!([{ "actionId": "act.stop_background_program", "sentence": DURATION_CASE }]);
        assert_eq!(
            validate(&v, &context()).unwrap().actions[0].sentence,
            DURATION_CASE
        );
        let mut v = raw("act_now");
        v["actions"] =
            json!([{ "actionId": "act.stop_background_program", "sentence": "a".repeat(200) }]);
        assert_eq!(
            validate(&v, &context()).unwrap().actions[0].sentence.len(),
            200,
            "an action sentence between 120 and 300 is kept"
        );
        let mut v = raw("act_now");
        v["actions"] =
            json!([{ "actionId": "act.stop_background_program", "sentence": "a".repeat(301) }]);
        assert_eq!(validate(&v, &context()).unwrap().actions[0].sentence, "");
        let mut v = raw("act_now");
        v["probes"] = json!([{ "probeId": "probe.persistence", "reason": "Please check it again, I think." }]);
        assert_eq!(
            validate(&v, &context()).unwrap().probes[0].reason,
            "Please check it again, I think.",
            "a probe reason keeps the looser rule too"
        );
    }

    #[test]
    fn the_corrected_path_and_port_forms_pass_prose_and_catch_tokens() {
        assert!(safe_sentence("Nothing here is and/or stuck."));
        assert!(safe_sentence("It runs 24/7."));
        assert!(!safe_sentence("Look in \"/Users/alice\" first."));
        assert!(!safe_sentence("A file (/tmp/x) appeared."));
        assert!(!safe_sentence("Under folder:/Library it sits."));
        assert!(safe_sentence("It comes back at 18:00."));
        assert!(!safe_sentence("port :8080 opened."));
        assert!(!safe_sentence("Something listens on 127.0.0.1:8080 now."));
        assert!(!safe_sentence("It is open on 0.0.0.0:22."));
        assert!(!safe_sentence("10.0.0.5:5900"));
        assert!(!PORT_RE.is_match("18:00"));
        assert!(PORT_RE.is_match("127.0.0.1:8080"));
    }
}
