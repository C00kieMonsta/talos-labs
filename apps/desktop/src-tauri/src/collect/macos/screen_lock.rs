//! Screen lock delay from `sysadminctl -screenLock status` (stderr) and the screensaver idle time.

use std::sync::atomic::AtomicBool;
use std::sync::LazyLock;

use regex::Regex;

use super::{check_exit, defaults, lit, run};
use crate::collect::{to_section, Fail};
use crate::exec::Bin;
use crate::state::{IdleSeconds, ScreenLock, Section};

static DELAY_RE: LazyLock<Regex> = LazyLock::new(|| lit(r"screenLock delay is (\d+) (second|minute|hour)"));

/// (requirePassword, delaySeconds) from the sysadminctl status line.
pub fn parse_screen_lock(text: &str) -> Result<(bool, Option<u64>), Fail> {
    if text.contains("screenLock is off") {
        return Ok((false, None));
    }
    if text.contains("screenLock delay is immediate") {
        return Ok((true, Some(0)));
    }
    if let Some(caps) = DELAY_RE.captures(text) {
        let n: u64 = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
        let unit = caps.get(2).map_or("second", |m| m.as_str());
        let seconds = match unit {
            "minute" => n.saturating_mul(60),
            "hour" => n.saturating_mul(3600),
            _ => n,
        };
        return Ok((true, Some(seconds)));
    }
    Err(Fail::parse("sysadminctl"))
}

/// Missing key or domain gives "unset" (OS default, 20 minutes).
pub fn parse_idle_time(value: Option<&str>) -> IdleSeconds {
    value
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map_or(IdleSeconds::Unset, IdleSeconds::Seconds)
}

fn inner(cancel: &AtomicBool) -> Result<ScreenLock, Fail> {
    let out = run(Bin::Sysadminctl, &["-screenLock", "status"], cancel)?;
    // sysadminctl answers on stderr, so only a silent failure is a tool failure.
    if out.stderr.trim().is_empty() {
        check_exit(&out, Bin::Sysadminctl)?;
    }
    let (require_password, delay_seconds) = parse_screen_lock(&format!("{}\n{}", out.stderr, out.stdout))?;
    let idle = defaults::read_current_host_key("com.apple.screensaver", "idleTime", "screensaver", cancel)?;
    Ok(ScreenLock { require_password, delay_seconds, screensaver_idle_seconds: parse_idle_time(idle.as_deref()) })
}

pub fn collect(cancel: &AtomicBool) -> Section<ScreenLock> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parses_captured_immediate() {
        let text = include_str!("../../../tests/fixtures/sysadminctl.txt");
        assert_eq!(parse_screen_lock(text).unwrap(), (true, Some(0)));
    }

    #[test]
    fn parses_seconds_and_off() {
        let seconds = "2026-10-15 12:52:14.258 sysadminctl[73292:8798281] screenLock delay is 5 seconds\n";
        assert_eq!(parse_screen_lock(seconds).unwrap(), (true, Some(5)));
        let minutes = "2026-10-15 12:52:14.258 sysadminctl[1:1] screenLock delay is 15 minutes\n";
        assert_eq!(parse_screen_lock(minutes).unwrap(), (true, Some(900)));
        let off = "2026-10-15 12:52:14.258 sysadminctl[73292:8798281] screenLock is off\n";
        assert_eq!(parse_screen_lock(off).unwrap(), (false, None));
        assert!(parse_screen_lock("").is_err());
    }

    #[test]
    fn idle_time_defaults_to_unset() {
        assert_eq!(parse_idle_time(None), IdleSeconds::Unset);
        assert_eq!(parse_idle_time(Some("1200\n")), IdleSeconds::Seconds(1200));
        assert_eq!(parse_idle_time(Some("garbage")), IdleSeconds::Unset);
    }
}
