//! The menu bar item, the watch window placement and the main-window activation
//! (docs/DESIGN-WATCH.md section 5). The item is built and changed from Rust only; no webview
//! can reach it. Nothing here may print: tests/ai_no_logging.rs covers this file.

use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use block2::RcBlock;
use chrono::{DateTime, Utc};
use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
use objc2_foundation::NSNotification;
use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    ActivationPolicy, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition,
    Rect, Window, WindowEvent, include_image,
};
use tauri_plugin_notification::NotificationExt;

use crate::watch::{OpenScreen, Rating, WatchState};

/// The custom Quit item, shared by the app menu and the tray menu; `menu::on_event` exits for both.
pub const QUIT_ID: &str = "talos-quit";
/// The tray item's id, for `tray_by_id` and `remove_tray_by_id`.
pub const TRAY_ID: &str = "watch";
/// Emitted by `open_main` only, with `OpenPayload`.
pub const OPEN_EVENT: &str = "watch:open";
/// Emitted when a hidden main window is shown, with `OpenPayload` (`home` for a plain open).
pub const SHOWN_EVENT: &str = "main:shown";
const OPEN_ID: &str = "talos-tray-open";
const CHECK_ID: &str = "talos-tray-check";
const PAUSE_ID: &str = "talos-tray-pause";
const OFF_ID: &str = "talos-tray-off";
const MAIN_LABEL: &str = "main";
const WATCH_LABEL: &str = "watch";
const NOTIFICATION_TITLE: &str = "Talos Labs";
/// The plugin reports a click on the banner itself under this action id.
const TAP_ACTION: &str = "tap";

/// A blur this soon after a tray click is the click itself, not the person leaving.
const BLUR_IGNORE: Duration = Duration::from_millis(150);

/// The configured size of the watch window, used when the runtime cannot report it.
const WINDOW_SIZE: LogicalSize<f64> = LogicalSize {
    width: 320.0,
    height: 360.0,
};

/// Height to content, by state (spec section 5: max 360). The window is sized from Rust before
/// it is shown, so a calm window is not a 360 px box with an empty middle. The look height
/// fits a two-line headline, the why line and an "and N more things" line; the QA harness
/// checks each state's content against these numbers (qa/harness.ts WATCH_WINDOW_HEIGHTS).
pub fn window_height(state: &WatchState) -> f64 {
    if state.first_run {
        return 170.0;
    }
    match state.rating {
        Rating::Calm => 150.0,
        Rating::KeepAnEye => 280.0,
        Rating::ActNow => WINDOW_SIZE.height,
    }
}

/// Managed by lib.rs: when the icon was last clicked, whether the window is shown, which raster
/// the item carries, and whether the notification tap handler is hooked (once per process).
#[derive(Default)]
pub struct TrayState {
    pub last_click: Mutex<Option<Instant>>,
    pub window_open: AtomicBool,
    pub shown_rating: Mutex<Option<Rating>>,
    /// The height last applied to the watch window, so `set_size` runs only on a change.
    pub shown_height: Mutex<Option<f64>>,
    pub tap_hooked: AtomicBool,
    /// Set by `hide_main` (a close with the watch on, a `--watch` launch), cleared by `show_main`.
    /// Kept here rather than read from `is_visible()`, which also says no for a minimised window.
    pub main_hidden: AtomicBool,
}

/// What a watch-off must do about the main window so no invisible process is left behind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnOffFollowUp {
    /// The window was hidden behind the tray: show it and bring the Dock icon back.
    Show,
    /// There is no main window to show: end the process, as closing it with the watch off would.
    Exit,
    /// The window is on screen (or minimised, so still in the Dock): nothing to do.
    Nothing,
}

pub fn turn_off_follow_up(has_main: bool, main_hidden: bool) -> TurnOffFollowUp {
    match (has_main, main_hidden) {
        (false, _) => TurnOffFollowUp::Exit,
        (true, true) => TurnOffFollowUp::Show,
        (true, false) => TurnOffFollowUp::Nothing,
    }
}

/// A rectangle in logical points with a top-left origin.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The right-click menu's entries, by id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    Open,
    CheckNow,
    Pause,
    TurnOff,
}

