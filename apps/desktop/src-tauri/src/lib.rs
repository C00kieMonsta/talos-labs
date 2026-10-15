//! Talos Labs desktop: read-only collectors behind a small Tauri command surface.

pub mod capabilities;
pub mod collect;
pub mod commands;
pub mod exec;
pub mod license_store;
pub mod report_store;
pub mod secret;
pub mod settings_pane;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::collect_system_state,
            commands::cancel_scan,
            commands::collect_section,
            commands::check_capabilities,
            commands::open_settings_pane,
            commands::secret_get,
            commands::secret_set,
            commands::secret_delete,
            commands::report_save_last,
            commands::report_load_last,
            commands::license_read,
            commands::license_write,
            commands::license_delete,
        ])
        .run(tauri::generate_context!());
    if let Err(err) = result {
        eprintln!("error while running tauri application: {err}");
        std::process::exit(1);
    }
}
