//! Time Machine state from `tmutil destinationinfo`, `tmutil latestbackup` and, when the disk is not
//! mounted, the `Destinations` key of the Time Machine preference domain.

use std::sync::atomic::AtomicBool;
use std::sync::LazyLock;

use chrono::TimeZone;
use regex::Regex;

use super::{defaults, lit, run};
use crate::collect::{to_section, Fail};
use crate::exec::Bin;
use crate::state::{Backup, BackupMethod, Section};

/// The plist itself is TCC-protected; `defaults read` goes through cfprefsd and works without Full Disk Access.
pub const TIME_MACHINE_DOMAIN: &str = "/Library/Preferences/com.apple.TimeMachine";

static ID_LINE_RE: LazyLock<Regex> = LazyLock::new(|| lit(r"(?m)^ID\s*:"));
static BACKUP_STAMP_RE: LazyLock<Regex> = LazyLock::new(|| lit(r"(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})"));

/// One `ID :` line per destination.
pub fn parse_destination_count(text: &str) -> u64 {
    ID_LINE_RE.find_iter(text).count() as u64
}

/// Backup folder names carry a local timestamp `YYYY-MM-DD-HHMMSS`.
pub fn backup_timestamp_to_iso(text: &str) -> Option<String> {
    let caps = BACKUP_STAMP_RE.captures(text)?;
    let num = |i: usize| caps.get(i).and_then(|m| m.as_str().parse::<u32>().ok());
    let date = chrono::NaiveDate::from_ymd_opt(num(1)? as i32, num(2)?, num(3)?)?;
    let naive = date.and_hms_opt(num(4)?, num(5)?, num(6)?)?;
    let local = chrono::Local.from_local_datetime(&naive).single()?;
    Some(local.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

/// (destinationReachable, lastBackupAt) from `tmutil latestbackup`.
pub fn parse_latest_backup(stdout: &str, stderr: &str) -> (bool, Option<String>) {
    if stderr.contains("Failed to mount backup destination") {
        return (false, None);
    }
    (true, backup_timestamp_to_iso(stdout))
}

/// Newest date across every `SnapshotDates` array in the `Destinations` dump, as RFC 3339 UTC.
/// `AttemptDates` and `LastBackupActivity` record attempts, not completed backups, and are ignored.
pub fn latest_snapshot_date(destinations: &str) -> Option<String> {
    let mut inside = false;
    let mut newest: Option<String> = None;
    for raw in destinations.lines() {
        let line = raw.trim();
        if inside {
            if line.starts_with(')') {
                inside = false;
                continue;
            }
            let value = defaults::unquote(line.trim_end_matches(','));
            if let Some(iso) = defaults::date_to_iso(&value)
                && newest.as_ref().is_none_or(|n| &iso > n)
            {
                newest = Some(iso);
            }
        } else if let Some((key, rest)) = line.split_once('=')
            && key.trim() == "SnapshotDates"
            && rest.trim() == "("
        {
            inside = true;
        }
    }
    newest
}

fn inner(cancel: &AtomicBool) -> Result<Backup, Fail> {
    let info = run(Bin::Tmutil, &["destinationinfo"], cancel)?;
    let destination_count = parse_destination_count(&info.stdout);
    if destination_count == 0 {
        return Ok(Backup {
            method: BackupMethod::TimeMachine,
            configured: false,
            destination_count: 0,
            destination_reachable: None,
            last_backup_at: None,
        });
    }
    let latest = run(Bin::Tmutil, &["latestbackup"], cancel)?;
    let (reachable, mut last_backup_at) = parse_latest_backup(&latest.stdout, &latest.stderr);
    if !reachable {
        // The preference domain keeps the completed snapshot dates while the disk is unplugged.
        let destinations = defaults::read_key(TIME_MACHINE_DOMAIN, "Destinations", "TimeMachine Destinations", cancel)?;
        last_backup_at = destinations.as_deref().and_then(latest_snapshot_date);
    }
    Ok(Backup {
        method: BackupMethod::TimeMachine,
        configured: true,
        destination_count,
        destination_reachable: Some(reachable),
        last_backup_at,
    })
}

pub fn collect(cancel: &AtomicBool) -> Section<Backup> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn counts_captured_destination() {
        let text = include_str!("../../../tests/fixtures/tmutil-destinationinfo.txt");
        assert_eq!(parse_destination_count(text), 1);
        assert_eq!(parse_destination_count("No destinations configured.\n"), 0);
        assert_eq!(parse_destination_count(""), 0);
        let two = "====\nName : A\nKind : Local\nID   : 1\n====\nName : B\nKind : Network\nID   : 2\n";
        assert_eq!(parse_destination_count(two), 2);
    }

    #[test]
    fn failed_to_mount_means_unreachable() {
        let stderr = include_str!("../../../tests/fixtures/tmutil-latestbackup-stderr.txt");
        assert_eq!(parse_latest_backup("", stderr), (false, None));
    }

    #[test]
    fn snapshot_dates_give_the_newest_completed_backup() {
        let text = include_str!("../../../tests/fixtures/timemachine-destinations.txt");
        assert_eq!(latest_snapshot_date(text).as_deref(), Some("2025-12-26T20:02:44.000Z"), "attempt dates in 2026 are not backups");
        let two = "(\n        {\n        SnapshotDates =         (\n            \"2025-12-26 20:02:44 +0000\",\n            \"2026-01-03 10:00:00 +0100\"\n        );\n    },\n        {\n        AttemptDates =         (\n            \"2026-07-29 22:06:10 +0000\"\n        );\n        SnapshotDates =         (\n            \"2026-02-01 08:30:00 +0000\"\n        );\n    }\n)\n";
        assert_eq!(latest_snapshot_date(two).as_deref(), Some("2026-02-01T08:30:00.000Z"));
        let none = "(\n        {\n        AttemptDates =         (\n            \"2026-07-29 22:06:10 +0000\"\n        );\n        SnapshotDates =         (\n        );\n    }\n)\n";
        assert_eq!(latest_snapshot_date(none), None, "an empty list keeps the outcome indeterminate");
        assert_eq!(latest_snapshot_date(""), None);
        assert_eq!(latest_snapshot_date("(\n)\n"), None);
    }

    #[test]
    fn latest_backup_path_gives_timestamp() {
        let (reachable, at) = parse_latest_backup("/Volumes/Backup/Backups.backupdb/Mac/2026-10-15-120000\n", "");
        assert!(reachable);
        let at = at.unwrap();
        assert!(at.starts_with("2026-10-1"), "{at}");
        assert!(at.ends_with('Z'));
        assert_eq!(parse_latest_backup("\n", ""), (true, None));
    }
}
