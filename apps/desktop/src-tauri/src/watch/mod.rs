//! The menu bar watch (docs/DESIGN-WATCH.md). The wire types mirror
//! `packages/core/src/ports/watch-port.ts`; the closed enums are the only strings that cross.
//! `WatchStore` is the managed state; `start` runs the timer; `cycle` runs one tick; the
//! commands in `commands.rs` call the functions at the bottom of this file.

pub mod baseline;
pub mod context;
pub mod cycle;
pub mod notify;
pub mod playbook;
pub mod probes;
pub mod rate;
pub mod settings;
pub mod signals;
pub mod types;
pub mod validate;

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::UnavailableReason;

use baseline::Baseline;
use probes::ProbeOutcome;
use settings::{WatchAi, WatchSettingsFile};
use types::{
    ExplainerProfile, WatchContext, WatchDetails, WatchDetailsItem, WatchLastVerdict, WatchVerdict,
};

/// A closed enum with an explicit wire name per variant, `as_str`, `parse` and `ALL`.
macro_rules! closed_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident = $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        pub enum $name {
            $( #[serde(rename = $text)] $variant, )+
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$( $name::$variant, )+];

            pub fn as_str(self) -> &'static str {
                match self { $( $name::$variant => $text, )+ }
            }

            pub fn parse(text: &str) -> Option<Self> {
                match text { $( $text => Some($name::$variant), )+ _ => None }
            }
        }
    };
}

closed_enum! {
    /// calm < keep_an_eye < act_now.
    Rating { Calm = "calm", KeepAnEye = "keep_an_eye", ActNow = "act_now" }
}

closed_enum! {
    Change { Same = "same", Changed = "changed", FirstSeen = "first_seen", Appeared = "appeared", Cleared = "cleared" }
}

closed_enum! {
    Freshness { Fresh = "fresh", Stale = "stale", Unavailable = "unavailable" }
}

closed_enum! {
    Severity { Critical = "critical", High = "high", Medium = "medium", Low = "low", Info = "info" }
}

closed_enum! {
    FishyKind {
        Persistence = "persistence",
        Listener = "listener",
        Guard = "guard",
        Remote = "remote",
        Admin = "admin",
        Dns = "dns",
        Backup = "backup",
    }
}

closed_enum! {
    /// The provider a model sentence came from.
    ModelProvider { Apple = "apple", Chatgpt = "chatgpt", ClaudePlan = "claude_plan" }
}

closed_enum! {
    /// What `tray::open_main` asks the main window to show.
    OpenScreen {
        Home = "home",
        Noticed = "noticed",
        SettingsWatch = "settings_watch",
        Chat = "chat",
        Connect = "connect",
    }
}

closed_enum! {
    /// The check-up grade words of `packages/core/src/domain/report.ts`.
    Grade { Good = "good", Fair = "fair", Poor = "poor", AtRisk = "at_risk" }
}

closed_enum! {
    /// What the main webview's "Do this next" step does.
    NextKind { Fix = "fix", Show = "show", Details = "details" }
}

closed_enum! {
    /// Why a probe could not read: the nine `UnavailableReason` words plus the socket table an
    /// unsigned build cannot read, which the main window's reason set has no word for.
    ProbeReason {
        NeedsFullDiskAccess = "needs_full_disk_access",
        NeedsAutomationPermission = "needs_automation_permission",
        NeedsAdmin = "needs_admin",
        PermissionDenied = "permission_denied",
        ToolMissing = "tool_missing",
        Timeout = "timeout",
        ParseError = "parse_error",
        NotSupportedOnOs = "not_supported_on_os",
        CollectorError = "collector_error",
        UnsignedBuild = "unsigned_build",
    }
}

impl From<UnavailableReason> for ProbeReason {
    fn from(reason: UnavailableReason) -> Self {
        match reason {
            UnavailableReason::NeedsFullDiskAccess => ProbeReason::NeedsFullDiskAccess,
            UnavailableReason::NeedsAutomationPermission => ProbeReason::NeedsAutomationPermission,
            UnavailableReason::NeedsAdmin => ProbeReason::NeedsAdmin,
            UnavailableReason::PermissionDenied => ProbeReason::PermissionDenied,
            UnavailableReason::ToolMissing => ProbeReason::ToolMissing,
            UnavailableReason::Timeout => ProbeReason::Timeout,
            UnavailableReason::ParseError => ProbeReason::ParseError,
            UnavailableReason::NotSupportedOnOs => ProbeReason::NotSupportedOnOs,
            UnavailableReason::CollectorError => ProbeReason::CollectorError,
        }
    }
}

closed_enum! {
    /// SIGNAL_IDS in packages/core/src/ports/watch-port.ts, in the same order.
    SignalId {
        PersistenceSet = "sig.persistence_set",
        PersistenceNew = "sig.persistence_new",
        PersistenceUnsigned = "sig.persistence_unsigned",
        PersistenceInTempOrHidden = "sig.persistence_in_temp_or_hidden",
        HelperToolsCount = "sig.helper_tools_count",
        LoginItemsCount = "sig.login_items_count",
        ListenerSet = "sig.listener_set",
        ListenerNewPorts = "sig.listener_new_ports",
        EstablishedCount = "sig.established_count",
        RemoteAccessOn = "sig.remote_access_on",
        GuestShare = "sig.guest_share",
        ShareCount = "sig.share_count",
        Firewall = "sig.firewall",
        Gatekeeper = "sig.gatekeeper",
        Sip = "sig.sip",
        BootArgsSet = "sig.boot_args_set",
        XprotectPresent = "sig.xprotect_present",
        XprotectVersion = "sig.xprotect_version",
        XprotectRemediatorVersion = "sig.xprotect_remediator_version",
        XprotectScansEnabled = "sig.xprotect_scans_enabled",
        AdminCount = "sig.admin_count",
        UserCount = "sig.user_count",
        HiddenUserCount = "sig.hidden_user_count",
        Autologin = "sig.autologin",
        ProfilesCount = "sig.profiles_count",
        MdmEnrolled = "sig.mdm_enrolled",
        ManagedPrefsCount = "sig.managed_prefs_count",
        SysextCount = "sig.sysext_count",
        KextCount = "sig.kext_count",
        DnsManual = "sig.dns_manual",
        ProxyOn = "sig.proxy_on",
        PacUrlSet = "sig.pac_url_set",
        Resolvers = "sig.resolvers",
        HostsChanged = "sig.hosts_changed",
        AuthorizedKeysChanged = "sig.authorized_keys_changed",
        SshdConfigChanged = "sig.sshd_config_changed",
        BackupAuto = "sig.backup_auto",
        BackupDestinations = "sig.backup_destinations",
        BackupAgeDays = "sig.backup_age_days",
        CronLines = "sig.cron_lines",
        AtJobs = "sig.at_jobs",
        LegacyStartupCount = "sig.legacy_startup_count",
        LockdownMode = "sig.lockdown_mode",
        SudoersDCount = "sig.sudoers_d_count",
        PamSudoChanged = "sig.pam_sudo_changed",
        RemoteLogins = "sig.remote_logins",
        LoadAvg = "sig.load_avg",
        DiskFreePct = "sig.disk_free_pct",
        OnBattery = "sig.on_battery",
        PendingUpdates = "sig.pending_updates",
        BroadExtensionCount = "sig.broad_extension_count",
    }
}

closed_enum! {
    /// PROBE_IDS, in the same order. `PersistenceSignatures` and `SshKeys` are never model-chosen.
    ProbeId {
        PlatformIntegrity = "probe.platform_integrity",
        Firewall = "probe.firewall",
        MalwareProtection = "probe.malware_protection",
        RemoteAccess = "probe.remote_access",
        FileSharing = "probe.file_sharing",
        Listeners = "probe.listeners",
        Accounts = "probe.accounts",
        Persistence = "probe.persistence",
        PersistenceSignatures = "probe.persistence_signatures",
        NetworkConfig = "probe.network_config",
        Hosts = "probe.hosts",
        Profiles = "probe.profiles",
        SystemExtensions = "probe.system_extensions",
        Backup = "probe.backup",
        LockdownMode = "probe.lockdown_mode",
        SudoConfig = "probe.sudo_config",
        SshKeys = "probe.ssh_keys",
        HostMetrics = "probe.host_metrics",
        Updates = "probe.updates",
        ScheduledJobs = "probe.scheduled_jobs",
        Logins = "probe.logins",
    }
}

