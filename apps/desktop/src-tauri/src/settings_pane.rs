//! Closed set of System Settings panes, mapped to `x-apple.systempreferences` URLs for macOS 26 and 27.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingsPane {
    Filevault,
    Firewall,
    Security,
    SoftwareUpdate,
    LockScreen,
    UsersGroups,
    Sharing,
    LoginItems,
    TimeMachine,
    FullDiskAccess,
    Automation,
    AppleIntelligence,
    #[serde(rename = "airdrop")]
    AirDrop,
}

impl SettingsPane {
    pub const ALL: [SettingsPane; 13] = [
        SettingsPane::Filevault,
        SettingsPane::Firewall,
        SettingsPane::Security,
        SettingsPane::SoftwareUpdate,
        SettingsPane::LockScreen,
        SettingsPane::UsersGroups,
        SettingsPane::Sharing,
        SettingsPane::LoginItems,
        SettingsPane::TimeMachine,
        SettingsPane::FullDiskAccess,
        SettingsPane::Automation,
        SettingsPane::AppleIntelligence,
        SettingsPane::AirDrop,
    ];

    pub fn parse(text: &str) -> Option<Self> {
        serde_json::from_value(serde_json::Value::String(text.to_owned())).ok()
    }

    pub fn url(self) -> &'static str {
        match self {
            SettingsPane::Filevault => {
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?FileVault"
            }
            SettingsPane::Firewall => {
                "x-apple.systempreferences:com.apple.Network-Settings.extension?Firewall"
            }
            SettingsPane::Security => {
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Security"
            }
            SettingsPane::SoftwareUpdate => {
                "x-apple.systempreferences:com.apple.Software-Update-Settings.extension"
            }
            SettingsPane::LockScreen => {
                "x-apple.systempreferences:com.apple.Lock-Screen-Settings.extension"
            }
            SettingsPane::UsersGroups => {
                "x-apple.systempreferences:com.apple.Users-Groups-Settings.extension"
            }
            SettingsPane::Sharing => {
                "x-apple.systempreferences:com.apple.Sharing-Settings.extension"
            }
            SettingsPane::LoginItems => {
                "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
            }
            SettingsPane::TimeMachine => {
                "x-apple.systempreferences:com.apple.Time-Machine-Settings.extension"
            }
            SettingsPane::FullDiskAccess => {
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles"
            }
            SettingsPane::Automation => {
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation"
            }
            SettingsPane::AppleIntelligence => {
                "x-apple.systempreferences:com.apple.Siri-Settings.extension"
            }
            // Not verified on a real Mac (docs/DESIGN-THREATS-V2.md section 9).
            SettingsPane::AirDrop => {
                "x-apple.systempreferences:com.apple.AirDrop-Handoff-Settings.extension"
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_core_pane_name() {
        let names = [
            "filevault",
            "firewall",
            "security",
            "software_update",
            "lock_screen",
            "users_groups",
            "sharing",
            "login_items",
            "time_machine",
            "full_disk_access",
            "automation",
            "apple_intelligence",
            "airdrop",
        ];
        for (name, pane) in names.iter().zip(SettingsPane::ALL) {
            assert_eq!(SettingsPane::parse(name), Some(pane));
            assert!(
                pane.url()
                    .starts_with("x-apple.systempreferences:com.apple.")
            );
        }
        assert_eq!(SettingsPane::parse("terminal"), None);
        assert_eq!(
            SettingsPane::parse("air_drop"),
            None,
            "the wire word is airdrop"
        );
        assert_eq!(names.len(), SettingsPane::ALL.len());
    }
}
