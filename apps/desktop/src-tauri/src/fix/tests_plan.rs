use std::time::{Duration, Instant};

use super::FixError;
use super::catalog::spec_for;
use super::plan::*;

fn plan(rule: &str) -> Plan {
    Plan::new(spec_for(rule).unwrap(), Bound::default(), None)
}

#[test]
fn ids_are_random_hex() {
    let a = new_id();
    let b = new_id();
    assert_eq!(a.len(), 32);
    assert!(a.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_ne!(a, b);
}

#[test]
fn wire_shape_matches_the_contract() {
    let p = plan("TL-MAC-019");
    let json = serde_json::to_value(p.wire()).unwrap();
    assert_eq!(json["ruleId"], "TL-MAC-019");
    assert_eq!(json["needsPassword"], true);
    assert_eq!(json["needsPassphrase"], false);
    assert_eq!(
        json["recheck"],
        serde_json::json!(["remoteAccess", "listeners"])
    );
    assert_eq!(json["previous"], serde_json::Value::Null);
    assert_eq!(
        json["lines"][1]["text"],
        "/bin/launchctl bootout system/com.apple.screensharing"
            .replace("com.apple.screensharing", "com.openssh.sshd")
    );
    assert_eq!(json["lines"][1]["privilege"], "admin");
    assert!(json["expiresAt"].as_str().unwrap().ends_with('Z'));
    assert!(json["planId"].as_str().unwrap().len() == 32);
}

#[test]
fn unknown_and_expired_ids_are_plan_expired() {
    let store = PlanStore::default();
    assert_eq!(store.start("nope").err(), Some(FixError::PlanExpired));
    let mut stale = plan("TL-MAC-002");
    stale.created = Instant::now() - PLAN_TTL - Duration::from_secs(1);
    assert!(stale.expired());
    let id = store.insert(stale).plan_id;
    assert_eq!(store.start(&id).err(), Some(FixError::PlanExpired));
    assert!(!store.is_running());
}

#[test]
fn a_plan_runs_once_and_a_second_apply_is_busy() {
    let store = PlanStore::default();
    let first = store.insert(plan("TL-MAC-002")).plan_id;
    let second = store.insert(plan("TL-MAC-003")).plan_id;
    let (_plan, running) = store.start(&first).unwrap();
    assert!(store.is_running());
    assert_eq!(store.start(&second).err(), Some(FixError::Busy));
    store.cancel(&first);
    assert!(running.cancelled());
    store.finish(&first);
    assert!(!store.is_running());
    assert_eq!(
        store.start(&first).err(),
        Some(FixError::PlanExpired),
        "an id runs once"
    );
    // The busy rejection left the second plan in place, so it can run now.
    assert!(store.start(&second).is_ok());
    store.finish(&second);
}

#[test]
fn bound_expands_slots_and_per_key_steps() {
    let spec = spec_for("TL-MAC-030").unwrap();
    let bound = Bound {
        ssh_dir: Some("/Users/alice/.ssh".into()),
        key_paths: vec!["/Users/alice/.ssh/a".into(), "/Users/alice/.ssh/b".into()],
        ..Bound::default()
    };
    let lines = Plan::new(spec, bound, None).lines();
    let texts: Vec<&str> = lines.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "/bin/chmod 700 /Users/alice/.ssh",
            "/bin/chmod 600 /Users/alice/.ssh/a",
            "/bin/chmod 600 /Users/alice/.ssh/b"
        ]
    );
    let spec = spec_for("TL-MAC-029").unwrap();
    let bound = Bound {
        key_paths: vec!["/Users/alice/.ssh/id_rsa".into()],
        key_format_flags: &["-m", "PEM"],
        ..Bound::default()
    };
    assert_eq!(
        Plan::new(spec, bound, None).lines()[0].text,
        "/usr/bin/ssh-keygen -p -m PEM -f /Users/alice/.ssh/id_rsa"
    );
}
