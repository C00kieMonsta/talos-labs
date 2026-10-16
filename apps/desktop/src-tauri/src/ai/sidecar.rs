//! Spawns and talks to the `talos-ai` helper process.

use super::protocol::{Event, LineReader, Request, encode};
use std::io::{BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Overrides the helper path in debug builds only. Tests point it at the fake.
pub const HELPER_ENV: &str = "TALOS_AI_HELPER";

/// The helper next to the app binary; in debug builds the sidecar build output is the fallback.
pub fn helper_path() -> PathBuf {
    if let Some(path) = std::env::var_os(HELPER_ENV).filter(|_| cfg!(debug_assertions)) {
        return PathBuf::from(path);
    }
    let beside = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("talos-ai")));
    if let Some(path) = beside {
        if path.exists() {
            return path;
        }
        if cfg!(debug_assertions) {
            return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries/talos-ai-aarch64-apple-darwin");
        }
        return path;
    }
    PathBuf::from("talos-ai")
}

/// Shared handle to the helper's stdin so a cancel can be written while a request is being read.
#[derive(Clone)]
pub struct Writer(Arc<Mutex<ChildStdin>>);

impl Writer {
    pub fn send(&self, request: &Request) -> Result<(), String> {
        let line = encode(request).map_err(|e| e.to_string())?;
        let mut stdin = self
            .0
            .lock()
            .map_err(|_| "helper stdin poisoned".to_owned())?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|()| stdin.flush())
            .map_err(|e| e.to_string())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum RecvError {
    Timeout,
    /// The helper's stdout closed: it exited or crashed.
    Closed,
}

pub struct Sidecar {
    child: Child,
    writer: Writer,
    events: Receiver<Event>,
    last_used: Instant,
}

impl Sidecar {
    pub fn spawn(path: &std::path::Path) -> std::io::Result<Sidecar> {
        let mut command = Command::new(path);
        command.env_clear().env("PATH", "/usr/bin:/bin");
        for key in ["HOME", "LANG"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        #[cfg(test)]
        if let Some(value) = std::env::var_os("TALOS_AI_FAKE") {
            command.env("TALOS_AI_FAKE", value);
        }
        command.stdin(Stdio::piped()).stdout(Stdio::piped());
        command.stderr(if cfg!(debug_assertions) {
            Stdio::inherit()
        } else {
            Stdio::null()
        });
        let mut child = command.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| std::io::Error::other("no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| std::io::Error::other("no stdout"))?;
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("talos-ai-reader".into())
            .spawn(move || {
                let mut reader = LineReader::new(BufReader::new(stdout));
                while let Ok(Some(event)) = reader.next_event() {
                    if tx.send(event).is_err() {
                        break;
                    }
                }
            })?;
        Ok(Sidecar {
            child,
            writer: Writer(Arc::new(Mutex::new(stdin))),
            events: rx,
            last_used: Instant::now(),
        })
    }

    pub fn writer(&self) -> Writer {
        self.writer.clone()
    }

    pub fn send(&mut self, request: &Request) -> Result<(), String> {
        self.touch();
        self.writer.send(request)
    }

    /// Waits for the next event; `Closed` once the helper has gone away.
    pub fn recv(&mut self, timeout: Duration) -> Result<Event, RecvError> {
        self.touch();
        match self.events.recv_timeout(timeout) {
            Ok(event) => Ok(event),
            Err(RecvTimeoutError::Timeout) => Err(RecvError::Timeout),
            Err(RecvTimeoutError::Disconnected) => Err(RecvError::Closed),
        }
    }

    pub fn touch(&mut self) {
        self.last_used = Instant::now();
    }

    pub fn idle_for(&self) -> Duration {
        self.last_used.elapsed()
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    /// Reports whether the process has exited without blocking.
    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Asks the helper to exit, then kills it if it has not gone within `grace`.
    pub fn shutdown(mut self, grace: Duration) {
        let _ = self.writer.send(&Request::Shutdown);
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline {
            if !self.is_alive() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        self.kill();
    }

    pub fn kill(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        if self.is_alive() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}
