//! The menu bar item, the watch window placement and the main-window activation
//! (docs/DESIGN-WATCH.md section 5). The item is built and changed from Rust only; no webview
//! can reach it. Nothing here may print: tests/ai_no_logging.rs covers this file.

use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use block2::RcBlock;
use chrono::{DateTime, Local, Utc};
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

use crate::watch::{ModelProvider, OpenScreen, Rating, WatchState};

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

/// The configured size of the watch window (tauri.conf.json), used only when the runtime
/// cannot report the outer size; the state's own height is `window_height`.
const WINDOW_SIZE: LogicalSize<f64> = LogicalSize {
    width: 320.0,
    height: 360.0,
};

/// The most a state may ask for (DESIGN-WATCH-WINDOW section 2, "Heights"). The act state with
/// the reason line and an unreadable area would be 424.
pub const MAX_WINDOW_HEIGHT: f64 = 420.0;

const PADDING: f64 = 32.0;
const GAP: f64 = 8.0;

/// The row budgets of the window, in px, in draw order; a row of 0 is not drawn. Mirrored by
/// `apps/desktop/src/watch/height.ts` and pinned by `watch-cases.json`'s `heights`.
pub fn rows_for(state: &WatchState) -> Vec<f64> {
    const STATUS: f64 = 24.0;
    const FOOTER: f64 = 32.0;
    if state.first_run {
        return vec![58.0, 32.0, 32.0];
    }
    let checked = state.checking || state.last_check_at.is_some();
    let unavailable = state.unavailable.len();
    // The line the window draws: about the shown rating, and never On this Mac on calm. The
    // Apple badge wraps to a second line, so its row is one line taller.
    let reason_row = |rating: Rating| -> f64 {
        match state.judge.as_ref() {
            Some(judge)
                if judge.rating == rating
                    && !(rating == Rating::Calm && judge.provider == ModelProvider::Apple) =>
            {
                if judge.provider == ModelProvider::Apple {
                    90.0
                } else {
                    72.0
                }
            }
            _ => 0.0,
        }
    };
    if state.paused_until.is_some() {
        // The meta line is look's: the unreadable count wraps it to a second line.
        let meta = if checked {
            if unavailable > 0 { 40.0 } else { 20.0 }
        } else {
            0.0
        };
        return vec![STATUS, meta, 20.0, FOOTER]
            .into_iter()
            .filter(|row| *row > 0.0)
            .collect();
    }
    let rows: Vec<f64> = match state.rating {
        Rating::Calm => {
            let meta = if state.checking {
                20.0
            } else {
                (if state.last_check_at.is_some() {
                    20.0
                } else {
                    0.0
                }) + 20.0
            };
            let unreadable = match unavailable {
                0 => 0.0,
                1 => 40.0,
                _ => 60.0,
            };
            let reason = reason_row(Rating::Calm);
            let sentence = if reason > 0.0 { reason } else { 20.0 };
            let up_next = match (&state.report, &state.next) {
                (Some(report), Some(next)) if next.report_id == report.report_id => 28.0,
                _ => 0.0,
            };
            let checkup = 20.0 + up_next;
            // The ask field. The Connect line (DESIGN-WATCH-WINDOW section 2, "AI not connected")
            // is drawn from the window's own localStorage read, which no pushed `ai` shape carries
            // today, so no row is sized for it: a `provider` of None is a Developer provider.
            let row5 = if state.ai.enabled { 44.0 } else { 0.0 };
            vec![STATUS, meta, unreadable, sentence, checkup, row5, FOOTER]
        }
        Rating::KeepAnEye => {
            let meta = if checked {
                if unavailable > 0 { 40.0 } else { 20.0 }
            } else {
                0.0
            };
            let body = if state.items.is_empty() { 20.0 } else { 92.0 };
            let reason = reason_row(Rating::KeepAnEye);
            let ask_link = if state.ai.enabled { 32.0 } else { 0.0 };
            vec![STATUS, meta, body, reason, 44.0, ask_link, FOOTER]
        }
        Rating::ActNow => {
            let meta = if checked {
                if unavailable > 0 { 40.0 } else { 20.0 }
            } else {
                0.0
            };
            let reason = reason_row(Rating::ActNow);
            if state.items.is_empty() {
                vec![STATUS, meta, 20.0, reason, FOOTER]
            } else {
                vec![STATUS, meta, 92.0, 40.0, 44.0, reason, FOOTER]
            }
        }
    };
    rows.into_iter().filter(|row| *row > 0.0).collect()
}