closed_enum! {
    /// ACTION_IDS, the playbook rows, in the same order.
    ActionId {
        DisconnectNetwork = "act.disconnect_network",
        BlockIncoming = "act.block_incoming",
        DoNotPowerOff = "act.do_not_power_off",
        NoteWhatYouSaw = "act.note_what_you_saw",
        DoNotWait = "act.do_not_wait",
        StopBackgroundProgram = "act.stop_background_program",
        ReviewBackgroundPrograms = "act.review_background_programs",
        TurnOffRemoteAccess = "act.turn_off_remote_access",
        StopGuestSharing = "act.stop_guest_sharing",
        TurnOnFirewall = "act.turn_on_firewall",
        TurnOnBuiltinProtection = "act.turn_on_builtin_protection",
        Report = "act.report",
        ChangePasswords = "act.change_passwords",
        ReviewAppleAccountDevices = "act.review_apple_account_devices",
        TurnOn2fa = "act.turn_on_2fa",
        ScanOrReinstall = "act.scan_or_reinstall",
        CheckBackupBeforeRestore = "act.check_backup_before_restore",
        UpdateNow = "act.update_now",
        DoNotPay = "act.do_not_pay",
        LockdownMode = "act.lockdown_mode",
        ReconnectAndWatch = "act.reconnect_and_watch",
        LessonsLearned = "act.lessons_learned",
        RunFullCheckup = "act.run_full_checkup",
        GetHelp = "act.get_help",
    }
}

closed_enum! {
    /// WATCH_ACTION_IDS, the WATCH_CATALOG rows.
    WatchActionId {
        WifiOff = "watch.wifi_off",
        WifiOn = "watch.wifi_on",
        BlockIncoming = "watch.block_incoming",
        AllowIncoming = "watch.allow_incoming",
        StopUserAgent = "watch.stop_user_agent",
        StopDaemon = "watch.stop_daemon",
    }
}

impl ProbeId {
    /// True for the two probes that touch file bytes; the model may never name them.
    pub fn rust_only(self) -> bool {
        matches!(self, ProbeId::PersistenceSignatures | ProbeId::SshKeys)
    }
}

/// One item the window and the fishy flow show. Mirrors `WatchItem`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchItem {
    pub signal_id: SignalId,
    pub kind: FishyKind,
    pub severity: Severity,
    pub points: u32,
    pub change: Change,
    pub changed_at: Option<String>,
    pub gated: bool,
    pub snoozed_until: Option<String>,
    pub has_startup_entry: bool,
    pub is_listener: bool,
    pub action_ids: Vec<ActionId>,
    /// In memory only; never persisted.
    pub model_sentence: Option<String>,
    pub model_provider: Option<ModelProvider>,
}

/// A probe the last cycle could not read, with the reason word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableProbe {
    pub probe_id: ProbeId,
    pub reason: ProbeReason,
}

/// The judge's sentence the window may show. In memory only; never persisted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgeLine {
    pub provider: ModelProvider,
    pub at: String,
    pub rating: Rating,
    pub reason: String,
}

/// How many rules appeared in the last check-up, kept until the report id changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesSince {
    pub report_id: String,
    pub appeared: u32,
}

/// The last check-up as the window shows it: an id, a date, a score and a grade.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRow {
    pub report_id: String,
    pub scanned_at: String,
    pub score: Option<u32>,
    pub grade: Option<Grade>,
}

/// The main webview's "Do this next" step, pushed with the profile and stored in
/// watch-settings.json.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextRow {
    pub report_id: String,
    pub rule_id: String,
    pub kind: NextKind,
}

/// `next` as `watch_set_profile` receives it; `clean_next` turns it into a row or nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextWire {
    pub kind: String,
    #[serde(default)]
    pub report_id: Option<String>,
    #[serde(default)]
    pub rule_id: Option<String>,
}

/// What `watch_status` returns and `watch:state` carries. Mirrors `WatchState`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchState {
    /// The person's switch.
    pub enabled: bool,
    /// The webview's product gate, as last pushed; the watch runs only when both are true.
    #[serde(default)]
    pub licensed: bool,
    pub first_run: bool,
    /// True from a `--watch` launch until the main window is first shown.
    pub hidden_launch: bool,
    pub rating: Rating,
    pub since: Option<String>,
    pub last_check_at: Option<String>,
    pub checking: bool,
    pub cycle_index: u64,
    /// 15, 60 or 240.
    pub every_minutes: u32,
    pub notify: bool,
    pub paused_until: Option<String>,
    pub close_watch_until: Option<String>,
    pub unavailable: Vec<UnavailableProbe>,
    pub gated: Vec<SignalId>,
    /// Sorted by points desc then SignalId order; the first is the top item.
    pub items: Vec<WatchItem>,
    /// Written by the loop before each wait; None before the first pass.
    #[serde(default)]
    pub next_check_at: Option<String>,
    /// `baseline.last_change_at`.
    #[serde(default)]
    pub last_change_at: Option<String>,
    /// watch-settings.json's `ai`: enabled means a consumer provider is chosen and the switch
    /// is on, not that one is connected.
    #[serde(default)]
    pub ai: WatchAi,
    /// The judge's current sentence, or None (section 3 of DESIGN-WATCH-WINDOW).
    #[serde(default)]
    pub judge: Option<JudgeLine>,
    /// `baseline.recent` entries within the last 24 h.
    #[serde(default)]
    pub recent_count: u32,
    #[serde(default)]
    pub rules_since: Option<RulesSince>,
    /// From last-report.json, read each cycle.
    #[serde(default)]
    pub report: Option<ReportRow>,
    /// From watch-settings.json's `next`.
    #[serde(default)]
    pub next: Option<NextRow>,
}

impl Default for WatchState {
    fn default() -> Self {
        WatchState {
            enabled: false,
            licensed: false,
            first_run: true,
            hidden_launch: false,
            rating: Rating::Calm,
            since: None,
            last_check_at: None,
            checking: false,
            cycle_index: 0,
            every_minutes: 60,
            notify: true,
            paused_until: None,
            close_watch_until: None,
            unavailable: Vec::new(),
            gated: Vec::new(),
            items: Vec::new(),
            next_check_at: None,
            last_change_at: None,
            ai: WatchAi::default(),
            judge: None,
            recent_count: 0,
            rules_since: None,
            report: None,
            next: None,
        }
    }
}

/// A baseline edit a command makes. It lands on the live baseline at once, under the short
/// lock, and is replayed onto a running cycle's copy before that copy is saved, so neither the
/// command nor the cycle waits for the other.
#[derive(Debug, Clone, PartialEq)]
pub enum Edit {
    /// "This is fine, I know it": re-baseline the signal and count the acknowledgement.
    Acknowledge { signal: SignalId, at: String },
    /// "Yes, that was me" re-baselines; "No, I didn't" floors the rating at act now.
    AnswerGate {
        signal: SignalId,
        mine: bool,
        at: String,
    },
    /// "Not now": the item is capped at keep_an_eye for 14 days.
    Snooze { signal: SignalId, at: DateTime<Utc> },
    /// A Talos fix just ran: changes near it are held for a cycle.
    RecordFix { at: String },
    /// After "turn Wi-Fi back on": the watch runs every 15 minutes for a day.
    CloseWatch { at: DateTime<Utc> },
}

impl Edit {
    pub fn apply(&self, baseline: &mut Baseline) {
        match self {
            Edit::Acknowledge { signal, at } => {
                cycle::rebaseline(baseline, *signal, at);
                for id in signals::siblings(*signal) {
                    let count = baseline.acknowledge_count.entry(id).or_insert(0);
                    *count = count.saturating_add(1);
                }
            }
            Edit::AnswerGate {
                signal,
                mine: true,
                at,
            } => cycle::rebaseline(baseline, *signal, at),
            Edit::AnswerGate {
                signal,
                mine: false,
                ..
            } => cycle::answer_not_mine(baseline, *signal),
            Edit::Snooze { signal, at } => cycle::snooze(baseline, *signal, *at),
            Edit::RecordFix { at } => baseline.last_fix_at = Some(at.clone()),
            Edit::CloseWatch { at } => cycle::close_watch(baseline, *at),
        }
    }
}

/// The managed state the cycle writes and the commands read. Sentences live only in memory.
#[derive(Default)]
pub struct WatchStore {
    pub state: Mutex<WatchState>,
    /// The live baseline, under a short lock no cycle holds for long.
    baseline: Mutex<Option<Baseline>>,
    /// True from `begin_cycle` to `finish_cycle`; set and cleared under the baseline lock.
    cycle_running: AtomicBool,
    /// Edits made while a cycle ran, replayed onto its copy by `finish_cycle`.
    edits: Mutex<Vec<Edit>>,
    settings: Mutex<Option<WatchSettingsFile>>,
    /// Wakes the loop for a check-now, a wake or a reconfigure.
    pub notify: tokio::sync::Notify,
    pub last_manual_check: Mutex<Option<Instant>>,
    pub full_check_requested: AtomicBool,
    pub manual_requested: AtomicBool,
    /// A re-run after an acknowledgement; skips the manual guard, is not a full check.
    pub refresh_requested: AtomicBool,
    pub reconfigure: AtomicBool,
    /// One cycle at a time. Commands never take it: they edit the baseline under its own lock.
    pub cycle_lock: Mutex<()>,
    pub pending: Mutex<Vec<ProbeOutcome>>,
    pub probe_last_run: Mutex<BTreeMap<ProbeId, Instant>>,
    pub limit_until: Mutex<Option<DateTime<Utc>>>,
    pub details: Mutex<Vec<WatchDetailsItem>>,
    pub last_context: Mutex<Option<WatchContext>>,
    last_verdict: Mutex<Option<LastVerdict>>,
}

