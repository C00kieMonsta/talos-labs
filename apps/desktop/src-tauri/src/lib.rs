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
pub mod tray;
pub mod watch;

use tauri::{ActivationPolicy, Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

/// The login-item launch (docs/DESIGN-WATCH.md section 5): `--watch` opens the tray only.
pub const WATCH_FLAG: &str = "--watch";

/// True when the process was started with `--watch`, as the LaunchAgent does.
pub fn watch_only(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().skip(1).any(|arg| arg == WATCH_FLAG)
}

/// A `--watch` launch opens the tray only while the watch is on. With the watch off there would
/// be no tray item either, so the launch is treated as a normal one and the main window shows.
pub fn start_hidden(watch_only: bool, watch_enabled: bool) -> bool {
    watch_only && watch_enabled
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let watch_only = watch_only(std::env::args());
    let built = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            tray::on_second_instance(app, argv, cwd)
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![WATCH_FLAG]),
        ))
        .manage(commands::AppState::default())
        .manage(ai::AiState::default())
        .manage(ai::provider::Providers::default())
        .manage(fix::plan::PlanStore::default())
        .manage(tray::TrayState::default())
        .manage(watch::WatchStore::default())
        .menu(menu::build)
        .on_menu_event(menu::on_event)
        .on_window_event(tray::on_window_event)
        .setup(move |app| {
            tray::build(app.handle())?;
            tray::observe_wake(app.handle());
            let enabled = app
                .state::<watch::WatchStore>()
                .settings(app.handle())
                .enabled;
            if start_hidden(watch_only, enabled) {
                // Hide, Accessory and the hidden flag `tray::show_main` reads.
                tray::hide_main(app.handle());
                // The webview still boots; it holds its launch check-up until the window shows.
                watch::mark_hidden_launch(app.handle());
            } else {
                app.handle()
                    .set_activation_policy(ActivationPolicy::Regular)?;
            }
            watch::start(app.handle().clone());
            // Run folders a killed or quit process left under /private/tmp.
            std::thread::spawn(ai::claude_code::sweep_stale_run_dirs);
            Ok(())
        })
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
            commands::watch_status,
            commands::watch_check_now,
            commands::watch_pause,
            commands::watch_open_main,
            commands::watch_set_enabled,
            commands::watch_set_interval,
            commands::watch_set_notify,
            commands::watch_request_notify_permission,
            commands::watch_set_profile,
            commands::watch_acknowledge,
            commands::watch_answer_gate,
            commands::watch_snooze,
            commands::watch_context,
            commands::watch_details,
            commands::watch_open_source,
            commands::watch_action_preview,
            commands::watch_action_apply,
            commands::autostart_enable,
            commands::autostart_disable,
            commands::autostart_is_enabled,
        ])
        .build(tauri::generate_context!());
    let app = match built {
        Ok(app) => app,
        Err(err) => {
            eprintln!("error while running tauri application: {err}");
            std::process::exit(1);
        }
    };
    app.run(|app, event| match event {
        // The last window closing asks to exit with no code; the tray keeps the process.
        RunEvent::ExitRequested {
            code: None, api, ..
        } if watch::is_enabled(app) => {
            api.prevent_exit();
        }
        RunEvent::Reopen { .. } => tray::open_main_plain(app),
        // `app.exit(0)` ends the process without unwinding the thread that holds a run folder.
        RunEvent::Exit => ai::claude_code::sweep_run_dirs_at_exit(),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_watch_flag_is_read_after_the_program_name() {
        assert!(watch_only(args(&["talos-desktop", "--watch"])));
        assert!(watch_only(args(&["talos-desktop", "other", "--watch"])));
        assert!(!watch_only(args(&["talos-desktop"])));
        assert!(!watch_only(args(&["--watch"])));
        assert!(!watch_only(args(&["talos-desktop", "--watch=1"])));
        assert!(!watch_only(Vec::new()));
    }

    #[test]
    fn a_watch_launch_hides_the_main_window_only_while_the_watch_is_on() {
        assert!(start_hidden(true, true));
        assert!(
            !start_hidden(true, false),
            "no window, no Dock icon and no tray item would be an invisible process"
        );
        assert!(!start_hidden(false, true));
        assert!(!start_hidden(false, false));
    }
}
