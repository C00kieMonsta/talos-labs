//! The app menu: About and Settings (Cmd+,) emit `menu:navigate`; Edit keeps copy and paste working.
//! Quit is a custom item (docs/DESIGN-WATCH.md section 5): the predefined one arrives as
//! `ExitRequested { code: None }`, which the run loop swallows while the watch is on.

use serde::Serialize;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub use crate::tray::QUIT_ID;

pub const NAVIGATE_EVENT: &str = "menu:navigate";
pub const ABOUT_ID: &str = "talos-about";
pub const SETTINGS_ID: &str = "talos-settings";

/// The payload of `menu:navigate`; App.tsx reads `payload.route`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct NavigatePayload {
    pub route: &'static str,
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = MenuItem::with_id(app, ABOUT_ID, "About Talos Labs", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, SETTINGS_ID, "Settings…", true, Some("CmdOrCtrl+,"))?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit Talos Labs", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "Talos Labs",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

/// The screen a menu id navigates to, or None for Quit and the items the OS handles.
pub fn target(id: &str) -> Option<&'static str> {
    match id {
        ABOUT_ID => Some("about"),
        SETTINGS_ID => Some("settings"),
        _ => None,
    }
}

/// True for the custom Quit item, from the app menu or the tray menu.
pub fn is_quit(id: &str) -> bool {
    id == QUIT_ID
}

/// Every menu event reaches this handler, tray menus included, so Quit exits from both.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    if is_quit(id) {
        app.exit(0);
        return;
    }
    if let Some(route) = target(id) {
        let _ = app.emit(NAVIGATE_EVENT, NavigatePayload { route });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_two_custom_items_navigate() {
        assert_eq!(target(ABOUT_ID), Some("about"));
        assert_eq!(target(SETTINGS_ID), Some("settings"));
        assert_eq!(target(QUIT_ID), None);
        assert_eq!(target("quit"), None);
    }

    #[test]
    fn quit_is_the_custom_item_only() {
        assert!(is_quit(QUIT_ID));
        assert!(!is_quit("quit"));
        assert!(!is_quit(SETTINGS_ID));
        assert_eq!(QUIT_ID, "talos-quit");
    }

    #[test]
    fn the_navigate_payload_carries_the_route_key() {
        let value = serde_json::to_value(NavigatePayload { route: "settings" }).unwrap();
        assert_eq!(value, serde_json::json!({ "route": "settings" }));
        let value = serde_json::to_value(NavigatePayload { route: "about" }).unwrap();
        assert_eq!(value["route"], "about");
    }
}