/// The last validated answer, in memory only.
struct LastVerdict {
    verdict: WatchVerdict,
    at: DateTime<Utc>,
    provider: ModelProvider,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn data_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    crate::commands::app_data_dir(app).ok()
}

impl WatchStore {
    pub fn snapshot(&self) -> WatchState {
        lock(&self.state).clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut WatchState)) {
        f(&mut lock(&self.state));
    }

    /// The settings file, loaded once and cached; the state mirrors its three switches.
    pub fn settings(&self, app: &AppHandle) -> WatchSettingsFile {
        let mut cache = lock(&self.settings);
        if let Some(settings) = cache.as_ref() {
            return settings.clone();
        }
        let loaded = data_dir(app)
            .map(|d| settings::load(&d))
            .unwrap_or_default();
        self.update(|s| {
            s.enabled = loaded.enabled;
            s.licensed = loaded.licensed;
            s.every_minutes = loaded.every_minutes;
            s.notify = loaded.notify;
            s.ai = loaded.ai;
            s.next = loaded.next.clone();
        });
        *cache = Some(loaded.clone());
        loaded
    }

    /// Edits and saves the settings file; the state follows.
    pub fn set_settings(
        &self,
        app: &AppHandle,
        f: impl FnOnce(&mut WatchSettingsFile),
    ) -> Result<(), String> {
        let mut settings = self.settings(app);
        f(&mut settings);
        let dir = data_dir(app).ok_or_else(|| "no_app_data_dir".to_owned())?;
        settings::save(&dir, &settings).map_err(|e| e.to_string())?;
        self.update(|s| {
            s.enabled = settings.enabled;
            s.licensed = settings.licensed;
            s.every_minutes = settings.every_minutes;
            s.notify = settings.notify;
            s.ai = settings.ai;
            s.next = settings.next.clone();
        });
        *lock(&self.settings) = Some(settings);
        Ok(())
    }

    /// A copy of the baseline, loaded from disk on first use.
    pub fn baseline(&self, app: &AppHandle) -> Baseline {
        self.baseline_in(data_dir(app).as_deref())
    }

    /// The same with the data folder given, or none in tests.
    pub fn baseline_in(&self, dir: Option<&Path>) -> Baseline {
        let mut cache = lock(&self.baseline);
        cache
            .get_or_insert_with(|| dir.map(baseline::load).unwrap_or_default())
            .clone()
    }

    pub fn put_baseline(&self, baseline: Baseline) {
        *lock(&self.baseline) = Some(baseline);
    }

    /// A command's edit. Skipped while the watch is inactive, so nothing recreates watch.json
    /// after a disable or a lost licence.
    pub fn edit(&self, app: &AppHandle, edit: Edit) -> Result<(), String> {
        if !active(&self.settings(app)) {
            return Ok(());
        }
        self.apply_edit(data_dir(app).as_deref(), edit)
    }

    /// Applies an edit to the live baseline under the short lock and saves it. While a cycle
    /// runs the edit is queued as well, so the cycle's copy picks it up before it is saved.
    /// Never waits on a running cycle.
    pub fn apply_edit(&self, dir: Option<&Path>, edit: Edit) -> Result<(), String> {
        let mut cache = lock(&self.baseline);
        let baseline = cache.get_or_insert_with(|| dir.map(baseline::load).unwrap_or_default());
        edit.apply(baseline);
        if self.cycle_running.load(Ordering::SeqCst) {
            lock(&self.edits).push(edit);
        }
        if let Some(dir) = dir {
            baseline::save(dir, baseline).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// The cycle's copy of the baseline. From here until `finish_cycle` the commands' edits
    /// are queued for replay.
    pub fn begin_cycle(&self, dir: Option<&Path>) -> Baseline {
        let mut cache = lock(&self.baseline);
        let copy = cache
            .get_or_insert_with(|| dir.map(baseline::load).unwrap_or_default())
            .clone();
        lock(&self.edits).clear();
        self.cycle_running.store(true, Ordering::SeqCst);
        copy
    }

    /// Replays the queued edits onto the cycle's copy, stores it as the live baseline and
    /// saves it. `active` is read under the lock: with the watch turned off or the licence
    /// gone meanwhile nothing is written and None comes back.
    pub fn finish_cycle(
        &self,
        dir: Option<&Path>,
        active: impl FnOnce() -> bool,
        mut baseline: Baseline,
    ) -> Option<Baseline> {
        let mut cache = lock(&self.baseline);
        let edits = std::mem::take(&mut *lock(&self.edits));
        self.cycle_running.store(false, Ordering::SeqCst);
        if !active() {
            return None;
        }
        for edit in edits {
            edit.apply(&mut baseline);
        }
        if let Some(dir) = dir {
            let _ = baseline::save(dir, &baseline);
        }
        *cache = Some(baseline.clone());
        Some(baseline)
    }

    /// Deletes the file and forgets the baseline, under the short lock.
    fn clear_baseline(&self, dir: Option<&Path>) -> Result<(), String> {
        let mut cache = lock(&self.baseline);
        if let Some(dir) = dir {
            baseline::delete(dir).map_err(|e| e.to_string())?;
        }
        *cache = None;
        lock(&self.edits).clear();
        Ok(())
    }

    /// The store's half of an inactive settle: watch.json and the baseline go, the requests,
    /// details, context and verdict are cleared, and the state is reset keeping the switch,
    /// the interval, the notify flag, the licence flag, the AI pair and the next step (all
    /// settings-file fields). The judge line goes with the reset. Idempotent; a missing
    /// watch.json is fine.
    fn settle(&self, dir: Option<&Path>) -> Result<(), String> {
        // A running cycle sees the watch inactive in `finish_cycle` and writes nothing.
        self.clear_baseline(dir)?;
        self.manual_requested.store(false, Ordering::SeqCst);
        self.refresh_requested.store(false, Ordering::SeqCst);
        *lock(&self.details) = Vec::new();
        *lock(&self.last_context) = None;
        *lock(&self.last_verdict) = None;
        self.update(|s| {
            *s = WatchState {
                enabled: s.enabled,
                licensed: s.licensed,
                every_minutes: s.every_minutes,
                notify: s.notify,
                ai: s.ai,
                next: s.next.take(),
                ..WatchState::default()
            };
        });
        Ok(())
    }

    pub fn remember_verdict(&self, verdict: WatchVerdict, at: DateTime<Utc>, provider: ModelProvider) {
        *lock(&self.last_verdict) = Some(LastVerdict {
            verdict,
            at,
            provider,
        });
    }

    /// The provider that gave the last validated answer, for the window's badge tests.
    pub fn last_verdict_provider(&self) -> Option<ModelProvider> {
        lock(&self.last_verdict).as_ref().map(|last| last.provider)
    }

    pub fn last_verdict_for(&self, now: DateTime<Utc>) -> Option<WatchLastVerdict> {
        lock(&self.last_verdict)
            .as_ref()
            .map(|last| WatchLastVerdict {
                rating: last.verdict.rating,
                minutes_ago: (now - last.at).num_minutes().max(0),
            })
    }

    pub fn last_context(&self) -> Option<WatchContext> {
        lock(&self.last_context).clone()
    }

    pub fn details(&self) -> Vec<WatchDetailsItem> {
        lock(&self.details).clone()
    }
}

fn publish(app: &AppHandle) {
    let state = current_state(app);
    crate::tray::set_state(app, &state);
    let _ = app.emit(cycle::STATE_EVENT, &state);
}

/// The watch runs when the person's switch is on and the webview reports a licence.
pub fn active(settings: &WatchSettingsFile) -> bool {
    settings.enabled && settings.licensed
}

/// What a settings write did to the active flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transition {
    Start,
    Stop,
    Keep,
}

pub fn transition(before: bool, after: bool) -> Transition {
    match (before, after) {
        (false, true) => Transition::Start,
        (true, false) => Transition::Stop,
        _ => Transition::Keep,
    }
}

/// The interval in force: the setting, or 15 minutes while the close watch runs.
fn period(app: &AppHandle) -> Duration {
    let store = app.state::<WatchStore>();
    let settings = store.settings(app);
    let close = store
        .snapshot()
        .close_watch_until
        .as_deref()
        .and_then(signals::parse_ms)
        .is_some_and(|until| until > Utc::now().timestamp_millis());
    let minutes = if close {
        cycle::CLOSE_WATCH_MINUTES
    } else {
        settings.every_minutes
    };
    Duration::from_secs(u64::from(minutes) * 60)
}

async fn run(app: AppHandle) {
    let handle = app.clone();
    let _ =
        tauri::async_runtime::spawn_blocking(move || cycle::run_once(&handle, Utc::now())).await;
}

