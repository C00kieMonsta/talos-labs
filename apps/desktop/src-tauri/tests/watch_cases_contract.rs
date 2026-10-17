//! The Rust rating, validator, context builder, ChatGPT body and notification body agree with
//! the TypeScript side on every case of packages/core/fixtures/watch-cases.json.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::path::PathBuf;

use serde_json::Value;
use talos_desktop_lib::ai::chatgpt_watch;
use talos_desktop_lib::watch::context::{
    ContextInput, ContextMemory, RecentEntry, to_watch_context,
};
use talos_desktop_lib::watch::notify;
use talos_desktop_lib::watch::playbook::PLAYBOOK;
use talos_desktop_lib::watch::rate::{apply_hysteresis, bounds_for, rate_watch, top_items};
use talos_desktop_lib::watch::signals::{
    self, BadDirection, GATED_SIGNALS, PAIR_SIGNALS, STAND_ALONE_SIGNALS, bad_direction, kind_of,
};
use talos_desktop_lib::watch::types::{
    ExplainerProfile, SignalReading, WatchContext, WatchCycle, WatchLastVerdict, WatchVerdict,
};
use talos_desktop_lib::watch::validate::validate_watch_verdict;
use talos_desktop_lib::watch::{FishyKind, Rating, Severity, SignalId};

fn fixture() -> Option<Value> {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "..",
        "packages",
        "core",
        "fixtures",
        "watch-cases.json",
    ]
    .iter()
    .collect();
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

macro_rules! fixture_or_skip {
    () => {
        match fixture() {
            Some(f) => f,
            None => {
                eprintln!("skipped: packages/core/fixtures/watch-cases.json is absent");
                return;
            }
        }
    };
}

fn parse<T: serde::de::DeserializeOwned>(value: &Value) -> T {
    serde_json::from_value(value.clone()).unwrap()
}

/// The fixture's `badDirection` word: `true`, `false` (as a boolean or its word), `"up"`,
/// `"down"`, `"any"` or null.
fn direction_of(value: &Value) -> Option<BadDirection> {
    match value {
        Value::Null => None,
        Value::Bool(true) => Some(BadDirection::True),
        Value::Bool(false) => Some(BadDirection::False),
        Value::String(word) => match word.as_str() {
            "true" => Some(BadDirection::True),
            "false" => Some(BadDirection::False),
            "up" => Some(BadDirection::Up),
            "down" => Some(BadDirection::Down),
            "any" => Some(BadDirection::Any),
            other => panic!("not a direction: {other}"),
        },
        other => panic!("not a direction: {other}"),
    }
}

#[test]
fn the_signal_tables_match() {
    let f = fixture_or_skip!();
    assert_eq!(SignalId::ALL.len(), 67);
    for key in ["signalSeverity", "signalKind", "badDirection"] {
        assert_eq!(
            f[key].as_object().map(|o| o.len()),
            Some(67),
            "{key} covers every signal"
        );
    }
    for id in SignalId::ALL {
        let severity: Severity = parse(&f["signalSeverity"][id.as_str()]);
        assert_eq!(signals::severity(*id), severity, "{}", id.as_str());
        let kind: Option<FishyKind> = parse(&f["signalKind"][id.as_str()]);
        assert_eq!(kind_of(*id), kind, "{}", id.as_str());
        let direction = direction_of(&f["badDirection"][id.as_str()]);
        assert_eq!(bad_direction(*id), direction, "{}", id.as_str());
    }
    assert_eq!(
        direction_of(&f["badDirection"]["sig.shell_startup_changed"]),
        Some(BadDirection::Any)
    );
    let kinded = SignalId::ALL
        .iter()
        .filter(|s| kind_of(**s).is_some())
        .count();
    assert_eq!(kinded, 57);
    let gated: Vec<SignalId> = parse(&f["gated"]);
    assert_eq!(gated.len(), 7);
    assert_eq!(gated, GATED_SIGNALS.to_vec());
    let stand_alone: Vec<SignalId> = parse(&f["standAlone"]);
    assert_eq!(stand_alone.len(), 8);
    assert_eq!(stand_alone, STAND_ALONE_SIGNALS.to_vec());
    let pairs: Vec<SignalId> = parse(&f["pairSet"]);
    assert_eq!(pairs.len(), 18);
    assert_eq!(pairs, PAIR_SIGNALS.to_vec());
}