/// The payload of `watch:open`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct OpenPayload {
    pub screen: OpenScreen,
}

/// The tray entry a menu id maps to; Quit is left to `menu::on_event`, OS items to the OS.
pub fn menu_action(id: &str) -> Option<TrayAction> {
    match id {
        OPEN_ID => Some(TrayAction::Open),
        CHECK_ID => Some(TrayAction::CheckNow),
        PAUSE_ID => Some(TrayAction::Pause),
        OFF_ID => Some(TrayAction::TurnOff),
        _ => None,
    }
}

/// The raster for a rating; all three are 36 x 36 template images.
pub fn icon_for(rating: Rating) -> Image<'static> {
    match rating {
        Rating::Calm => include_image!("./icons/tray-calm.png"),
        Rating::KeepAnEye => include_image!("./icons/tray-look.png"),
        Rating::ActNow => include_image!("./icons/tray-act.png"),
    }
}

/// Minutes round to five; the line stays in minutes under this, so hours is never one.
const HOURS_FROM_MINUTES: i64 = 90;

/// "Checked just now", "Checked 10 minutes ago" or "Checked 3 hours ago"; None without a check.
/// The same rounding as `apps/desktop/src/watch/relative-time.ts`, so the tooltip and the
/// window agree: minutes to the nearest five, hours from 90 minutes.
pub fn checked_ago(last_check_at: Option<&str>, now: DateTime<Utc>) -> Option<String> {
    let at = DateTime::parse_from_rfc3339(last_check_at?)
        .ok()?
        .with_timezone(&Utc);
    let minutes = (now - at).num_minutes().max(0);
    let rounded = (minutes + 2) / 5 * 5;
    Some(if rounded == 0 {
        "Checked just now".to_string()
    } else if rounded < HOURS_FROM_MINUTES {
        format!("Checked {rounded} minutes ago")
    } else {
        format!("Checked {} hours ago", (rounded + 30) / 60)
    })
}

/// What closing the main window does: hide behind the tray while the watch is on, else quit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    Hide,
    Exit,
}

pub fn close_action(watch_enabled: bool) -> CloseAction {
    if watch_enabled {
        CloseAction::Hide
    } else {
        CloseAction::Exit
    }
}

/// The tooltip for a state, from the spec's three sentences.
pub fn tooltip(state: &WatchState, now: DateTime<Utc>) -> String {
    match state.rating {
        Rating::Calm => match checked_ago(state.last_check_at.as_deref(), now) {
            Some(ago) => format!("Talos Labs: nothing changed since the last check. {ago}."),
            None => "Talos Labs: nothing changed since the last check.".to_string(),
        },
        // The count is of what the window shows: with no item the word carries no number.
        Rating::KeepAnEye => match state.items.len() {
            0 => "Talos Labs: something to look at.".to_string(),
            1 => "Talos Labs: one thing to look at.".to_string(),
            n => format!("Talos Labs: {n} things to look at."),
        },
        Rating::ActNow => "Talos Labs: act now.".to_string(),
    }
}

/// The window's top-left: centred under the icon, clamped into the work area.
pub fn place(
    icon: LogicalRect,
    work_area: LogicalRect,
    window: LogicalSize<f64>,
) -> LogicalPosition<f64> {
    let x = icon.x + icon.width / 2.0 - window.width / 2.0;
    let y = icon.y + icon.height;
    let max_x = (work_area.x + work_area.width - window.width).max(work_area.x);
    let max_y = (work_area.y + work_area.height - window.height).max(work_area.y);
    LogicalPosition::new(x.clamp(work_area.x, max_x), y.clamp(work_area.y, max_y))
}

