//! User-level and admin runners. Admin steps go through one `osascript` reading its script from stdin.

use std::io::Write;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use wait_timeout::ChildExt;

use super::FixError;
use super::plan::Running;

pub const PATH_ENV: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
pub const OSASCRIPT: &str = "/usr/bin/osascript";
/// Long enough for the password dialog to sit open while the user types.
pub const ADMIN_TIMEOUT: Duration = Duration::from_secs(120);
pub const USER_TIMEOUT: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(200);
/// Step markers: step N exits with 10 + N.
pub const MARKER_BASE: i32 = 10;

pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

pub fn as_quote(s: &str) -> String {
    s.replace('\\', r"\\").replace('"', r#"\""#)
}

/// One shell line per step: quoted program and args, then the exit marker so Rust learns which step failed.
pub fn shell_line(index: usize, tokens: &[String], tolerate_exit: Option<i32>) -> String {
    let cmd = tokens
        .iter()
        .map(|t| sh_quote(t))
        .collect::<Vec<_>>()
        .join(" ");
    let marker = MARKER_BASE as usize + index;
    match tolerate_exit {
        Some(code) => format!("{cmd} || test $? -eq {code} || exit {marker}"),
        None => format!("{cmd} || exit {marker}"),
    }
}

pub fn admin_source(lines: &[String], prompt: &str) -> String {
    format!(
        "do shell script \"{}\" with prompt \"{}\" with administrator privileges",
        as_quote(&lines.join("; ")),
        as_quote(prompt)
    )
}

/// What a finished admin run means, from osascript's stderr and exit status.
pub fn classify(stderr: &str, status: Option<i32>) -> Result<(), (FixError, Option<usize>)> {
    if status == Some(0) {
        return Ok(());
    }
    if stderr.contains("(-128)") || stderr.contains("(-60006)") || stderr.contains("User canceled")
    {
        return Err((FixError::Cancelled, None));
    }
    let wrong = regex::Regex::new(r"(?i)administrator user ?name or password was incorrect")
        .ok()
        .is_some_and(|re| re.is_match(stderr));
    if stderr.contains("(-60005)") || wrong {
        return Err((FixError::WrongPassword, None));
    }
    let step = regex::Regex::new(r"\((\d+)\)\s*$")
        .ok()
        .and_then(|re| re.captures(stderr.trim_end()))
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<i32>().ok())
        .filter(|code| (MARKER_BASE..MARKER_BASE + 10).contains(code))
        .map(|code| (code - MARKER_BASE) as usize);
    Err((FixError::CommandFailed, step))
}

enum Stop {
    Timeout,
    Cancelled,
}

fn wait(
    child: &mut Child,
    timeout: Duration,
    running: &Running,
) -> std::io::Result<Result<ExitStatus, Stop>> {
    let deadline = Instant::now() + timeout;
    loop {
        if running.cancelled() {
            return Ok(Err(Stop::Cancelled));
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(Err(Stop::Timeout));
        }
        if let Some(status) = child.wait_timeout(remaining.min(POLL))? {
            return Ok(Ok(status));
        }
    }
}

fn clean_command(program: &str, args: &[String]) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env_clear()
        .env("PATH", PATH_ENV)
        .env("LANG", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

pub struct Finished {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

fn finish(mut child: Child, timeout: Duration, running: &Running) -> Result<Finished, FixError> {
    if let Ok(mut pid) = running.child_pid.lock() {
        *pid = Some(child.id());
    }
    let waited = wait(&mut child, timeout, running);
    if let Ok(mut pid) = running.child_pid.lock() {
        *pid = None;
    }
    match waited {
        Ok(Ok(_)) => {}
        Ok(Err(stop)) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(match stop {
                Stop::Timeout => FixError::Timeout,
                Stop::Cancelled => FixError::Cancelled,
            });
        }
        Err(_) => {
            let _ = child.kill();
            return Err(FixError::CommandFailed);
        }
    }
    let out = child
        .wait_with_output()
        .map_err(|_| FixError::CommandFailed)?;
    Ok(Finished {
        status: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// Spawns an absolute program with explicit args and a clean environment. No shell.
pub fn run_user(tokens: &[String], running: &Running) -> Result<Finished, FixError> {
    let (program, args) = tokens.split_first().ok_or(FixError::CommandFailed)?;
    if running.cancelled() {
        return Err(FixError::Cancelled);
    }
    let child = clean_command(program, args)
        .stdin(Stdio::null())
        .spawn()
        .map_err(|_| FixError::CommandFailed)?;
    finish(child, USER_TIMEOUT, running)
}

/// A read-only user-level command at preview time, with a throwaway cancel handle.
pub fn read_user(tokens: &[String]) -> Result<Finished, FixError> {
    run_user(tokens, &Running::default())
}

/// One osascript invocation for all admin lines of a plan. The script travels over stdin.
pub fn run_admin(
    lines: &[String],
    prompt: &str,
    running: &Arc<Running>,
) -> Result<(), (FixError, Option<usize>)> {
    if running.cancelled() {
        return Err((FixError::Cancelled, None));
    }
    let source = admin_source(lines, prompt);
    let mut child = clean_command(OSASCRIPT, &[])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|_| (FixError::CommandFailed, None))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(source.as_bytes());
    }
    let done = finish(child, ADMIN_TIMEOUT, running).map_err(|e| (e, None))?;
    classify(&done.stderr, done.status)
}
