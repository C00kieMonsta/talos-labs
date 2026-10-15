//! Runs allow-listed binaries with no shell, a clean environment, a timeout and an output cap.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

use wait_timeout::ChildExt;

/// Every binary the collectors may run. An unknown binary is unrepresentable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bin {
    Fdesetup,
    Socketfilterfw,
    Spctl,
    Csrutil,
    SwVers,
    Defaults,
    Sysadminctl,
    Dscl,
    Whoami,
    Netstat,
    Sharing,
    Launchctl,
    Tmutil,
    Osascript,
    Pwpolicy,
    #[cfg(test)]
    Sleep,
    #[cfg(test)]
    Echo,
    #[cfg(test)]
    Head,
    #[cfg(test)]
    Missing,
}

impl Bin {
    pub fn path(self) -> &'static str {
        match self {
            Bin::Fdesetup => "/usr/bin/fdesetup",
            Bin::Socketfilterfw => "/usr/libexec/ApplicationFirewall/socketfilterfw",
            Bin::Spctl => "/usr/sbin/spctl",
            Bin::Csrutil => "/usr/bin/csrutil",
            Bin::SwVers => "/usr/bin/sw_vers",
            Bin::Defaults => "/usr/bin/defaults",
            Bin::Sysadminctl => "/usr/sbin/sysadminctl",
            Bin::Dscl => "/usr/bin/dscl",
            Bin::Whoami => "/usr/bin/whoami",
            Bin::Netstat => "/usr/sbin/netstat",
            Bin::Sharing => "/usr/sbin/sharing",
            Bin::Launchctl => "/bin/launchctl",
            Bin::Tmutil => "/usr/bin/tmutil",
            Bin::Osascript => "/usr/bin/osascript",
            Bin::Pwpolicy => "/usr/bin/pwpolicy",
            #[cfg(test)]
            Bin::Sleep => "/bin/sleep",
            #[cfg(test)]
            Bin::Echo => "/bin/echo",
            #[cfg(test)]
            Bin::Head => "/usr/bin/head",
            #[cfg(test)]
            Bin::Missing => "/nonexistent/talos-missing-binary",
        }
    }

    /// File name only, used in `detail` labels such as "bin: fdesetup".
    pub fn name(self) -> &'static str {
        self.path().rsplit('/').next().unwrap_or("")
    }
}

pub const PATH_ENV: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
pub const OUTPUT_CAP: usize = 1024 * 1024;
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);
pub const OSASCRIPT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    /// true when stdout or stderr exceeded `OUTPUT_CAP` and was cut.
    pub truncated: bool,
}