/// True when a blur lands within 150 ms of the tray click that opened the window.
pub fn ignore_blur(clicked_at: Option<Instant>, now: Instant) -> bool {
    clicked_at.is_some_and(|at| now.saturating_duration_since(at) < BLUR_IGNORE)
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, OPEN_ID, "Open Talos Labs", true, None::<&str>)?;
    let check = MenuItem::with_id(app, CHECK_ID, "Check now", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, PAUSE_ID, "Pause for an hour", true, None::<&str>)?;
    let off = MenuItem::with_id(app, OFF_ID, "Turn the watch off", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit Talos Labs", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &open,
            &check,
            &pause,
            &off,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

/// Creates the tray item with its icon and menu; a second call while it exists does nothing.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let menu = tray_menu(app)?;
    let state = crate::watch::current_state(app);
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_for(Rating::Calm))
        .icon_as_template(true)
        .tooltip(tooltip(&state, Utc::now()))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event: MenuEvent| run_action(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| on_tray_event(tray.app_handle(), event))
        .build(app)?;
    if let Some(tray_state) = app.try_state::<TrayState>() {
        *tray_state
            .shown_rating
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(Rating::Calm);
    }
    hook_notification_tap(app);
    Ok(())
}

fn run_action(app: &AppHandle, id: &str) {
    match menu_action(id) {
        Some(TrayAction::Open) => open_main(app, OpenScreen::Home),
        Some(TrayAction::CheckNow) => crate::watch::request_check_now(app),
        Some(TrayAction::Pause) => crate::watch::pause(app, 60),
        Some(TrayAction::TurnOff) => {
            let _ = crate::watch::set_enabled(app, false);
        }
        None => {}
    }
}

/// A tap on the banner opens the main window on the noticed screen. Hooked once per process.
fn hook_notification_tap(app: &AppHandle) {
    let Some(state) = app.try_state::<TrayState>() else {
        return;
    };
    if state.tap_hooked.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    let _ = app.notification().on_action(move |action| {
        if action.action_id() == TAP_ACTION {
            open_main(&handle, OpenScreen::Noticed);
        }
    });
}

/// Swaps the icon and tooltip for the rating; removes the item when the watch is off and
/// rebuilds it when the watch comes back on.
pub fn set_state(app: &AppHandle, state: &WatchState) {
    if !state.enabled {
        // The status item is torn down on the main thread; the cycle calls this from a worker.
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || drop(handle.remove_tray_by_id(TRAY_ID)));
        if let Some(tray_state) = app.try_state::<TrayState>() {
            *tray_state
                .shown_rating
                .lock()
                .unwrap_or_else(PoisonError::into_inner) = None;
        }
        return;
    }
    if app.tray_by_id(TRAY_ID).is_none() && build(app).is_err() {
        return;
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let unchanged = app.try_state::<TrayState>().is_some_and(|tray_state| {
        let mut shown = tray_state
            .shown_rating
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let same = *shown == Some(state.rating);
        *shown = Some(state.rating);
        same
    });
    if !unchanged {
        let _ = tray.set_icon_with_as_template(Some(icon_for(state.rating)), true);
    }
    let _ = tray.set_tooltip(Some(tooltip(state, Utc::now())));
    size_watch_window(app, state);
}

/// Applies the state's height to the watch window when it differs from the last one applied.
fn size_watch_window(app: &AppHandle, state: &WatchState) {
    let height = window_height(state);
    let changed = app.try_state::<TrayState>().is_none_or(|tray_state| {
        let mut shown = tray_state
            .shown_height
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let same = *shown == Some(height);
        *shown = Some(height);
        !same
    });
    if !changed {
        return;
    }
    if let Some(window) = app.get_webview_window(WATCH_LABEL) {
        let _ = window.set_size(LogicalSize::new(WINDOW_SIZE.width, height));
    }
}

/// One banner titled "Talos Labs", no sound, through tauri-plugin-notification.
pub fn send_notification(app: &AppHandle, body: &str) -> Result<(), String> {
    app.notification()
        .builder()
        .title(NOTIFICATION_TITLE)
        .body(body)
        .show()
        .map_err(|err| err.to_string())
}

/// Regular activation, show and focus main, then emit `watch:open { screen }`.
pub fn open_main(app: &AppHandle, screen: OpenScreen) {
    show_main(app, Some(screen));
}

/// The same with no `watch:open`: the Dock reopen and the second-instance callback.
pub fn open_main_plain(app: &AppHandle) {
    show_main(app, None);
}

