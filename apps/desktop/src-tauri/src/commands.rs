//! Tauri command surface. Thin; maps errors to strings. Argument names are single lowercase words.
//! Every command takes the calling `window` first and checks its label through `guard`: the
//! four watch-window commands accept `watch` or `main`, everything else `main` only.

pub mod guard;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tauri_plugin_opener::OpenerExt;

use crate::capabilities::{self, Capabilities};
use crate::collect::{self, CollectError, ProgressStatus};
use crate::fix::batch::{self, BatchOutcome, BatchPlanWire};
use crate::fix::plan::{FixPlan, PlanStore};
use crate::fix::run::{self as fix_run, FixStatus, STATUS_EVENT};
use crate::fix::{FixChoice, FixOutcome};
use crate::settings_pane::SettingsPane;
use crate::state::{SectionKey, SystemState};
use crate::watch::settings::WatchAi;
use crate::watch::types::{ExplainerProfile, WatchContext, WatchDetails};
use crate::watch::{self, ActionId, OpenScreen, SignalId, WatchActionId, WatchState};
use crate::{license_store, report_store, secret};
use guard::Callers;

/// Cancel flags. Two of them, because a Rescan may start while a recheck is still running and
/// aborting the old recheck must not stop the new scan. `in_flight` counts the scans and
/// rechecks running, so the watch skips a tick while the main window collects.
pub struct AppState {
    /// Set by `cancel_scan`; cleared when `collect_system_state` starts.
    pub scan_cancel: Arc<AtomicBool>,
    /// Set by `cancel_section` and by `cancel_scan`; cleared when `collect_section` starts.
    pub section_cancel: Arc<AtomicBool>,
    /// Scans and rechecks running right now.
    pub in_flight: AtomicUsize,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            scan_cancel: Arc::new(AtomicBool::new(false)),
            section_cancel: Arc::new(AtomicBool::new(false)),
            in_flight: AtomicUsize::new(0),
        }
    }
}

impl AppState {
    /// Clears the scan flag and hands it to the scan about to start.
    pub fn start_scan(&self) -> Arc<AtomicBool> {
        self.scan_cancel.store(false, Ordering::SeqCst);
        Arc::clone(&self.scan_cancel)
    }

    /// Clears the recheck flag and hands it to the recheck about to start.
    pub fn start_section(&self) -> Arc<AtomicBool> {
        self.section_cancel.store(false, Ordering::SeqCst);
        Arc::clone(&self.section_cancel)
    }

    /// Stops the full scan and any recheck in flight.
    pub fn cancel_scan(&self) {
        self.scan_cancel.store(true, Ordering::SeqCst);
        self.section_cancel.store(true, Ordering::SeqCst);
    }

    /// Stops the recheck only; a scan started alongside it keeps going.
    pub fn cancel_section(&self) {
        self.section_cancel.store(true, Ordering::SeqCst);
    }

    /// Counts a collection for as long as the guard lives.
    pub fn enter(&self) -> InFlight<'_> {
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        InFlight(&self.in_flight)
    }
}

/// Decrements the in-flight counter when dropped, so an early return never leaves it raised.
pub struct InFlight<'a>(&'a AtomicUsize);

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn cancelled(err: CollectError) -> String {
    match err {
        CollectError::Cancelled => "cancelled".to_owned(),
    }
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    key: SectionKey,
    status: ProgressStatus,
}

pub const PROGRESS_EVENT: &str = "scan:progress";

pub(crate) fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn main_only(window: &Window) -> Result<(), String> {
    guard::check(window, Callers::MainOnly)
}

