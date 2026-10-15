//! The raw licence key string in `<app_data>/license.key`, mode 0600.

use std::path::{Path, PathBuf};

pub const FILE_NAME: &str = "license.key";

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

pub fn read(dir: &Path) -> std::io::Result<Option<String>> {
    match std::fs::read_to_string(path(dir)) {
        Ok(text) => {
            let trimmed = text.trim();
            Ok(if trimmed.is_empty() { None } else { Some(trimmed.to_owned()) })
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

pub fn write(dir: &Path, key: &str) -> std::io::Result<()> {
    crate::report_store::write_private(&path(dir), key.trim().as_bytes())
}

pub fn delete(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path(dir)) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
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
        let dir = std::env::temp_dir().join(format!("talos-license-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(read(&dir).unwrap(), None);
        write(&dir, "TL1.abc.def\n").unwrap();
        assert_eq!(read(&dir).unwrap().as_deref(), Some("TL1.abc.def"));
        let mode = std::fs::metadata(path(&dir)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        delete(&dir).unwrap();
        assert_eq!(read(&dir).unwrap(), None);
        delete(&dir).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