/// Every open asks the watch for a full check (spec section 2); the loop's own guards decide
/// when it runs. A window that was hidden also gets `main:shown { screen }`, which is what
/// runs the launch check-up: with the watch on, closing the window hides it, so the webview
/// never remounts and "Check my Mac when I open Talos Labs" would otherwise never fire again.
fn show_main(app: &AppHandle, screen: Option<OpenScreen>) {
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
    let was_hidden = app
        .try_state::<TrayState>()
        .is_some_and(|state| state.main_hidden.swap(false, Ordering::SeqCst));
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        if main.is_minimized().unwrap_or(false) {
            let _ = main.unminimize();
        }
        let _ = main.show();
        let _ = main.set_focus();
    }
    if app.try_state::<crate::watch::WatchStore>().is_some() {
        crate::watch::on_main_open(app);
    }
    if let Some(screen) = screen {
        let _ = app.emit(OPEN_EVENT, OpenPayload { screen });
    }
    if was_hidden {
        let _ = app.emit(
            SHOWN_EVENT,
            OpenPayload {
                screen: screen.unwrap_or(OpenScreen::Home),
            },
        );
    }
}

/// Hides the main window and drops the Dock icon; the process stays for the tray.
pub fn hide_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.hide();
    }
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
    if let Some(state) = app.try_state::<TrayState>() {
        state.main_hidden.store(true, Ordering::SeqCst);
    }
}

/// The watch just went off and the tray item with it: a main window hidden behind the tray is
/// shown again (Dock icon back), and with no main window at all the process ends. Without this
/// "Turn the watch off" from the tray with the window closed would leave a process with no
/// window, no Dock icon, no tray item and no way to quit.
pub fn after_watch_off(app: &AppHandle) {
    let has_main = app.get_webview_window(MAIN_LABEL).is_some();
    let hidden = app
        .try_state::<TrayState>()
        .is_some_and(|state| state.main_hidden.load(Ordering::SeqCst));
    match turn_off_follow_up(has_main, hidden) {
        TurnOffFollowUp::Show => open_main_plain(app),
        TurnOffFollowUp::Exit => app.exit(0),
        TurnOffFollowUp::Nothing => {}
    }
}

/// The second launch's argv and cwd are machine text and are dropped unread.
pub fn on_second_instance(app: &AppHandle, _argv: Vec<String>, _cwd: String) {
    open_main_plain(app);
}

/// The window events lib.rs forwards: main's close with the watch on hides instead; with the
/// watch off it ends the process, since the hidden watch window would otherwise keep it alive;
/// the watch window hides on blur unless the blur is the tray click itself.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match (window.label(), event) {
        (MAIN_LABEL, WindowEvent::CloseRequested { api, .. }) => {
            match close_action(crate::watch::is_enabled(window.app_handle())) {
                CloseAction::Hide => {
                    api.prevent_close();
                    hide_main(window.app_handle());
                }
                CloseAction::Exit => window.app_handle().exit(0),
            }
        }
        (WATCH_LABEL, WindowEvent::Focused(false)) => on_watch_blur(window.app_handle()),
        _ => {}
    }
}

fn last_click(app: &AppHandle) -> Option<Instant> {
    app.try_state::<TrayState>().and_then(|state| {
        *state
            .last_click
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    })
}

fn on_watch_blur(app: &AppHandle) {
    if ignore_blur(last_click(app), Instant::now()) {
        return;
    }
    hide_watch_window(app);
}

fn hide_watch_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WATCH_LABEL) {
        let _ = window.hide();
    }
    if let Some(state) = app.try_state::<TrayState>() {
        state.window_open.store(false, Ordering::SeqCst);
    }
}

fn on_tray_event(app: &AppHandle, event: TrayIconEvent) {
    let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state,
        rect,
        position,
        ..
    } = event
    else {
        return;
    };
    if let Some(state) = app.try_state::<TrayState>() {
        *state
            .last_click
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(Instant::now());
    }
    if button_state == MouseButtonState::Up {
        toggle_watch_window(app, rect, position);
    }
}

fn logical_rect(rect: Rect, scale: f64) -> LogicalRect {
    let position = rect.position.to_logical::<f64>(scale);
    let size = rect.size.to_logical::<f64>(scale);
    LogicalRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    }
}