#[tauri::command]
pub async fn collect_system_state(
    window: Window,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SystemState, String> {
    main_only(&window)?;
    let running = state.enter();
    if let Some(store) = app.try_state::<watch::WatchStore>() {
        store.full_check_requested.store(true, Ordering::SeqCst);
    }
    let cancel = state.start_scan();
    let emitter = app.clone();
    let progress: Arc<collect::ProgressFn> = Arc::new(move |key, status| {
        let _ = emitter.emit(PROGRESS_EVENT, ProgressPayload { key, status });
    });
    let result =
        tauri::async_runtime::spawn_blocking(move || collect::collect_all(progress, cancel))
            .await
            .map_err(|e| e.to_string())?
            .map_err(cancelled);
    drop(running);
    watch::on_idle(&app);
    result
}

/// Cancels the running scan and any recheck in flight. The scan rejects with "cancelled".
#[tauri::command]
pub fn cancel_scan(window: Window, state: State<'_, AppState>) -> Result<(), String> {
    main_only(&window)?;
    state.cancel_scan();
    Ok(())
}

/// One section, for "check again". Honours the recheck cancel flag the same way the scan honours
/// its own: `exec::run` checks it before every spawn and polls it while a child runs. Rejects with
/// "cancelled" when the flag was set, so a cancelled recheck never replaces a good section.
#[tauri::command]
pub async fn collect_section(
    window: Window,
    key: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    main_only(&window)?;
    let key = SectionKey::parse(&key).ok_or_else(|| "unknown section key".to_owned())?;
    let running = state.enter();
    let cancel = state.start_section();
    let section =
        tauri::async_runtime::spawn_blocking(move || collect::collect_section(key, cancel))
            .await
            .map_err(|e| e.to_string())
            .and_then(|outcome| outcome.map_err(cancelled));
    drop(running);
    watch::on_idle(window.app_handle());
    serde_json::to_value(section?).map_err(|e| e.to_string())
}

/// Cancels the recheck only. Use this from the recheck's abort signal so a Rescan that aborts the
/// old recheck after starting the new scan does not stop that scan.
#[tauri::command]
pub fn cancel_section(window: Window, state: State<'_, AppState>) -> Result<(), String> {
    main_only(&window)?;
    state.cancel_section();
    Ok(())
}

#[tauri::command]
pub fn check_capabilities(window: Window) -> Result<Capabilities, String> {
    main_only(&window)?;
    Ok(capabilities::check())
}

#[tauri::command]
pub fn open_settings_pane(window: Window, app: AppHandle, pane: String) -> Result<(), String> {
    main_only(&window)?;
    let pane = SettingsPane::parse(&pane).ok_or_else(|| "unknown settings pane".to_owned())?;
    app.opener()
        .open_url(pane.url(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Where "Buy" goes. Fixed here so the webview never passes a URL.
pub const BUY_URL: &str = "https://taloslabs.si/shop";

/// Builds and stores a plan for five minutes. Rejects with the `FixError` string.
#[tauri::command]
pub async fn fix_preview(
    window: Window,
    state: State<'_, PlanStore>,
    rule: String,
    choice: FixChoice,
) -> Result<FixPlan, String> {
    main_only(&window)?;
    let plan = tauri::async_runtime::spawn_blocking(move || fix_run::preview(&rule, &choice))
        .await
        .map_err(|e| e.to_string())?
        .map_err(String::from)?;
    Ok(state.insert(plan))
}

/// Which catalogue an apply command serves; a plan from the other table is refused before it runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Table {
    /// `FIX_CATALOG`, keyed by rule id.
    Fix,
    /// `WATCH_CATALOG`, keyed by `watch.*` id.
    Watch,
}

impl Table {
    fn holds(self, rule: &str) -> bool {
        match self {
            Table::Fix => crate::fix::catalog::spec_for(rule).is_some(),
            Table::Watch => WatchActionId::parse(rule).is_some(),
        }
    }
}

/// Takes a stored single plan out for a run, refusing a batch id or a plan from the other table.
/// On a refusal the store is released and nothing has run.
fn take_single(
    state: &PlanStore,
    plan: &str,
    table: Table,
) -> Result<(crate::fix::plan::Plan, Arc<crate::fix::plan::Running>), String> {
    let (stored, running) = state.start(plan).map_err(String::from)?;
    let single = match stored.into_single() {
        Ok(single) => single,
        Err(err) => {
            state.finish(plan);
            return Err(err.into());
        }
    };
    if !table.holds(single.spec.rule) {
        state.finish(plan);
        return Err("not_in_catalog".to_owned());
    }
    Ok((single, running))
}

/// Runs a stored single plan from `table`; shared by `fix_apply` and `watch_action_apply`.
async fn apply_single(
    app: &AppHandle,
    state: &PlanStore,
    plan: &str,
    passphrase: Option<String>,
    table: Table,
) -> Result<(FixOutcome, &'static str), String> {
    let passphrase = passphrase.map(zeroize::Zeroizing::new);
    let (single, running) = take_single(state, plan, table)?;
    let rule = single.spec.rule;
    let emitter = app.clone();
    let emit = move |status: FixStatus| {
        let _ = emitter.emit(STATUS_EVENT, status);
    };
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        fix_run::apply(&single, &running, passphrase, &emit)
    })
    .await
    .map_err(|e| e.to_string());
    state.finish(plan);
    watch::record_fix(app);
    Ok((outcome?.map_err(String::from)?, rule))
}

/// Runs a stored plan. Pre-run errors reject; run-time errors resolve `{ ok: false }`.
#[tauri::command]
pub async fn fix_apply(
    window: Window,
    app: AppHandle,
    state: State<'_, PlanStore>,
    plan: String,
    passphrase: Option<String>,
) -> Result<FixOutcome, String> {
    main_only(&window)?;
    apply_single(&app, &state, &plan, passphrase, Table::Fix)
        .await
        .map(|(outcome, _)| outcome)
}

/// Builds and stores a batch for five minutes. Rejects with `invalid_choice` or `not_in_catalog`.
#[tauri::command]
pub async fn fix_preview_batch(
    window: Window,
    state: State<'_, PlanStore>,
    rules: Vec<String>,
) -> Result<BatchPlanWire, String> {
    main_only(&window)?;
    let plan = tauri::async_runtime::spawn_blocking(move || batch::preview_batch(&rules))
        .await
        .map_err(|e| e.to_string())?
        .map_err(String::from)?;
    Ok(state.insert_batch(plan))
}

/// Runs a stored batch. Rejects `plan_expired` and `busy`; the run resolves, even on cancel.
#[tauri::command]
pub async fn fix_apply_batch(
    window: Window,
    app: AppHandle,
    state: State<'_, PlanStore>,
    plan: String,
) -> Result<BatchOutcome, String> {
    main_only(&window)?;
    let (stored, running) = state.start(&plan).map_err(String::from)?;
    let batch_plan = match stored.into_batch() {
        Ok(batch_plan) => batch_plan,
        Err(err) => {
            state.finish(&plan);
            return Err(err.into());
        }
    };
    let emitter = app.clone();
    let emit = move |status: FixStatus| {
        let _ = emitter.emit(STATUS_EVENT, status);
    };
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        batch::apply_batch(&batch_plan, &running, &emit)
    })
    .await
    .map_err(|e| e.to_string());
    state.finish(&plan);
    watch::record_fix(&app);
    outcome?.map_err(String::from)
}