/// Starts the timer task: one cycle per interval, plus one on every wake of the notify. A
/// missed interval during sleep yields one cycle, not a burst. The first cycle runs at once
/// when the watch is active. Never settles: a licensed Mac with a pre-change file keeps its
/// login item until the webview pushes the flag.
pub fn start(app: AppHandle) {
    {
        let store = app.state::<WatchStore>();
        let settings = store.settings(&app);
        let active = active(&settings);
        store.update(|s| {
            s.enabled = settings.enabled;
            s.licensed = settings.licensed;
            s.first_run = active;
        });
        if active {
            store.notify.notify_one();
        }
        if let Some(dir) = data_dir(&app) {
            let baseline = baseline::load(&dir);
            store.update(|s| {
                s.close_watch_until = baseline.close_watch_until.clone();
                s.last_change_at = baseline.last_change_at.clone();
                s.rules_since = baseline.rules_since.clone();
            });
            store.put_baseline(baseline);
        }
    }
    publish(&app);
    tauri::async_runtime::spawn(async move {
        loop {
            let every = period(&app);
            let woken = {
                let store = app.state::<WatchStore>();
                let now = Utc::now();
                let paused_until = store.snapshot().paused_until;
                let wait = wait_for(every, paused_until.as_deref(), now);
                store.update(|s| s.next_check_at = Some(next_check_at(now, every)));
                publish(&app);
                tokio::time::timeout(wait, store.notify.notified())
                    .await
                    .is_ok()
            };
            let skip = {
                let store = app.state::<WatchStore>();
                let paused_until = store.snapshot().paused_until;
                if ends_pause(woken, pause_over(paused_until.as_deref(), Utc::now())) {
                    // The pause ran out: the window reads "paused" from the field alone, so it
                    // is cleared here and the next tick runs on its own timer.
                    store.update(|s| s.paused_until = None);
                    publish(&app);
                    continue;
                }
                let reconfigure = woken && store.reconfigure.swap(false, Ordering::SeqCst);
                let pending = store.manual_requested.load(Ordering::SeqCst)
                    || store.refresh_requested.load(Ordering::SeqCst)
                    || store.full_check_requested.load(Ordering::SeqCst);
                skip_wake(reconfigure, pending)
            };
            if skip {
                continue;
            }
            run(app.clone()).await;
        }
    });
}

/// A wake that only reconfigured the interval is skipped, unless a request shares its permit:
/// `Notify` stores one permit, so a check-now, a refresh or a window open that landed while a
/// cycle ran would otherwise wait a whole interval.
pub fn skip_wake(reconfigure: bool, pending: bool) -> bool {
    reconfigure && !pending
}

/// When the next timer tick lands: `now + every`, as the window's "Next check in" line reads it.
pub fn next_check_at(now: DateTime<Utc>, every: Duration) -> String {
    let millis = i64::try_from(every.as_millis()).unwrap_or(i64::MAX);
    cycle::iso(now + chrono::Duration::milliseconds(millis))
}

/// How long the loop sleeps: the interval, shortened to the end of a pause so the window stops
/// reading "paused" the moment the hour is up.
pub fn wait_for(every: Duration, paused_until: Option<&str>, now: DateTime<Utc>) -> Duration {
    let Some(until) = paused_until.and_then(signals::parse_ms) else {
        return every;
    };
    let left = until - now.timestamp_millis();
    if left <= 0 {
        return every;
    }
    every.min(Duration::from_millis(left.unsigned_abs()))
}

/// True when a pause is recorded and has ended. An unparsable value counts as over, so a
/// corrupt string never pins the window on "paused".
pub fn pause_over(paused_until: Option<&str>, now: DateTime<Utc>) -> bool {
    match paused_until {
        None => false,
        Some(text) => signals::parse_ms(text).is_none_or(|until| until <= now.timestamp_millis()),
    }
}

/// A timeout (not a wake) that lands after the pause ended clears it without a cycle.
pub fn ends_pause(woken: bool, pause_over: bool) -> bool {
    !woken && pause_over
}

/// Asks the loop for one cycle now, as the person's own check. It lifts "Pause for an hour":
/// the press is the person's later word.
pub fn request_check_now(app: &AppHandle) {
    let store = app.state::<WatchStore>();
    if store.snapshot().paused_until.is_some() {
        store.update(|s| s.paused_until = None);
        publish(app);
    }
    store.manual_requested.store(true, Ordering::SeqCst);
    store.full_check_requested.store(true, Ordering::SeqCst);
    store.notify.notify_one();
}

/// A scan or fix just ended: a check the person asked for while it ran goes now.
pub fn on_idle(app: &AppHandle) {
    if let Some(store) = app.try_state::<WatchStore>()
        && (store.manual_requested.load(Ordering::SeqCst)
            || store.refresh_requested.load(Ordering::SeqCst))
    {
        store.notify.notify_one();
    }
}

/// The main window opened: the next cycle re-reads the full-check sections (spec section 2).
/// Not a manual check, so the 60 s guard, a pause and the mains-only rule all still apply.
pub fn request_full_check(app: &AppHandle) {
    app.state::<WatchStore>().request_full_check();
}

/// A `--watch` login launch keeps the main window hidden: the webview reads this and holds its
/// launch check-up until the window is shown.
pub fn mark_hidden_launch(app: &AppHandle) {
    let store = app.state::<WatchStore>();
    store.update(|s| s.hidden_launch = true);
    publish(app);
}

/// The main window is on screen: the hidden launch is over, and the loop gets its full check.
pub fn on_main_open(app: &AppHandle) {
    let store = app.state::<WatchStore>();
    if store.snapshot().hidden_launch {
        store.update(|s| s.hidden_launch = false);
        publish(app);
    }
    store.request_full_check();
}

impl WatchStore {
    /// Marks the next cycle a full check and wakes the loop.
    pub fn request_full_check(&self) {
        self.full_check_requested.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }
}

/// A re-run after an acknowledgement: not a manual check, not a full check.
fn request_refresh(app: &AppHandle) {
    let store = app.state::<WatchStore>();
    store.refresh_requested.store(true, Ordering::SeqCst);
    store.notify.notify_one();
}

/// Pauses the loop for `minutes`.
pub fn pause(app: &AppHandle, minutes: u32) {
    let until = Utc::now() + chrono::Duration::minutes(i64::from(minutes));
    app.state::<WatchStore>().update(|s| {
        s.paused_until = Some(cycle::iso(until));
    });
    publish(app);
}

/// The watch just became active: a first run, the pause lifted and one cycle at once.
fn activate(store: &WatchStore) {
    store.update(|s| {
        s.first_run = true;
        s.paused_until = None;
    });
    store.notify.notify_one();
}

/// The settings are inactive after a write: the login item and watch.json go whatever the
/// previous state was, so a pre-change file or a free Mac loses its stale LaunchAgent on the
/// first push. Idempotent.
fn settle_inactive(app: &AppHandle, store: &WatchStore) -> Result<(), String> {
    store.settle(data_dir(app).as_deref())?;
    // The login item exists for the watch: it goes with it, so no hidden process starts at login.
    {
        use tauri_plugin_autostart::ManagerExt;
        let _ = app.autolaunch().disable();
    }
    Ok(())
}

/// After a settings write: settles when inactive, activates on a start, publishes, and on a
/// stop lets the tray hand the window back or end the process.
fn apply_transition(
    app: &AppHandle,
    store: &WatchStore,
    before: bool,
    after: bool,
) -> Result<(), String> {
    if !after {
        settle_inactive(app, store)?;
    }
    let change = transition(before, after);
    if change == Transition::Start {
        activate(store);
    }
    publish(app);
    if change == Transition::Stop {
        // The tray item is gone: a main window hidden behind it comes back, else the process ends.
        crate::tray::after_watch_off(app);
    }
    Ok(())
}

/// Turns the person's switch on or off. Inactive settings delete watch.json (and its key) and
/// remove the tray item; the settings file survives. Active settings run a cycle at once.
pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let store = app.state::<WatchStore>();
    let before = active(&store.settings(app));
    store.set_settings(app, |s| s.enabled = enabled)?;
    let after = active(&store.settings(app));
    apply_transition(app, &store, before, after)
}

/// One cycle after sleep when more than an interval has passed since the last check.
pub fn on_wake(app: &AppHandle) {
    let store = app.state::<WatchStore>();
    let every = period(app);
    let stale = store
        .snapshot()
        .last_check_at
        .as_deref()
        .and_then(signals::parse_ms)
        .is_none_or(|at| Utc::now().timestamp_millis() - at >= every.as_millis() as i64);
    if stale {
        store.notify.notify_one();
    }
}

/// The last state, or the default when nothing is managed yet.
pub fn current_state(app: &AppHandle) -> WatchState {
    app.try_state::<WatchStore>()
        .map(|store| store.snapshot())
        .unwrap_or_default()
}

/// True while the switch is on and the webview's last push reported a licence.
pub fn is_active(app: &AppHandle) -> bool {
    let state = current_state(app);
    state.enabled && state.licensed
}

