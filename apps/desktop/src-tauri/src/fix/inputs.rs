//! Validation of the few non-literal slots. Every value is matched against a fresh Rust listing.

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use super::FixError;
use super::catalog::KEY_FORMAT_FLAGS;
use crate::state::{SshKey, SshKeyFormat};

pub const SHARE_NAME_MAX: usize = 64;
pub const PASSPHRASE_MIN: usize = 8;
pub const PASSPHRASE_MAX: usize = 256;

/// Rejects a newline or NUL anywhere in a slot value, before any quoting.
pub fn check_slot(value: &str) -> Result<(), FixError> {
    if value.is_empty() || value.contains(['\n', '\r', '\0']) {
        return Err(FixError::InvalidInput);
    }
    Ok(())
}

pub fn valid_share_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= SHARE_NAME_MAX
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'))
}

/// The record-level share name whose `path` equals `chosen`, from `sharing -l -f json` output.
pub fn bind_share(chosen: &str, listing_json: &str) -> Result<String, FixError> {
    check_slot(chosen).map_err(|_| FixError::InvalidChoice)?;
    let listing: serde_json::Value =
        serde_json::from_str(listing_json).map_err(|_| FixError::InvalidChoice)?;
    let shares = listing.as_object().ok_or(FixError::InvalidChoice)?;
    let name = shares
        .iter()
        .find(|(_, share)| share.get("path").and_then(|p| p.as_str()) == Some(chosen))
        .map(|(name, _)| name.clone())
        .ok_or(FixError::InvalidChoice)?;
    if !valid_share_name(&name) {
        return Err(FixError::InvalidChoice);
    }
    Ok(name)
}

/// The tokens `ssh-keygen -p` needs to keep the key in its current container format.
pub fn key_format_flags(format: SshKeyFormat) -> Result<&'static [&'static str], FixError> {
    let name = match format {
        SshKeyFormat::Openssh => "openssh",
        SshKeyFormat::Pem => "pem",
        SshKeyFormat::Pkcs8 => "pkcs8",
        SshKeyFormat::Unknown => return Err(FixError::InvalidChoice),
    };
    KEY_FORMAT_FLAGS
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, tokens)| *tokens)
        .ok_or(FixError::InvalidChoice)
}

/// A key path is accepted when it is in the fresh listing, canonicalises to itself (no symlink
/// component), is a regular file directly under `ssh_dir` and is owned by the current uid.
pub fn check_key_path(chosen: &str, keys: &[SshKey], ssh_dir: &Path) -> Result<PathBuf, FixError> {
    check_slot(chosen).map_err(|_| FixError::InvalidChoice)?;
    if !keys.iter().any(|k| k.path == chosen) {
        return Err(FixError::InvalidChoice);
    }
    let path = PathBuf::from(chosen);
    let canonical = path.canonicalize().map_err(|_| FixError::InvalidChoice)?;
    let dir = ssh_dir
        .canonicalize()
        .map_err(|_| FixError::InvalidChoice)?;
    if canonical != path || canonical.parent() != Some(dir.as_path()) {
        return Err(FixError::InvalidChoice);
    }
    let meta = std::fs::symlink_metadata(&path).map_err(|_| FixError::InvalidChoice)?;
    if !meta.is_file() {
        return Err(FixError::InvalidChoice);
    }
    // SAFETY: getuid has no preconditions and cannot fail.
    let uid = unsafe { libc::getuid() };
    if meta.uid() != uid {
        return Err(FixError::InvalidChoice);
    }
    Ok(canonical)
}

/// 029: the chosen key, which must still read as unencrypted, with its format flags.
pub fn bind_unencrypted_key(
    chosen: &str,
    keys: &[SshKey],
    ssh_dir: &Path,
) -> Result<(PathBuf, &'static [&'static str]), FixError> {
    let path = check_key_path(chosen, keys, ssh_dir)?;
    let key = keys
        .iter()
        .find(|k| k.path == chosen)
        .ok_or(FixError::InvalidChoice)?;
    if key.encrypted != Some(false) {
        return Err(FixError::InvalidChoice);
    }
    Ok((path, key_format_flags(key.format)?))
}

/// 030: every key from the listing that passes the same checks. Keys that fail are skipped.
pub fn bind_all_keys(keys: &[SshKey], ssh_dir: &Path) -> Vec<(PathBuf, Option<String>)> {
    keys.iter()
        .filter_map(|key| {
            check_key_path(&key.path, keys, ssh_dir)
                .ok()
                .map(|path| (path, key.mode.clone()))
        })
        .collect()
}

/// 8 to 256 code points, no control characters.
pub fn check_passphrase(value: &str) -> Result<(), FixError> {
    let count = value.chars().count();
    if !(PASSPHRASE_MIN..=PASSPHRASE_MAX).contains(&count) || value.chars().any(char::is_control) {
        return Err(FixError::InvalidInput);
    }
    Ok(())
}

