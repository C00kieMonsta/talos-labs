//! `<app data>/watch-settings.json`, mode 0600: the truth for enabled, the interval, the notify
//! flag, the profile and the webview's licence flag, so the loop runs under `--watch` with no
//! webview and the tray's "Turn the watch off" sticks. Survives the watch being turned off or
//! the licence going; only watch.json is deleted then.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::ModelProvider;
use super::types::ExplainerProfile;
use crate::report_store::write_private;

pub const FILE_NAME: &str = "watch-settings.json";
pub const INTERVALS: [u32; 3] = [15, 60, 240];
pub const DEFAULT_INTERVAL: u32 = 60;

/// The AI switch and provider choice as the webview reports them; `None` means auto-pick a
/// connected provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchAi {
    pub enabled: bool,
    #[serde(default)]
    pub provider: Option<ModelProvider>,
}

impl Default for WatchAi {
    fn default() -> Self {
        WatchAi {
            enabled: true,
            provider: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSettingsFile {
    pub version: u8,
    pub enabled: bool,
    pub every_minutes: u32,
    pub notify: bool,
    /// The webview's product gate; Rust never verifies a key. Absent in pre-change files.
    #[serde(default)]
    pub licensed: bool,
    #[serde(default)]
    pub profile: ExplainerProfile,
    #[serde(default)]
    pub ai: WatchAi,
}

impl Default for WatchSettingsFile {
    fn default() -> Self {
        WatchSettingsFile {
            version: 1,
            enabled: true,
            every_minutes: DEFAULT_INTERVAL,
            notify: true,
            licensed: false,
            profile: ExplainerProfile::default(),
            ai: WatchAi::default(),
        }
    }
}

impl WatchSettingsFile {
    /// A stored interval outside the three options falls back to the default.
    fn normalised(mut self) -> Self {
        if !INTERVALS.contains(&self.every_minutes) {
            self.every_minutes = DEFAULT_INTERVAL;
        }
        self.version = 1;
        self
    }
}

pub fn valid_interval(minutes: u32) -> bool {
    INTERVALS.contains(&minutes)
}

pub fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// The stored settings, or the defaults when the file is absent or unreadable.
pub fn load(dir: &Path) -> WatchSettingsFile {
    std::fs::read(path(dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<WatchSettingsFile>(&bytes).ok())
        .map(WatchSettingsFile::normalised)
        .unwrap_or_default()
}

pub fn save(dir: &Path, settings: &WatchSettingsFile) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(settings).map_err(std::io::Error::other)?;
    write_private(&path(dir), &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "talos-watch-settings-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn defaults_are_on_hourly_notify_with_the_neutral_profile() {
        let d = WatchSettingsFile::default();
        assert!(d.enabled && d.notify);
        assert!(!d.licensed, "a licence is reported, never assumed");
        assert_eq!(d.every_minutes, 60);
        assert_eq!(d.profile, ExplainerProfile::default());
        assert_eq!(
            d.ai,
            WatchAi {
                enabled: true,
                provider: None
            }
        );
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json["version"], 1);
        assert_eq!(json["profile"]["role"], "individual");
        assert_eq!(json["ai"]["provider"], serde_json::Value::Null);
        assert_eq!(json["licensed"], false);
    }

    #[test]
    fn the_licensed_flag_round_trips_and_defaults_to_false_in_a_pre_change_file() {
        let dir = scratch("licensed");
        let settings = WatchSettingsFile {
            licensed: true,
            ..WatchSettingsFile::default()
        };
        save(&dir, &settings).unwrap();
        assert_eq!(load(&dir), settings);
        std::fs::write(
            path(&dir),
            br#"{"version":1,"enabled":true,"everyMinutes":60,"notify":true}"#,
        )
        .unwrap();
        let loaded = load(&dir);
        assert!(loaded.enabled && !loaded.licensed);
        assert_eq!(loaded.version, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_file_is_private_and_survives_a_disable() {
        let dir = scratch("survive");
        let settings = WatchSettingsFile {
            enabled: false,
            every_minutes: 15,
            ..WatchSettingsFile::default()
        };
        save(&dir, &settings).unwrap();
        let mode = std::fs::metadata(path(&dir)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        super::super::baseline::delete(&dir).unwrap();
        assert_eq!(
            load(&dir),
            settings,
            "disable deletes watch.json, not the settings"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_bad_interval_or_a_corrupt_file_falls_back() {
        let dir = scratch("bad");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            path(&dir),
            br#"{"version":1,"enabled":true,"everyMinutes":7,"notify":false}"#,
        )
        .unwrap();
        let loaded = load(&dir);
        assert_eq!(loaded.every_minutes, 60);
        assert!(!loaded.notify);
        assert_eq!(
            loaded.profile,
            ExplainerProfile::default(),
            "an absent profile is the neutral one"
        );
        std::fs::write(path(&dir), b"nope").unwrap();
        assert_eq!(load(&dir), WatchSettingsFile::default());
        assert!(valid_interval(240) && !valid_interval(30));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
