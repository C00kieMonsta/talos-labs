//! Serde mirror of `packages/core/src/domain/system-state.ts`.
//!
//! Every struct serialises with camelCase keys. `Section<T>` serialises as
//! `{ "status": "ok", "data": ... }` or `{ "status": "unavailable", "reason": ..., "detail": ... }`.

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    NeedsFullDiskAccess,
    NeedsAutomationPermission,
    NeedsAdmin,
    PermissionDenied,
    ToolMissing,
    Timeout,
    ParseError,
    NotSupportedOnOs,
    CollectorError,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Section<T> {
    Ok {
        data: T,
    },
    Unavailable {
        reason: UnavailableReason,
        detail: Option<String>,
    },
}

impl<T> Section<T> {
    pub fn ok(data: T) -> Self {
        Section::Ok { data }
    }

    pub fn unavailable(reason: UnavailableReason, detail: Option<&str>) -> Self {
        Section::Unavailable {
            reason,
            detail: detail.map(str::to_owned),
        }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, Section::Ok { .. })
    }

    pub fn as_ok(&self) -> Option<&T> {
        match self {
            Section::Ok { data } => Some(data),
            Section::Unavailable { .. } => None,
        }
    }

    pub fn reason(&self) -> Option<UnavailableReason> {
        match self {
            Section::Ok { .. } => None,
            Section::Unavailable { reason, .. } => Some(*reason),
        }
    }
}

/// A setting that may be absent. `Unset` means the rule applies the OS default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tri {
    True,
    False,
    Unset,
}

impl From<bool> for Tri {
    fn from(value: bool) -> Self {
        if value { Tri::True } else { Tri::False }
    }
}

impl From<Option<bool>> for Tri {
    fn from(value: Option<bool>) -> Self {
        value.map_or(Tri::Unset, Tri::from)
    }
}

impl Serialize for Tri {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Tri::True => serializer.serialize_bool(true),
            Tri::False => serializer.serialize_bool(false),
            Tri::Unset => serializer.serialize_str("unset"),
        }
    }
}

impl<'de> Deserialize<'de> for Tri {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Bool(bool),
            Text(String),
        }
        match Raw::deserialize(deserializer)? {
            Raw::Bool(b) => Ok(Tri::from(b)),
            Raw::Text(s) if s == "unset" => Ok(Tri::Unset),
            Raw::Text(s) => Err(D::Error::unknown_variant(&s, &["unset"])),
        }
    }
}

/// `number | "unset"` for the screensaver idle time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdleSeconds {
    Seconds(u64),
    Unset,
}

impl Serialize for IdleSeconds {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            IdleSeconds::Seconds(n) => serializer.serialize_u64(*n),
            IdleSeconds::Unset => serializer.serialize_str("unset"),
        }
    }
}