pub fn set_interval(app: &AppHandle, minutes: u32) -> Result<(), String> {
    if !settings::valid_interval(minutes) {
        return Err("invalid_input".to_owned());
    }
    let store = app.state::<WatchStore>();
    store.set_settings(app, |s| s.every_minutes = minutes)?;
    store.reconfigure.store(true, Ordering::SeqCst);
    store.notify.notify_one();
    publish(app);
    Ok(())
}

/// Records the notify flag only; the macOS permission is asked for by its own command.
pub fn set_notify(app: &AppHandle, enabled: bool) -> Result<(), String> {
    app.state::<WatchStore>()
        .set_settings(app, |s| s.notify = enabled)?;
    publish(app);
    Ok(())
}

/// The most accepted rule ids a push may store.
pub const MAX_ACCEPTED: usize = 64;

/// The accepted ids as stored: well-formed rule ids only, first occurrence kept, at most
/// `MAX_ACCEPTED`.
pub fn clean_accepted(ids: Vec<String>) -> Vec<String> {
    let mut clean: Vec<String> = Vec::new();
    for id in ids {
        if context::rule_id_ok(&id) && !clean.contains(&id) {
            clean.push(id);
        }
    }
    clean.truncate(MAX_ACCEPTED);
    clean
}

/// The most UTF-16 units a typed question may carry: the input's `maxLength` and the TS
/// `.length` count the same units.
pub const MAX_QUESTION_UNITS: usize = 500;

/// The person's own question, as `watch_open_main` may carry it to the main window's composer.
/// Only the `chat` screen takes one. CR and LF fold to spaces, any other control character
/// refuses, the text is trimmed, an empty draft is nothing, and over 500 UTF-16 units refuses.
/// Held in memory only; never logged, never written.
pub fn clean_question(
    screen: OpenScreen,
    question: Option<String>,
) -> Result<Option<String>, String> {
    let Some(raw) = question else {
        return Ok(None);
    };
    if screen != OpenScreen::Chat {
        return Err("invalid_input".to_owned());
    }
    let folded: String = raw
        .chars()
        .map(|c| if c == '\r' || c == '\n' { ' ' } else { c })
        .collect();
    if folded.chars().any(char::is_control) {
        return Err("invalid_input".to_owned());
    }
    let trimmed = folded.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.encode_utf16().count() > MAX_QUESTION_UNITS {
        return Err("invalid_input".to_owned());
    }
    Ok(Some(trimmed.to_owned()))
}

/// The pushed "Do this next" step: `none` clears it; a kind with two well-formed ids stores it;
/// anything else is `invalid_input`.
pub fn clean_next(wire: NextWire) -> Result<Option<NextRow>, String> {
    if wire.kind == "none" {
        return Ok(None);
    }
    let kind = NextKind::parse(&wire.kind).ok_or_else(|| "invalid_input".to_owned())?;
    let report_id = wire
        .report_id
        .filter(|id| context::report_id_ok(id))
        .ok_or_else(|| "invalid_input".to_owned())?;
    let rule_id = wire
        .rule_id
        .filter(|id| context::rule_id_ok(id))
        .ok_or_else(|| "invalid_input".to_owned())?;
    Ok(Some(NextRow {
        report_id,
        rule_id,
        kind,
    }))
}

/// One profile push onto the settings file. `ai`, `accepted` and `next` keep the stored value
/// when absent; `accepted` is persisted only, no cycle reads it. Returns whether the judge line
/// must go: the AI switched off never leaves a model sentence behind.
pub fn apply_profile(
    settings: &mut WatchSettingsFile,
    profile: ExplainerProfile,
    ai: Option<WatchAi>,
    licensed: bool,
    accepted: Option<Vec<String>>,
    next: Option<Option<NextRow>>,
) -> bool {
    settings.profile = profile;
    let clears = clears_judge(ai.as_ref());
    if let Some(ai) = ai {
        settings.ai = ai;
    }
    settings.licensed = licensed;
    if let Some(ids) = accepted {
        settings.accepted = clean_accepted(ids);
    }
    if let Some(next) = next {
        settings.next = next;
    }
    clears
}

/// True when a pushed AI pair has the switch off.
pub fn clears_judge(ai: Option<&WatchAi>) -> bool {
    ai.is_some_and(|a| !a.enabled)
}

/// The profile, the AI choice when sent, the webview's product gate, the accepted ids when
/// sent and the next step when sent. A push that flips the gate starts or stops the watch
/// exactly as the switch does; Rust never verifies a key.
pub fn set_profile(
    app: &AppHandle,
    profile: ExplainerProfile,
    ai: Option<WatchAi>,
    licensed: bool,
    accepted: Option<Vec<String>>,
    next: Option<Option<NextRow>>,
) -> Result<(), String> {
    let store = app.state::<WatchStore>();
    let before = active(&store.settings(app));
    let mut clears = false;
    store.set_settings(app, |s| {
        clears = apply_profile(s, profile, ai, licensed, accepted, next);
    })?;
    if clears {
        store.update(|s| s.judge = None);
    }
    let after = active(&store.settings(app));
    apply_transition(app, &store, before, after)
}

/// A baseline edit makes the judge's sentence stale: it goes before the refresh re-rates.
fn forget_judge(store: &WatchStore) {
    store.update(|s| s.judge = None);
}

/// "This is fine, I know it": re-baseline the signal and its siblings and count the answer;
/// three answers on one signal mute it until a full check sees a new change.
pub fn acknowledge(app: &AppHandle, signal: SignalId) -> Result<(), String> {
    let store = app.state::<WatchStore>();
    store.edit(
        app,
        Edit::Acknowledge {
            signal,
            at: cycle::iso(Utc::now()),
        },
    )?;
    forget_judge(&store);
    request_refresh(app);
    Ok(())
}

pub fn answer_gate(app: &AppHandle, signal: SignalId, mine: bool) -> Result<(), String> {
    let store = app.state::<WatchStore>();
    store.edit(
        app,
        Edit::AnswerGate {
            signal,
            mine,
            at: cycle::iso(Utc::now()),
        },
    )?;
    forget_judge(&store);
    request_refresh(app);
    Ok(())
}

/// The signals a "Not now" snoozes: the one it was pressed on, plus every other item that
/// justifies act now (neither gated nor snoozed), so no act-now state survives it (section 5).
pub fn snooze_targets(state: &WatchState, signal: SignalId) -> Vec<SignalId> {
    let mut targets = vec![signal];
    if state.rating != Rating::ActNow {
        return targets;
    }
    for item in &state.items {
        if !item.gated && item.snoozed_until.is_none() && !targets.contains(&item.signal_id) {
            targets.push(item.signal_id);
        }
    }
    targets
}

/// "Not now": caps the item, and every other act-now item, at keep_an_eye for 14 days.
pub fn snooze(app: &AppHandle, signal: SignalId) -> Result<(), String> {
    let store = app.state::<WatchStore>();
    let at = Utc::now();
    for target in snooze_targets(&store.snapshot(), signal) {
        store.edit(app, Edit::Snooze { signal: target, at })?;
    }
    forget_judge(&store);
    request_refresh(app);
    Ok(())
}

/// A Talos fix just ran: changes within ten minutes of it are held for a cycle. Never waits on
/// a running cycle, so the fix sheet resolves at once.
pub fn record_fix(app: &AppHandle) {
    if let Some(store) = app.try_state::<WatchStore>() {
        let _ = store.edit(
            app,
            Edit::RecordFix {
                at: cycle::iso(Utc::now()),
            },
        );
        forget_judge(&store);
    }
    on_idle(app);
}

/// After "turn Wi-Fi back on": the watch runs every 15 minutes for a day.
pub fn close_watch(app: &AppHandle) {
    let store = app.state::<WatchStore>();
    let _ = store.edit(app, Edit::CloseWatch { at: Utc::now() });
    let until = store.baseline(app).close_watch_until;
    store.update(|s| s.close_watch_until = until);
    store.reconfigure.store(true, Ordering::SeqCst);
    store.notify.notify_one();
    publish(app);
}

/// The last context, or an empty one before the first cycle.
pub fn last_context(app: &AppHandle) -> WatchContext {
    let store = app.state::<WatchStore>();
    store.last_context().unwrap_or_else(|| {
        let settings = store.settings(app);
        context::to_watch_context(&context::ContextInput {
            previous_report: None,
            report: None,
            readings: &[],
            memory: &context::ContextMemory::default(),
            recent: &[],
            now: &cycle::iso(Utc::now()),
            os: crate::state::Os::Macos,
            os_version: "unknown",
            profile: settings.profile,
            cycle: types::WatchCycle {
                index: 0,
                minutes_since_full_check: 0,
                minutes_since_last_change: None,
                probes_left: cycle::MAX_MODEL_PROBES as u32,
            },
            last_verdict: None,
        })
    })
}

