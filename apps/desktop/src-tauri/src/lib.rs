//! Talos Labs desktop: read-only collectors behind a small Tauri command surface.
#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

pub mod ai;
pub mod automation;
pub mod capabilities;
pub mod collect;
pub mod commands;
pub mod exec;
pub mod fix;
pub mod license_store;
pub mod menu;
pub mod report_store;
pub mod secret;
pub mod settings_pane;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::AppState::default())
        .manage(ai::AiState::default())
        .manage(ai::provider::Providers::default())
        .manage(fix::plan::PlanStore::default())
        .menu(menu::build)
        .on_menu_event(menu::on_event)
        .invoke_handler(tauri::generate_handler![
            commands::collect_system_state,
            commands::cancel_scan,
            commands::collect_section,
            commands::cancel_section,
            commands::check_capabilities,
            commands::open_settings_pane,
            commands::fix_preview,
            commands::fix_apply,
            commands::fix_preview_batch,
            commands::fix_apply_batch,
            commands::fix_cancel,
            commands::fix_reveal,
            commands::open_buy_page,
            commands::app_restart,
            commands::secret_get,
            commands::secret_set,
            commands::secret_delete,
            commands::report_save_last,
            commands::report_load_last,
            commands::license_read,
            commands::license_write,
            commands::license_delete,
            ai::ai_availability,
            ai::ai_generate,
            ai::ai_cancel,
            ai::claude_generate,
            ai::claude_cancel,
            ai::claude_code_info,
            ai::provider::ai_provider_status,
            ai::provider::ai_connect_offered,
            ai::provider::ai_connect_start,
            ai::provider::ai_connect_poll,
            ai::provider::ai_connect_cancel,
            ai::provider::ai_disconnect,
            ai::chatgpt_oauth::chatgpt_token,
            ai::chatgpt_oauth::chatgpt_info,
        ])
        .run(tauri::generate_context!());
    if let Err(err) = result {
        eprintln!("error while running tauri application: {err}");
        std::process::exit(1);
    }
}
