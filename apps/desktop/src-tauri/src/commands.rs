//! Tauri command surface. Thin; maps errors to strings. Argument names are single lowercase words.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::assistant;
use crate::capabilities::{self, Capabilities};
use crate::collect::{self, CollectError, ProgressStatus};
use crate::settings_pane::SettingsPane;
use crate::state::{SectionKey, SystemState};
use crate::{license_store, report_store, secret};

/// Cancel flags. Two of them, because a Rescan may start while a recheck is still running and
/// aborting the old recheck must not stop the new scan.
pub struct AppState {
    /// Set by `cancel_scan`; cleared when `collect_system_state` starts.
    pub scan_cancel: Arc<AtomicBool>,
    /// Set by `cancel_section` and by `cancel_scan`; cleared when `collect_section` starts.
    pub section_cancel: Arc<AtomicBool>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState { scan_cancel: Arc::new(AtomicBool::new(false)), section_cancel: Arc::new(AtomicBool::new(false)) }
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

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn collect_system_state(app: AppHandle, state: State<'_, AppState>) -> Result<SystemState, String> {
    let cancel = state.start_scan();
    let emitter = app.clone();
    let progress: Arc<collect::ProgressFn> = Arc::new(move |key, status| {
        let _ = emitter.emit(PROGRESS_EVENT, ProgressPayload { key, status });
    });
    tauri::async_runtime::spawn_blocking(move || collect::collect_all(progress, cancel))
        .await
        .map_err(|e| e.to_string())?
        .map_err(cancelled)
}

/// Cancels the running scan and any recheck in flight. The scan rejects with "cancelled".
#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) {
    state.cancel_scan();
}

/// One section, for "check again". Honours the recheck cancel flag the same way the scan honours
/// its own: `exec::run` checks it before every spawn and polls it while a child runs. Rejects with
/// "cancelled" when the flag was set, so a cancelled recheck never replaces a good section.
#[tauri::command]
pub async fn collect_section(key: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let key = SectionKey::parse(&key).ok_or_else(|| "unknown section key".to_owned())?;
    let cancel = state.start_section();
    let section = tauri::async_runtime::spawn_blocking(move || collect::collect_section(key, cancel))
        .await
        .map_err(|e| e.to_string())?
        .map_err(cancelled)?;
    serde_json::to_value(section).map_err(|e| e.to_string())
}

/// Cancels the recheck only. Use this from the recheck's abort signal so a Rescan that aborts the
/// old recheck after starting the new scan does not stop that scan.
#[tauri::command]
pub fn cancel_section(state: State<'_, AppState>) {
    state.cancel_section();
}

#[tauri::command]
pub fn check_capabilities() -> Capabilities {
    capabilities::check()
}

#[tauri::command]
pub fn open_settings_pane(app: AppHandle, pane: String) -> Result<(), String> {
    let pane = SettingsPane::parse(&pane).ok_or_else(|| "unknown settings pane".to_owned())?;
    app.opener().open_url(pane.url(), None::<&str>).map_err(|e| e.to_string())
}

/// Opens the user's own Claude or ChatGPT account with a prompt built by core. Rust picks the URL.
#[tauri::command]
pub fn open_assistant(app: AppHandle, assistant: String, prompt: String) -> Result<(), String> {
    let url = assistant::assistant_url(&assistant, &prompt)?;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn secret_get(name: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || secret::get(&name)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secret_set(name: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secret::set(&name, &value)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secret_delete(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || secret::delete(&name)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn report_save_last(app: AppHandle, report: serde_json::Value) -> Result<(), String> {
    report_store::save_last(&app_data_dir(&app)?, &report).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn report_load_last(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    report_store::load_last(&app_data_dir(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn license_read(app: AppHandle) -> Result<Option<String>, String> {
    license_store::read(&app_data_dir(&app)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn license_write(app: AppHandle, key: String) -> Result<(), String> {
    license_store::write(&app_data_dir(&app)?, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn license_delete(app: AppHandle) -> Result<(), String> {
    license_store::delete(&app_data_dir(&app)?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_scan_stops_a_recheck_in_flight() {
        let state = AppState::default();
        let flag = state.start_section();
        state.cancel_scan();
        assert!(matches!(collect::collect_section(SectionKey::Accounts, flag), Err(CollectError::Cancelled)));
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
        assert!(state.scan_cancel.load(Ordering::SeqCst), "the scan flag waits for the next scan");
        assert!(!state.start_scan().load(Ordering::SeqCst));
    }

    #[test]
    fn cancelled_maps_to_the_string_the_adapter_matches() {
        assert_eq!(cancelled(CollectError::Cancelled), "cancelled");
    }
}
