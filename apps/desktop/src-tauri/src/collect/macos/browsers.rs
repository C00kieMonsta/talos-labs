//! Installed browsers and their extensions. Chrome-family data is TCC-protected.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use super::{check_cancel, home, is_not_found, is_permission_error};
use crate::collect::{to_section, Fail};
use crate::state::{BrowserExtension, BrowserId, BrowserReport, Browsers, Section, UnavailableReason};

/// Chrome-family user data directories under `~/Library/Application Support`.
pub const CHROME_FAMILY: [(BrowserId, &str); 4] = [
    (BrowserId::Chrome, "Google/Chrome"),
    (BrowserId::Brave, "BraveSoftware/Brave-Browser"),
    (BrowserId::Edge, "Microsoft Edge"),
    (BrowserId::Arc, "Arc/User Data"),
];

pub const FIREFOX_DIR: &str = "Firefox";

/// true for `<all_urls>` or a wildcard host pattern such as `*://*/*`.
pub fn is_broad_host_pattern(pattern: &str) -> bool {
    let p = pattern.trim();
    p == "<all_urls>"
        || ["*://*/*", "http://*/*", "https://*/*", "*://*/", "http://*/", "https://*/"].contains(&p)
        || p.starts_with("*://*/")
        || p.starts_with("http://*/")
        || p.starts_with("https://*/")
}

fn strings(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
        .map(|items| items.iter().filter_map(serde_json::Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default()
}

/// `name`, `version`, `permissions` and `host_permissions` from a Chrome manifest.
pub fn parse_chrome_manifest(id: &str, text: &str) -> Option<BrowserExtension> {
    let manifest: serde_json::Value = serde_json::from_str(text).ok()?;
    let version = manifest.get("version")?.as_str()?.to_owned();
    let name = manifest.get("name").and_then(serde_json::Value::as_str).unwrap_or(id).to_owned();
    let permissions = strings(manifest.get("permissions"));
    let hosts = strings(manifest.get("host_permissions"));
    let broad_host_access = permissions.iter().chain(hosts.iter()).any(|p| is_broad_host_pattern(p));
    Some(BrowserExtension { id: id.to_owned(), name, version, permissions, broad_host_access })
}

/// Profile paths from Firefox `profiles.ini`: (path, is_relative).
pub fn parse_profiles_ini(text: &str) -> Vec<(String, bool)> {
    let mut profiles = Vec::new();
    let mut in_profile = false;
    let mut path: Option<String> = None;
    let mut relative = true;
    let flush = |in_profile: bool, path: &mut Option<String>, relative: bool, profiles: &mut Vec<(String, bool)>| {
        if in_profile && let Some(p) = path.take() {
            profiles.push((p, relative));
        }
    };
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            flush(in_profile, &mut path, relative, &mut profiles);
            in_profile = line.starts_with("[Profile");
            relative = true;
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            match key.trim() {
                "Path" => path = Some(value.trim().to_owned()),
                "IsRelative" => relative = value.trim() != "0",
                _ => {}
            }
        }
    }
    flush(in_profile, &mut path, relative, &mut profiles);
    profiles
}

const FIREFOX_BUILTIN_LOCATIONS: [&str; 4] = ["app-system-defaults", "app-builtin", "app-system-addons", "app-system-share"];

/// User-installed extensions from Firefox `extensions.json`.
pub fn parse_firefox_extensions(text: &str) -> Vec<BrowserExtension> {
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(text) else { return Vec::new() };
    let Some(addons) = doc.get("addons").and_then(serde_json::Value::as_array) else { return Vec::new() };
    let mut out = Vec::new();
    for addon in addons {
        let kind = addon.get("type").and_then(serde_json::Value::as_str).unwrap_or("");
        if kind != "extension" {
            continue;
        }
        let location = addon.get("location").and_then(serde_json::Value::as_str).unwrap_or("");
        if FIREFOX_BUILTIN_LOCATIONS.contains(&location) {
            continue;
        }
        if addon.get("hidden").and_then(serde_json::Value::as_bool) == Some(true) {
            continue;
        }
        let Some(id) = addon.get("id").and_then(serde_json::Value::as_str) else { continue };
        let Some(version) = addon.get("version").and_then(serde_json::Value::as_str) else { continue };
        let name = addon
            .get("defaultLocale")
            .and_then(|l| l.get("name"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or(id)
            .to_owned();
        let user = addon.get("userPermissions");
        let permissions = strings(user.and_then(|u| u.get("permissions")));
        let origins = strings(user.and_then(|u| u.get("origins")));
        let broad_host_access = origins.iter().any(|o| is_broad_host_pattern(o));
        out.push(BrowserExtension { id: id.to_owned(), name, version: version.to_owned(), permissions, broad_host_access });
    }
    out
}

fn fda_fail(err: &std::io::Error, label: &str) -> Fail {
    if is_permission_error(err) {
        Fail::new(UnavailableReason::NeedsFullDiskAccess, label)
    } else {
        Fail::io(err, label)
    }
}

fn chrome_profile_dirs(user_data: &Path, label: &str) -> Result<Vec<PathBuf>, Fail> {
    let entries = std::fs::read_dir(user_data).map_err(|err| fda_fail(&err, &format!("read_dir: Application Support/{label}")))?;
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            p.is_dir() && (name == "Default" || name.starts_with("Profile "))
        })
        .collect();
    dirs.sort();
    Ok(dirs)
}

