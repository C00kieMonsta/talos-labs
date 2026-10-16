//! The app menu: About and Settings (Cmd+,) emit `menu:navigate`; Edit keeps copy and paste working.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

pub const NAVIGATE_EVENT: &str = "menu:navigate";
pub const ABOUT_ID: &str = "talos-about";
pub const SETTINGS_ID: &str = "talos-settings";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = MenuItem::with_id(app, ABOUT_ID, "About Talos Labs", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, SETTINGS_ID, "Settings…", true, Some("CmdOrCtrl+,"))?;
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
            &PredefinedMenuItem::quit(app, None)?,
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

/// The screen a menu id navigates to, or None for items the OS handles.
pub fn target(id: &str) -> Option<&'static str> {
    match id {
        ABOUT_ID => Some("about"),
        SETTINGS_ID => Some("settings"),
        _ => None,
    }
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if let Some(screen) = target(event.id().as_ref()) {
        let _ = app.emit(NAVIGATE_EVENT, screen);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_two_custom_items_navigate() {
        assert_eq!(target(ABOUT_ID), Some("about"));
        assert_eq!(target(SETTINGS_ID), Some("settings"));
        assert_eq!(target("quit"), None);
    }
}
