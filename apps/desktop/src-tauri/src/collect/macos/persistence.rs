//! Third-party launch agents and daemons.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use super::{check_cancel, home, is_not_found, is_permission_error};
use crate::collect::{to_section, Fail};
use crate::state::{LaunchItem, LaunchItemScope, Persistence, Section};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedPlist {
    pub label: Option<String>,
    pub program: Option<String>,
    pub run_at_load: bool,
}

/// Label, first program path and RunAtLoad from a launchd plist (XML or binary). Arguments are never kept.
pub fn parse_launch_plist(bytes: &[u8]) -> Option<ParsedPlist> {
    let value = plist::Value::from_reader(Cursor::new(bytes)).ok()?;
    let dict = value.into_dictionary()?;
    let label = dict.get("Label").and_then(plist::Value::as_string).map(str::to_owned);
    let program = dict
        .get("Program")
        .and_then(plist::Value::as_string)
        .or_else(|| {
            dict.get("ProgramArguments")
                .and_then(plist::Value::as_array)
                .and_then(|args| args.first())
                .and_then(plist::Value::as_string)
        })
        .map(str::to_owned);
    let run_at_load = dict.get("RunAtLoad").and_then(plist::Value::as_boolean).unwrap_or(false);
    Some(ParsedPlist { label, program, run_at_load })
}

const SEARCH_PATH: [&str; 6] = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin", "/opt/homebrew/bin"];

/// Absolute paths are checked directly; a bare name is looked up on the standard PATH.
pub fn program_exists(program: &str) -> bool {
    if program.contains('/') {
        return Path::new(program).exists();
    }
    SEARCH_PATH.iter().any(|dir| Path::new(dir).join(program).exists())
}

fn item_for(path: &Path, scope: LaunchItemScope) -> Option<LaunchItem> {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let plist_path = path.to_string_lossy().into_owned();
    match std::fs::read(path) {
        Ok(bytes) => {
            let parsed = parse_launch_plist(&bytes)?;
            // launchd refuses a plist with no program; nothing starts from it.
            let program = parsed.program?;
            let program_exists = Some(program_exists(&program));
            Some(LaunchItem {
                scope,
                plist_path,
                label: parsed.label.unwrap_or(stem),
                program: Some(program),
                program_exists,
                run_at_load: parsed.run_at_load,
            })
        }
        // A plist only root can read is still a persistence item; report what the name tells us.
        Err(err) if is_permission_error(&err) => Some(LaunchItem {
            scope,
            plist_path,
            label: stem,
            program: None,
            program_exists: None,
            run_at_load: false,
        }),
        Err(_) => None,
    }
}

fn scan_dir(dir: &Path, scope: LaunchItemScope, label: &str, items: &mut Vec<LaunchItem>) -> Result<(), Fail> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if is_not_found(&err) => return Ok(()),
        Err(err) => return Err(Fail::io(&err, &format!("read_dir: {label}"))),
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "plist"))
        .collect();
    paths.sort();
    for path in paths {
        if let Some(item) = item_for(&path, scope) {
            items.push(item);
        }
    }
    Ok(())
}

fn inner(cancel: &AtomicBool) -> Result<Persistence, Fail> {
    check_cancel(cancel)?;
    let mut items = Vec::new();
    let user_agents = home()?.join("Library/LaunchAgents");
    scan_dir(&user_agents, LaunchItemScope::UserAgent, "user LaunchAgents", &mut items)?;
    scan_dir(Path::new("/Library/LaunchAgents"), LaunchItemScope::SystemAgent, "LaunchAgents", &mut items)?;
    scan_dir(Path::new("/Library/LaunchDaemons"), LaunchItemScope::SystemDaemon, "LaunchDaemons", &mut items)?;
    Ok(Persistence { items })
}

pub fn collect(cancel: &AtomicBool) -> Section<Persistence> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.example.agent</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/true</string>
		<string>--secret-arg</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
"#;

    #[test]
    fn parses_program_arguments_first_only() {
        let parsed = parse_launch_plist(XML.as_bytes()).unwrap();
        assert_eq!(parsed.label.as_deref(), Some("com.example.agent"));
        assert_eq!(parsed.program.as_deref(), Some("/usr/bin/true"));
        assert!(parsed.run_at_load);
        assert!(program_exists("/usr/bin/true"));
        assert!(!program_exists("/nonexistent/talos"));
        assert!(program_exists("true"));
    }

    #[test]
    fn program_key_wins_and_run_at_load_defaults_false() {
        let xml = "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>Label</key><string>x</string><key>Program</key><string>/bin/ls</string></dict></plist>";
        let parsed = parse_launch_plist(xml.as_bytes()).unwrap();
        assert_eq!(parsed.program.as_deref(), Some("/bin/ls"));
        assert!(!parsed.run_at_load);
        assert!(parse_launch_plist(b"not a plist").is_none());
    }

    #[test]
    fn scan_missing_dir_is_empty() {
        let mut items = Vec::new();
        scan_dir(Path::new("/nonexistent/talos-dir"), LaunchItemScope::SystemDaemon, "x", &mut items).unwrap();
        assert!(items.is_empty());
    }

    const EMPTY_DICT: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\">\n<dict/>\n</plist>\n";
    const LABEL_ONLY: &str = "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>Label</key><string>session-manager-plugin</string></dict></plist>";

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("talos-persistence-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn empty_and_label_only_plists_parse_with_no_program() {
        let parsed = parse_launch_plist(EMPTY_DICT.as_bytes()).unwrap();
        assert_eq!(parsed, ParsedPlist::default());
        let parsed = parse_launch_plist(LABEL_ONLY.as_bytes()).unwrap();
        assert_eq!(parsed.label.as_deref(), Some("session-manager-plugin"));
        assert_eq!(parsed.program, None);
    }

    #[test]
    fn plists_launchd_cannot_load_are_skipped() {
        let dir = scratch_dir("skip");
        std::fs::write(dir.join("com.google.keystone.agent.plist"), EMPTY_DICT).unwrap();
        std::fs::write(dir.join("SessionManagerPlugin.plist"), LABEL_ONLY).unwrap();
        std::fs::write(dir.join("notes.txt"), "not a plist").unwrap();
        let mut items = Vec::new();
        scan_dir(&dir, LaunchItemScope::UserAgent, "x", &mut items).unwrap();
        assert!(items.is_empty(), "{items:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_plist_with_a_program_is_one_item() {
        let dir = scratch_dir("keep");
        std::fs::write(dir.join("com.example.agent.plist"), XML).unwrap();
        std::fs::write(dir.join("com.google.keystone.agent.plist"), EMPTY_DICT).unwrap();
        let mut items = Vec::new();
        scan_dir(&dir, LaunchItemScope::SystemDaemon, "x", &mut items).unwrap();
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.scope, LaunchItemScope::SystemDaemon);
        assert_eq!(item.label, "com.example.agent");
        assert_eq!(item.program.as_deref(), Some("/usr/bin/true"));
        assert_eq!(item.program_exists, Some(true));
        assert!(item.run_at_load);
        assert!(item.plist_path.ends_with("com.example.agent.plist"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