/// Height to content: 16 px above and below, the rows present and 8 px between every two,
/// capped at `MAX_WINDOW_HEIGHT`. The window is sized from Rust before it is shown, so a calm
/// window is not a 360 px box with an empty middle; the QA harness checks each state's content
/// against the same sum in TypeScript.
pub fn window_height(state: &WatchState) -> f64 {
    let rows = rows_for(state);
    let gaps = rows.len().saturating_sub(1) as f64;
    let sum: f64 = rows.iter().sum();
    f64::min(MAX_WINDOW_HEIGHT, PADDING + sum + GAP * gaps)
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

/// The payload of `watch:open` and `main:shown`. The question travels with `chat` opens only,
/// as the composer's draft; it is never logged and `main:shown` never carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpenPayload {
    pub screen: OpenScreen,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
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

/// What closing the main window does: hide behind the tray while the watch is active (switched
/// on and licensed), else quit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    Hide,
    Exit,
}

pub fn close_action(watch_active: bool) -> CloseAction {
    if watch_active {
        CloseAction::Hide
    } else {
        CloseAction::Exit
    }
}

/// "15:30" in local time for an RFC 3339 instant; None when it does not parse.
fn local_clock(text: &str) -> Option<String> {
    let at = DateTime::parse_from_rfc3339(text).ok()?;
    Some(at.with_timezone(&Local).format("%H:%M").to_string())
}

/// The tooltip for a state: the paused form first, then the spec's rating sentences.
pub fn tooltip(state: &WatchState, now: DateTime<Utc>) -> String {
    if let Some(until) = state.paused_until.as_deref().and_then(local_clock) {
        return format!("Talos Labs: paused until {until}.");
    }
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

/// Creates the tray item with its icon and menu; a second call while it exists does nothing,
/// and an inactive watch (switched off or unlicensed) gets no item.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    if !crate::watch::is_active(app) || app.tray_by_id(TRAY_ID).is_some() {
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
        Some(TrayAction::Open) => open_main(app, OpenScreen::Home, None),
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
            open_main(&handle, OpenScreen::Noticed, None);
        }
    });
}