#[test]
fn every_rate_case_agrees_on_bounds_items_rating_and_hysteresis() {
    let f = fixture_or_skip!();
    let cases = f["rate"].as_array().unwrap();
    assert!(cases.len() >= 30);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let context: WatchContext = parse(&case["context"]);
        let bounds = bounds_for(&context.signals, &context.rules);
        let expected_floor: Rating = parse(&case["expectedBounds"]["floor"]);
        let expected_ceiling: Rating = parse(&case["expectedBounds"]["ceiling"]);
        assert_eq!(
            (bounds.floor, bounds.ceiling),
            (expected_floor, expected_ceiling),
            "{name}: bounds"
        );
        let items: Vec<SignalId> = top_items(&context.signals)
            .iter()
            .map(|i| i.signal_id)
            .collect();
        let expected_items: Vec<SignalId> = parse(&case["expectedItems"]);
        assert_eq!(items, expected_items, "{name}: items");
        let verdict: Option<Rating> = case["verdict"].get("rating").map(parse);
        let raw = rate_watch(&context, verdict);
        let expected_raw: Rating = parse(&case["expectedRaw"]);
        assert_eq!(raw, expected_raw, "{name}: raw rating");
        let previous: Rating = parse(&case["previousRating"]);
        let streak = case["calmStreak"].as_u64().unwrap() as u32;
        let shown = apply_hysteresis(previous, raw, streak);
        let expected: Rating = parse(&case["expected"]);
        assert_eq!(shown.rating, expected, "{name}: shown rating");
        assert_eq!(
            shown.calm_streak,
            case["expectedCalmStreak"].as_u64().unwrap() as u32,
            "{name}: streak"
        );
    }
}

#[test]
fn every_validate_case_agrees() {
    let f = fixture_or_skip!();
    let cases = f["validate"].as_array().unwrap();
    assert!(cases.len() >= 30);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let context: WatchContext = parse(&case["context"]);
        let result = validate_watch_verdict(&case["raw"], &context, &PLAYBOOK);
        if case["expected"] == "rejected" {
            assert!(result.is_err(), "{name}: expected rejected, got {result:?}");
        } else {
            let expected: WatchVerdict = parse(&case["expected"]);
            assert_eq!(result.ok(), Some(expected), "{name}");
        }
    }
}

#[test]
fn every_context_case_builds_the_same_document() {
    let f = fixture_or_skip!();
    let cases = f["contexts"].as_array().unwrap();
    assert!(cases.len() >= 4);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let input = &case["input"];
        let readings: Vec<SignalReading> = parse(&input["readings"]);
        let memory = ContextMemory::from_json(&input["memory"]);
        let recent: Vec<RecentEntry> = parse(&input["recent"]);
        let profile: ExplainerProfile = parse(&input["profile"]);
        let cycle: WatchCycle = parse(&input["cycle"]);
        let last_verdict: Option<WatchLastVerdict> = parse(&input["lastVerdict"]);
        let previous = input["previousReport"].clone();
        let report = input["report"].clone();
        let context = to_watch_context(&ContextInput {
            previous_report: (!previous.is_null()).then_some(&previous),
            report: (!report.is_null()).then_some(&report),
            readings: &readings,
            memory: &memory,
            recent: &recent,
            now: input["now"].as_str().unwrap(),
            os: parse(&input["os"]),
            os_version: input["osVersion"].as_str().unwrap(),
            profile,
            cycle,
            last_verdict,
        });
        let built = serde_json::to_value(&context).unwrap();
        assert_eq!(built, case["expected"], "{name}");
        let text = serde_json::to_string(&context).unwrap();
        assert!(
            !text.contains("INJECT") && !text.contains("IGNORE"),
            "{name}: machine text leaked"
        );
    }
}

#[test]
fn the_chatgpt_body_matches_the_typescript_builder() {
    let f = fixture_or_skip!();
    let case = &f["chatgptBody"];
    let context: WatchContext = parse(&case["context"]);
    let model = case["model"].as_str().unwrap();
    let instructions = case["instructions"].as_str().unwrap();
    assert_eq!(
        chatgpt_watch::INSTRUCTIONS.trim_end(),
        instructions.trim_end(),
        "the fixture text equals buildWatchInstructions()"
    );
    let mut body = chatgpt_watch::body(model, instructions, &context);
    let mut expected = case["body"].clone();
    // The user turn is a JSON string; the hand-written case writes its keys in another order,
    // so the embedded document is compared parsed. Everything else is compared as is.
    let ours: Value = serde_json::from_str(body["input"][0]["content"].as_str().unwrap()).unwrap();
    let theirs: Value =
        serde_json::from_str(expected["input"][0]["content"].as_str().unwrap()).unwrap();
    assert_eq!(ours, theirs, "the user turn");
    body["input"][0]["content"] = Value::Null;
    expected["input"][0]["content"] = Value::Null;
    assert_eq!(body, expected);
}

