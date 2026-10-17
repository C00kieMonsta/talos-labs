//! The watch never reads file contents beyond the declared exceptions: no `scan_keys`, no
//! `ssh::scan`, no `dotfiles::`, no `collect_all`; the two full-check collectors are named in
//! probes.rs only (docs/DESIGN-WATCH.md section 2, decision 21).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::Path;

const NEVER: [&str; 4] = ["scan_keys", "ssh::scan", "dotfiles::", "collect_all"];
const PROBES_ONLY: [&str; 2] = ["browsers::", "login_items::"];

fn watch_files() -> Vec<std::path::PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/watch");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "rs"))
        .collect();
    files.sort();
    assert!(files.len() >= 12, "{} watch files", files.len());
    files
}

#[test]
fn the_watch_never_names_the_content_readers() {
    for file in watch_files() {
        let text = std::fs::read_to_string(&file).unwrap();
        for needle in NEVER {
            assert!(
                !text.contains(needle),
                "{}: mentions {needle}",
                file.display()
            );
        }
        let is_probes = file.file_name().is_some_and(|n| n == "probes.rs");
        for needle in PROBES_ONLY {
            assert!(
                is_probes || !text.contains(needle),
                "{}: mentions {needle} outside probes.rs",
                file.display()
            );
        }
    }
}

#[test]
fn probes_name_the_two_full_check_collectors_only_once_each() {
    let whole =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/watch/probes.rs"))
            .unwrap();
    // The in-module tests read fixture files; the production body before them may not.
    let text = whole.split("#[cfg(test)]\nmod tests").next().unwrap_or("");
    for needle in PROBES_ONLY {
        assert!(
            text.contains(needle),
            "probes.rs must call {needle} for the full check"
        );
    }
    assert!(
        !text.contains("std::fs::read("),
        "probes.rs reads metadata and listings, not contents"
    );
    assert!(
        !text.contains("read_to_string("),
        "probes.rs reads metadata and listings, not contents"
    );
}
