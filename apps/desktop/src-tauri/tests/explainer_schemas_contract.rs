//! The schemas Rust hands to Claude Code equal packages/core/fixtures/explainer-schemas.json.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::path::PathBuf;

use talos_desktop_lib::ai::Task;
use talos_desktop_lib::ai::schemas;

fn fixture() -> Option<serde_json::Value> {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "..",
        "packages",
        "core",
        "fixtures",
        "explainer-schemas.json",
    ]
    .iter()
    .collect();
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

#[test]
fn rust_schemas_match_the_core_fixture() {
    let Some(fixture) = fixture() else {
        eprintln!("skipped: packages/core/fixtures/explainer-schemas.json is absent");
        return;
    };
    for (task, key) in [
        (Task::Explain, "explain"),
        (Task::Prioritise, "prioritise"),
        (Task::Ask, "ask"),
    ] {
        let rust: serde_json::Value = serde_json::from_str(schemas::for_task(task)).unwrap();
        assert_eq!(rust, fixture[key], "{key}");
    }
}
