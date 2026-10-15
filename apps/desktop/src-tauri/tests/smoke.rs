//! Runs the real collectors on this Mac. Ignored by default; run with `cargo test -- --ignored`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use talos_desktop_lib::collect::{self, ProgressFn};
use talos_desktop_lib::state::{SectionKey, SystemState};

#[test]
#[ignore]
fn collect_all_on_this_mac() {
    let progress: Arc<ProgressFn> = Arc::new(|key, status| eprintln!("{} {:?}", key.as_str(), status));
    let state = collect::collect_all(progress, Arc::new(AtomicBool::new(false))).unwrap();
    let json = serde_json::to_value(&state).unwrap();
    let sections = json["sections"].as_object().unwrap();
    assert_eq!(sections.len(), SectionKey::ALL.len());
    for key in SectionKey::ALL {
        let section = &sections[key.as_str()];
        match section["status"].as_str().unwrap() {
            "ok" => assert!(section.get("data").is_some(), "{}", key.as_str()),
            "unavailable" => assert!(section["reason"].is_string(), "{}", key.as_str()),
            other => panic!("{}: unexpected status {other}", key.as_str()),
        }
    }
    let back: SystemState = serde_json::from_value(json).unwrap();
    assert_eq!(back, state);
}