/// Shows the window under the icon or hides it when it is already up.
fn toggle_watch_window(app: &AppHandle, rect: Rect, position: PhysicalPosition<f64>) {
    let Some(window) = app.get_webview_window(WATCH_LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        hide_watch_window(app);
        return;
    }
    let monitor = app
        .monitor_from_point(position.x, position.y)
        .ok()
        .flatten();
    let scale = monitor.as_ref().map_or(1.0, tauri::Monitor::scale_factor);
    let work_area = monitor.as_ref().map_or(
        LogicalRect {
            x: f64::MIN / 2.0,
            y: f64::MIN / 2.0,
            width: f64::MAX,
            height: f64::MAX,
        },
        |monitor| {
            let area = monitor.work_area();
            let origin = area.position.to_logical::<f64>(scale);
            let size = area.size.to_logical::<f64>(scale);
            LogicalRect {
                x: origin.x,
                y: origin.y,
                width: size.width,
                height: size.height,
            }
        },
    );
    let size = window
        .outer_size()
        .map(|size| size.to_logical::<f64>(scale))
        .unwrap_or(WINDOW_SIZE);
    let _ = window.set_position(place(logical_rect(rect, scale), work_area, size));
    let _ = window.show();
    let _ = window.set_focus();
    if let Some(state) = app.try_state::<TrayState>() {
        state.window_open.store(true, Ordering::SeqCst);
    }
}