/// Reads `<profile>/Extensions/<id>/<version>/manifest.json` for every profile.
/// `Ok(None)` means the directory holds no profile, so the browser is not installed.
pub fn chrome_extensions(user_data: &Path, label: &str) -> Result<Option<Vec<BrowserExtension>>, Fail> {
    let profiles = chrome_profile_dirs(user_data, label)?;
    if profiles.is_empty() {
        return Ok(None);
    }
    let mut found: Vec<BrowserExtension> = Vec::new();
    for profile in profiles {
        let ids = match std::fs::read_dir(profile.join("Extensions")) {
            Ok(ids) => ids,
            Err(err) if is_not_found(&err) => continue,
            Err(err) => return Err(fda_fail(&err, &format!("read_dir: Application Support/{label}/Extensions"))),
        };
        for id_entry in ids.flatten() {
            let id = id_entry.file_name().to_string_lossy().into_owned();
            let Ok(versions) = std::fs::read_dir(id_entry.path()) else { continue };
            let mut version_dirs: Vec<PathBuf> = versions.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
            version_dirs.sort();
            let Some(latest) = version_dirs.last() else { continue };
            let Ok(text) = std::fs::read_to_string(latest.join("manifest.json")) else { continue };
            if let Some(ext) = parse_chrome_manifest(&id, &text)
                && !found.iter().any(|e| e.id == ext.id)
            {
                found.push(ext);
            }
        }
    }
    found.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(Some(found))
}

pub fn firefox_extensions(base: &Path) -> Result<Vec<BrowserExtension>, Fail> {
    let ini = std::fs::read_to_string(base.join("profiles.ini"))
        .map_err(|err| fda_fail(&err, "read: Application Support/Firefox/profiles.ini"))?;
    let mut found: Vec<BrowserExtension> = Vec::new();
    for (path, relative) in parse_profiles_ini(&ini) {
        let profile = if relative { base.join(path) } else { PathBuf::from(path) };
        let Ok(text) = std::fs::read_to_string(profile.join("extensions.json")) else { continue };
        for ext in parse_firefox_extensions(&text) {
            if !found.iter().any(|e| e.id == ext.id) {
                found.push(ext);
            }
        }
    }
    found.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(found)
}

/// Installed when the directory can be stat'ed. ENOENT means not installed.
fn installed(dir: &Path) -> bool {
    match std::fs::metadata(dir) {
        Ok(_) => true,
        Err(err) => !is_not_found(&err),
    }
}

pub fn scan(app_support: &Path) -> Browsers {
    let mut installed_browsers = Vec::new();
    for (browser, rel) in CHROME_FAMILY {
        let user_data = app_support.join(rel);
        if !installed(&user_data) {
            continue;
        }
        let extensions = match chrome_extensions(&user_data, rel) {
            Ok(Some(list)) => Section::ok(list),
            Ok(None) => continue,
            Err(fail) => fail.into_section(),
        };
        installed_browsers.push(BrowserReport { browser, extensions });
    }
    let firefox = app_support.join(FIREFOX_DIR);
    if installed(&firefox) {
        installed_browsers.push(BrowserReport { browser: BrowserId::Firefox, extensions: to_section(firefox_extensions(&firefox)) });
    }
    Browsers { installed: installed_browsers }
}

fn inner(cancel: &AtomicBool) -> Result<Browsers, Fail> {
    check_cancel(cancel)?;
    Ok(scan(&home()?.join("Library/Application Support")))
}

