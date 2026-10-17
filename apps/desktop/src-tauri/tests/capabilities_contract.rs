//! The app ACL: commands.txt equals the `generate_handler!` block in src/lib.rs, the main window's
//! capability allows exactly those commands, the watch window's capability allows only the four
//! watch commands that exist, and neither file grants core:default, the tray, menus or event emits.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const WATCH_WINDOW_COMMANDS: [&str; 4] = [
    "watch_status",
    "watch_check_now",
    "watch_pause",
    "watch_open_main",
];
const FORBIDDEN: [&str; 5] = [
    "core:default",
    "core:tray",
    "core:menu",
    "core:event:allow-emit",
    "core:event:allow-emit-to",
];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

fn read(relative: &str) -> String {
    std::fs::read_to_string(root().join(relative)).unwrap_or_else(|e| panic!("{relative}: {e}"))
}

fn commands_txt() -> Vec<String> {
    read("commands.txt")
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

/// The `path::name,` entries between `generate_handler![` and the closing `]`, comments stripped.
fn handler_names() -> Vec<String> {
    let text = read("src/lib.rs");
    let start = text
        .find("generate_handler![")
        .expect("lib.rs has a generate_handler! block")
        + "generate_handler![".len();
    let rest = text.get(start..).unwrap_or("");
    let end = rest.find(']').expect("the generate_handler! block closes");
    rest.get(..end)
        .unwrap_or("")
        .lines()
        .map(|line| {
            line.split("//")
                .next()
                .unwrap_or("")
                .trim()
                .trim_end_matches(',')
                .trim()
        })
        .filter(|line| !line.is_empty())
        .map(|entry| entry.rsplit("::").next().unwrap_or(entry).to_string())
        .collect()
}

fn permissions(relative: &str) -> (serde_json::Value, BTreeSet<String>) {
    let value: serde_json::Value = serde_json::from_str(&read(relative)).unwrap();
    let list: BTreeSet<String> = value["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_string())
        .collect();
    (value, list)
}

fn kebab(name: &str) -> String {
    format!("allow-{}", name.replace('_', "-"))
}

#[test]
fn commands_txt_equals_the_generate_handler_block_both_ways() {
    let listed = commands_txt();
    let registered = handler_names();
    assert!(!listed.is_empty());
    let listed_set: BTreeSet<&str> = listed.iter().map(String::as_str).collect();
    let registered_set: BTreeSet<&str> = registered.iter().map(String::as_str).collect();
    assert_eq!(
        listed_set, registered_set,
        "commands.txt and generate_handler! differ"
    );
    assert_eq!(
        listed.len(),
        listed_set.len(),
        "commands.txt has a duplicate"
    );
    assert_eq!(
        registered.len(),
        registered_set.len(),
        "generate_handler! has a duplicate"
    );
}

#[test]
fn the_main_window_allows_exactly_the_listed_commands_plus_four_core_permissions() {
    let (value, perms) = permissions("capabilities/default.json");
    assert_eq!(value["identifier"], "default");
    assert_eq!(value["windows"], serde_json::json!(["main"]));
    let allowed: BTreeSet<String> = perms
        .iter()
        .filter(|p| p.starts_with("allow-"))
        .cloned()
        .collect();
    let expected: BTreeSet<String> = commands_txt().iter().map(|c| kebab(c)).collect();
    assert_eq!(
        allowed, expected,
        "default.json allow- set differs from commands.txt"
    );
    let core: BTreeSet<String> = perms
        .iter()
        .filter(|p| p.starts_with("core:"))
        .cloned()
        .collect();
    // start-dragging moves the window by its title strip; internal-toggle-maximize is the
    // double-click zoom Tauri's drag script invokes on that strip (window/scripts/drag.js).
    let expected_core: BTreeSet<String> = [
        "core:event:allow-listen",
        "core:event:allow-unlisten",
        "core:window:allow-start-dragging",
        "core:window:allow-internal-toggle-maximize",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(core, expected_core);
    assert_eq!(
        perms.len(),
        allowed.len() + core.len(),
        "default.json carries an unexpected permission"
    );
}

#[test]
fn the_watch_window_allows_only_the_watch_commands_that_exist_plus_the_two_event_permissions() {
    let (value, perms) = permissions("capabilities/watch.json");
    assert_eq!(value["identifier"], "watch");
    assert_eq!(value["windows"], serde_json::json!(["watch"]));
    let listed = commands_txt();
    let allowed: BTreeSet<String> = perms
        .iter()
        .filter(|p| p.starts_with("allow-"))
        .cloned()
        .collect();
    let expected: BTreeSet<String> = WATCH_WINDOW_COMMANDS
        .iter()
        .filter(|c| listed.iter().any(|l| l == *c))
        .map(|c| kebab(c))
        .collect();
    assert_eq!(
        allowed, expected,
        "watch.json allow- set differs from the four watch commands present in commands.txt"
    );
    let core: BTreeSet<String> = perms
        .iter()
        .filter(|p| p.starts_with("core:"))
        .cloned()
        .collect();
    let expected_core: BTreeSet<String> = ["core:event:allow-listen", "core:event:allow-unlisten"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    assert_eq!(core, expected_core);
    assert_eq!(
        perms.len(),
        allowed.len() + core.len(),
        "watch.json carries an unexpected permission"
    );
}

#[test]
fn neither_capability_mentions_core_default_the_tray_menus_or_event_emits() {
    for file in ["capabilities/default.json", "capabilities/watch.json"] {
        let text = read(file);
        for needle in FORBIDDEN {
            assert!(!text.contains(needle), "{file} mentions {needle}");
        }
    }
}

#[test]
fn the_window_labels_are_the_two_in_tauri_conf() {
    let conf: serde_json::Value = serde_json::from_str(&read("tauri.conf.json")).unwrap();
    let windows = conf["app"]["windows"].as_array().unwrap();
    assert_eq!(windows.len(), 2);
    assert!(
        windows[0].get("label").is_none(),
        "the first window keeps the default label main"
    );
    let watch = &windows[1];
    assert_eq!(watch["label"], "watch");
    assert_eq!(watch["url"], "watch.html");
    assert_eq!(watch["width"], 320);
    assert_eq!(watch["height"], 420);
    assert_eq!(watch["visible"], false);
    assert_eq!(watch["decorations"], false);
    assert_eq!(watch["alwaysOnTop"], true);
    assert_eq!(watch["visibleOnAllWorkspaces"], true);
    assert_eq!(watch["resizable"], false);
    assert_eq!(watch["transparent"], false);
    assert_eq!(watch["shadow"], true);
    assert_eq!(watch["acceptFirstMouse"], true);
    assert_eq!(watch["skipTaskbar"], true);
}