/// "Something to look at" becomes "something to look at": the tooltip is a sentence.
fn lower_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_lowercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[test]
fn the_tray_tooltip_words_are_pinned_to_the_window_copy() {
    use talos_desktop_lib::tray::tooltip;
    use talos_desktop_lib::watch::{Change, WatchItem, WatchState};
    let f = fixture_or_skip!();
    let words = &f["statusWords"];
    let state = |rating: Rating, items: usize| {
        let mut state = WatchState {
            enabled: true,
            rating,
            ..WatchState::default()
        };
        for _ in 0..items {
            state.items.push(WatchItem {
                signal_id: SignalId::PersistenceNew,
                kind: FishyKind::Persistence,
                severity: Severity::High,
                points: 6,
                change: Change::Changed,
                changed_at: None,
                gated: false,
                snoozed_until: None,
                has_startup_entry: true,
                is_listener: false,
                action_ids: Vec::new(),
                model_sentence: None,
                model_provider: None,
            });
        }
        state
    };
    let now = chrono::Utc::now();
    let word = |key: &str| lower_first(words[key].as_str().unwrap());
    assert_eq!(
        tooltip(&state(Rating::KeepAnEye, 0), now),
        format!("Talos Labs: {}.", word("look"))
    );
    assert_eq!(
        tooltip(&state(Rating::KeepAnEye, 1), now),
        format!("Talos Labs: {}.", word("lookOne"))
    );
    assert_eq!(
        tooltip(&state(Rating::KeepAnEye, 3), now),
        format!("Talos Labs: {}.", word("lookMany").replace("{n}", "3"))
    );
    assert_eq!(
        tooltip(&state(Rating::ActNow, 1), now),
        format!("Talos Labs: {}.", word("act"))
    );
}

/// The four window keys are emitted by core in parallel with this build: each pin returns
/// quietly while its key is absent and bites once it lands.
fn key_or_skip(f: &Value, key: &str) -> Option<Value> {
    let value = f.get(key)?;
    if value.is_null() {
        return None;
    }
    Some(value.clone())
}

#[test]
fn the_banned_words_are_pinned_in_order() {
    use talos_desktop_lib::watch::validate::BANNED_WORDS;
    let f = fixture_or_skip!();
    let Some(words) = key_or_skip(&f, "bannedWords") else {
        eprintln!("skipped: bannedWords not yet emitted");
        return;
    };
    let words: Vec<String> = parse(&words);
    assert_eq!(words, BANNED_WORDS.map(str::to_owned).to_vec());
}

#[test]
fn every_window_sentence_case_agrees() {
    use talos_desktop_lib::watch::validate::safe_window_sentence;
    let f = fixture_or_skip!();
    let Some(cases) = key_or_skip(&f, "windowSentences") else {
        eprintln!("skipped: windowSentences not yet emitted");
        return;
    };
    let cases = cases.as_array().unwrap();
    assert!(cases.len() >= 15, "{} cases", cases.len());
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let text = case["text"].as_str().unwrap();
        let rating: Rating = parse(&case["rating"]);
        let kept = case["kept"].as_bool().unwrap();
        assert_eq!(
            safe_window_sentence(text, rating),
            kept,
            "{name}: {text:?} on {}",
            rating.as_str()
        );
    }
}

#[test]
fn every_height_case_agrees_with_the_row_sum() {
    use talos_desktop_lib::tray::window_height;
    use talos_desktop_lib::watch::WatchState;
    let f = fixture_or_skip!();
    let Some(cases) = key_or_skip(&f, "heights") else {
        eprintln!("skipped: heights not yet emitted");
        return;
    };
    let cases = cases.as_array().unwrap();
    assert!(cases.len() >= 16, "{} cases", cases.len());
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let state: WatchState = serde_json::from_value(case["state"].clone())
            .unwrap_or_else(|err| panic!("{name}: the state does not parse: {err}"));
        let height = case["height"].as_f64().unwrap();
        assert_eq!(window_height(&state), height, "{name}");
    }
}

#[test]
fn every_report_row_case_agrees() {
    use talos_desktop_lib::watch::context::report_row;
    let f = fixture_or_skip!();
    let Some(cases) = key_or_skip(&f, "reportRows") else {
        eprintln!("skipped: reportRows not yet emitted");
        return;
    };
    let cases = cases.as_array().unwrap();
    assert!(cases.len() >= 9, "{} cases", cases.len());
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let row = report_row(&case["report"]);
        let built = serde_json::to_value(row).unwrap();
        assert_eq!(built, case["row"], "{name}");
    }
}

#[test]
fn the_notification_body_is_pinned_to_the_copy() {
    let f = fixture_or_skip!();
    assert_eq!(notify::TAIL, f["notifyTail"].as_str().unwrap());
    assert_eq!(f["headlines"].as_object().map(|o| o.len()), Some(10));
    assert_eq!(FishyKind::ALL.len(), 10);
    for kind in FishyKind::ALL {
        let headline = f["headlines"][kind.as_str()].as_str().unwrap();
        assert_eq!(notify::headline(*kind), headline, "{}", kind.as_str());
        assert_eq!(
            notify::body_for(*kind),
            format!("{headline}. {}", notify::TAIL)
        );
    }
}
