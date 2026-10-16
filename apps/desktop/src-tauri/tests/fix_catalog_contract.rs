//! `FIX_CATALOG` lists exactly the `in_app` rules of packages/core/fixtures/fix-catalog.json.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::path::PathBuf;

use talos_desktop_lib::fix::catalog::{Choice, FIX_CATALOG, batchable, dump_json};

fn fixture() -> Option<serde_json::Value> {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "..",
        "packages",
        "core",
        "fixtures",
        "fix-catalog.json",
    ]
    .iter()
    .collect();
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

fn choice_name(choice: Choice) -> &'static str {
    match choice {
        Choice::None => "none",
        Choice::Share => "share",
        Choice::SshKey => "ssh_key",
        Choice::AllSshKeys => "all_ssh_keys",
    }
}

#[test]
fn rust_catalog_matches_the_core_fixture() {
    let Some(fixture) = fixture() else {
        eprintln!("skipped: packages/core/fixtures/fix-catalog.json is absent");
        return;
    };
    let entries = fixture.as_array().unwrap();
    let in_app: Vec<&serde_json::Value> =
        entries.iter().filter(|e| e["kind"] == "in_app").collect();
    let mut expected: Vec<&str> = in_app
        .iter()
        .map(|e| e["ruleId"].as_str().unwrap())
        .collect();
    let mut actual: Vec<&str> = FIX_CATALOG.iter().map(|s| s.rule).collect();
    expected.sort_unstable();
    actual.sort_unstable();
    assert_eq!(actual, expected, "in_app set");
    for entry in in_app {
        let rule = entry["ruleId"].as_str().unwrap();
        let spec = FIX_CATALOG.iter().find(|s| s.rule == rule).unwrap();
        assert_eq!(entry["choice"], choice_name(spec.choice), "{rule}: choice");
        assert_eq!(
            entry["needsPassword"],
            spec.needs_password(),
            "{rule}: needsPassword"
        );
        assert_eq!(
            entry["passphrase"],
            spec.needs_passphrase(),
            "{rule}: passphrase"
        );
        let recheck: Vec<&str> = spec.recheck.iter().map(|k| k.as_str()).collect();
        assert_eq!(
            entry["recheck"],
            serde_json::json!(recheck),
            "{rule}: recheck"
        );
        // The core fixture gains `batchable` in v0.3; until then the key is absent and skipped.
        if !entry["batchable"].is_null() {
            assert_eq!(entry["batchable"], batchable(spec), "{rule}: batchable");
        }
    }
}

#[test]
fn dump_json_is_an_array_with_one_entry_per_rule() {
    let dump: serde_json::Value = serde_json::from_str(&dump_json()).unwrap();
    let rows = dump.as_array().unwrap();
    assert_eq!(rows.len(), FIX_CATALOG.len());
    assert_eq!(rows[0]["rule"], "TL-MAC-002");
    assert_eq!(
        rows[0]["lines"][0]["text"],
        "/usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on"
    );
    assert_eq!(rows[0]["lines"][0]["privilege"], "admin");
}