impl Output {
    pub fn success(&self) -> bool {
        self.exit_code == Some(0)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ExecError {
    #[error("binary missing: {}", .0.name())]
    ToolMissing(Bin),
    #[error("timed out: {}", .0.name())]
    Timeout(Bin),
    #[error("cancelled")]
    Cancelled,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Runs `bin` with `args` verbatim. Never a shell.
pub fn run(bin: Bin, args: &[&str], timeout: Duration, cancel: &AtomicBool) -> Result<Output, ExecError> {
    if cancel.load(Ordering::SeqCst) {
        return Err(ExecError::Cancelled);
    }
    let spawned = Command::new(bin.path())
        .args(args)
        .env_clear()
        .env("PATH", PATH_ENV)
        .env("LANG", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Err(ExecError::ToolMissing(bin)),
        Err(err) => return Err(ExecError::Io(err)),
    };
    let stdout = child.stdout.take().and_then(spawn_reader);
    let stderr = child.stderr.take().and_then(spawn_reader);

    let status = match child.wait_timeout(timeout)? {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            join(stdout);
            join(stderr);
            return Err(ExecError::Timeout(bin));
        }
    };
    let (out, out_cut) = join(stdout);
    let (err, err_cut) = join(stderr);
    let output = Output {
        stdout: String::from_utf8_lossy(&out).into_owned(),
        stderr: String::from_utf8_lossy(&err).into_owned(),
        exit_code: status.code(),
        truncated: out_cut || err_cut,
    };
    #[cfg(feature = "debug-raw")]
    eprintln!(
        "[debug-raw] {} {:?} exit={:?}\n--- stdout ---\n{}\n--- stderr ---\n{}",
        bin.path(),
        args,
        output.exit_code,
        output.stdout,
        output.stderr
    );
    Ok(output)
}

type Captured = (Vec<u8>, bool);

fn spawn_reader<R: Read + Send + 'static>(mut reader: R) -> Option<JoinHandle<Captured>> {
    std::thread::Builder::new()
        .name("talos-exec-reader".into())
        .spawn(move || read_capped(&mut reader))
        .ok()
}

/// Keeps the first `OUTPUT_CAP` bytes and drains the rest so the child never blocks on a full pipe.
fn read_capped(reader: &mut impl Read) -> Captured {
    let mut kept = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                let room = OUTPUT_CAP.saturating_sub(kept.len());
                let take = room.min(n);
                kept.extend_from_slice(&chunk[..take]);
                if take < n {
                    truncated = true;
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    (kept, truncated)
}

fn join(handle: Option<JoinHandle<Captured>>) -> Captured {
    handle.and_then(|h| h.join().ok()).unwrap_or_default()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn no_cancel() -> AtomicBool {
        AtomicBool::new(false)
    }

    #[test]
    fn timeout_kills_the_child() {
        let started = Instant::now();
        let result = run(Bin::Sleep, &["5"], Duration::from_millis(300), &no_cancel());
        assert!(matches!(result, Err(ExecError::Timeout(Bin::Sleep))));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn arguments_reach_the_child_verbatim() {
        let out = run(Bin::Echo, &["a;b", "$(whoami)", "two words", "`x`"], DEFAULT_TIMEOUT, &no_cancel()).unwrap();
        assert_eq!(out.stdout, "a;b $(whoami) two words `x`\n");
        assert!(out.success());
        assert!(!out.truncated);
    }

    #[test]
    fn output_over_cap_is_truncated_and_flagged() {
        let out = run(Bin::Head, &["-c", "1200000", "/dev/zero"], DEFAULT_TIMEOUT, &no_cancel()).unwrap();
        assert_eq!(out.stdout.len(), OUTPUT_CAP);
        assert!(out.truncated);
    }

    #[test]
    fn cancel_flag_blocks_spawn() {
        let cancel = AtomicBool::new(true);
        assert!(matches!(run(Bin::Echo, &["hi"], DEFAULT_TIMEOUT, &cancel), Err(ExecError::Cancelled)));
    }

    #[test]
    fn missing_binary_is_tool_missing() {
        assert!(matches!(run(Bin::Missing, &[], DEFAULT_TIMEOUT, &no_cancel()), Err(ExecError::ToolMissing(Bin::Missing))));
    }

    #[test]
    fn bin_names_are_file_names() {
        assert_eq!(Bin::Socketfilterfw.name(), "socketfilterfw");
        assert_eq!(Bin::SwVers.name(), "sw_vers");
    }
}

#[cfg(all(test, target_os = "macos"))]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod macos_tests {
    use super::*;

    /// On macOS 27 the kernel returns an empty socket list to process trees whose ancestor is
    /// ad-hoc signed (every cargo-built binary), so this only passes from a Developer ID signed app.
    #[test]
    #[ignore]
    fn netstat_output_is_captured() {
        let out = run(Bin::Netstat, &["-anv", "-p", "tcp"], DEFAULT_TIMEOUT, &AtomicBool::new(false)).unwrap();
        eprintln!("exit={:?} stdout={} bytes stderr={} bytes truncated={}", out.exit_code, out.stdout.len(), out.stderr.len(), out.truncated);
        assert!(out.stdout.contains("Proto"), "stdout: {:?} stderr: {:?}", out.stdout, out.stderr);
    }
}
