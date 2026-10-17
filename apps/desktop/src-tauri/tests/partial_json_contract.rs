//! `partial_json::complete_prefix` agrees with packages/core/fixtures/partial-json-cases.json.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::path::PathBuf;

use talos_desktop_lib::ai::partial_json::complete_prefix;

fn fixture() -> Option<Vec<serde_json::Value>> {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "..",
        "packages",
        "core",
        "fixtures",
        "partial-json-cases.json",
    ]
    .iter()
    .collect();
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

#[test]
fn every_fixture_case_agrees() {
    let Some(cases) = fixture() else {
        eprintln!("skipped: packages/core/fixtures/partial-json-cases.json is absent");
        return;
    };
    assert!(cases.len() >= 20);
    for case in cases {
        let prefix = case["prefix"].as_str().unwrap();
        let expected = match &case["value"] {
            serde_json::Value::Null => None,
            value => Some(value.clone()),
        };
        assert_eq!(complete_prefix(prefix), expected, "{prefix:?}");
    }
}
