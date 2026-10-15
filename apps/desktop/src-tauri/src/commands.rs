//! Tauri command surface. Thin; maps errors to strings. Argument names are single lowercase words.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::capabilities::{self, Capabilities};
use crate::collect::{self, CollectError, ProgressStatus};
use crate::settings_pane::SettingsPane;
use crate::state::{SectionKey, SystemState};
use crate::{license_store, report_store, secret};

pub struct AppState {
    pub cancel: Arc<AtomicBool>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState { cancel: Arc::new(AtomicBool::new(false)) }
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
    let cancel = Arc::clone(&state.cancel);
    cancel.store(false, Ordering::SeqCst);
    let emitter = app.clone();
    let progress: Arc<collect::ProgressFn> = Arc::new(move |key, status| {
        let _ = emitter.emit(PROGRESS_EVENT, ProgressPayload { key, status });
    });
    let result = tauri::async_runtime::spawn_blocking(move || collect::collect_all(progress, cancel))
        .await
        .map_err(|e| e.to_string())?;
    result.map_err(|err| match err {
        CollectError::Cancelled => "cancelled".to_owned(),
    })
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn collect_section(key: String) -> Result<serde_json::Value, String> {
    let key = SectionKey::parse(&key).ok_or_else(|| "unknown section key".to_owned())?;
    let cancel = Arc::new(AtomicBool::new(false));
    let section = tauri::async_runtime::spawn_blocking(move || collect::collect_section(key, cancel))
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(section).map_err(|e| e.to_string())
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
