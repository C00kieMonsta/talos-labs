//! Reads preference domains through `defaults read` and parses its top-level scalars.

use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;

use super::run;
use crate::collect::Fail;
use crate::exec::{Bin, Output};
use crate::state::Tri;

/// Top-level scalar keys of a `defaults read <domain>` dump. Nested dictionaries and arrays are skipped.
pub fn parse_dump(text: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    let mut depth: i32 = 0;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line == "{" || line == "(" {
            depth += 1;
            continue;
        }
        if line.starts_with('}') || line.starts_with(')') {
            depth -= 1;
            continue;
        }
        let opens = line.ends_with('{') || line.ends_with('(');
        if depth == 1 && !opens && let Some((key, value)) = line.split_once('=') {
            let value = value.trim();
            let value = value.strip_suffix(';').unwrap_or(value).trim();
            map.insert(unquote(key.trim()), unquote(value));
        }
        if opens {
            depth += 1;
        }
    }
    map
}

fn unquote(text: &str) -> String {
    text.strip_prefix('"')
        .and_then(|t| t.strip_suffix('"'))
        .unwrap_or(text)
        .to_owned()
}

pub fn as_bool(value: &str) -> Option<bool> {
    match value.trim() {
        "1" | "true" | "YES" | "true;" => Some(true),
        "0" | "false" | "NO" => Some(false),
        _ => None,
    }
}

pub fn bool_of(map: &BTreeMap<String, String>, key: &str) -> Option<bool> {
    map.get(key).and_then(|v| as_bool(v))
}

/// Missing key gives `Unset`.
pub fn tri(map: &BTreeMap<String, String>, key: &str) -> Tri {
    Tri::from(bool_of(map, key))
}

/// "2026-10-15 08:56:56 +0000" to "2026-10-15T08:56:56.000Z".
pub fn date_to_iso(value: &str) -> Option<String> {
    chrono::DateTime::parse_from_str(value.trim(), "%Y-%m-%d %H:%M:%S %z")
        .ok()
        .map(|d| d.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn is_missing(out: &Output) -> bool {
    let err = out.stderr.to_ascii_lowercase();
    err.contains("not found") || err.contains("could not find") || err.contains("does not exist")
}

fn read(args: &[&str], label: &str, cancel: &AtomicBool) -> Result<Option<String>, Fail> {
    let out = run(Bin::Defaults, args, cancel)?;
    if out.success() {
        Ok(Some(out.stdout))
    } else if is_missing(&out) {
        Ok(None)
    } else {
        Err(Fail::collector(&format!("defaults: {label}")))
    }
}

/// The whole domain dump, or None when the domain does not exist.
pub fn read_domain(domain: &str, label: &str, cancel: &AtomicBool) -> Result<Option<String>, Fail> {
    read(&["read", domain], label, cancel)
}

/// One key as its printed value, trimmed, or None when the key or domain is missing.
pub fn read_key(domain: &str, key: &str, label: &str, cancel: &AtomicBool) -> Result<Option<String>, Fail> {
    Ok(read(&["read", domain, key], label, cancel)?.map(|v| v.trim().to_owned()))
}

/// Like `read_key` but for the current host (`defaults -currentHost read`).
pub fn read_current_host_key(domain: &str, key: &str, label: &str, cancel: &AtomicBool) -> Result<Option<String>, Fail> {
    Ok(read(&["-currentHost", "read", domain, key], label, cancel)?.map(|v| v.trim().to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DUMP: &str = r#"{
    AutoInstallProductKeys =     (
    );
    AutomaticDownload = 1;
    AutomaticallyInstallMacOSUpdates = 1;
    FirstInstallTonightDateDictionary =     {
        "MSU_UPDATE_24E263_patch_15.4.1_minor" = "2025-04-17 08:47:28 +0000";
        Nested = 0;
    };
    LastAttemptBuildVersion = "27.0.1 (26A434)";
    LastResultCode = 2;
    LastSuccessfulDate = "2026-10-15 08:56:56 +0000";
    PrimaryLanguages =     (
        "en-US",
        en
    );
    SplatEnabled = 1;
}
"#;

    #[test]
    fn parses_top_level_scalars_only() {
        let map = parse_dump(DUMP);
        assert_eq!(map.get("AutomaticDownload").map(String::as_str), Some("1"));
        assert_eq!(map.get("LastResultCode").map(String::as_str), Some("2"));
        assert_eq!(map.get("LastAttemptBuildVersion").map(String::as_str), Some("27.0.1 (26A434)"));
        assert_eq!(map.get("LastSuccessfulDate").map(String::as_str), Some("2026-10-15 08:56:56 +0000"));
        assert_eq!(map.get("SplatEnabled").map(String::as_str), Some("1"));
        assert!(!map.contains_key("Nested"));
        assert!(!map.contains_key("MSU_UPDATE_24E263_patch_15.4.1_minor"));
        assert!(!map.contains_key("en"));
        assert_eq!(map.get("AutoInstallProductKeys"), None);
    }

    #[test]
    fn tri_and_bool_helpers() {
        let map = parse_dump("{\n    A = 1;\n    B = 0;\n    C = yes;\n}\n");
        assert_eq!(tri(&map, "A"), Tri::True);
        assert_eq!(tri(&map, "B"), Tri::False);
        assert_eq!(tri(&map, "C"), Tri::Unset);
        assert_eq!(tri(&map, "Missing"), Tri::Unset);
        assert_eq!(as_bool("true"), Some(true));
        assert_eq!(as_bool("NO"), Some(false));
    }

    #[test]
    fn converts_defaults_dates() {
        assert_eq!(date_to_iso("2026-10-15 08:56:56 +0000").as_deref(), Some("2026-10-15T08:56:56.000Z"));
        assert_eq!(date_to_iso("2026-10-15 10:56:56 +0200").as_deref(), Some("2026-10-15T08:56:56.000Z"));
        assert_eq!(date_to_iso("nope"), None);
    }

    #[test]
    fn empty_dump_is_empty_map() {
        assert!(parse_dump("").is_empty());
    }
}
