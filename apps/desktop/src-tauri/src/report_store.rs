//! The last report in `<app_data>/last-report.json`, mode 0600, written atomically.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub const FILE_NAME: &str = "last-report.json";

/// Distinguishes temp files from concurrent writers in one process.
static WRITE_SEQ: AtomicU64 = AtomicU64::new(0);

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Temp file beside the target so the final rename stays on one filesystem.
fn temp_path(file: &Path) -> PathBuf {
    let name = file
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let seq = WRITE_SEQ.fetch_add(1, Ordering::SeqCst);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    file.with_file_name(format!(".{name}.{}-{seq}-{nanos}.tmp", std::process::id()))
}

/// Creates the parent directory and writes the file with owner-only permissions.
/// The bytes go to a temp file first and the rename is atomic, so a reader sees the old file or
/// the new one, never a partial write, and a crash leaves at most a stray temp file.
pub fn write_private(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = temp_path(file);
    let result = write_temp(&temp, bytes).and_then(|()| std::fs::rename(&temp, file));
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn write_temp(temp: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut handle = options.open(temp)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        handle.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    handle.write_all(bytes)?;
    handle.flush()?;
    handle.sync_all()
}

pub fn save_last(dir: &Path, report: &serde_json::Value) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(report).map_err(std::io::Error::other)?;
    write_private(&path(dir), &bytes)
}

/// None when there is no report yet or the file does not parse.
pub fn load_last(dir: &Path) -> std::io::Result<Option<serde_json::Value>> {
    match std::fs::read(path(dir)) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("talos-report-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn round_trip_with_private_mode() {
        let dir = scratch_dir("roundtrip");
        assert_eq!(load_last(&dir).unwrap(), None);
        let report = serde_json::json!({ "schemaVersion": 1, "reportId": "r1" });
        save_last(&dir, &report).unwrap();
        assert_eq!(load_last(&dir).unwrap(), Some(report));
        let mode = std::fs::metadata(path(&dir)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        std::fs::write(path(&dir), b"{ not json").unwrap();
        assert_eq!(load_last(&dir).unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_save_leaves_only_the_report_behind() {
        let dir = scratch_dir("clean");
        save_last(&dir, &serde_json::json!({ "reportId": "r1" })).unwrap();
        save_last(&dir, &serde_json::json!({ "reportId": "r2" })).unwrap();
        assert_eq!(entries(&dir), [FILE_NAME]);
        assert_eq!(
            load_last(&dir).unwrap(),
            Some(serde_json::json!({ "reportId": "r2" }))
        );
        let mode = std::fs::metadata(path(&dir)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_rename_keeps_the_old_file_and_no_temp() {
        let dir = scratch_dir("failed");
        let first = serde_json::json!({ "reportId": "r1" });
        save_last(&dir, &first).unwrap();
        // A directory in the way makes the rename fail after the temp file was written.
        let blocker = dir.join("blocked.json");
        std::fs::create_dir_all(&blocker).unwrap();
        std::fs::write(blocker.join("keep"), b"x").unwrap();
        assert!(write_private(&blocker, b"{}").is_err());
        assert_eq!(entries(&dir), ["blocked.json", FILE_NAME]);
        assert_eq!(load_last(&dir).unwrap(), Some(first));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn temp_names_differ_between_writes() {
        let file = Path::new("/tmp/x/last-report.json");
        let a = temp_path(file);
        let b = temp_path(file);
        assert_ne!(a, b);
        assert_eq!(a.parent(), file.parent());
        let name = a.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            name.starts_with(".last-report.json.") && name.ends_with(".tmp"),
            "{name}"
        );
    }
}
