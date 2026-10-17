//! `watch::playbook::PLAYBOOK` equals packages/core/fixtures/playbook.json row by row, every
//! `fix` row names a catalogue id, and no WATCH_CATALOG row can join a batch.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::path::PathBuf;

use talos_desktop_lib::fix::catalog::{WATCH_CATALOG, batchable, spec_for, watch_spec_for};
use talos_desktop_lib::watch::playbook::{ActionKind, PLAYBOOK, dump_json};

fn fixture() -> Option<serde_json::Value> {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "..",
        "packages",
        "core",
        "fixtures",
        "playbook.json",
    ]
    .iter()
    .collect();
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

#[test]
fn rust_playbook_matches_the_core_fixture_row_by_row() {
    let Some(fixture) = fixture() else {
        eprintln!("skipped: packages/core/fixtures/playbook.json is absent");
        return;
    };
    let expected = fixture.as_array().unwrap();
    let dump: serde_json::Value = serde_json::from_str(&dump_json()).unwrap();
    let rows = dump.as_array().unwrap();
    assert_eq!(rows.len(), expected.len(), "row count");
    for (row, want) in rows.iter().zip(expected) {
        let id = want["id"].as_str().unwrap();
        for key in [
            "id",
            "source",
            "step",
            "url",
            "kind",
            "floor",
            "triggers",
            "title",
            "whatExpertsDo",
            "phase",
            "outcome",
        ] {
            assert_eq!(row[key], want[key], "{id}: {key}");
        }
        assert_eq!(row.as_object().unwrap().len(), 11, "{id}: eleven fields");
    }
}

#[test]
fn every_fix_row_resolves_and_every_url_is_https() {
    for row in PLAYBOOK.iter() {
        assert!(row.url.starts_with("https://"), "{}", row.id.as_str());
        if let ActionKind::Fix { spec } = row.kind {
            assert!(
                spec_for(spec).is_some() || watch_spec_for(spec).is_some(),
                "{}: {spec} is in neither catalogue",
                row.id.as_str()
            );
        }
    }
}

#[test]
fn no_watch_catalog_row_is_batchable() {
    assert_eq!(WATCH_CATALOG.len(), 6);
    for spec in WATCH_CATALOG {
        assert!(!batchable(spec), "{}", spec.rule);
        assert!(spec.rule.starts_with("watch."), "{}", spec.rule);
    }
}