pub fn collect(cancel: &AtomicBool) -> Section<Browsers> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn broad_host_patterns() {
        assert!(is_broad_host_pattern("<all_urls>"));
        assert!(is_broad_host_pattern("*://*/*"));
        assert!(is_broad_host_pattern("https://*/*"));
        assert!(!is_broad_host_pattern("https://*.example.com/*"));
        assert!(!is_broad_host_pattern("storage"));
    }

    #[test]
    fn chrome_manifest_mv3() {
        let text = r#"{"manifest_version":3,"name":"Blocker","version":"1.2.3","permissions":["storage","tabs"],"host_permissions":["<all_urls>"]}"#;
        let ext = parse_chrome_manifest("abc", text).unwrap();
        assert_eq!(ext.name, "Blocker");
        assert_eq!(ext.version, "1.2.3");
        assert_eq!(ext.permissions, ["storage", "tabs"]);
        assert!(ext.broad_host_access);
        let narrow = parse_chrome_manifest("abc", r#"{"name":"N","version":"1","permissions":["storage"]}"#).unwrap();
        assert!(!narrow.broad_host_access);
        assert!(parse_chrome_manifest("abc", r#"{"name":"no version"}"#).is_none());
        assert!(parse_chrome_manifest("abc", "not json").is_none());
    }

    #[test]
    fn profiles_ini() {
        let text = "[Install4F96D1932A9F858E]\nDefault=Profiles/abc.default-release\nLocked=1\n\n[Profile1]\nName=default\nIsRelative=1\nPath=Profiles/xyz.default\nDefault=1\n\n[Profile0]\nName=default-release\nIsRelative=0\nPath=/Users/x/custom\n\n[General]\nStartWithLastProfile=1\nVersion=2\n";
        let profiles = parse_profiles_ini(text);
        assert_eq!(profiles, vec![("Profiles/xyz.default".to_owned(), true), ("/Users/x/custom".to_owned(), false)]);
    }

    #[test]
    fn firefox_extensions_skip_builtins_and_themes() {
        let text = r#"{"schemaVersion":37,"addons":[
            {"id":"{762f9885-5a13-4abd-9c77-433dcd38b8fd}","type":"extension","location":"app-profile","version":"3.0.0.18","defaultLocale":{"name":"Return YouTube Dislike"},"userPermissions":{"permissions":["storage"],"origins":["*://*.youtube.com/*"]}},
            {"id":"default-theme@mozilla.org","type":"theme","location":"app-builtin","version":"1.0","defaultLocale":{"name":"System theme"}},
            {"id":"formautofill@mozilla.org","type":"extension","location":"app-system-defaults","version":"1.0","defaultLocale":{"name":"Form Autofill"}},
            {"id":"broad@example.com","type":"extension","location":"app-profile","version":"2.0","defaultLocale":{"name":"Broad"},"userPermissions":{"permissions":["tabs"],"origins":["<all_urls>"]}}
        ]}"#;
        let exts = parse_firefox_extensions(text);
        assert_eq!(exts.len(), 2);
        assert_eq!(exts[0].name, "Return YouTube Dislike");
        assert_eq!(exts[0].permissions, ["storage"]);
        assert!(!exts[0].broad_host_access);
        assert_eq!(exts[1].id, "broad@example.com");
        assert!(exts[1].broad_host_access);
        assert!(parse_firefox_extensions("{}").is_empty());
    }

    #[test]
    fn scan_on_a_fake_application_support_tree() {
        let dir = std::env::temp_dir().join(format!("talos-browsers-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let ext_dir = dir.join("Google/Chrome/Default/Extensions/abcdefghijklmnop/1.0_0");
        std::fs::create_dir_all(&ext_dir).unwrap();
        std::fs::write(ext_dir.join("manifest.json"), r#"{"name":"X","version":"1.0","host_permissions":["*://*/*"]}"#).unwrap();
        let ff = dir.join("Firefox/Profiles/a.default");
        std::fs::create_dir_all(&ff).unwrap();
        std::fs::write(dir.join("Firefox/profiles.ini"), "[Profile0]\nName=d\nIsRelative=1\nPath=Profiles/a.default\n").unwrap();
        std::fs::write(ff.join("extensions.json"), r#"{"addons":[{"id":"a@b","type":"extension","location":"app-profile","version":"1","defaultLocale":{"name":"A"},"userPermissions":{"permissions":[],"origins":[]}}]}"#).unwrap();
        let browsers = scan(&dir);
        assert_eq!(browsers.installed.len(), 2);
        assert_eq!(browsers.installed[0].browser, BrowserId::Chrome);
        let chrome = browsers.installed[0].extensions.as_ok().unwrap();
        assert_eq!(chrome.len(), 1);
        assert!(chrome[0].broad_host_access);
        assert_eq!(browsers.installed[1].browser, BrowserId::Firefox);
        assert_eq!(browsers.installed[1].extensions.as_ok().unwrap()[0].name, "A");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(scan(Path::new("/nonexistent/talos")).installed.is_empty());
    }

    #[test]
    fn user_data_without_profiles_is_not_installed() {
        let dir = std::env::temp_dir().join(format!("talos-browsers-leftover-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Arc/User Data/NativeMessagingHosts")).unwrap();
        assert!(scan(&dir).installed.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
