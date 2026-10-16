//! Drives `ssh-keygen -p` over a pseudo-terminal: answers the two new-passphrase prompts and nothing else.

use std::os::fd::{FromRawFd, OwnedFd};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use zeroize::Zeroizing;

use super::FixError;
use super::plan::Running;
use super::privileged::PATH_ENV;

pub const PROMPT_TIMEOUT: Duration = Duration::from_secs(10);
pub const NEW_PROMPT: &str = "Enter new passphrase";
pub const REPEAT_PROMPT: &str = "Enter same passphrase again";
pub const OLD_PROMPT: &str = "Enter old passphrase";

/// Program, args and the two answers. The same driver runs the test stub and the real ssh-keygen.
pub struct Session<'a> {
    pub program: &'a str,
    pub args: &'a [String],
    pub passphrase: &'a Zeroizing<String>,
    /// How long to wait for each prompt and for exit.
    pub prompt_timeout: Duration,
}

fn open_pty() -> Result<(OwnedFd, OwnedFd), FixError> {
    let mut master: libc::c_int = -1;
    let mut slave: libc::c_int = -1;
    // SAFETY: openpty writes two descriptors into the integers it is given; the other pointers may be null.
    let rc = unsafe {
        libc::openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if rc != 0 || master < 0 || slave < 0 {
        return Err(FixError::CommandFailed);
    }
    // SAFETY: both descriptors were just created by openpty and are owned by nothing else.
    Ok(unsafe { (OwnedFd::from_raw_fd(master), OwnedFd::from_raw_fd(slave)) })
}

/// Reads until `deadline`, returning the bytes read so far once the buffer holds any of `needles`.
fn read_until(
    master: &OwnedFd,
    buf: &mut Vec<u8>,
    needles: &[&str],
    deadline: Instant,
) -> Result<usize, FixError> {
    use std::os::fd::AsRawFd;
    loop {
        let text = String::from_utf8_lossy(buf);
        if let Some(i) = needles.iter().position(|n| text.contains(n)) {
            return Ok(i);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(FixError::Timeout);
        }
        let mut fds = libc::pollfd {
            fd: master.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: one valid pollfd for an open descriptor; the timeout is bounded.
        let ready = unsafe {
            libc::poll(
                &mut fds,
                1,
                remaining.as_millis().min(i32::MAX as u128) as i32,
            )
        };
        if ready < 0 {
            return Err(FixError::CommandFailed);
        }
        if ready == 0 {
            continue;
        }
        let mut chunk = [0u8; 1024];
        // SAFETY: the buffer is valid for its length and the descriptor is open.
        let n = unsafe { libc::read(master.as_raw_fd(), chunk.as_mut_ptr().cast(), chunk.len()) };
        if n <= 0 {
            // EOF or EIO: the child closed its side without the prompt we wanted.
            return Err(FixError::CommandFailed);
        }
        buf.extend_from_slice(chunk.get(..n as usize).unwrap_or(&[]));
    }
}

fn write_all(master: &OwnedFd, bytes: &[u8]) -> Result<(), FixError> {
    use std::os::fd::AsRawFd;
    let mut off = 0;
    while off < bytes.len() {
        let rest = bytes.get(off..).unwrap_or(&[]);
        // SAFETY: the slice is valid for its length and the descriptor is open.
        let n = unsafe { libc::write(master.as_raw_fd(), rest.as_ptr().cast(), rest.len()) };
        if n <= 0 {
            return Err(FixError::CommandFailed);
        }
        off += n as usize;
    }
    Ok(())
}

/// Runs the session: waits for the new-passphrase prompt, answers, waits for the repeat prompt,
/// answers, then waits for exit. An old-passphrase prompt or a third prompt aborts the run.
pub fn drive(session: &Session<'_>, running: &Running) -> Result<(), FixError> {
    let (master, slave) = open_pty()?;
    let slave_fd = {
        use std::os::fd::AsRawFd;
        slave.as_raw_fd()
    };
    let mut cmd = Command::new(session.program);
    cmd.args(session.args)
        .env_clear()
        .env("PATH", PATH_ENV)
        .env("LANG", "C")
        .stdin(Stdio::from(
            slave.try_clone().map_err(|_| FixError::CommandFailed)?,
        ))
        .stdout(Stdio::from(
            slave.try_clone().map_err(|_| FixError::CommandFailed)?,
        ))
        .stderr(Stdio::from(slave));
    // SAFETY: only async-signal-safe calls run between fork and exec.
    unsafe {
        cmd.pre_exec(move || {
            if libc::setsid() < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::ioctl(slave_fd, libc::TIOCSCTTY as _, 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = cmd.spawn().map_err(|_| FixError::CommandFailed)?;
    drop(cmd);
    if let Ok(mut pid) = running.child_pid.lock() {
        *pid = Some(child.id());
    }
    let result = converse(&master, session.passphrase, session.prompt_timeout, running);
    let outcome = match result {
        Ok(()) => wait_exit(&mut child, session.prompt_timeout, running),
        Err(err) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(err)
        }
    };
    if let Ok(mut pid) = running.child_pid.lock() {
        *pid = None;
    }
    outcome
}

fn converse(
    master: &OwnedFd,
    passphrase: &Zeroizing<String>,
    timeout: Duration,
    running: &Running,
) -> Result<(), FixError> {
    let mut buf = Vec::new();
    let answer = Zeroizing::new(format!("{}\n", passphrase.as_str()));
    for expected in [NEW_PROMPT, REPEAT_PROMPT] {
        if running.cancelled() {
            return Err(FixError::Cancelled);
        }
        let hit = read_until(
            master,
            &mut buf,
            &[expected, OLD_PROMPT],
            Instant::now() + timeout,
        )?;
        if hit != 0 {
            return Err(FixError::CommandFailed);
        }
        buf.clear();
        write_all(master, answer.as_bytes())?;
    }
    // A third prompt means the tool wants something the plan did not promise.
    let prompts = [NEW_PROMPT, REPEAT_PROMPT, OLD_PROMPT, "Enter passphrase"];
    match read_until(master, &mut buf, &prompts, Instant::now() + timeout) {
        Ok(_) => Err(FixError::CommandFailed),
        Err(FixError::CommandFailed) => Ok(()),
        Err(err) => Err(err),
    }
}

fn wait_exit(
    child: &mut std::process::Child,
    timeout: Duration,
    running: &Running,
) -> Result<(), FixError> {
    use wait_timeout::ChildExt;
    let deadline = Instant::now() + timeout;
    loop {
        if running.cancelled() {
            let _ = child.kill();
            return Err(FixError::Cancelled);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            let _ = child.kill();
            return Err(FixError::Timeout);
        }
        if let Ok(Some(status)) = child.wait_timeout(remaining.min(Duration::from_millis(200))) {
            return if status.success() {
                Ok(())
            } else {
                Err(FixError::CommandFailed)
            };
        }
    }
}

/// True when the first bytes of the key still read as an unencrypted private key.
pub fn still_unencrypted(path: &Path) -> bool {
    use std::io::Read;
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut head = Vec::new();
    if file.by_ref().take(4096).read_to_end(&mut head).is_err() {
        return false;
    }
    classify_head(&head) == Some(false)
}

#[cfg(target_os = "macos")]
fn classify_head(head: &[u8]) -> Option<bool> {
    crate::collect::macos::ssh::classify_key(head).and_then(|(_, encrypted)| encrypted)
}

#[cfg(not(target_os = "macos"))]
fn classify_head(_head: &[u8]) -> Option<bool> {
    None
}
