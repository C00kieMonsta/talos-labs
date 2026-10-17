//! `<app data>/watch.json`, mode 0600: the per-signal baselines, the keyed digests, the change
//! history and the loop's bookkeeping (docs/DESIGN-WATCH.md section 7). Digests are
//! HMAC-SHA-256 over sorted machine-text sets under a per-install key that lives only in this
//! file; they are never serialised into any document and the file is deleted when the watch is
//! turned off. Model sentences are never written here.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use super::context::RecentEntry;
use super::types::{GateAnswer, ReadingKind};
use super::{Freshness, Rating, RulesSince, SignalId};
use crate::report_store::write_private;

pub const FILE_NAME: &str = "watch.json";
pub const KEY_BYTES: usize = 32;
pub const MAX_RECENT: usize = 50;

/// A stored value: booleans, counts and versions as numbers, digests as hex text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StoredValue {
    Bool(bool),
    Count(u64),
    Digest(String),
}

/// What the loop saw when the value differed from the baseline, and when it first saw it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observed {
    pub value: StoredValue,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<String>,
    pub changed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub kind: ReadingKind,
    pub value: StoredValue,
    /// Digest kinds only: one keyed digest per member, so "new" members can be counted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<String>,
    pub seen_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed: Option<Observed>,
    pub freshness: Freshness,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSnapshot {
    pub rule_id: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallsToday {
    pub date: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub version: u8,
    /// base64 of 32 random bytes, generated once per install.
    pub key: String,
    #[serde(default)]
    pub baselines: BTreeMap<SignalId, Entry>,
    #[serde(default)]
    pub rules: Vec<RuleSnapshot>,
    #[serde(default)]
    pub recent: Vec<RecentEntry>,
    #[serde(default = "calm")]
    pub last_rating: Rating,
    #[serde(default)]
    pub rating_since: Option<String>,
    #[serde(default)]
    pub calm_streak: u32,
    #[serde(default)]
    pub last_model_call_at: Option<String>,
    #[serde(default)]
    pub calls_today: CallsToday,
    #[serde(default)]
    pub close_watch_until: Option<String>,
    /// Unanswered "Did you just change this?" gates: when each opened.
    #[serde(default)]
    pub gates: BTreeMap<SignalId, String>,
    /// "No, I didn't" answers; "Yes, that was me" re-baselines and clears instead.
    #[serde(default)]
    pub gate_answers: BTreeMap<SignalId, GateAnswer>,
    #[serde(default)]
    pub snoozed: BTreeMap<SignalId, String>,
    #[serde(default)]
    pub notified: BTreeMap<SignalId, String>,
    /// "This is fine, I know it" counts per signal; three mute it until a full check sees a new change.
    #[serde(default)]
    pub acknowledge_count: BTreeMap<SignalId, u32>,
    #[serde(default)]
    pub last_full_check_at: Option<String>,
    #[serde(default)]
    pub cycle_index: u64,
    /// The last Talos fix, for the noise hold.
    #[serde(default)]
    pub last_fix_at: Option<String>,
    /// The last persistence change whose new items were all validly signed, for the noise hold.
    #[serde(default)]
    pub last_signed_change_at: Option<String>,
    #[serde(default)]
    pub last_change_at: Option<String>,
    /// How many rules appeared in the last check-up's diff, kept until the report id changes.
    #[serde(default)]
    pub rules_since: Option<RulesSince>,
}

fn calm() -> Rating {
    Rating::Calm
}

fn fresh_key() -> String {
    let bytes: [u8; KEY_BYTES] = rand::random();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

impl Baseline {
    pub fn new() -> Self {
        Baseline {
            version: 1,
            key: fresh_key(),
            baselines: BTreeMap::new(),
            rules: Vec::new(),
            recent: Vec::new(),
            last_rating: Rating::Calm,
            rating_since: None,
            calm_streak: 0,
            last_model_call_at: None,
            calls_today: CallsToday::default(),
            close_watch_until: None,
            gates: BTreeMap::new(),
            gate_answers: BTreeMap::new(),
            snoozed: BTreeMap::new(),
            notified: BTreeMap::new(),
            acknowledge_count: BTreeMap::new(),
            last_full_check_at: None,
            cycle_index: 0,
            last_fix_at: None,
            last_signed_change_at: None,
            last_change_at: None,
            rules_since: None,
        }
    }

    pub fn key_bytes(&self) -> Vec<u8> {
        base64::engine::general_purpose::STANDARD
            .decode(&self.key)
            .unwrap_or_default()
    }

    /// Keyed digest of a set: HMAC-SHA-256 over the newline-joined, sorted, deduplicated members.
    pub fn digest_set(&self, members: &[String]) -> String {
        let mut sorted: Vec<&str> = members.iter().map(String::as_str).collect();
        sorted.sort_unstable();
        sorted.dedup();
        hmac_hex(&self.key_bytes(), sorted.join("\n").as_bytes())
    }

    /// Keyed digest of one member, so a current member can be matched against the stored list.
    pub fn digest_member(&self, member: &str) -> String {
        hmac_hex(&self.key_bytes(), member.as_bytes())
    }

    /// Pushes one change to the front of the history, keeping the newest 50.
    pub fn record(&mut self, entry: RecentEntry) {
        self.recent.insert(0, entry);
        self.recent.truncate(MAX_RECENT);
    }

    /// Counts one model call on `date` (YYYY-MM-DD); a new day resets the counter.
    pub fn count_call(&mut self, date: &str) {
        if self.calls_today.date != date {
            self.calls_today = CallsToday {
                date: date.to_owned(),
                count: 0,
            };
        }
        self.calls_today.count += 1;
    }

    pub fn calls_on(&self, date: &str) -> u32 {
        if self.calls_today.date == date {
            self.calls_today.count
        } else {
            0
        }
    }
}

impl Default for Baseline {
    fn default() -> Self {
        Baseline::new()
    }
}

fn hmac_hex(key: &[u8], data: &[u8]) -> String {
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key) else {
        return String::new();
    };
    mac.update(data);
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// The stored baseline, or a fresh one with a new key when the file is absent or unreadable.
pub fn load(dir: &Path) -> Baseline {
    std::fs::read(path(dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Baseline>(&bytes).ok())
        .filter(|b| b.version == 1 && b.key_bytes().len() == KEY_BYTES)
        .unwrap_or_default()
}

pub fn save(dir: &Path, baseline: &Baseline) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(baseline).map_err(std::io::Error::other)?;
    write_private(&path(dir), &bytes)
}

/// Removes the file and its key; nothing derived from machine text survives the watch being off.
pub fn delete(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path(dir)) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "talos-watch-baseline-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn digests_are_order_stable_deduplicated_and_key_sensitive() {
        let a = Baseline::new();
        let b = Baseline::new();
        assert_ne!(a.key, b.key);
        let one = a.digest_set(&["x".into(), "y".into(), "z".into()]);
        let two = a.digest_set(&["z".into(), "x".into(), "y".into(), "x".into()]);
        assert_eq!(one, two, "order and duplicates do not matter");
        assert_ne!(one, a.digest_set(&["x".into(), "y".into()]));
        assert_ne!(
            one,
            b.digest_set(&["x".into(), "y".into(), "z".into()]),
            "a different key gives a different digest"
        );
        assert_eq!(one.len(), 64);
        assert_ne!(a.digest_member("x"), a.digest_member("y"));
        assert_eq!(a.digest_member("x"), a.digest_member("x"));
        assert!(!one.contains('x'));
    }

    #[test]
    fn the_file_is_private_round_trips_and_is_deleted_on_disable() {
        let dir = scratch("roundtrip");
        let mut baseline = Baseline::new();
        baseline.baselines.insert(
            SignalId::Firewall,
            Entry {
                kind: ReadingKind::Bool,
                value: StoredValue::Bool(true),
                members: vec![],
                seen_at: "2026-10-17T12:00:00.000Z".into(),
                observed: None,
                freshness: Freshness::Fresh,
            },
        );
        baseline.record(RecentEntry {
            signal_id: SignalId::Firewall,
            change: crate::watch::Change::Changed,
            at: "2026-10-17T12:00:00.000Z".into(),
        });
        baseline
            .gate_answers
            .insert(SignalId::Firewall, GateAnswer::NotMine);
        baseline.acknowledge_count.insert(SignalId::ShareCount, 2);
        baseline.rules_since = Some(RulesSince {
            report_id: "r-1".into(),
            appeared: 2,
        });
        save(&dir, &baseline).unwrap();
        let mode = std::fs::metadata(path(&dir)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let back = load(&dir);
        assert_eq!(back, baseline);
        let text = std::fs::read_to_string(path(&dir)).unwrap();
        assert!(
            text.contains("\"seenAt\"")
                && text.contains("\"gateAnswers\"")
                && text.contains("\"acknowledgeCount\"")
        );
        assert!(!text.contains("sentence"), "no model text is stored");
        delete(&dir).unwrap();
        assert!(!path(&dir).exists());
        delete(&dir).unwrap();
        assert_ne!(load(&dir).key, baseline.key, "a fresh key after delete");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_corrupt_or_short_key_file_is_replaced() {
        let dir = scratch("corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(path(&dir), b"{ nope").unwrap();
        assert_eq!(load(&dir).version, 1);
        std::fs::write(path(&dir), br#"{"version":1,"key":"AAAA"}"#).unwrap();
        assert_eq!(load(&dir).key_bytes().len(), KEY_BYTES);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn recent_keeps_fifty_and_calls_reset_on_a_new_day() {
        let mut baseline = Baseline::new();
        for i in 0..60 {
            baseline.record(RecentEntry {
                signal_id: SignalId::Sip,
                change: crate::watch::Change::Changed,
                at: format!("{i}"),
            });
        }
        assert_eq!(baseline.recent.len(), MAX_RECENT);
        assert_eq!(baseline.recent[0].at, "59");
        baseline.count_call("2026-10-17");
        baseline.count_call("2026-10-17");
        assert_eq!(baseline.calls_on("2026-10-17"), 2);
        assert_eq!(baseline.calls_on("2026-10-18"), 0);
        baseline.count_call("2026-10-18");
        assert_eq!(baseline.calls_on("2026-10-18"), 1);
    }
}
