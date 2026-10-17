//! The window-label guard: the second layer under Tauri's ACL. Every command takes
//! `window: tauri::Window` and checks the caller's label here; the four watch-window commands
//! accept `watch` or `main`, everything else `main` only.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Callers {
    MainOnly,
    WatchOrMain,
}

pub const MAIN_LABEL: &str = "main";
pub const WATCH_LABEL: &str = "watch";

/// The only app commands the `watch` window may call.
pub const WATCH_WINDOW_COMMANDS: [&str; 4] = [
    "watch_status",
    "watch_check_now",
    "watch_pause",
    "watch_open_main",
];

pub fn allowed(label: &str, callers: Callers) -> bool {
    match callers {
        Callers::MainOnly => label == MAIN_LABEL,
        Callers::WatchOrMain => label == MAIN_LABEL || label == WATCH_LABEL,
    }
}

/// Which set a command name belongs to.
pub fn callers_for(command: &str) -> Callers {
    if WATCH_WINDOW_COMMANDS.contains(&command) {
        Callers::WatchOrMain
    } else {
        Callers::MainOnly
    }
}

pub fn check(window: &tauri::Window, callers: Callers) -> Result<(), String> {
    if allowed(window.label(), callers) {
        Ok(())
    } else {
        Err("forbidden_window".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_listed_command_except_the_four_refuses_the_watch_window() {
        let text =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/commands.txt")).unwrap();
        let names: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        assert!(!names.is_empty());
        for name in &names {
            let callers = callers_for(name);
            let is_watch = WATCH_WINDOW_COMMANDS.contains(name);
            assert_eq!(
                callers,
                if is_watch {
                    Callers::WatchOrMain
                } else {
                    Callers::MainOnly
                },
                "{name}"
            );
            assert_eq!(allowed(WATCH_LABEL, callers), is_watch, "{name}");
            assert!(allowed(MAIN_LABEL, callers), "{name}");
            assert!(!allowed("other", callers), "{name}");
        }
        assert!(!allowed("", Callers::WatchOrMain));
        assert!(!allowed("Main", Callers::MainOnly));
    }
}