/// Registers NSWorkspaceDidWakeNotification on the main thread and calls `watch::on_wake`.
/// The observer lives for the process, so its token is kept.
pub fn observe_wake(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| crate::watch::on_wake(&handle));
        // SAFETY: the name is AppKit's own static, the block outlives the call through the
        // retained token, and the call runs on the main thread.
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceDidWakeNotification),
                None,
                None,
                &block,
            )
        };
        std::mem::forget(token);
        std::mem::forget(block);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> LogicalRect {
        LogicalRect {
            x,
            y,
            width,
            height,
        }
    }

    fn state(rating: Rating, items: usize, last_check_at: Option<&str>) -> WatchState {
        let mut state = WatchState {
            enabled: true,
            first_run: false,
            rating,
            last_check_at: last_check_at.map(str::to_string),
            ..WatchState::default()
        };
        for _ in 0..items {
            state.items.push(crate::watch::WatchItem {
                signal_id: crate::watch::SignalId::PersistenceNew,
                kind: crate::watch::FishyKind::Persistence,
                severity: crate::watch::Severity::High,
                points: 6,
                change: crate::watch::Change::Appeared,
                changed_at: None,
                gated: false,
                snoozed_until: None,
                has_startup_entry: true,
                is_listener: false,
                action_ids: Vec::new(),
                model_sentence: None,
                model_provider: None,
            });
        }
        state
    }

    fn at(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn the_three_rasters_are_36_by_36() {
        for rating in Rating::ALL {
            let image = icon_for(*rating);
            assert_eq!(
                (image.width(), image.height()),
                (36, 36),
                "{}",
                rating.as_str()
            );
            assert_eq!(image.rgba().len(), 36 * 36 * 4, "{}", rating.as_str());
        }
    }

    #[test]
    fn the_rasters_carry_ink_and_transparency() {
        for rating in Rating::ALL {
            let image = icon_for(*rating);
            let rgba = image.rgba();
            let alphas: Vec<u8> = rgba.chunks(4).map(|px| px[3]).collect();
            assert!(
                alphas.contains(&0),
                "{} has no transparent pixel",
                rating.as_str()
            );
            assert!(
                alphas.contains(&255),
                "{} has no opaque pixel",
                rating.as_str()
            );
            let coloured = rgba
                .chunks(4)
                .any(|px| px[3] > 0 && (px[0] > 8 || px[1] > 8 || px[2] > 8));
            assert!(!coloured, "{} has ink that is not black", rating.as_str());
        }
    }

    #[test]
    fn place_centres_under_the_icon() {
        let pos = place(
            rect(1000.0, 0.0, 22.0, 24.0),
            rect(0.0, 0.0, 1512.0, 982.0),
            WINDOW_SIZE,
        );
        assert_eq!(pos, LogicalPosition::new(1011.0 - 160.0, 24.0));
    }

    #[test]
    fn place_clamps_to_the_right_edge() {
        let pos = place(
            rect(1500.0, 0.0, 22.0, 24.0),
            rect(0.0, 0.0, 1512.0, 982.0),
            WINDOW_SIZE,
        );
        assert_eq!(pos, LogicalPosition::new(1512.0 - 320.0, 24.0));
    }

    #[test]
    fn place_clamps_to_the_left_edge_of_a_second_display() {
        let pos = place(
            rect(-1900.0, 0.0, 22.0, 24.0),
            rect(-1920.0, -100.0, 1920.0, 1080.0),
            WINDOW_SIZE,
        );
        assert_eq!(pos, LogicalPosition::new(-1920.0, 24.0));
    }

    #[test]
    fn place_clamps_to_the_bottom_when_the_work_area_is_short() {
        let pos = place(
            rect(100.0, 0.0, 22.0, 24.0),
            rect(0.0, 0.0, 800.0, 300.0),
            WINDOW_SIZE,
        );
        assert_eq!(pos.y, 0.0);
        let pos = place(
            rect(100.0, 0.0, 22.0, 24.0),
            rect(0.0, 0.0, 800.0, 400.0),
            WINDOW_SIZE,
        );
        assert_eq!(pos.y, 24.0);
    }

    #[test]
    fn place_never_leaves_a_work_area_narrower_than_the_window() {
        let pos = place(
            rect(100.0, 0.0, 22.0, 24.0),
            rect(50.0, 0.0, 200.0, 900.0),
            WINDOW_SIZE,
        );
        assert_eq!(pos.x, 50.0);
    }

    #[test]
    fn a_blur_inside_150ms_of_the_click_is_ignored() {
        let now = Instant::now();
        assert!(ignore_blur(Some(now), now));
        assert!(ignore_blur(Some(now), now + Duration::from_millis(149)));
        assert!(!ignore_blur(Some(now), now + Duration::from_millis(150)));
        assert!(!ignore_blur(Some(now), now + Duration::from_secs(2)));
        assert!(!ignore_blur(None, now));
    }

    #[test]
    fn a_blur_before_the_click_counts_as_the_click() {
        let now = Instant::now();
        assert!(ignore_blur(Some(now + Duration::from_millis(10)), now));
    }

    #[test]
    fn checked_ago_rounds_to_five_minutes_then_hours_like_the_window() {
        let now = at("2026-10-17T12:00:00Z");
        assert_eq!(checked_ago(None, now), None);
        assert_eq!(checked_ago(Some("not a time"), now), None);
        assert_eq!(
            checked_ago(Some("2026-10-17T11:59:40Z"), now).as_deref(),
            Some("Checked just now")
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T11:58:00Z"), now).as_deref(),
            Some("Checked just now"),
            "two minutes rounds down"
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T11:57:00Z"), now).as_deref(),
            Some("Checked 5 minutes ago")
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T11:48:00Z"), now).as_deref(),
            Some("Checked 10 minutes ago")
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T11:47:00Z"), now).as_deref(),
            Some("Checked 15 minutes ago")
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T11:00:00Z"), now).as_deref(),
            Some("Checked 60 minutes ago")
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T10:35:00Z"), now).as_deref(),
            Some("Checked 85 minutes ago")
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T10:30:00Z"), now).as_deref(),
            Some("Checked 2 hours ago"),
            "never one hour"
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T09:32:00Z"), now).as_deref(),
            Some("Checked 3 hours ago")
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T08:00:00Z"), now).as_deref(),
            Some("Checked 4 hours ago")
        );
        assert_eq!(
            checked_ago(Some("2026-10-17T13:00:00Z"), now).as_deref(),
            Some("Checked just now")
        );
    }

    #[test]
    fn the_window_height_follows_the_state_and_never_passes_360() {
        let mut first = state(Rating::Calm, 0, None);
        first.first_run = true;
        assert_eq!(window_height(&first), 170.0);
        assert_eq!(
            window_height(&state(Rating::Calm, 0, Some("2026-10-17T11:00:00Z"))),
            150.0
        );
        assert_eq!(window_height(&state(Rating::KeepAnEye, 1, None)), 280.0);
        assert_eq!(window_height(&state(Rating::ActNow, 3, None)), 360.0);
        for rating in Rating::ALL {
            assert!(window_height(&state(*rating, 2, None)) <= WINDOW_SIZE.height);
        }
    }

    #[test]
    fn closing_main_hides_with_the_watch_on_and_exits_with_it_off() {
        assert_eq!(close_action(true), CloseAction::Hide);
        assert_eq!(close_action(false), CloseAction::Exit);
    }

    #[test]
    fn tooltips_follow_the_three_sentences() {
        let now = at("2026-10-17T12:00:00Z");
        assert_eq!(
            tooltip(&state(Rating::Calm, 0, Some("2026-10-17T11:48:00Z")), now),
            "Talos Labs: nothing changed since the last check. Checked 10 minutes ago."
        );
        assert_eq!(
            tooltip(&state(Rating::Calm, 0, None), now),
            "Talos Labs: nothing changed since the last check."
        );
        assert_eq!(
            tooltip(&state(Rating::KeepAnEye, 0, None), now),
            "Talos Labs: something to look at.",
            "no item, no count"
        );
        assert_eq!(
            tooltip(&state(Rating::KeepAnEye, 1, None), now),
            "Talos Labs: one thing to look at."
        );
        assert_eq!(
            tooltip(&state(Rating::KeepAnEye, 3, None), now),
            "Talos Labs: 3 things to look at."
        );
        assert_eq!(
            tooltip(&state(Rating::ActNow, 2, None), now),
            "Talos Labs: act now."
        );
    }

    #[test]
    fn tooltips_carry_no_machine_text() {
        let now = at("2026-10-17T12:00:00Z");
        for rating in Rating::ALL {
            let text = tooltip(&state(*rating, 2, Some("2026-10-17T11:00:00Z")), now);
            assert!(text.starts_with("Talos Labs: "), "{text}");
            assert!(!text.contains('/'), "{text}");
            assert_eq!(text.matches(':').count(), 1, "{text}");
        }
    }

    #[test]
    fn menu_ids_map_to_the_four_tray_actions_and_quit_is_left_to_the_app_menu() {
        assert_eq!(menu_action(OPEN_ID), Some(TrayAction::Open));
        assert_eq!(menu_action(CHECK_ID), Some(TrayAction::CheckNow));
        assert_eq!(menu_action(PAUSE_ID), Some(TrayAction::Pause));
        assert_eq!(menu_action(OFF_ID), Some(TrayAction::TurnOff));
        assert_eq!(menu_action(QUIT_ID), None);
        assert_eq!(menu_action("quit"), None);
        assert_eq!(menu_action(crate::menu::SETTINGS_ID), None);
    }

    #[test]
    fn the_open_payload_is_the_screen_word() {
        let value = serde_json::to_value(OpenPayload {
            screen: OpenScreen::SettingsWatch,
        })
        .unwrap();
        assert_eq!(value, serde_json::json!({ "screen": "settings_watch" }));
    }

    #[test]
    fn the_blur_window_is_150ms() {
        assert_eq!(BLUR_IGNORE, Duration::from_millis(150));
    }

    #[test]
    fn turning_the_watch_off_with_main_hidden_shows_it_and_with_no_main_exits() {
        assert_eq!(turn_off_follow_up(true, true), TurnOffFollowUp::Show);
        assert_eq!(turn_off_follow_up(true, false), TurnOffFollowUp::Nothing);
        assert_eq!(turn_off_follow_up(false, true), TurnOffFollowUp::Exit);
        assert_eq!(turn_off_follow_up(false, false), TurnOffFollowUp::Exit);
        for hidden in [true, false] {
            assert_ne!(
                turn_off_follow_up(false, hidden),
                TurnOffFollowUp::Nothing,
                "no window, no Dock icon and no tray item would be an invisible process"
            );
        }
    }

    #[test]
    fn tray_state_starts_closed_and_unhooked() {
        let state = TrayState::default();
        assert!(!state.window_open.load(Ordering::SeqCst));
        assert!(!state.tap_hooked.load(Ordering::SeqCst));
        assert!(!state.main_hidden.load(Ordering::SeqCst));
        assert_eq!(*state.last_click.lock().unwrap(), None);
        assert_eq!(*state.shown_rating.lock().unwrap(), None);
        assert_eq!(*state.shown_height.lock().unwrap(), None);
    }
}
