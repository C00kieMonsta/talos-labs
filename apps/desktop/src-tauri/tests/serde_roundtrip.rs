//! Contract test: every emitted core fixture deserialises into `state::SystemState` and re-serialises equal.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::path::{Path, PathBuf};

use talos_desktop_lib::state::{SectionKey, SystemState};

/// The TypeScript fixtures are the source; `pnpm --filter @talos/core fixtures:emit` writes them here.
fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/core/fixtures")
}

const EXPECTED: [&str; 5] = [
    "all-unavailable",
    "dev-machine",
    "fresh-install",
    "hardened",
    "windows-minimal",
];

fn json_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        // fix-catalog.json is the fix contract, not a SystemState; tests/fix_catalog_contract.rs reads it.
        // explainer-schemas.json and partial-json-cases.json are AI contracts with their own tests.
        // playbook.json and watch-cases.json are the watch contracts (tests/playbook_contract.rs, tests/watch_cases_contract.rs).
        .filter(|p| {
            p.file_stem().is_none_or(|s| {
                s != "fix-catalog"
                    && s != "explainer-schemas"
                    && s != "partial-json-cases"
                    && s != "playbook"
                    && s != "watch-cases"
            })
        })
        .collect();
    files.sort();
    files
}

#[test]
fn every_fixture_round_trips() {
    let dir = fixture_dir();
    let files = json_files(&dir);
    for name in EXPECTED {
        assert!(
            files
                .iter()
                .any(|f| f.file_stem().is_some_and(|s| s == name)),
            "{} is missing {name}.json; run pnpm --filter @talos/core fixtures:emit",
            dir.display()
        );
    }
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        let original: serde_json::Value = serde_json::from_str(&text).unwrap();
        let state: SystemState =
            serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
        assert_eq!(state.schema_version, 1, "{}", file.display());
        let back = serde_json::to_value(&state).unwrap();
        assert_eq!(
            back,
            original,
            "{} changed after a round trip",
            file.display()
        );
        let sections = original
            .get("sections")
            .and_then(|s| s.as_object())
            .unwrap();
        for key in SectionKey::ALL {
            assert!(
                sections.contains_key(key.as_str()),
                "{} lacks {}",
                file.display(),
                key.as_str()
            );
        }
    }
}

#[test]
fn dev_machine_fixture_matches_known_values() {
    let text = std::fs::read_to_string(fixture_dir().join("dev-machine.json")).unwrap();
    let state: SystemState = serde_json::from_str(&text).unwrap();
    assert_eq!(state.host.os_version, "27.0.1");
    let fw = state.sections.firewall.as_ok().unwrap();
    assert!(!fw.enabled);
    let listeners = state.sections.listeners.as_ok().unwrap();
    assert_eq!(listeners.entries.len(), 6);
    let chrome = &state.sections.browsers.as_ok().unwrap().installed[0];
    assert_eq!(
        chrome.extensions.reason(),
        Some(talos_desktop_lib::state::UnavailableReason::NeedsFullDiskAccess)
    );
    let remote = state.sections.remote_access.as_ok().unwrap();
    assert_eq!(
        remote
            .remote_apple_events
            .as_ref()
            .and_then(|s| s.service_loaded),
        Some(false)
    );
    assert_eq!(
        remote.internet_sharing,
        talos_desktop_lib::state::Tri::Unset
    );
    assert_eq!(
        remote.airdrop,
        talos_desktop_lib::state::AirdropMode::Everyone
    );
    let integrity = state.sections.platform_integrity.as_ok().unwrap();
    let apps = integrity.apps.as_ok().unwrap();
    assert_eq!((apps.bundle_count, apps.checked_count), (41, 41));
    assert!(apps.flagged.is_empty());
    let inserts = integrity.inserts.as_ok().unwrap();
    assert!(!inserts.dyld_insert_set && !inserts.login_hook_set && !inserts.launchd_conf_present);
}
