//! "Reveal in Finder" for 023, 024 and 031. The chosen path must come from a fresh listing of our own.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use super::inputs::check_slot;
use super::{FixChoice, FixError};

/// Rules that reveal a plist from the persistence scan.
pub const PLIST_RULES: [&str; 2] = ["TL-MAC-023", "TL-MAC-024"];
/// Rules that reveal a file from the dotfile scan.
pub const FILE_RULES: [&str; 1] = ["TL-MAC-031"];

/// Picks the path out of `candidates` that equals the choice exactly.
pub fn match_path(chosen: &str, candidates: &[String]) -> Result<PathBuf, FixError> {
    check_slot(chosen).map_err(|_| FixError::InvalidChoice)?;
    candidates
        .iter()
        .find(|c| c.as_str() == chosen)
        .map(PathBuf::from)
        .ok_or(FixError::InvalidChoice)
}

/// Every plist path of a fresh persistence scan; the watch catalogue binds against it too.
#[cfg(target_os = "macos")]
pub(crate) fn fresh_plists() -> Vec<String> {
    use crate::collect::macos::persistence;
    persistence::collect(&AtomicBool::new(false))
        .as_ok()
        .map(|p| p.items.iter().map(|i| i.plist_path.clone()).collect())
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn fresh_hits() -> Vec<String> {
    use crate::collect::macos::dotfiles;
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let mut paths: Vec<String> = dotfiles::scan_home(&home)
        .hits
        .into_iter()
        .map(|h| h.path)
        .collect();
    paths.dedup();
    paths
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn fresh_plists() -> Vec<String> {
    let _ = AtomicBool::new(false);
    Vec::new()
}

#[cfg(not(target_os = "macos"))]
fn fresh_hits() -> Vec<String> {
    Vec::new()
}

/// Validates the choice for a reveal rule and returns the path Rust will reveal.
pub fn resolve(rule: &str, choice: &FixChoice) -> Result<PathBuf, FixError> {
    match choice {
        FixChoice::Plist { path } if PLIST_RULES.contains(&rule) => {
            match_path(path, &fresh_plists())
        }
        FixChoice::File { path } if FILE_RULES.contains(&rule) => match_path(path, &fresh_hits()),
        FixChoice::Plist { .. } | FixChoice::File { .. } => Err(FixError::InvalidChoice),
        FixChoice::None | FixChoice::Share { .. } | FixChoice::SshKey { .. } => {
            if PLIST_RULES.contains(&rule) || FILE_RULES.contains(&rule) {
                Err(FixError::InvalidChoice)
            } else {
                Err(FixError::NotInCatalog)
            }
        }
    }
}