/// The Details document: the new launch items and listeners from the last cycle plus whether
/// a Wi-Fi port exists, read from Rust's own hardware-ports listing.
pub fn details(app: &AppHandle) -> WatchDetails {
    let items = app.state::<WatchStore>().details();
    let listing = crate::exec::run(
        crate::exec::Bin::Networksetup,
        &["-listallhardwareports"],
        crate::exec::DEFAULT_TIMEOUT,
        &AtomicBool::new(false),
    )
    .map(|out| out.stdout)
    .unwrap_or_default();
    WatchDetails {
        items,
        wifi_available: crate::fix::inputs::wifi_available(&listing),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_main_window_open_asks_for_a_full_check_and_wakes_the_loop_without_a_manual_flag() {
        let store = WatchStore::default();
        store.request_full_check();
        assert!(store.full_check_requested.load(Ordering::SeqCst));
        assert!(
            !store.manual_requested.load(Ordering::SeqCst),
            "not the person's own check: the 60 s guard holds"
        );
        assert!(!store.refresh_requested.load(Ordering::SeqCst));
        let woken = tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_millis(200), store.notify.notified())
                .await
                .is_ok()
        });
        assert!(woken, "the loop is woken");
    }

    #[test]
    fn the_closed_enums_round_trip_their_wire_names() {
        for id in SignalId::ALL {
            assert_eq!(SignalId::parse(id.as_str()), Some(*id));
            assert_eq!(
                serde_json::to_string(id).unwrap(),
                format!("\"{}\"", id.as_str())
            );
        }
        assert_eq!(SignalId::ALL.len(), 51);
        assert_eq!(ProbeId::ALL.len(), 21);
        assert_eq!(ActionId::ALL.len(), 24);
        assert_eq!(WatchActionId::ALL.len(), 6);
        assert_eq!(ProbeId::ALL.iter().filter(|p| p.rust_only()).count(), 2);
        assert_eq!(
            OpenScreen::parse("settings_watch"),
            Some(OpenScreen::SettingsWatch)
        );
        assert_eq!(OpenScreen::parse("chat"), Some(OpenScreen::Chat));
        assert_eq!(OpenScreen::parse("connect"), Some(OpenScreen::Connect));
        assert_eq!(OpenScreen::ALL.len(), 5);
        assert_eq!(Grade::parse("at_risk"), Some(Grade::AtRisk));
        assert_eq!(NextKind::parse("details"), Some(NextKind::Details));
        assert_eq!(ProbeReason::ALL.len(), 10);
        for reason in [
            UnavailableReason::NeedsFullDiskAccess,
            UnavailableReason::NeedsAutomationPermission,
            UnavailableReason::NeedsAdmin,
            UnavailableReason::PermissionDenied,
            UnavailableReason::ToolMissing,
            UnavailableReason::Timeout,
            UnavailableReason::ParseError,
            UnavailableReason::NotSupportedOnOs,
            UnavailableReason::CollectorError,
        ] {
            let word = serde_json::to_value(reason).unwrap();
            assert_eq!(
                serde_json::to_value(ProbeReason::from(reason)).unwrap(),
                word,
                "the nine wire words are shared"
            );
        }
        assert_eq!(ProbeReason::UnsignedBuild.as_str(), "unsigned_build");
        assert!(Rating::ActNow > Rating::Calm);
    }

    fn item(signal_id: SignalId, kind: FishyKind, gated: bool, snoozed: bool) -> WatchItem {
        WatchItem {
            signal_id,
            kind,
            severity: Severity::High,
            points: 6,
            change: Change::Appeared,
            changed_at: Some("2026-10-17T12:00:00.000Z".into()),
            gated,
            snoozed_until: snoozed.then(|| "2026-10-31T12:00:00.000Z".to_owned()),
            has_startup_entry: false,
            is_listener: false,
            action_ids: Vec::new(),
            model_sentence: None,
            model_provider: None,
        }
    }

    #[test]
    fn a_not_now_snoozes_every_act_now_item_and_only_the_pressed_one_otherwise() {
        let items = vec![
            item(
                SignalId::PersistenceNew,
                FishyKind::Persistence,
                false,
                false,
            ),
            item(
                SignalId::ListenerNewPorts,
                FishyKind::Listener,
                false,
                false,
            ),
            item(SignalId::RemoteAccessOn, FishyKind::Remote, true, false),
            item(SignalId::Firewall, FishyKind::Guard, false, true),
        ];
        let act = WatchState {
            rating: Rating::ActNow,
            items: items.clone(),
            ..WatchState::default()
        };
        assert_eq!(
            snooze_targets(&act, SignalId::PersistenceNew),
            vec![SignalId::PersistenceNew, SignalId::ListenerNewPorts],
            "the gated and the already snoozed items are left alone"
        );
        assert_eq!(
            snooze_targets(&act, SignalId::ListenerNewPorts),
            vec![SignalId::ListenerNewPorts, SignalId::PersistenceNew],
            "the pressed item comes first and is never repeated"
        );
        let look = WatchState {
            rating: Rating::KeepAnEye,
            items,
            ..WatchState::default()
        };
        assert_eq!(
            snooze_targets(&look, SignalId::PersistenceNew),
            vec![SignalId::PersistenceNew]
        );
        // Through the baseline: both listings end up snoozed with their siblings.
        let store = WatchStore::default();
        let at = Utc::now();
        for target in snooze_targets(&act, SignalId::PersistenceNew) {
            store
                .apply_edit(None, Edit::Snooze { signal: target, at })
                .unwrap();
        }
        let live = store.baseline_in(None);
        assert!(live.snoozed.contains_key(&SignalId::PersistenceNew));
        assert!(live.snoozed.contains_key(&SignalId::ListenerNewPorts));
        assert!(!live.snoozed.contains_key(&SignalId::RemoteAccessOn));
    }

    #[test]
    fn an_edit_never_waits_on_a_running_cycle_and_is_replayed_before_the_cycle_saves() {
        let store = WatchStore::default();
        let _cycle = store.cycle_lock.lock().unwrap();
        let copy = store.begin_cycle(None);
        assert!(store.cycle_running.load(Ordering::SeqCst));
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            scope.spawn(|| {
                store
                    .apply_edit(
                        None,
                        Edit::RecordFix {
                            at: "2026-10-17T12:00:00.000Z".into(),
                        },
                    )
                    .unwrap();
                store
                    .apply_edit(
                        None,
                        Edit::Snooze {
                            signal: SignalId::Sip,
                            at: Utc::now(),
                        },
                    )
                    .unwrap();
                tx.send(()).unwrap();
            });
            assert!(
                rx.recv_timeout(Duration::from_secs(2)).is_ok(),
                "the edits returned while the cycle held its lock"
            );
        });
        let live = store.baseline_in(None);
        assert_eq!(
            live.last_fix_at.as_deref(),
            Some("2026-10-17T12:00:00.000Z"),
            "the live baseline took the edit"
        );
        assert!(live.snoozed.contains_key(&SignalId::Sip));
        assert_eq!(copy.last_fix_at, None, "the cycle's copy predates it");
        assert_eq!(lock(&store.edits).len(), 2);

        let saved = store.finish_cycle(None, || true, copy).unwrap();
        assert_eq!(
            saved.last_fix_at.as_deref(),
            Some("2026-10-17T12:00:00.000Z"),
            "replayed before the save"
        );
        assert!(saved.snoozed.contains_key(&SignalId::Sip));
        assert!(!store.cycle_running.load(Ordering::SeqCst));
        assert!(lock(&store.edits).is_empty());
        store
            .apply_edit(
                None,
                Edit::RecordFix {
                    at: "2026-10-17T13:00:00.000Z".into(),
                },
            )
            .unwrap();
        assert!(
            lock(&store.edits).is_empty(),
            "outside a cycle nothing is queued"
        );
        assert_eq!(
            store.baseline_in(None).last_fix_at.as_deref(),
            Some("2026-10-17T13:00:00.000Z")
        );
    }

    #[test]
    fn a_cycle_finishing_after_the_watch_was_turned_off_writes_nothing() {
        let store = WatchStore::default();
        let copy = store.begin_cycle(None);
        store.clear_baseline(None).unwrap();
        assert!(store.finish_cycle(None, || false, copy).is_none());
        assert!(!store.cycle_running.load(Ordering::SeqCst));
    }

    #[test]
    fn a_cycle_finishing_after_the_licence_was_dropped_writes_nothing() {
        let dir =
            std::env::temp_dir().join(format!("talos-watch-mod-licence-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = WatchStore::default();
        let mut copy = store.begin_cycle(Some(&dir));
        let at = DateTime::parse_from_rfc3339("2026-10-17T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        copy.last_fix_at = Some(cycle::iso(at));
        // The licence went while the cycle ran: the settle took the baseline with it.
        store.settle(Some(&dir)).unwrap();
        let settings = WatchSettingsFile {
            enabled: true,
            licensed: false,
            ..WatchSettingsFile::default()
        };
        assert!(
            store
                .finish_cycle(Some(&dir), || active(&settings), copy)
                .is_none()
        );
        assert!(!store.cycle_running.load(Ordering::SeqCst));
        assert!(
            !baseline::path(&dir).exists(),
            "nothing recreated watch.json"
        );
        assert_eq!(store.baseline_in(Some(&dir)).last_fix_at, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_settle_on_an_inactive_store_deletes_the_baseline_and_a_second_one_is_fine() {
        let dir =
            std::env::temp_dir().join(format!("talos-watch-mod-settle-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut baseline = Baseline::new();
        baseline.last_fix_at = Some("2026-10-17T10:00:00.000Z".into());
        baseline::save(&dir, &baseline).unwrap();
        assert!(baseline::path(&dir).exists());
        let store = WatchStore::default();
        store.put_baseline(baseline);
        store.manual_requested.store(true, Ordering::SeqCst);
        store.refresh_requested.store(true, Ordering::SeqCst);
        store.remember_verdict(
            WatchVerdict {
                rating: Rating::ActNow,
                rating_reason: String::new(),
                based_on: Vec::new(),
                probes: Vec::new(),
                actions: Vec::new(),
            },
            Utc::now(),
            ModelProvider::Chatgpt,
        );
        assert_eq!(
            store.last_verdict_provider(),
            Some(ModelProvider::Chatgpt),
            "the provider is kept beside the verdict"
        );
        let ai = WatchAi {
            enabled: false,
            provider: Some(ModelProvider::Apple),
        };
        let next = NextRow {
            report_id: "r-1".into(),
            rule_id: "TL-MAC-001".into(),
            kind: NextKind::Fix,
        };
        store.update(|s| {
            s.enabled = true;
            s.licensed = false;
            s.every_minutes = 15;
            s.notify = false;
            s.rating = Rating::ActNow;
            s.cycle_index = 4;
            s.first_run = false;
            s.ai = ai;
            s.next = Some(next.clone());
            s.judge = Some(JudgeLine {
                provider: ModelProvider::Chatgpt,
                at: "2026-10-17T12:00:00.000Z".into(),
                rating: Rating::ActNow,
                reason: "A guard went off.".into(),
            });
            s.report = Some(ReportRow {
                report_id: "r-1".into(),
                scanned_at: "2026-10-17T10:00:00.000Z".into(),
                score: Some(72),
                grade: Some(Grade::Fair),
            });
        });
        store.settle(Some(&dir)).unwrap();
        assert!(!baseline::path(&dir).exists(), "watch.json is deleted");
        assert!(!store.manual_requested.load(Ordering::SeqCst));
        assert!(!store.refresh_requested.load(Ordering::SeqCst));
        assert!(store.last_verdict_for(Utc::now()).is_none());
        assert!(store.last_verdict_provider().is_none());
        let state = store.snapshot();
        assert_eq!(
            state,
            WatchState {
                enabled: true,
                licensed: false,
                every_minutes: 15,
                notify: false,
                ai,
                next: Some(next),
                ..WatchState::default()
            },
            "the switch, the interval, the notify flag, the licence flag, the AI pair and the \
             next step survive; the judge line and the report go"
        );
        assert!(lock(&store.baseline).is_none(), "the baseline is forgotten");
        assert!(store.settle(Some(&dir)).is_ok(), "a second settle is fine");
        assert!(store.settle(None).is_ok(), "no data folder is fine as well");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_watch_is_active_only_when_switched_on_and_licensed() {
        let case = |enabled: bool, licensed: bool| {
            active(&WatchSettingsFile {
                enabled,
                licensed,
                ..WatchSettingsFile::default()
            })
        };
        assert!(!case(false, false));
        assert!(!case(false, true), "a licence alone does not turn it on");
        assert!(!case(true, false), "the switch alone does not run it");
        assert!(case(true, true));
    }

    #[test]
    fn a_profile_push_keeps_the_accepted_ids_without_the_field_and_replaces_them_with_it() {
        let stored = vec!["TL-MAC-001".to_owned()];
        let mut settings = WatchSettingsFile {
            accepted: stored.clone(),
            ..WatchSettingsFile::default()
        };
        let profile = ExplainerProfile::default();
        assert!(!apply_profile(&mut settings, profile, None, true, None, None));
        assert_eq!(settings.accepted, stored, "None keeps the stored list");
        assert!(settings.licensed, "the gate still follows the push");
        apply_profile(&mut settings, profile, None, true, Some(Vec::new()), None);
        assert!(settings.accepted.is_empty(), "an empty list clears it");
        apply_profile(
            &mut settings,
            profile,
            None,
            false,
            Some(vec![
                "TL-MAC-010".to_owned(),
                "/Users/x".to_owned(),
                "TL-MAC-010".to_owned(),
                "TL-IOS-001".to_owned(),
                "TL-ANY-2b".to_owned(),
            ]),
            None,
        );
        assert_eq!(
            settings.accepted,
            vec!["TL-MAC-010".to_owned(), "TL-ANY-2b".to_owned()],
            "a bad id is dropped and a duplicate collapses, order kept"
        );
        assert!(!settings.licensed);
        let ai = WatchAi {
            enabled: false,
            provider: None,
        };
        assert!(
            apply_profile(&mut settings, profile, Some(ai), false, None, None),
            "the AI switched off clears the judge line"
        );
        assert_eq!(settings.ai, ai, "the AI choice still lands beside it");
        assert_eq!(settings.accepted.len(), 2);
        let on = WatchAi {
            enabled: true,
            provider: Some(ModelProvider::Chatgpt),
        };
        assert!(
            !apply_profile(&mut settings, profile, Some(on), false, None, None),
            "the switch on keeps it"
        );
        assert!(!clears_judge(None) && clears_judge(Some(&ai)) && !clears_judge(Some(&on)));
    }

    #[test]
    fn a_profile_push_keeps_the_next_step_without_the_field_and_clears_it_with_none() {
        let row = NextRow {
            report_id: "r-1".into(),
            rule_id: "TL-MAC-001".into(),
            kind: NextKind::Fix,
        };
        let mut settings = WatchSettingsFile {
            next: Some(row.clone()),
            ..WatchSettingsFile::default()
        };
        let profile = ExplainerProfile::default();
        apply_profile(&mut settings, profile, None, true, None, None);
        assert_eq!(settings.next, Some(row.clone()), "absent keeps the stored row");
        apply_profile(&mut settings, profile, None, true, None, Some(None));
        assert_eq!(settings.next, None, "`none` clears it");
        let other = NextRow {
            rule_id: "TL-MAC-002".into(),
            ..row
        };
        apply_profile(
            &mut settings,
            profile,
            None,
            true,
            None,
            Some(Some(other.clone())),
        );
        assert_eq!(settings.next, Some(other));
    }

    fn wire(kind: &str, report_id: Option<&str>, rule_id: Option<&str>) -> NextWire {
        NextWire {
            kind: kind.to_owned(),
            report_id: report_id.map(str::to_owned),
            rule_id: rule_id.map(str::to_owned),
        }
    }

    #[test]
    fn clean_next_takes_none_and_a_well_formed_row_and_refuses_the_rest() {
        assert_eq!(clean_next(wire("none", None, None)), Ok(None));
        assert_eq!(
            clean_next(wire("fix", Some("r-1"), Some("TL-MAC-001"))),
            Ok(Some(NextRow {
                report_id: "r-1".into(),
                rule_id: "TL-MAC-001".into(),
                kind: NextKind::Fix,
            }))
        );
        for kind in ["show", "details"] {
            assert!(clean_next(wire(kind, Some("r-1"), Some("TL-ANY-2b"))).is_ok());
        }
        let bad = Err("invalid_input".to_owned());
        assert_eq!(
            clean_next(wire("fix", Some("r-1"), Some("/Users/x"))),
            bad,
            "a bad rule id"
        );
        assert_eq!(
            clean_next(wire("fix", Some("bad id!"), Some("TL-MAC-001"))),
            bad,
            "a bad report id"
        );
        assert_eq!(
            clean_next(wire("open", Some("r-1"), Some("TL-MAC-001"))),
            bad,
            "an unknown kind"
        );
        assert_eq!(clean_next(wire("fix", None, Some("TL-MAC-001"))), bad);
        assert_eq!(clean_next(wire("fix", Some("r-1"), None)), bad);
        let json: NextWire = serde_json::from_value(serde_json::json!({ "kind": "none" })).unwrap();
        assert_eq!(json, wire("none", None, None), "the ids are optional on the wire");
        let json: NextWire = serde_json::from_value(
            serde_json::json!({ "kind": "fix", "reportId": "r-1", "ruleId": "TL-MAC-001" }),
        )
        .unwrap();
        assert_eq!(json.report_id.as_deref(), Some("r-1"));
    }

    #[test]
    fn clean_question_takes_a_chat_draft_only_and_counts_utf16_units() {
        let ok = |text: &str| clean_question(OpenScreen::Chat, Some(text.to_owned()));
        let bad = Err("invalid_input".to_owned());
        assert_eq!(clean_question(OpenScreen::Chat, None), Ok(None));
        assert_eq!(clean_question(OpenScreen::Home, None), Ok(None));
        assert_eq!(
            clean_question(OpenScreen::Home, Some("hi".into())),
            bad,
            "a question goes with chat only"
        );
        assert_eq!(
            clean_question(OpenScreen::Connect, Some("hi".into())),
            bad
        );
        assert_eq!(ok("  What changed?  "), Ok(Some("What changed?".into())));
        assert_eq!(
            ok(" hi\r\nthere\n"),
            Ok(Some("hi  there".into())),
            "CR and LF fold to spaces before the trim"
        );
        assert_eq!(ok("   "), Ok(None), "an empty draft is nothing");
        assert_eq!(ok(""), Ok(None));
        assert_eq!(ok("a\u{0007}b"), bad, "a control character refuses");
        assert_eq!(ok("a\tb"), bad);
        assert_eq!(ok("a\u{007f}b"), bad);
        assert_eq!(ok(&"a".repeat(500)), Ok(Some("a".repeat(500))));
        assert_eq!(ok(&"a".repeat(501)), bad);
        let smile = "\u{1F600}".repeat(250);
        assert_eq!(ok(&smile), Ok(Some(smile.clone())), "250 non-BMP: 500 units");
        assert_eq!(ok(&"\u{1F600}".repeat(251)), bad, "251 non-BMP: 502 units");
        assert_eq!(MAX_QUESTION_UNITS, 500);
    }

    #[test]
    fn the_four_baseline_edits_forget_the_judge_line() {
        let judge = JudgeLine {
            provider: ModelProvider::Chatgpt,
            at: "2026-10-17T12:00:00.000Z".into(),
            rating: Rating::KeepAnEye,
            reason: "Two start-up changes in a day is unusual here.".into(),
        };
        for _ in 0..4 {
            let store = WatchStore::default();
            store.update(|s| s.judge = Some(judge.clone()));
            assert!(store.snapshot().judge.is_some());
            forget_judge(&store);
            assert_eq!(store.snapshot().judge, None);
        }
    }

    #[test]
    fn the_next_check_is_now_plus_the_interval() {
        let now = DateTime::parse_from_rfc3339("2026-10-17T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            next_check_at(now, Duration::from_secs(60 * 60)),
            "2026-10-17T13:00:00.000Z"
        );
        assert_eq!(
            next_check_at(now, Duration::from_secs(15 * 60)),
            "2026-10-17T12:15:00.000Z"
        );
    }

    #[test]
    fn the_wait_is_the_interval_or_the_rest_of_the_pause() {
        let now = DateTime::parse_from_rfc3339("2026-10-17T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let hour = Duration::from_secs(60 * 60);
        assert_eq!(wait_for(hour, None, now), hour);
        assert_eq!(
            wait_for(hour, Some("2026-10-17T11:00:00.000Z"), now),
            hour,
            "a past pause changes nothing"
        );
        assert_eq!(
            wait_for(hour, Some("2026-10-17T14:00:00.000Z"), now),
            hour,
            "a pause further than the interval changes nothing"
        );
        assert_eq!(
            wait_for(hour, Some("2026-10-17T12:20:00.000Z"), now),
            Duration::from_secs(20 * 60),
            "the pause ends first"
        );
        assert_eq!(wait_for(hour, Some("nope"), now), hour);
    }

    #[test]
    fn a_pause_is_over_when_past_or_unreadable_and_a_timeout_ends_it() {
        let now = DateTime::parse_from_rfc3339("2026-10-17T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(pause_over(Some("2026-10-17T11:59:59.000Z"), now));
        assert!(pause_over(Some("2026-10-17T12:00:00.000Z"), now));
        assert!(!pause_over(Some("2026-10-17T12:00:01.000Z"), now));
        assert!(!pause_over(None, now));
        assert!(
            pause_over(Some("yesterday"), now),
            "a corrupt string never pins the window"
        );
        assert!(ends_pause(false, true));
        assert!(!ends_pause(true, true), "a wake runs the skip and cycle logic");
        assert!(!ends_pause(false, false));
        assert!(!ends_pause(true, false));
    }

    #[test]
    fn the_accepted_ids_are_capped_at_the_limit() {
        let many: Vec<String> = (0..MAX_ACCEPTED + 5)
            .map(|n| format!("TL-MAC-{n:03}"))
            .collect();
        let clean = clean_accepted(many.clone());
        assert_eq!(clean.len(), MAX_ACCEPTED);
        assert_eq!(clean.first(), many.first());
        assert_eq!(clean.get(MAX_ACCEPTED - 1), many.get(MAX_ACCEPTED - 1));
        assert_eq!(MAX_ACCEPTED, 64);
    }

    #[test]
    fn a_transition_is_a_start_a_stop_or_a_keep() {
        assert_eq!(transition(false, false), Transition::Keep);
        assert_eq!(transition(true, true), Transition::Keep);
        assert_eq!(transition(false, true), Transition::Start);
        assert_eq!(transition(true, false), Transition::Stop);
    }

    #[test]
    fn acknowledging_counts_the_listing_siblings_and_saturates() {
        let mut baseline = Baseline::new();
        Edit::Acknowledge {
            signal: SignalId::PersistenceNew,
            at: "2026-10-17T12:00:00.000Z".into(),
        }
        .apply(&mut baseline);
        assert_eq!(
            baseline.acknowledge_count.get(&SignalId::PersistenceSet),
            Some(&1)
        );
        assert_eq!(
            baseline.acknowledge_count.get(&SignalId::PersistenceNew),
            Some(&1)
        );
        baseline.acknowledge_count.insert(SignalId::Sip, u32::MAX);
        Edit::Acknowledge {
            signal: SignalId::Sip,
            at: "2026-10-17T12:00:00.000Z".into(),
        }
        .apply(&mut baseline);
        assert_eq!(
            baseline.acknowledge_count.get(&SignalId::Sip),
            Some(&u32::MAX)
        );
        Edit::AnswerGate {
            signal: SignalId::Firewall,
            mine: true,
            at: "2026-10-17T12:00:00.000Z".into(),
        }
        .apply(&mut baseline);
        assert_eq!(
            baseline.acknowledge_count.get(&SignalId::Firewall),
            None,
            "Yes, that was me is not a strike"
        );
        Edit::AnswerGate {
            signal: SignalId::Firewall,
            mine: false,
            at: "2026-10-17T12:00:00.000Z".into(),
        }
        .apply(&mut baseline);
        assert_eq!(
            baseline.gate_answers.get(&SignalId::Firewall),
            Some(&types::GateAnswer::NotMine)
        );
    }

    #[test]
    fn a_reconfigure_wake_runs_when_a_request_shares_its_permit() {
        assert!(
            skip_wake(true, false),
            "an interval change alone restarts the wait"
        );
        assert!(
            !skip_wake(true, true),
            "a coalesced check-now, refresh or window open still runs"
        );
        assert!(!skip_wake(false, false));
        assert!(!skip_wake(false, true));
    }

    #[test]
    fn the_default_state_is_off_and_first_run() {
        let state = WatchState::default();
        assert!(!state.enabled && state.first_run && !state.hidden_launch);
        assert!(!state.licensed);
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["everyMinutes"], 60);
        assert_eq!(json["hiddenLaunch"], false);
        assert_eq!(json["licensed"], false);
        let licensed = WatchState {
            licensed: true,
            ..WatchState::default()
        };
        assert_eq!(
            serde_json::to_value(&licensed).unwrap()["licensed"],
            true,
            "the state carries the licence flag to the webview"
        );
        assert_eq!(json["items"], serde_json::json!([]));
        assert_eq!(json["nextCheckAt"], serde_json::Value::Null);
        assert_eq!(json["lastChangeAt"], serde_json::Value::Null);
        assert_eq!(
            json["ai"],
            serde_json::json!({ "enabled": true, "provider": null })
        );
        assert_eq!(json["judge"], serde_json::Value::Null);
        assert_eq!(json["recentCount"], 0);
        assert_eq!(json["rulesSince"], serde_json::Value::Null);
        assert_eq!(json["report"], serde_json::Value::Null);
        assert_eq!(json["next"], serde_json::Value::Null);
        let keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        let tail = &keys[keys.len() - 9..];
        assert_eq!(
            tail,
            [
                "items",
                "nextCheckAt",
                "lastChangeAt",
                "ai",
                "judge",
                "recentCount",
                "rulesSince",
                "report",
                "next"
            ],
            "the new fields follow items in the contract's order"
        );
        let old: WatchState = serde_json::from_value(serde_json::json!({
            "enabled": true, "firstRun": false, "hiddenLaunch": false, "rating": "calm",
            "since": null, "lastCheckAt": null, "checking": false, "cycleIndex": 3,
            "everyMinutes": 60, "notify": true, "pausedUntil": null, "closeWatchUntil": null,
            "unavailable": [], "gated": [], "items": []
        }))
        .unwrap();
        assert_eq!(old.judge, None, "a pre-change document still parses");
        assert_eq!(old.recent_count, 0);
        let store = WatchStore::default();
        assert_eq!(store.snapshot(), state);
        store.update(|s| s.checking = true);
        assert!(store.snapshot().checking);
        assert!(store.last_verdict_for(Utc::now()).is_none());
    }
}
