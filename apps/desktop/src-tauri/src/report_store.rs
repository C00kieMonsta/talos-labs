//! The last report in `<app_data>/last-report.json`, mode 0600.

use std::io::Write;
use std::path::{Path, PathBuf};

pub const FILE_NAME: &str = "last-report.json";

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Creates the parent directory and writes the file with owner-only permissions.
pub fn write_private(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut handle = options.open(file)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        handle.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    handle.write_all(bytes)?;
    handle.flush()
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

    #[test]
    fn round_trip_with_private_mode() {
        let dir = std::env::temp_dir().join(format!("talos-report-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
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
}
