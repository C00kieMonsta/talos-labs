//! The fixed argument lists of the DESIGN-THREATS-V2 probes and collectors are literals in
//! `src/watch/probes.rs` and `src/collect/macos/apps.rs` (`exec.rs` has no per-binary
//! allow-list to test), the watch never runs `sw_vers -buildVersion` of its own (the build
//! comes from the host collector), and the two files open no file contents.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::Path;

fn source(rel: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)).unwrap()
}

/// The production body of a file: everything before its in-module tests.
fn body(rel: &str) -> String {
    let whole = source(rel);
    whole.split("#[cfg(test)]").next().unwrap_or("").to_owned()
}

const PROBES: &str = "src/watch/probes.rs";
const APPS: &str = "src/collect/macos/apps.rs";
const REMOTE: &str = "src/collect/macos/remote_access.rs";

#[test]
fn the_codesign_slices_are_the_two_literals_in_apps_rs() {
    let apps = body(APPS);
    assert!(apps.contains(r#"&["--verify", "--strict", "--", text.as_ref()]"#));
    assert!(apps.contains(r#"&["-dvv", "--", text.as_ref()]"#));
    assert_eq!(
        apps.matches("Bin::Codesign").count(),
        2,
        "one call per argument list"
    );
}

#[test]
fn the_launchctl_csrutil_and_mdfind_slices_are_literals() {
    let apps = body(APPS);
    let probes = body(PROBES);
    assert!(apps.contains(r#"&["getenv", "DYLD_INSERT_LIBRARIES"]"#));
    assert!(probes.contains(r#"&["authenticated-root", "status"]"#));
    assert!(probes.contains(r#""-onlyin","#));
    assert!(probes.contains(r#""kMDItemContentType == 'com.apple.application-bundle'""#));
    assert!(probes.contains("Bin::Mdfind"));
    assert!(
        !apps.contains("Bin::Mdfind"),
        "the check-up never runs mdfind"
    );
}

#[test]
fn the_defaults_reads_name_their_domains_and_keys_through_the_read_helpers() {
    let apps = body(APPS);
    let probes = body(PROBES);
    let remote = body(REMOTE);
    // `defaults::read_key(domain, key, ..)` runs `["read", domain, key]`; `read_domain` runs `["read", domain]`.
    assert!(probes.contains(r#"defaults::read_key("com.apple.sharingd", "DiscoverableMode","#));
    assert!(probes.contains(r#""/Library/Preferences/SystemConfiguration/com.apple.nat","#));
    assert!(probes.contains("defaults::read_domain("));
    assert!(apps.contains(r#"("/Library/Preferences/com.apple.loginwindow", "LoginHook")"#));
    assert!(apps.contains(r#"("/Library/Preferences/com.apple.loginwindow", "LogoutHook")"#));
    assert!(apps.contains(r#"("com.apple.loginwindow", "LoginHook")"#));
    assert!(apps.contains("defaults::read_key(domain, key,"));
    assert!(remote.contains(
        r#"pub const NAT_DOMAIN: &str = "/Library/Preferences/SystemConfiguration/com.apple.nat";"#
    ));
    assert!(remote.contains(r#"pub const SHARINGD_DOMAIN: &str = "com.apple.sharingd";"#));
    assert!(remote.contains("defaults::read_domain(NAT_DOMAIN,"));
    assert!(remote.contains("defaults::read_key(SHARINGD_DOMAIN, DISCOVERABLE_MODE_KEY,"));
    let helpers = body("src/collect/macos/defaults.rs");
    assert!(helpers.contains(r#"read(&["read", domain], label, cancel)"#));
    assert!(helpers.contains(r#"read(&["read", domain, key], label, cancel)"#));
}

#[test]
fn the_watch_never_runs_sw_vers_build_version_itself() {
    for file in [
        PROBES,
        APPS,
        "src/watch/cycle.rs",
        "src/watch/baseline.rs",
        "src/watch/mod.rs",
    ] {
        let text = source(file);
        assert!(!text.contains("-buildVersion"), "{file}");
    }
    let cycle = body("src/watch/cycle.rs");
    assert!(
        cycle.contains("crate::collect::macos::host::collect("),
        "the build comes from the host collector's plain `sw_vers` read"
    );
    assert!(
        !cycle.contains("Bin::SwVers"),
        "no second sw_vers run in the cycle"
    );
}

#[test]
fn the_probes_and_the_apps_collector_open_no_file_contents() {
    for file in [PROBES, APPS] {
        let text = body(file);
        for needle in [
            "std::fs::read(",
            "read_to_string(",
            "File::open(",
            "fs::read(",
        ] {
            assert!(!text.contains(needle), "{file}: {needle}");
        }
    }
    let apps = body(APPS);
    assert!(apps.contains("libc::listxattr("));
    assert!(
        !apps.contains("libc::getxattr("),
        "attribute names only, never a value"
    );
    assert!(
        !apps.contains("Bin::Xattr"),
        "no xattr binary: the probe calls listxattr(2)"
    );
}