/// A launchd plist is accepted when it is in the fresh listing, canonicalises to itself (no
/// symlink component), is a regular file directly under `dir`, and, for the user's own
/// LaunchAgents, is owned by the current uid. The same five checks as `check_key_path`.
pub fn check_plist_path(
    chosen: &str,
    listing: &[String],
    dir: &Path,
    require_owner: bool,
) -> Result<PathBuf, FixError> {
    check_slot(chosen).map_err(|_| FixError::InvalidChoice)?;
    if !listing.iter().any(|p| p == chosen) {
        return Err(FixError::InvalidChoice);
    }
    let path = PathBuf::from(chosen);
    let canonical = path.canonicalize().map_err(|_| FixError::InvalidChoice)?;
    let dir = dir.canonicalize().map_err(|_| FixError::InvalidChoice)?;
    if canonical != path || canonical.parent() != Some(dir.as_path()) {
        return Err(FixError::InvalidChoice);
    }
    let meta = std::fs::symlink_metadata(&path).map_err(|_| FixError::InvalidChoice)?;
    if !meta.is_file() {
        return Err(FixError::InvalidChoice);
    }
    if require_owner {
        // SAFETY: getuid has no preconditions and cannot fail.
        let uid = unsafe { libc::getuid() };
        if meta.uid() != uid {
            return Err(FixError::InvalidChoice);
        }
    }
    Ok(canonical)
}

/// `^en[0-9]{1,2}$`: the only shape a Wi-Fi device name may take.
pub fn valid_wifi_device(device: &str) -> bool {
    device.strip_prefix("en").is_some_and(|digits| {
        (1..=2).contains(&digits.len()) && digits.bytes().all(|b| b.is_ascii_digit())
    })
}

/// The Wi-Fi device from Rust's own `networksetup -listallhardwareports` listing.
pub fn bind_wifi_device(listing_text: &str) -> Result<String, FixError> {
    let device =
        crate::watch::probes::parse_wifi_device(listing_text).ok_or(FixError::InvalidChoice)?;
    if !valid_wifi_device(&device) {
        return Err(FixError::InvalidChoice);
    }
    Ok(device)
}

/// True when the listing has a Wi-Fi port the catalogue could switch.
pub fn wifi_available(listing_text: &str) -> bool {
    bind_wifi_device(listing_text).is_ok()
}

/// 013: the digits of `defaults read` output, or null when the key is unset or not an integer.
pub fn parse_previous(stdout: &str, success: bool) -> Option<String> {
    if !success {
        return None;
    }
    let text = stdout.trim();
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(text.to_owned())
}

#[cfg(test)]
mod watch_tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn tmp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("talos-fix-watch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn a_plist_binds_only_from_the_fresh_listing_under_its_folder_and_never_through_a_symlink() {
        let agents = tmp("agents");
        let other = tmp("other");
        let plist = agents.join("com.example.agent.plist");
        std::fs::write(&plist, b"<plist/>").unwrap();
        let link = agents.join("link.plist");
        symlink(&plist, &link).unwrap();
        let elsewhere = other.join("com.example.daemon.plist");
        std::fs::write(&elsewhere, b"<plist/>").unwrap();
        let listing: Vec<String> = [&plist, &link, &elsewhere]
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let text = |p: &PathBuf| p.to_string_lossy().into_owned();
        assert_eq!(
            check_plist_path(&text(&plist), &listing, &agents, true),
            Ok(plist.clone())
        );
        assert_eq!(
            check_plist_path(&text(&plist), &listing, &agents, false),
            Ok(plist.clone())
        );
        assert_eq!(
            check_plist_path(&text(&link), &listing, &agents, false),
            Err(FixError::InvalidChoice),
            "symlink"
        );
        assert_eq!(
            check_plist_path(&text(&elsewhere), &listing, &agents, false),
            Err(FixError::InvalidChoice),
            "outside the folder"
        );
        assert_eq!(
            check_plist_path(&text(&plist), &[], &agents, false),
            Err(FixError::InvalidChoice),
            "not in the listing"
        );
        assert_eq!(
            check_plist_path("", &listing, &agents, false),
            Err(FixError::InvalidChoice)
        );
        assert_eq!(
            check_plist_path(
                &text(&agents),
                &[text(&agents)],
                agents.parent().unwrap(),
                false
            ),
            Err(FixError::InvalidChoice),
            "a directory"
        );
        let _ = std::fs::remove_dir_all(&agents);
        let _ = std::fs::remove_dir_all(&other);
    }

    #[test]
    fn the_wifi_device_must_read_en_and_one_or_two_digits() {
        let listing = include_str!("../../tests/fixtures/networksetup-hardwareports.txt");
        assert_eq!(bind_wifi_device(listing), Ok("en0".into()));
        assert!(wifi_available(listing));
        assert_eq!(
            bind_wifi_device("Hardware Port: Wi-Fi\nDevice: en12\n"),
            Ok("en12".into())
        );
        assert_eq!(
            bind_wifi_device("Hardware Port: Wi-Fi\nDevice: en123\n"),
            Err(FixError::InvalidChoice)
        );
        assert_eq!(
            bind_wifi_device("Hardware Port: Wi-Fi\nDevice: bridge0\n"),
            Err(FixError::InvalidChoice)
        );
        assert_eq!(
            bind_wifi_device("Hardware Port: Wi-Fi\nDevice: en0; rm -rf /\n"),
            Err(FixError::InvalidChoice)
        );
        assert_eq!(
            bind_wifi_device("Hardware Port: Ethernet\nDevice: en4\n"),
            Err(FixError::InvalidChoice)
        );
        assert!(!wifi_available(""));
        assert!(valid_wifi_device("en0") && !valid_wifi_device("en") && !valid_wifi_device("eth0"));
    }
}