impl<'de> Deserialize<'de> for IdleSeconds {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Number(u64),
            Text(String),
        }
        match Raw::deserialize(deserializer)? {
            Raw::Number(n) => Ok(IdleSeconds::Seconds(n)),
            Raw::Text(s) if s == "unset" => Ok(IdleSeconds::Unset),
            Raw::Text(s) => Err(D::Error::unknown_variant(&s, &["unset"])),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Os {
    Macos,
    Windows,
    Linux,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Arch {
    #[serde(rename = "arm64")]
    Arm64,
    #[serde(rename = "x86_64")]
    X86_64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub os: Os,
    pub os_version: String,
    pub os_build: Option<String>,
    pub arch: Arch,
    pub collector_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiskEncryptionMethod {
    Filevault,
    Bitlocker,
    Luks,
    None,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskEncryption {
    pub system_volume_encrypted: bool,
    pub method: DiskEncryptionMethod,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Firewall {
    pub enabled: bool,
    pub stealth_mode: Option<bool>,
    pub block_all_incoming: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformIntegrity {
    pub exec_policy_enabled: Option<bool>,
    pub system_protection_enabled: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MalwareEngine {
    Xprotect,
    Defender,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MalwareProtection {
    pub engine: MalwareEngine,
    pub present: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Updates {
    pub pending_count: Option<u64>,
    pub last_check_at: Option<String>,
    pub last_result_code: Option<i64>,
    pub automatic_check: Tri,
    pub automatic_download: Tri,
    pub auto_install_os: Tri,
    pub auto_install_security_responses: Tri,
    pub app_store_auto_update: Tri,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenLock {
    pub require_password: bool,
    pub delay_seconds: Option<u64>,
    pub screensaver_idle_seconds: IdleSeconds,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Accounts {
    pub current_user_is_admin: bool,
    pub human_admin_count: u64,
    pub guest_enabled: Tri,
    pub auto_login_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordPolicy {
    pub min_length: Option<u64>,
    pub max_failed_attempts: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ListenerBind {
    All,
    Loopback,
    LinkLocal,
    Specific,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Tcp,
    Udp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    pub protocol: Protocol,
    pub port: u16,
    pub bind: ListenerBind,
    pub process_name: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Listeners {
    pub entries: Vec<Listener>,
    pub process_names_complete: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceState {
    pub service_loaded: Option<bool>,
    pub listening_port: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccess {
    pub ssh: ServiceState,
    pub screen_sharing: ServiceState,
    pub remote_management: Option<ServiceState>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Share {
    pub path: String,
    pub guest_access: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSharing {
    pub enabled: bool,
    pub shares: Vec<Share>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchItemScope {
    UserAgent,
    SystemAgent,
    SystemDaemon,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchItem {
    pub scope: LaunchItemScope,
    pub plist_path: String,
    pub label: String,
    pub program: Option<String>,
    pub program_exists: Option<bool>,
    pub run_at_load: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Persistence {
    pub items: Vec<LaunchItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginItems {
    pub count: u64,
    pub names: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupMethod {
    TimeMachine,
    WindowsBackup,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub method: BackupMethod,
    pub configured: bool,
    pub destination_count: u64,
    pub destination_reachable: Option<bool>,
    pub last_backup_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserId {
    Chrome,
    Brave,
    Edge,
    Arc,
    Firefox,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserExtension {
    pub id: String,
    pub name: String,
    pub version: String,
    pub permissions: Vec<String>,
    pub broad_host_access: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserReport {
    pub browser: BrowserId,
    pub extensions: Section<Vec<BrowserExtension>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Browsers {
    pub installed: Vec<BrowserReport>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SshKeyFormat {
    Openssh,
    Pem,
    Pkcs8,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    pub path: String,
    pub format: SshKeyFormat,
    pub encrypted: Option<bool>,
    pub mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ssh {
    pub dir_exists: bool,
    pub dir_mode: Option<String>,
    pub keys: Vec<SshKey>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretPattern {
    AwsAccessKeyId,
    AwsSecretAccessKey,
    GithubToken,
    NpmToken,
    NetrcPassword,
    PrivateKeyBlock,
    LlmApiKey,
    SlackToken,
    DockerAuth,
    GenericSecretAssignment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretHit {
    pub path: String,
    pub pattern: SecretPattern,
    pub line: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dotfiles {
    pub scanned: Vec<String>,
    pub unreadable: Vec<String>,
    pub hits: Vec<SecretHit>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStateSections {
    pub disk_encryption: Section<DiskEncryption>,
    pub firewall: Section<Firewall>,
    pub platform_integrity: Section<PlatformIntegrity>,
    pub malware_protection: Section<MalwareProtection>,
    pub updates: Section<Updates>,
    pub screen_lock: Section<ScreenLock>,
    pub accounts: Section<Accounts>,
    pub password_policy: Section<PasswordPolicy>,
    pub listeners: Section<Listeners>,
    pub remote_access: Section<RemoteAccess>,
    pub file_sharing: Section<FileSharing>,
    pub persistence: Section<Persistence>,
    pub login_items: Section<LoginItems>,
    pub backup: Section<Backup>,
    pub browsers: Section<Browsers>,
    pub ssh: Section<Ssh>,
    pub dotfiles: Section<Dotfiles>,
}

impl SystemStateSections {
    /// Every section unavailable with the same reason and detail.
    pub fn all_unavailable(reason: UnavailableReason, detail: Option<&str>) -> Self {
        Self {
            disk_encryption: Section::unavailable(reason, detail),
            firewall: Section::unavailable(reason, detail),
            platform_integrity: Section::unavailable(reason, detail),
            malware_protection: Section::unavailable(reason, detail),
            updates: Section::unavailable(reason, detail),
            screen_lock: Section::unavailable(reason, detail),
            accounts: Section::unavailable(reason, detail),
            password_policy: Section::unavailable(reason, detail),
            listeners: Section::unavailable(reason, detail),
            remote_access: Section::unavailable(reason, detail),
            file_sharing: Section::unavailable(reason, detail),
            persistence: Section::unavailable(reason, detail),
            login_items: Section::unavailable(reason, detail),
            backup: Section::unavailable(reason, detail),
            browsers: Section::unavailable(reason, detail),
            ssh: Section::unavailable(reason, detail),
            dotfiles: Section::unavailable(reason, detail),
        }
    }
}

/// Stable section order shared with `SECTION_KEYS` in core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SectionKey {
    DiskEncryption,
    Firewall,
    PlatformIntegrity,
    MalwareProtection,
    Updates,
    ScreenLock,
    Accounts,
    PasswordPolicy,
    Listeners,
    RemoteAccess,
    FileSharing,
    Persistence,
    LoginItems,
    Backup,
    Browsers,
    Ssh,
    Dotfiles,
}

impl SectionKey {
    pub const ALL: [SectionKey; 17] = [
        SectionKey::DiskEncryption,
        SectionKey::Firewall,
        SectionKey::PlatformIntegrity,
        SectionKey::MalwareProtection,
        SectionKey::Updates,
        SectionKey::ScreenLock,
        SectionKey::Accounts,
        SectionKey::PasswordPolicy,
        SectionKey::Listeners,
        SectionKey::RemoteAccess,
        SectionKey::FileSharing,
        SectionKey::Persistence,
        SectionKey::LoginItems,
        SectionKey::Backup,
        SectionKey::Browsers,
        SectionKey::Ssh,
        SectionKey::Dotfiles,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            SectionKey::DiskEncryption => "diskEncryption",
            SectionKey::Firewall => "firewall",
            SectionKey::PlatformIntegrity => "platformIntegrity",
            SectionKey::MalwareProtection => "malwareProtection",
            SectionKey::Updates => "updates",
            SectionKey::ScreenLock => "screenLock",
            SectionKey::Accounts => "accounts",
            SectionKey::PasswordPolicy => "passwordPolicy",
            SectionKey::Listeners => "listeners",
            SectionKey::RemoteAccess => "remoteAccess",
            SectionKey::FileSharing => "fileSharing",
            SectionKey::Persistence => "persistence",
            SectionKey::LoginItems => "loginItems",
            SectionKey::Backup => "backup",
            SectionKey::Browsers => "browsers",
            SectionKey::Ssh => "ssh",
            SectionKey::Dotfiles => "dotfiles",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|k| k.as_str() == text)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemState {
    pub schema_version: u8,
    pub collected_at: String,
    pub host: Host,
    pub sections: SystemStateSections,
}

pub const SCHEMA_VERSION: u8 = 1;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn section_serialises_with_status_tag() {
        let ok: Section<Firewall> = Section::ok(Firewall {
            enabled: true,
            stealth_mode: None,
            block_all_incoming: Some(false),
        });
        let json = serde_json::to_value(&ok).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "status": "ok", "data": { "enabled": true, "stealthMode": null, "blockAllIncoming": false } })
        );
        let bad: Section<Firewall> =
            Section::unavailable(UnavailableReason::ToolMissing, Some("bin: socketfilterfw"));
        let json = serde_json::to_value(&bad).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "status": "unavailable", "reason": "tool_missing", "detail": "bin: socketfilterfw" })
        );
        let back: Section<Firewall> = serde_json::from_value(json).unwrap();
        assert_eq!(back, bad);
    }

    #[test]
    fn tri_round_trips() {
        for (value, text) in [
            (Tri::True, "true"),
            (Tri::False, "false"),
            (Tri::Unset, "\"unset\""),
        ] {
            assert_eq!(serde_json::to_string(&value).unwrap(), text);
            let back: Tri = serde_json::from_str(text).unwrap();
            assert_eq!(back, value);
        }
        assert!(serde_json::from_str::<Tri>("\"maybe\"").is_err());
    }

    #[test]
    fn idle_seconds_round_trips() {
        assert_eq!(
            serde_json::to_string(&IdleSeconds::Seconds(600)).unwrap(),
            "600"
        );
        assert_eq!(
            serde_json::to_string(&IdleSeconds::Unset).unwrap(),
            "\"unset\""
        );
        let back: IdleSeconds = serde_json::from_str("1200").unwrap();
        assert_eq!(back, IdleSeconds::Seconds(1200));
    }

    #[test]
    fn section_keys_match_core_order() {
        let names: Vec<&str> = SectionKey::ALL.iter().map(|k| k.as_str()).collect();
        assert_eq!(
            names,
            [
                "diskEncryption",
                "firewall",
                "platformIntegrity",
                "malwareProtection",
                "updates",
                "screenLock",
                "accounts",
                "passwordPolicy",
                "listeners",
                "remoteAccess",
                "fileSharing",
                "persistence",
                "loginItems",
                "backup",
                "browsers",
                "ssh",
                "dotfiles",
            ]
        );
        for key in SectionKey::ALL {
            assert_eq!(SectionKey::parse(key.as_str()), Some(key));
            assert_eq!(
                serde_json::to_string(&key).unwrap(),
                format!("\"{}\"", key.as_str())
            );
        }
        assert_eq!(SectionKey::parse("nope"), None);
    }
}