/// Swaps the icon and tooltip for the rating; removes the item when the watch is inactive
/// (switched off or unlicensed) and rebuilds it when both flags come back.
pub fn set_state(app: &AppHandle, state: &WatchState) {
    if !(state.enabled && state.licensed) {
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
    if app.tray_by_id(TRAY_ID).is_none() {
        // tray-icon creates the item only on the main thread; the cycle and the Settings command
        // reach here from workers, so the rebuild is queued there and the state applied after it.
        let handle = app.clone();
        let state = state.clone();
        let _ = app.run_on_main_thread(move || {
            if build(&handle).is_ok() {
                apply_state(&handle, &state);
            }
        });
        return;
    }
    apply_state(app, state);
}

/// The icon, tooltip and window height for a state, on an item that exists.
fn apply_state(app: &AppHandle, state: &WatchState) {
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

/// Regular activation, show and focus main, then emit `watch:open { screen, question? }`.
pub fn open_main(app: &AppHandle, screen: OpenScreen, question: Option<String>) {
    show_main(app, Some(screen), question);
}

/// The same with no `watch:open`: the Dock reopen and the second-instance callback.
pub fn open_main_plain(app: &AppHandle) {
    show_main(app, None, None);
}

/// Every open asks the watch for a full check (spec section 2); the loop's own guards decide
/// when it runs. A window that was hidden also gets `main:shown { screen }`, which is what
/// runs the launch check-up: with the watch on, closing the window hides it, so the webview
/// never remounts and "Check my Mac when I open Talos Labs" would otherwise never fire again.
fn show_main(app: &AppHandle, screen: Option<OpenScreen>, question: Option<String>) {
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
        let _ = app.emit(OPEN_EVENT, OpenPayload { screen, question });
    }
    if was_hidden {
        let _ = app.emit(
            SHOWN_EVENT,
            OpenPayload {
                screen: screen.unwrap_or(OpenScreen::Home),
                question: None,
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

/// The window events lib.rs forwards: main's close with the watch active hides instead; with the
/// watch inactive it ends the process, since the hidden watch window would otherwise keep it alive;
/// the watch window hides on blur unless the blur is the tray click itself.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match (window.label(), event) {
        (MAIN_LABEL, WindowEvent::CloseRequested { api, .. }) => {
            match close_action(crate::watch::is_active(window.app_handle())) {
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
    // The click position is physical, and monitor_from_point compares in points, so match the
    // monitor by its physical rect. A miss falls back to the primary display, never to scale 1.
    let monitor = app
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|monitor| {
                let origin = monitor.position();
                let size = monitor.size();
                position.x >= f64::from(origin.x)
                    && position.x < f64::from(origin.x) + f64::from(size.width)
                    && position.y >= f64::from(origin.y)
                    && position.y < f64::from(origin.y) + f64::from(size.height)
            })
        })
        .or_else(|| app.primary_monitor().ok().flatten());
    let scale = monitor.as_ref().map_or(2.0, tauri::Monitor::scale_factor);
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

    use crate::watch::settings::WatchAi;
    use crate::watch::{
        Grade, JudgeLine, ModelProvider, NextKind, NextRow, ProbeId, ProbeReason, ReportRow,
        RulesSince, UnavailableProbe,
    };

    fn judge(rating: Rating) -> JudgeLine {
        JudgeLine {
            provider: ModelProvider::Chatgpt,
            at: "2026-10-17T11:48:00.000Z".into(),
            rating,
            reason: "The one thing still open is your unlocked disk.".into(),
        }
    }

    fn report() -> ReportRow {
        ReportRow {
            report_id: "demo-report".into(),
            scanned_at: "2026-10-17T10:00:00.000Z".into(),
            score: Some(72),
            grade: Some(Grade::Fair),
        }
    }

    fn next() -> NextRow {
        NextRow {
            report_id: "demo-report".into(),
            rule_id: "TL-MAC-001".into(),
            kind: NextKind::Fix,
        }
    }

    fn unavailable(n: usize) -> Vec<UnavailableProbe> {
        [
            ProbeId::Listeners,
            ProbeId::RemoteAccess,
            ProbeId::FileSharing,
        ]
        .into_iter()
        .take(n)
        .map(|probe_id| UnavailableProbe {
            probe_id,
            reason: ProbeReason::UnsignedBuild,
        })
        .collect()
    }

    const CHECKED: Option<&str> = Some("2026-10-17T11:48:00Z");

    fn ai(enabled: bool, provider: Option<ModelProvider>) -> WatchAi {
        WatchAi { enabled, provider }
    }

    /// A calm window as the demo draws it: checked, the judge line, the report, the next step
    /// and the field.
    fn calm_full() -> WatchState {
        let mut s = state(Rating::Calm, 0, CHECKED);
        s.ai = ai(true, Some(ModelProvider::Chatgpt));
        s.judge = Some(judge(Rating::Calm));
        s.report = Some(report());
        s.next = Some(next());
        s
    }

    fn look_full(items: usize) -> WatchState {
        let mut s = state(Rating::KeepAnEye, items, CHECKED);
        s.ai = ai(true, Some(ModelProvider::Chatgpt));
        s.judge = Some(judge(Rating::KeepAnEye));
        s
    }

    fn act_full(reason: bool) -> WatchState {
        let mut s = state(Rating::ActNow, 3, CHECKED);
        s.ai = ai(true, Some(ModelProvider::Chatgpt));
        s.judge = reason.then(|| judge(Rating::ActNow));
        s
    }

    #[test]
    fn the_window_height_is_the_row_sum_of_the_named_cases() {
        let mut first = state(Rating::Calm, 0, None);
        first.first_run = true;
        assert_eq!(window_height(&first), 170.0, "first run");
        assert_eq!(rows_for(&first), vec![58.0, 32.0, 32.0]);

        let mut paused = state(Rating::Calm, 0, CHECKED);
        paused.paused_until = Some("2026-10-17T13:00:00.000Z".into());
        assert_eq!(window_height(&paused), 152.0, "paused");
        let mut paused_act = act_full(true);
        paused_act.paused_until = Some("2026-10-17T13:00:00.000Z".into());
        assert_eq!(
            window_height(&paused_act),
            152.0,
            "a paused window is about the pause, whatever the rating"
        );
        let mut paused_unreadable = state(Rating::Calm, 0, CHECKED);
        paused_unreadable.paused_until = Some("2026-10-17T13:00:00.000Z".into());
        paused_unreadable.unavailable = unavailable(1);
        assert_eq!(
            window_height(&paused_unreadable),
            172.0,
            "paused: the unreadable count wraps the meta line to 40"
        );
        assert_eq!(rows_for(&paused_unreadable), vec![24.0, 40.0, 20.0, 32.0]);

        assert_eq!(
            window_height(&calm_full()),
            332.0,
            "calm: judge, score, next, field"
        );
        let mut authored = calm_full();
        authored.judge = None;
        assert_eq!(window_height(&authored), 280.0, "calm: authored line");
        let mut unreadable = calm_full();
        unreadable.unavailable = unavailable(3);
        assert_eq!(
            window_height(&unreadable),
            400.0,
            "calm: three unreadable probes + judge"
        );
        let mut one = calm_full();
        one.unavailable = unavailable(1);
        assert_eq!(
            window_height(&one),
            380.0,
            "calm: one unreadable probe + judge"
        );
        let mut two = calm_full();
        two.unavailable = unavailable(2);
        assert_eq!(window_height(&two), 400.0, "two probes read as several");
        let mut no_provider = calm_full();
        no_provider.ai = ai(false, None);
        no_provider.judge = None;
        assert_eq!(
            window_height(&no_provider),
            228.0,
            "calm: no provider (a Developer one) sizes no row 5"
        );
        let mut apple_calm = calm_full();
        apple_calm.ai = ai(true, Some(ModelProvider::Apple));
        apple_calm.judge = Some(JudgeLine {
            provider: ModelProvider::Apple,
            ..judge(Rating::Calm)
        });
        assert_eq!(
            window_height(&apple_calm),
            280.0,
            "calm: an On this Mac line is hidden, the authored line stands"
        );
        let mut off = calm_full();
        off.ai = ai(false, Some(ModelProvider::Chatgpt));
        off.judge = None;
        assert_eq!(
            window_height(&off),
            228.0,
            "calm: AI off with a provider chosen"
        );
        let mut no_report = calm_full();
        no_report.judge = None;
        no_report.report = None;
        no_report.next = None;
        assert_eq!(window_height(&no_report), 252.0, "calm: no report yet");
        let mut foreign_next = calm_full();
        foreign_next.next = Some(NextRow {
            report_id: "older-report".into(),
            ..next()
        });
        assert_eq!(
            window_height(&foreign_next),
            304.0,
            "a next step from another report draws no Up next"
        );
        let mut checking = calm_full();
        checking.checking = true;
        assert_eq!(
            window_height(&checking),
            312.0,
            "while checking the meta is one line"
        );
        let mut unchecked = calm_full();
        unchecked.last_check_at = None;
        assert_eq!(
            window_height(&unchecked),
            312.0,
            "never checked: the next-check line only"
        );

        assert_eq!(window_height(&look_full(1)), 396.0, "look: reason + link");
        let mut no_link = look_full(1);
        no_link.ai = ai(false, Some(ModelProvider::Chatgpt));
        assert_eq!(window_height(&no_link), 356.0, "look: reason, no link");
        let mut no_reason = look_full(1);
        no_reason.judge = None;
        assert_eq!(window_height(&no_reason), 316.0, "look: link only");
        let mut neither = look_full(1);
        neither.judge = None;
        neither.ai = ai(false, Some(ModelProvider::Chatgpt));
        assert_eq!(window_height(&neither), 276.0, "look: neither");
        let mut empty = look_full(0);
        empty.rules_since = Some(RulesSince {
            report_id: "demo-report".into(),
            appeared: 1,
        });
        assert_eq!(window_height(&empty), 324.0, "look-empty: reason + link");
        let mut look_unreadable = look_full(1);
        look_unreadable.unavailable = unavailable(1);
        assert_eq!(
            window_height(&look_unreadable),
            416.0,
            "look meta is 40 with an unreadable area"
        );
        let mut look_apple = look_full(1);
        look_apple.ai = ai(true, Some(ModelProvider::Apple));
        look_apple.judge = Some(JudgeLine {
            provider: ModelProvider::Apple,
            ..judge(Rating::KeepAnEye)
        });
        assert_eq!(
            window_height(&look_apple),
            414.0,
            "look: the Apple badge wraps, so the reason row is 90"
        );
        let mut act_apple = act_full(true);
        act_apple.ai = ai(true, Some(ModelProvider::Apple));
        act_apple.judge = Some(JudgeLine {
            provider: ModelProvider::Apple,
            ..judge(Rating::ActNow)
        });
        assert_eq!(
            window_height(&act_apple),
            420.0,
            "act: the Apple reason row is capped from 422"
        );
        let mut mismatched = look_full(1);
        mismatched.judge = Some(judge(Rating::Calm));
        assert_eq!(
            window_height(&mismatched),
            316.0,
            "a judge line for another rating is not drawn"
        );

        assert_eq!(window_height(&act_full(true)), 404.0, "act: reason");
        assert_eq!(window_height(&act_full(false)), 324.0, "act");
        let mut capped = act_full(true);
        capped.unavailable = unavailable(1);
        assert_eq!(
            window_height(&capped),
            420.0,
            "act: reason + unreadable, capped from 424"
        );
        let mut act_empty = act_full(true);
        act_empty.items.clear();
        assert_eq!(
            window_height(&act_empty),
            232.0,
            "act with no item: the look-empty line"
        );
    }

    #[test]
    fn the_window_height_never_passes_420() {
        for rating in Rating::ALL {
            let mut s = state(*rating, 3, CHECKED);
            s.ai = ai(true, Some(ModelProvider::Chatgpt));
            s.judge = Some(judge(*rating));
            s.unavailable = unavailable(3);
            s.report = Some(report());
            s.next = Some(next());
            assert!(
                window_height(&s) <= MAX_WINDOW_HEIGHT,
                "{}",
                rating.as_str()
            );
        }
        assert_eq!(MAX_WINDOW_HEIGHT, 420.0);
        assert_eq!(
            WINDOW_SIZE.height, 360.0,
            "the config's pre-show size is unchanged"
        );
    }

    #[test]
    fn closing_main_hides_with_the_watch_active_and_exits_with_it_inactive() {
        assert_eq!(close_action(true), CloseAction::Hide);
        assert_eq!(
            close_action(false),
            CloseAction::Exit,
            "switched off or unlicensed: no tray item, so the process ends"
        );
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
            question: None,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "screen": "settings_watch" }),
            "no question key when there is none"
        );
        let value = serde_json::to_value(OpenPayload {
            screen: OpenScreen::Chat,
            question: Some("What changed?".into()),
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "screen": "chat", "question": "What changed?" })
        );
    }

    #[test]
    fn the_paused_tooltip_names_the_local_time_and_falls_back_on_a_bad_one() {
        let now = at("2026-10-17T12:00:00Z");
        let mut paused = state(Rating::ActNow, 2, CHECKED);
        paused.paused_until = Some("2026-10-17T13:30:00.000Z".into());
        let text = tooltip(&paused, now);
        assert!(text.starts_with("Talos Labs: paused until "), "{text}");
        let tail = text.trim_start_matches("Talos Labs: paused until ");
        let bytes = tail.as_bytes();
        assert_eq!(bytes.len(), 6, "{text}");
        assert!(
            bytes[0].is_ascii_digit()
                && bytes[1].is_ascii_digit()
                && bytes[2] == b':'
                && bytes[3].is_ascii_digit()
                && bytes[4].is_ascii_digit()
                && bytes[5] == b'.',
            "{text}"
        );
        let expected = DateTime::parse_from_rfc3339("2026-10-17T13:30:00.000Z")
            .unwrap()
            .with_timezone(&Local)
            .format("%H:%M")
            .to_string();
        assert_eq!(text, format!("Talos Labs: paused until {expected}."));
        paused.paused_until = Some("soon".into());
        assert_eq!(
            tooltip(&paused, now),
            "Talos Labs: act now.",
            "an unreadable time falls back to the rating form"
        );
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