/// Kills the running child; the osascript dialog closes with it.
#[tauri::command]
pub fn fix_cancel(window: Window, state: State<'_, PlanStore>, plan: String) -> Result<(), String> {
    main_only(&window)?;
    state.cancel(&plan);
    Ok(())
}

/// Finder reveal for 023, 024 and 031 after the same validation as a preview.
#[tauri::command]
pub async fn fix_reveal(
    window: Window,
    app: AppHandle,
    rule: String,
    choice: FixChoice,
) -> Result<(), String> {
    main_only(&window)?;
    let path =
        tauri::async_runtime::spawn_blocking(move || crate::fix::reveal::resolve(&rule, &choice))
            .await
            .map_err(|e| e.to_string())?
            .map_err(String::from)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_buy_page(window: Window, app: AppHandle) -> Result<(), String> {
    main_only(&window)?;
    app.opener()
        .open_url(BUY_URL, None::<&str>)
        .map_err(|e| e.to_string())
}

/// For the Full Disk Access continuation: the new grant applies to the next process.
#[tauri::command]
pub fn app_restart(window: Window, app: AppHandle) -> Result<(), String> {
    main_only(&window)?;
    app.restart();
}

#[tauri::command]
pub async fn secret_get(window: Window, name: String) -> Result<Option<String>, String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || secret::webview_get(&name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secret_set(window: Window, name: String, value: String) -> Result<(), String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || secret::webview_set(&name, &value))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secret_delete(window: Window, name: String) -> Result<(), String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || secret::webview_delete(&name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn report_save_last(
    window: Window,
    app: AppHandle,
    report: serde_json::Value,
) -> Result<(), String> {
    main_only(&window)?;
    report_store::save_last(&app_data_dir(&app)?, &report).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn report_load_last(
    window: Window,
    app: AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    main_only(&window)?;
    report_store::load_last(&app_data_dir(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn license_read(window: Window, app: AppHandle) -> Result<Option<String>, String> {
    main_only(&window)?;
    license_store::read(&app_data_dir(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn license_write(window: Window, app: AppHandle, key: String) -> Result<(), String> {
    main_only(&window)?;
    license_store::write(&app_data_dir(&app)?, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn license_delete(window: Window, app: AppHandle) -> Result<(), String> {
    main_only(&window)?;
    license_store::delete(&app_data_dir(&app)?).map_err(|e| e.to_string())
}

// ---------- the watch (docs/DESIGN-WATCH.md section 8) ----------

pub const WATCH_PAUSE_MINUTES: u32 = 60;

fn parse_signal(signal: &str) -> Result<SignalId, String> {
    SignalId::parse(signal).ok_or_else(|| "invalid_input".to_owned())
}

/// The last state. Callable from the watch window.
#[tauri::command]
pub fn watch_status(window: Window, app: AppHandle) -> Result<WatchState, String> {
    guard::check(&window, Callers::WatchOrMain)?;
    Ok(watch::current_state(&app))
}

/// One cycle now, as the person's own check. Callable from the watch window.
#[tauri::command]
pub fn watch_check_now(window: Window, app: AppHandle) -> Result<(), String> {
    guard::check(&window, Callers::WatchOrMain)?;
    watch::request_check_now(&app);
    Ok(())
}

/// "Pause for an hour". Callable from the watch window.
#[tauri::command]
pub fn watch_pause(window: Window, app: AppHandle, minutes: u32) -> Result<(), String> {
    guard::check(&window, Callers::WatchOrMain)?;
    if minutes != WATCH_PAUSE_MINUTES {
        return Err("invalid_input".to_owned());
    }
    watch::pause(&app, minutes);
    Ok(())
}

/// Shows the main window on a screen. Callable from the watch window.
#[tauri::command]
pub fn watch_open_main(window: Window, app: AppHandle, screen: String) -> Result<(), String> {
    guard::check(&window, Callers::WatchOrMain)?;
    let screen = OpenScreen::parse(&screen).ok_or_else(|| "invalid_input".to_owned())?;
    crate::tray::open_main(&app, screen);
    Ok(())
}

/// Off a worker thread: turning the watch off deletes watch.json and must never hold the main thread.
#[tauri::command]
pub async fn watch_set_enabled(
    window: Window,
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || watch::set_enabled(&app, enabled))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn watch_set_interval(window: Window, app: AppHandle, minutes: u32) -> Result<(), String> {
    main_only(&window)?;
    watch::set_interval(&app, minutes)
}

/// Records the flag only; `watch_request_notify_permission` is the one path to the alert.
#[tauri::command]
pub fn watch_set_notify(window: Window, app: AppHandle, enabled: bool) -> Result<(), String> {
    main_only(&window)?;
    watch::set_notify(&app, enabled)
}

/// macOS's own "allow notifications" alert, in the foreground only.
#[tauri::command]
pub fn watch_request_notify_permission(window: Window, app: AppHandle) -> Result<(), String> {
    main_only(&window)?;
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .request_permission()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The profile the context carries, plus the AI switch and provider choice when the webview
/// sends them. `licensed` is the webview's product gate; absent means false. Rust trusts the
/// last pushed value and never verifies a key. `accepted` is the rule ids the person chose to
/// leave alone: stored in watch-settings.json when sent, kept when absent, read by no cycle.
/// Off a worker thread like `watch_set_enabled`: the inactive path deletes watch.json and must
/// never hold the main thread.
#[tauri::command]
pub async fn watch_set_profile(
    window: Window,
    app: AppHandle,
    profile: ExplainerProfile,
    ai: Option<WatchAi>,
    licensed: Option<bool>,
    accepted: Option<Vec<String>>,
) -> Result<(), String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        watch::set_profile(&app, profile, ai, licensed.unwrap_or(false), accepted)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "This is fine, I know it": re-baselines the signal. Off the main thread, like every
/// command that writes watch.json.
#[tauri::command]
pub async fn watch_acknowledge(
    window: Window,
    app: AppHandle,
    signal: String,
) -> Result<(), String> {
    main_only(&window)?;
    let signal = parse_signal(&signal)?;
    tauri::async_runtime::spawn_blocking(move || watch::acknowledge(&app, signal))
        .await
        .map_err(|e| e.to_string())?
}

/// "Yes, that was me" (mine) re-baselines; "No, I didn't" floors the rating at act now.
#[tauri::command]
pub async fn watch_answer_gate(
    window: Window,
    app: AppHandle,
    signal: String,
    mine: bool,
) -> Result<(), String> {
    main_only(&window)?;
    let signal = parse_signal(&signal)?;
    tauri::async_runtime::spawn_blocking(move || watch::answer_gate(&app, signal, mine))
        .await
        .map_err(|e| e.to_string())?
}

/// "Not now": caps the item at keep_an_eye for 14 days.
#[tauri::command]
pub async fn watch_snooze(window: Window, app: AppHandle, signal: String) -> Result<(), String> {
    main_only(&window)?;
    let signal = parse_signal(&signal)?;
    tauri::async_runtime::spawn_blocking(move || watch::snooze(&app, signal))
        .await
        .map_err(|e| e.to_string())?
}

/// The last context, for the fishy flow's rating and the Details ids.
#[tauri::command]
pub fn watch_context(window: Window, app: AppHandle) -> Result<WatchContext, String> {
    main_only(&window)?;
    Ok(watch::last_context(&app))
}

/// The one document with machine text, returned to the fishy flow only.
#[tauri::command]
pub async fn watch_details(window: Window, app: AppHandle) -> Result<WatchDetails, String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || watch::details(&app))
        .await
        .map_err(|e| e.to_string())
}

/// Opens a playbook row's source URL, from the Rust table, by action id.
#[tauri::command]
pub fn watch_open_source(window: Window, app: AppHandle, action: String) -> Result<(), String> {
    main_only(&window)?;
    let id = ActionId::parse(&action).ok_or_else(|| "invalid_input".to_owned())?;
    let row = watch::playbook::action_for(id).ok_or_else(|| "invalid_input".to_owned())?;
    app.opener()
        .open_url(row.url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// The WATCH_CATALOG twin of `fix_preview`; the wire's `ruleId` is the watch.* id.
#[tauri::command]
pub async fn watch_action_preview(
    window: Window,
    state: State<'_, PlanStore>,
    action: String,
    choice: FixChoice,
) -> Result<FixPlan, String> {
    main_only(&window)?;
    let id = WatchActionId::parse(&action).ok_or_else(|| "invalid_input".to_owned())?;
    let plan =
        tauri::async_runtime::spawn_blocking(move || fix_run::preview_watch(id.as_str(), &choice))
            .await
            .map_err(|e| e.to_string())?
            .map_err(String::from)?;
    Ok(state.insert(plan))
}

/// The WATCH_CATALOG twin of `fix_apply`: `fix:status` events as usual, `fix_cancel` cancels.
/// Turning Wi-Fi or incoming connections back on starts the close watch for a day.
#[tauri::command]
pub async fn watch_action_apply(
    window: Window,
    app: AppHandle,
    state: State<'_, PlanStore>,
    plan: String,
) -> Result<FixOutcome, String> {
    main_only(&window)?;
    let (outcome, rule) = apply_single(&app, &state, &plan, None, Table::Watch).await?;
    if matches!(outcome, FixOutcome::Ok { .. })
        && matches!(rule, "watch.wifi_on" | "watch.allow_incoming")
    {
        watch::close_watch(&app);
    }
    Ok(outcome)
}

#[tauri::command]
pub fn autostart_enable(window: Window, app: AppHandle) -> Result<(), String> {
    main_only(&window)?;
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().enable().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autostart_disable(window: Window, app: AppHandle) -> Result<(), String> {
    main_only(&window)?;
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().disable().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autostart_is_enabled(window: Window, app: AppHandle) -> Result<bool, String> {
    main_only(&window)?;
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_buy_page_is_the_shop_on_the_product_domain() {
        assert_eq!(BUY_URL, "https://taloslabs.si/shop");
    }

    #[test]
    fn cancel_scan_stops_a_recheck_in_flight() {
        let state = AppState::default();
        let flag = state.start_section();
        state.cancel_scan();
        assert!(matches!(
            collect::collect_section(SectionKey::Accounts, flag),
            Err(CollectError::Cancelled)
        ));
        assert!(state.scan_cancel.load(Ordering::SeqCst));
    }

    #[test]
    fn cancel_section_leaves_the_scan_flag_alone() {
        let state = AppState::default();
        let scan = state.start_scan();
        let section = state.start_section();
        state.cancel_section();
        assert!(section.load(Ordering::SeqCst));
        assert!(!scan.load(Ordering::SeqCst));
    }

    #[test]
    fn a_new_collection_clears_its_stale_flag_only() {
        let state = AppState::default();
        state.cancel_scan();
        assert!(!state.start_section().load(Ordering::SeqCst));
        assert!(
            state.scan_cancel.load(Ordering::SeqCst),
            "the scan flag waits for the next scan"
        );
        assert!(!state.start_scan().load(Ordering::SeqCst));
    }

    #[test]
    fn each_apply_path_refuses_a_plan_from_the_other_table_before_it_runs() {
        use crate::fix::plan::{Bound, Plan};
        let state = PlanStore::default();
        let watch_spec = crate::fix::catalog::watch_spec_for("watch.block_incoming").unwrap();
        let fix_spec = crate::fix::catalog::spec_for("TL-MAC-002").unwrap();
        let watch_plan = state
            .insert(Plan::new(watch_spec, Bound::default(), None))
            .plan_id;
        let fix_plan = state
            .insert(Plan::new(fix_spec, Bound::default(), None))
            .plan_id;
        assert_eq!(
            take_single(&state, &watch_plan, Table::Fix)
                .err()
                .as_deref(),
            Some("not_in_catalog")
        );
        assert!(!state.is_running(), "a refused plan releases the store");
        assert_eq!(
            take_single(&state, &fix_plan, Table::Watch)
                .err()
                .as_deref(),
            Some("not_in_catalog")
        );
        assert!(!state.is_running());
        assert_eq!(
            take_single(&state, &watch_plan, Table::Watch)
                .err()
                .as_deref(),
            Some("plan_expired"),
            "a refused id was consumed"
        );
        let again = state
            .insert(Plan::new(watch_spec, Bound::default(), None))
            .plan_id;
        let (plan, _running) = take_single(&state, &again, Table::Watch).unwrap();
        assert_eq!(plan.spec.rule, "watch.block_incoming");
        assert!(state.is_running());
        state.finish(&again);
        assert!(!state.is_running());
        assert!(Table::Fix.holds("TL-MAC-002") && !Table::Fix.holds("watch.wifi_on"));
        assert!(Table::Watch.holds("watch.wifi_on") && !Table::Watch.holds("TL-MAC-002"));
    }

    #[test]
    fn cancelled_maps_to_the_string_the_adapter_matches() {
        assert_eq!(cancelled(CollectError::Cancelled), "cancelled");
    }

    #[test]
    fn the_in_flight_counter_follows_the_guard() {
        let state = AppState::default();
        assert_eq!(state.in_flight.load(Ordering::SeqCst), 0);
        {
            let _a = state.enter();
            let _b = state.enter();
            assert_eq!(state.in_flight.load(Ordering::SeqCst), 2);
        }
        assert_eq!(state.in_flight.load(Ordering::SeqCst), 0);
        assert_eq!(parse_signal("sig.firewall"), Ok(SignalId::Firewall));
        assert_eq!(parse_signal("firewall"), Err("invalid_input".to_owned()));
        assert_eq!(WATCH_PAUSE_MINUTES, 60);
    }
}
