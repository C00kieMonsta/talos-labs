//! The Claude plan route: Anthropic's own Claude Code program, verified by codesign before every
//! spawn, run with a Talos-owned config folder, a scrubbed environment and no shell.
//!
//! Layout under `<app_data>/claude-code/`: `config/` (CLAUDE_CONFIG_DIR), `home/` (HOME),
//! `versions/<v>` and `installed.json`. Each run gets a fresh 0700 cwd under `/private/tmp`.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use wait_timeout::ChildExt;

use super::claude_stream::{self, Parsed};
use super::engine::{GenerateRequest, StreamPayload, valid_id};
use super::partial_json;
use super::provider::{
    CONNECT_DEADLINE, ConnectJob, ConnectOutcome, ConnectPoll, ProviderState, ProviderStatus,
    Stage, lock,
};
use super::schemas;
use crate::exec::{self, Bin};

pub const IDENTITY: &str = "Developer ID Application: Anthropic PBC (Q6L2SF6YDW)";
/// The codesign requirement every binary must satisfy before it is spawned.
pub const REQUIREMENT: &str = "identifier \"com.anthropic.claude-code\" and anchor apple generic and certificate leaf[subject.OU] = \"Q6L2SF6YDW\"";
pub const MIN_VERSION: Version = Version(2, 1, 259);
pub const RELEASES_BASE: &str = "https://downloads.claude.ai/claude-code-releases";
pub const MAX_INSTRUCTIONS_CHARS: usize = 40_000;
pub const MAX_PROMPT_CHARS: usize = 60_000;
pub const FIRST_PARTIAL_TIMEOUT: Duration = Duration::from_secs(60);
pub const WHOLE_TIMEOUT: Duration = Duration::from_secs(180);
pub const PARTIAL_INTERVAL: Duration = Duration::from_millis(80);
const SHORT_TIMEOUT: Duration = Duration::from_secs(15);
const AUTH_TTL_AVAILABLE: Duration = Duration::from_secs(600);
const AUTH_TTL_OTHER: Duration = Duration::from_secs(10);
/// How long a `limit_reached` without a reset time is believed.
const LIMIT_TTL: Duration = Duration::from_secs(300);
const DOWNLOAD_LIMIT: u64 = 1024 * 1024 * 1024;

/// Build flag: release builds keep Claude at `not_offered` until the owner's test-account session.
pub fn offered() -> bool {
    cfg!(debug_assertions) || option_env!("TALOS_CLAUDE_PLAN_APPROVED") == Some("1")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(pub u32, pub u32, pub u32);

impl Version {
    /// "2.1.287", "2.1.287 (Claude Code)" or "v2.1.287".
    pub fn parse(text: &str) -> Option<Version> {
        let first = text.split_whitespace().next()?;
        let first = first.strip_prefix('v').unwrap_or(first);
        let mut parts = first.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch = parts.next()?.parse().ok()?;
        if parts.next().is_some() {
            return None;
        }
        Some(Version(major, minor, patch))
    }

    pub fn supported(self) -> bool {
        self >= MIN_VERSION
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.0, self.1, self.2)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dirs {
    pub root: PathBuf,
    pub config: PathBuf,
    pub home: PathBuf,
    pub versions: PathBuf,
    pub installed: PathBuf,
}

impl Dirs {
    pub fn under(app_data: &Path) -> Dirs {
        let root = app_data.join("claude-code");
        Dirs {
            config: root.join("config"),
            home: root.join("home"),
            versions: root.join("versions"),
            installed: root.join("installed.json"),
            root,
        }
    }

    /// Creates the folders with owner-only permissions.
    pub fn ensure(&self) -> std::io::Result<()> {
        for dir in [&self.root, &self.config, &self.home, &self.versions] {
            create_private_dir(dir)?;
        }
        Ok(())
    }
}

fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true).mode(0o700);
    builder.create(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}

/// A binary that passed `verify`. Only `verify` (and tests) can make one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified(PathBuf);

impl Verified {
    pub fn path(&self) -> &Path {
        &self.0
    }

    #[cfg(test)]
    pub(crate) fn trusted_for_tests(path: &Path) -> Verified {
        Verified(path.to_path_buf())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyError {
    Missing,
    Rejected,
    Tool(String),
}

/// Runs `codesign --verify --strict -R=<requirement>` on every call: there is no cached verdict, so
/// each spawn site (`--version`, `auth status`, `auth login`, `auth logout`, the explanation)
/// checks the signature right before it spawns. `locate` verifies for the probes it spawns at
/// once; a spawn that follows a wait (after the sign-in, after the logout) verifies again.
pub fn verify(bin: &Path) -> Result<Verified, VerifyError> {
    if !bin.is_file() {
        return Err(VerifyError::Missing);
    }
    let Some(text) = bin.to_str() else {
        return Err(VerifyError::Rejected);
    };
    let requirement = format!("-R={REQUIREMENT}");
    let out = exec::run(
        Bin::Codesign,
        &["--verify", "--strict", &requirement, text],
        Duration::from_secs(10),
        &AtomicBool::new(false),
    )
    .map_err(|e| VerifyError::Tool(e.to_string()))?;
    if !out.success() {
        return Err(VerifyError::Rejected);
    }
    Ok(Verified(bin.to_path_buf()))
}

/// The one way to build a Claude Code command: scrubbed env, Talos folders, no shell.
pub fn claude_command(bin: &Verified, dirs: &Dirs, cwd: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(bin.path());
    command
        .args(args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "en_GB.UTF-8")
        .env("HOME", &dirs.home)
        .env("CLAUDE_CONFIG_DIR", &dirs.config)
        .env("DISABLE_AUTOUPDATER", "1")
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped());
    #[cfg(feature = "debug-raw")]
    command.stderr(Stdio::inherit());
    #[cfg(not(feature = "debug-raw"))]
    command.stderr(Stdio::null());
    command
}

/// The parent of every run dir. Not the per-user temp dir: its path carries a token that is
/// stable for this account on this Mac, and Claude Code names the cwd in every request.
pub const RUN_DIR_ROOT: &str = "/private/tmp";

/// A fresh 0700 folder under `/private/tmp`, so no ancestor CLAUDE.md, account name or per-user
/// path is in reach.
pub struct RunDir(PathBuf);

impl RunDir {
    pub fn create() -> std::io::Result<RunDir> {
        let dir = PathBuf::from(RUN_DIR_ROOT).join(format!("talos-claude-{}", random_hex(8)));
        create_private_dir(&dir)?;
        Ok(RunDir(dir))
    }
    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for RunDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn random_hex(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Runs a prepared command to completion with a timeout; None when it timed out.
fn run_capture(
    mut command: Command,
    timeout: Duration,
) -> std::io::Result<Option<(String, Option<i32>)>> {
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().and_then(exec::spawn_reader);
    let status = match child.wait_timeout(timeout)? {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            exec::join(stdout);
            return Ok(None);
        }
    };
    let (out, _) = exec::join(stdout);
    Ok(Some((
        String::from_utf8_lossy(&out).into_owned(),
        status.code(),
    )))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Existing,
    Fetched,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    pub bin: Verified,
    pub version: Version,
    pub source: Source,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Installed {
    version: String,
    path: PathBuf,
}

fn version_from_file_name(path: &Path) -> Option<Version> {
    Version::parse(path.file_name()?.to_str()?)
}

/// Finds a supported, verified binary: the person's own install first (read-only), then ours.
pub fn locate(dirs: &Dirs) -> Option<Located> {
    let home = dirs::home_dir();
    let version_of = |bin: &Verified| -> Option<Version> {
        let (stdout, _) = run_capture(
            claude_command(bin, dirs, &dirs.home, &["--version"]),
            SHORT_TIMEOUT,
        )
        .ok()
        .flatten()?;
        Version::parse(&stdout)
    };
    locate_with(
        home.as_deref(),
        dirs,
        &|path| verify(path).ok(),
        &version_of,
    )
}

pub(crate) fn locate_with(
    home: Option<&Path>,
    dirs: &Dirs,
    verify: &dyn Fn(&Path) -> Option<Verified>,
    version_of: &dyn Fn(&Verified) -> Option<Version>,
) -> Option<Located> {
    if let Some(home) = home {
        let versions = home.join(".local/share/claude/versions");
        let mut candidates: Vec<(Version, PathBuf)> = std::fs::read_dir(&versions)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_file())
                    .filter_map(|p| version_from_file_name(&p).map(|v| (v, p)))
                    .filter(|(v, _)| v.supported())
                    .collect()
            })
            .unwrap_or_default();
        candidates.sort_by_key(|(v, _)| std::cmp::Reverse(*v));
        for (version, path) in candidates {
            if let Some(bin) = verify(&path) {
                return Some(Located {
                    bin,
                    version,
                    source: Source::Existing,
                });
            }
        }
        let link = home.join(".local/bin/claude");
        if let Ok(real) = std::fs::canonicalize(&link)
            && let Some(bin) = verify(&real)
        {
            let version = version_from_file_name(&real).or_else(|| version_of(&bin));
            if let Some(version) = version.filter(|v| v.supported()) {
                return Some(Located {
                    bin,
                    version,
                    source: Source::Existing,
                });
            }
        }
    }
    let installed: Installed =
        serde_json::from_slice(&std::fs::read(&dirs.installed).ok()?).ok()?;
    let version = Version::parse(&installed.version).filter(|v| v.supported())?;
    if !installed.path.starts_with(&dirs.versions) {
        return None;
    }
    let bin = verify(&installed.path)?;
    Some(Located {
        bin,
        version,
        source: Source::Fetched,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub checksum: String,
    pub size: u64,
}

/// `platforms[<platform>].{checksum,size}` from `<v>/manifest.json`.
pub fn parse_manifest(text: &str, platform: &str) -> Option<Manifest> {
    let value: Value = serde_json::from_str(text).ok()?;
    let entry = value.get("platforms")?.get(platform)?;
    let checksum = entry.get("checksum")?.as_str()?.to_ascii_lowercase();
    if checksum.len() != 64 || !checksum.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(Manifest {
        checksum,
        size: entry.get("size")?.as_u64()?,
    })
}

pub fn platform() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "darwin-arm64"
    } else {
        "darwin-x64"
    }
}

pub fn valid_release_version(text: &str) -> Option<Version> {
    let trimmed = text.trim();
    if trimmed.len() > 32 || trimmed.split_whitespace().count() != 1 {
        return None;
    }
    Version::parse(trimmed)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    Cancelled,
    Network,
    BadManifest,
    ChecksumMismatch,
    Io(String),
    Rejected,
}

fn http_agent(global: Option<Duration>) -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(global)
        .timeout_connect(Some(Duration::from_secs(30)))
        .build()
        .into()
}

fn get_text(agent: &ureq::Agent, url: &str, limit: u64) -> Result<String, FetchError> {
    let mut response = agent.get(url).call().map_err(|_| FetchError::Network)?;
    if response.status().as_u16() != 200 {
        return Err(FetchError::Network);
    }
    response
        .body_mut()
        .with_config()
        .limit(limit)
        .read_to_string()
        .map_err(|_| FetchError::Network)
}

/// Downloads the stable build into `versions/<v>`, checking the manifest's sha256, then verifies it.
pub fn fetch(dirs: &Dirs, cancel: &AtomicBool) -> Result<Located, FetchError> {
    dirs.ensure().map_err(|e| FetchError::Io(e.to_string()))?;
    let agent = http_agent(Some(Duration::from_secs(30)));
    let stable = get_text(&agent, &format!("{RELEASES_BASE}/stable"), 64)?;
    let version = valid_release_version(&stable).ok_or(FetchError::BadManifest)?;
    let manifest_text = get_text(
        &agent,
        &format!("{RELEASES_BASE}/{version}/manifest.json"),
        64 * 1024,
    )?;
    let manifest = parse_manifest(&manifest_text, platform()).ok_or(FetchError::BadManifest)?;
    if cancel.load(Ordering::SeqCst) {
        return Err(FetchError::Cancelled);
    }
    let target = dirs.versions.join(version.to_string());
    let part = dirs.versions.join(format!("{version}.part"));
    let url = format!("{RELEASES_BASE}/{version}/{}/claude", platform());
    let result = download(&url, &manifest, &part, cancel);
    if let Err(err) = result {
        let _ = std::fs::remove_file(&part);
        return Err(err);
    }
    finish_install(dirs, &version, &part, &target).inspect_err(|_| {
        let _ = std::fs::remove_file(&part);
    })
}

/// Total budget for receiving the body; ureq has no per-read timeout, so this is the backstop.
const DOWNLOAD_BODY_BUDGET: Duration = Duration::from_secs(15 * 60);
/// How often the download loop looks at the cancel flag while no chunk arrives.
const DOWNLOAD_CANCEL_POLL: Duration = Duration::from_millis(250);

/// Fetches `url` on its own thread and hands the body over chunk by chunk, so the loop below
/// still sees Cancel when the connection stalls. Stops as soon as the loop has gone.
fn read_body(url: &str, limit: u64, tx: &mpsc::SyncSender<Result<Vec<u8>, FetchError>>) {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_recv_body(Some(DOWNLOAD_BODY_BUDGET))
        .build()
        .into();
    let response = match agent.get(url).call() {
        Ok(response) if response.status().as_u16() == 200 => response,
        _ => {
            let _ = tx.send(Err(FetchError::Network));
            return;
        }
    };
    let mut reader = response
        .into_body()
        .into_with_config()
        .limit(limit)
        .reader();
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => return,
            Ok(n) => {
                let bytes = chunk.get(..n).unwrap_or(&[]).to_vec();
                if tx.send(Ok(bytes)).is_err() {
                    return;
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                let _ = tx.send(Err(FetchError::Network));
                return;
            }
        }
    }
}

fn download(
    url: &str,
    manifest: &Manifest,
    part: &Path,
    cancel: &AtomicBool,
) -> Result<(), FetchError> {
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o700)
            .open(part)
            .map_err(|e| FetchError::Io(e.to_string()))?
    };
    let (tx, rx) = mpsc::sync_channel::<Result<Vec<u8>, FetchError>>(4);
    let limit = DOWNLOAD_LIMIT.min(manifest.size.saturating_add(1));
    let owned_url = url.to_owned();
    std::thread::Builder::new()
        .name("talos-claude-download".into())
        .spawn(move || read_body(&owned_url, limit, &tx))
        .map_err(|e| FetchError::Io(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut total: u64 = 0;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(FetchError::Cancelled);
        }
        let bytes = match rx.recv_timeout(DOWNLOAD_CANCEL_POLL) {
            Ok(Ok(bytes)) => bytes,
            Ok(Err(err)) => return Err(err),
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        hasher.update(&bytes);
        file.write_all(&bytes)
            .map_err(|e| FetchError::Io(e.to_string()))?;
        total = total.saturating_add(bytes.len() as u64);
    }
    file.sync_all().map_err(|e| FetchError::Io(e.to_string()))?;
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if total != manifest.size || digest != manifest.checksum {
        return Err(FetchError::ChecksumMismatch);
    }
    Ok(())
}

fn finish_install(
    dirs: &Dirs,
    version: &Version,
    part: &Path,
    target: &Path,
) -> Result<Located, FetchError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(part, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| FetchError::Io(e.to_string()))?;
    std::fs::rename(part, target).map_err(|e| FetchError::Io(e.to_string()))?;
    let bin = verify(target).map_err(|_| {
        let _ = std::fs::remove_file(target);
        FetchError::Rejected
    })?;
    let installed = Installed {
        version: version.to_string(),
        path: target.to_path_buf(),
    };
    let bytes = serde_json::to_vec(&installed).map_err(|e| FetchError::Io(e.to_string()))?;
    crate::report_store::write_private(&dirs.installed, &bytes)
        .map_err(|e| FetchError::Io(e.to_string()))?;
    Ok(Located {
        bin,
        version: *version,
        source: Source::Fetched,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthStatus {
    pub logged_in: bool,
    pub auth_method: String,
}

impl AuthStatus {
    pub fn plan_signed_in(&self) -> bool {
        self.logged_in && self.auth_method == "claude.ai"
    }
}

/// `{ "loggedIn": bool, "authMethod": "..." }` from `claude auth status`; nothing else is kept.
pub fn parse_auth_status(stdout: &str) -> Option<AuthStatus> {
    let value: Value = serde_json::from_str(stdout.trim()).ok()?;
    let auth_method = value
        .get("authMethod")
        .or_else(|| value.get("auth_method"))
        .and_then(Value::as_str)
        .unwrap_or("none")
        .to_owned();
    let logged_in = value
        .get("loggedIn")
        .or_else(|| value.get("logged_in"))
        .and_then(Value::as_bool)
        .unwrap_or(auth_method != "none");
    Some(AuthStatus {
        logged_in,
        auth_method,
    })
}

fn auth_status(bin: &Verified, dirs: &Dirs) -> Option<AuthStatus> {
    let (stdout, _) = run_capture(
        claude_command(bin, dirs, &dirs.home, &["auth", "status"]),
        SHORT_TIMEOUT,
    )
    .ok()
    .flatten()?;
    parse_auth_status(&stdout)
}

/// The locked-down explanation run. No positional: the prompt goes on stdin.
/// `--permission-mode default` is added to the verified set: without it Claude Code 2.1.287 runs
/// in "auto" mode and sends a classifier context naming the config and home folders.
pub fn generate_args(instructions: &str, schema: &str) -> Vec<String> {
    [
        "-p",
        "--safe-mode",
        "--disable-slash-commands",
        "--tools",
        "",
        "--allowedTools",
        "StructuredOutput",
        "--strict-mcp-config",
        "--system-prompt",
        instructions,
        "--max-turns",
        "2",
        "--no-session-persistence",
        "--permission-prompts",
        "none",
        "--permission-mode",
        "default",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--json-schema",
        schema,
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect()
}

pub fn validate(request: &GenerateRequest) -> Result<(), String> {
    if !valid_id(&request.id) {
        return Err("invalid_id".into());
    }
    if request.instructions.chars().count() > MAX_INSTRUCTIONS_CHARS {
        return Err("instructions_too_long".into());
    }
    if request.prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err("prompt_too_long".into());
    }
    if request.instructions.starts_with('-') {
        return Err("invalid_text".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeInfo {
    pub offered: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub signed: bool,
    pub identity: Option<String>,
    pub source: Source,
}

struct InFlight {
    id: String,
    cancel: Arc<AtomicBool>,
}

#[derive(Debug, Clone)]
struct CachedError {
    code: &'static str,
    until: Option<String>,
    at: Instant,
}

pub struct ClaudeCode {
    pub job: ConnectJob,
    auth_cache: Mutex<Option<(bool, Instant)>>,
    stream_error: Mutex<Option<CachedError>>,
    busy: AtomicBool,
    inflight: Mutex<Option<InFlight>>,
}

impl Default for ClaudeCode {
    fn default() -> Self {
        ClaudeCode {
            job: ConnectJob::default(),
            auth_cache: Mutex::new(None),
            stream_error: Mutex::new(None),
            busy: AtomicBool::new(false),
            inflight: Mutex::new(None),
        }
    }
}

fn until_in_future(until: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(until)
        .map(|t| t > chrono::Utc::now())
        .unwrap_or(false)
}

impl ClaudeCode {
    fn remember_error(&self, code: &'static str, until: Option<String>) {
        *lock(&self.stream_error) = Some(CachedError {
            code,
            until,
            at: Instant::now(),
        });
    }

    fn clear_errors(&self) {
        *lock(&self.stream_error) = None;
        *lock(&self.auth_cache) = None;
    }

    /// The cached stream error that still applies, if any.
    fn current_error(&self, fresh: bool) -> Option<ProviderStatus> {
        let mut guard = lock(&self.stream_error);
        let cached = guard.clone()?;
        let keep = match cached.code {
            "limit_reached" => match &cached.until {
                Some(until) => until_in_future(until),
                None => cached.at.elapsed() < LIMIT_TTL,
            },
            "provider_unavailable" => !fresh,
            _ => true,
        };
        if !keep {
            *guard = None;
            return None;
        }
        let state = match cached.code {
            "limit_reached" => ProviderState::LimitReached,
            "needs_sign_in" => ProviderState::NeedsSignIn,
            "plan_not_eligible" => ProviderState::PlanNotEligible,
            _ => ProviderState::ProviderUnavailable,
        };
        Some(ProviderStatus {
            state,
            until: cached.until,
        })
    }

    fn signed_in(&self, bin: &Verified, dirs: &Dirs, fresh: bool) -> bool {
        if !fresh && let Some((logged_in, at)) = *lock(&self.auth_cache) {
            let ttl = if logged_in {
                AUTH_TTL_AVAILABLE
            } else {
                AUTH_TTL_OTHER
            };
            if at.elapsed() < ttl {
                return logged_in;
            }
        }
        let logged_in = auth_status(bin, dirs).is_some_and(|s| s.plan_signed_in());
        *lock(&self.auth_cache) = Some((logged_in, Instant::now()));
        logged_in
    }

    pub fn status(&self, dirs: &Dirs, fresh: bool) -> ProviderStatus {
        if !offered() {
            return ProviderStatus::plain(ProviderState::NotOffered);
        }
        if self.job.alive() {
            return ProviderStatus::plain(ProviderState::Connecting);
        }
        let Some(located) = locate(dirs) else {
            return ProviderStatus::plain(ProviderState::NotConnected);
        };
        if let Some(status) = self.current_error(fresh) {
            return status;
        }
        if self.signed_in(&located.bin, dirs, fresh) {
            ProviderStatus::plain(ProviderState::Available)
        } else {
            ProviderStatus::plain(ProviderState::NotConnected)
        }
    }

    pub fn info(&self, dirs: &Dirs) -> ClaudeCodeInfo {
        match locate(dirs) {
            Some(located) => ClaudeCodeInfo {
                offered: offered(),
                version: Some(located.version.to_string()),
                path: Some(located.bin.path().to_string_lossy().into_owned()),
                signed: true,
                identity: Some(IDENTITY.to_owned()),
                source: located.source,
            },
            None => ClaudeCodeInfo {
                offered: offered(),
                version: None,
                path: None,
                signed: false,
                identity: None,
                source: Source::None,
            },
        }
    }

    /// Starts the sign-in job: fetch when absent, then `claude auth login` in the browser. Answers
    /// with the seeded stage, so a helper already on the Mac skips the fetching screen.
    pub fn start(self: &Arc<Self>, dirs: Dirs) -> Result<ConnectPoll, String> {
        if !offered() {
            return Err("not_offered".to_owned());
        }
        if !self.job.try_start() {
            return Err("busy".to_owned());
        }
        // The stage is seeded before the worker starts, so the first poll never reads idle.
        let located = dirs.ensure().ok().and_then(|()| locate(&dirs));
        let seeded = ConnectPoll::stage(if located.is_some() {
            Stage::SigningIn
        } else {
            Stage::Fetching
        });
        self.job.set(seeded);
        let me = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("talos-claude-connect".into())
            .spawn(move || {
                let outcome = me.connect(&dirs, located);
                me.clear_errors();
                me.job.finish(outcome);
            });
        if spawned.is_err() {
            self.job
                .finish(ConnectPoll::failed(ConnectOutcome::ProviderUnavailable));
            return Err("busy".to_owned());
        }
        Ok(seeded)
    }

    fn connect(&self, dirs: &Dirs, located: Option<Located>) -> ConnectPoll {
        if dirs.ensure().is_err() {
            return ConnectPoll::failed(ConnectOutcome::FetchFailed);
        }
        let located = match located {
            Some(located) => located,
            None => {
                self.job.set(ConnectPoll::stage(Stage::Fetching));
                match fetch(dirs, self.job.cancel_flag()) {
                    Ok(located) => located,
                    Err(FetchError::Cancelled) => {
                        return ConnectPoll::failed(ConnectOutcome::Closed);
                    }
                    Err(_) => return ConnectPoll::failed(ConnectOutcome::FetchFailed),
                }
            }
        };
        if self.job.cancelled() {
            return ConnectPoll::failed(ConnectOutcome::Closed);
        }
        self.job.set(ConnectPoll::stage(Stage::SigningIn));
        // The signature is checked again right before the sign-in spawn.
        let Ok(bin) = verify(located.bin.path()) else {
            return ConnectPoll::failed(ConnectOutcome::ProviderUnavailable);
        };
        let Ok(run_dir) = RunDir::create() else {
            return ConnectPoll::failed(ConnectOutcome::ProviderUnavailable);
        };
        let mut command = claude_command(&bin, dirs, run_dir.path(), &["auth", "login"]);
        command.stdin(Stdio::piped());
        let Ok(mut child) = command.spawn() else {
            return ConnectPoll::failed(ConnectOutcome::ProviderUnavailable);
        };
        // stdin stays open until the child exits; stdout is drained and dropped.
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().and_then(exec::spawn_reader);
        let deadline = Instant::now() + CONNECT_DEADLINE;
        let outcome = loop {
            if self.job.cancelled() {
                kill(&mut child);
                break ConnectOutcome::Closed;
            }
            if Instant::now() >= deadline {
                kill(&mut child);
                break ConnectOutcome::Timeout;
            }
            match child.wait_timeout(Duration::from_millis(500)) {
                Ok(Some(_)) => {
                    // The sign-in may have taken minutes: the signature is checked again before the probe.
                    let Ok(bin) = verify(located.bin.path()) else {
                        break ConnectOutcome::ProviderUnavailable;
                    };
                    let signed_in = auth_status(&bin, dirs).is_some_and(|s| s.plan_signed_in());
                    if signed_in {
                        drop(stdin);
                        exec::join(stdout);
                        return ConnectPoll::stage(Stage::Done);
                    }
                    break ConnectOutcome::Closed;
                }
                Ok(None) => continue,
                Err(_) => {
                    kill(&mut child);
                    break ConnectOutcome::ProviderUnavailable;
                }
            }
        };
        drop(stdin);
        exec::join(stdout);
        ConnectPoll::failed(outcome)
    }

    /// `claude auth logout` under the Talos config dir, then the credentials file by name.
    /// Claude Code keys its Keychain item to `CLAUDE_CONFIG_DIR` (code.claude.com/docs/en/iam,
    /// "Credential management"; probed on 2.1.287 with a throwaway dir), so the owner's own item
    /// is out of reach. Only a logout that ran and a status probe that no longer reports claude.ai
    /// count as cleared; anything else is an error and the webview keeps showing the sign-in.
    pub fn disconnect(&self, dirs: &Dirs) -> Result<(), String> {
        *lock(&self.auth_cache) = None;
        if dirs.ensure().is_err() {
            return Err("provider_unavailable".to_owned());
        }
        let Some(located) = locate(dirs) else {
            return Err("provider_unavailable".to_owned());
        };
        let logged_out = matches!(
            run_capture(
                claude_command(&located.bin, dirs, &dirs.home, &["auth", "logout"]),
                SHORT_TIMEOUT,
            ),
            Ok(Some((_, Some(0))))
        );
        match std::fs::remove_file(dirs.config.join(".credentials.json")) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.to_string()),
        }
        if !logged_out {
            return Err("provider_unavailable".to_owned());
        }
        // The signature is checked again before the status probe.
        let Ok(bin) = verify(located.bin.path()) else {
            return Err("provider_unavailable".to_owned());
        };
        if auth_status(&bin, dirs).is_some_and(|s| s.plan_signed_in()) {
            return Err("provider_unavailable".to_owned());
        }
        self.clear_errors();
        Ok(())
    }

    /// Streams one explanation; events go to `emit`. Returns once the stream has ended.
    pub fn generate(
        &self,
        dirs: &Dirs,
        request: GenerateRequest,
        emit: &dyn Fn(StreamPayload),
    ) -> Result<(), String> {
        validate(&request)?;
        if !offered() {
            return Err("not_offered".into());
        }
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err("busy".into());
        }
        let result = self.run(dirs, &request, emit);
        *lock(&self.inflight) = None;
        self.busy.store(false, Ordering::SeqCst);
        result
    }

    fn run(
        &self,
        dirs: &Dirs,
        request: &GenerateRequest,
        emit: &dyn Fn(StreamPayload),
    ) -> Result<(), String> {
        let id = request.id.as_str();
        let Some(located) = locate(dirs) else {
            return Err("not_connected".into());
        };
        if dirs.ensure().is_err() {
            return Err("not_connected".into());
        }
        // The signature is checked again right before the explanation spawn.
        let Ok(bin) = verify(located.bin.path()) else {
            emit(StreamPayload::error(id, "internal"));
            return Ok(());
        };
        let Ok(run_dir) = RunDir::create() else {
            emit(StreamPayload::error(id, "internal"));
            return Ok(());
        };
        let args = generate_args(&request.instructions, schemas::for_task(request.task));
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let mut command = claude_command(&bin, dirs, run_dir.path(), &arg_refs);
        command.stdin(Stdio::piped());
        let Ok(mut child) = command.spawn() else {
            emit(StreamPayload::error(id, "internal"));
            return Ok(());
        };
        let cancel = Arc::new(AtomicBool::new(false));
        *lock(&self.inflight) = Some(InFlight {
            id: id.to_owned(),
            cancel: Arc::clone(&cancel),
        });
        let prompt = request.prompt.clone();
        let writer = child.stdin.take().map(|mut stdin| {
            std::thread::spawn(move || {
                let _ = stdin.write_all(prompt.as_bytes());
                let _ = stdin.flush();
            })
        });
        let (tx, rx) = mpsc::channel();
        let reader = child.stdout.take().map(|stdout| {
            std::thread::spawn(move || {
                let mut lines = super::protocol::LineReader::new(std::io::BufReader::new(stdout));
                while let Ok(line) = lines.next_line() {
                    match line {
                        super::protocol::Line::Text(text) => {
                            if tx.send(claude_stream::parse_line(&text)).is_err() {
                                break;
                            }
                        }
                        super::protocol::Line::TooLong | super::protocol::Line::NotUtf8 => {}
                        super::protocol::Line::Eof => break,
                    }
                }
            })
        });

        let started = Instant::now();
        let mut buffer = String::new();
        let mut pending: Option<Value> = None;
        let mut last_emit: Option<Instant> = None;
        let mut first_deadline = Some(started + FIRST_PARTIAL_TIMEOUT);
        let whole_deadline = started + WHOLE_TIMEOUT;
        let outcome: Result<Value, &'static str> = loop {
            if cancel.load(Ordering::SeqCst) {
                break Err("cancelled");
            }
            let now = Instant::now();
            if now >= whole_deadline || first_deadline.is_some_and(|d| now >= d) {
                break Err("timeout");
            }
            if let Some(json) = pending.take() {
                if last_emit.is_none_or(|t| t.elapsed() >= PARTIAL_INTERVAL) {
                    last_emit = Some(Instant::now());
                    emit(StreamPayload::partial(id, json));
                } else {
                    pending = Some(json);
                }
            }
            match rx.recv_timeout(Duration::from_millis(50)) {
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break Err("exit"),
                Ok(Parsed::Other) => continue,
                Ok(Parsed::Delta(piece)) => {
                    first_deadline = None;
                    buffer.push_str(&piece);
                    if let Some(object) = partial_json::complete_object(&buffer) {
                        pending = Some(Value::Object(object));
                    }
                }
                Ok(Parsed::Result(Ok(output))) => break Ok(output),
                Ok(Parsed::Result(Err(error))) => {
                    let classified = claude_stream::classify(&error, chrono::Local::now());
                    self.remember_error(classified.code, classified.until.clone());
                    emit(StreamPayload::error_until(
                        id,
                        classified.code,
                        classified.until,
                    ));
                    kill(&mut child);
                    if let Some(handle) = reader {
                        let _ = handle.join();
                    }
                    if let Some(handle) = writer {
                        let _ = handle.join();
                    }
                    return Ok(());
                }
            }
        };
        kill(&mut child);
        if let Some(handle) = reader {
            let _ = handle.join();
        }
        if let Some(handle) = writer {
            let _ = handle.join();
        }
        match outcome {
            Ok(output) => {
                *lock(&self.stream_error) = None;
                emit(StreamPayload::done(id, output));
            }
            Err("cancelled") => emit(StreamPayload::error(id, "cancelled")),
            Err("timeout") => emit(StreamPayload::error(id, "timeout")),
            Err(_) => {
                self.remember_error("provider_unavailable", None);
                emit(StreamPayload::error(id, "provider_unavailable"));
            }
        }
        Ok(())
    }

    /// Kills the run by id; a no-op when nothing by that id is running.
    pub fn cancel(&self, id: &str) {
        if let Some(inflight) = lock(&self.inflight).as_ref().filter(|f| f.id == id) {
            inflight.cancel.store(true, Ordering::SeqCst);
        }
    }
}

fn kill(child: &mut Child) {
    if matches!(child.try_wait(), Ok(None)) {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "talos-claude-test-{tag}-{}-{}",
            std::process::id(),
            random_hex(4)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn copy_of_ls(dir: &Path) -> PathBuf {
        let copy = dir.join("ls-copy");
        std::fs::copy("/bin/ls", &copy).unwrap();
        std::fs::set_permissions(&copy, std::fs::Permissions::from_mode(0o755)).unwrap();
        copy
    }

    #[test]
    fn versions_parse_and_compare() {
        assert_eq!(
            Version::parse("2.1.287 (Claude Code)"),
            Some(Version(2, 1, 287))
        );
        assert_eq!(Version::parse("v2.1.259"), Some(Version(2, 1, 259)));
        assert_eq!(Version::parse("2.1"), None);
        assert_eq!(Version::parse("2.1.2.3"), None);
        assert_eq!(Version::parse("latest"), None);
        assert!(Version(2, 1, 259).supported());
        assert!(Version(2, 2, 0).supported());
        assert!(Version(3, 0, 0).supported());
        assert!(!Version(2, 1, 258).supported());
        assert!(!Version(1, 9, 999).supported());
        assert!(Version(2, 1, 287) > Version(2, 1, 259));
        assert_eq!(Version(2, 1, 287).to_string(), "2.1.287");
        assert_eq!(valid_release_version("2.1.292\n"), Some(Version(2, 1, 292)));
        assert_eq!(valid_release_version("<html>"), None);
        assert_eq!(valid_release_version("2.1.292 beta"), None);
    }

    #[test]
    fn the_command_is_absolute_literal_and_scrubbed() {
        let root = temp_root("cmd");
        let dirs = Dirs::under(&root);
        let bin = Verified::trusted_for_tests(Path::new("/opt/talos/claude"));
        let instructions = "You explain. Secret canary: NEVER-IN-ARGS";
        let args = generate_args("You explain.", schemas::EXPLAIN);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let command = claude_command(&bin, &dirs, &dirs.home, &refs);
        assert_eq!(command.get_program(), "/opt/talos/claude");
        let got: Vec<String> = command
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(got[0], "-p");
        assert!(got.contains(&"--safe-mode".to_owned()));
        assert!(got.contains(&"--no-session-persistence".to_owned()));
        assert!(!got.iter().any(|a| a == "--bare" || a == "--model"));
        let mode = got.iter().position(|a| a == "--permission-mode").unwrap();
        assert_eq!(got[mode + 1], "default");
        assert!(!got.iter().any(|a| a.contains(instructions)));
        assert_eq!(got.last().map(String::as_str), Some(schemas::EXPLAIN));
        let prompt_position = got.iter().position(|a| a == "--json-schema").unwrap();
        assert_eq!(
            prompt_position + 2,
            got.len(),
            "no positional after the schema"
        );
        let envs: Vec<(String, Option<String>)> = command
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect();
        let mut keys: Vec<&str> = envs.iter().map(|(k, _)| k.as_str()).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
                "CLAUDE_CONFIG_DIR",
                "DISABLE_AUTOUPDATER",
                "HOME",
                "LANG",
                "PATH",
            ]
        );
        let value = |key: &str| {
            envs.iter()
                .find(|(k, _)| k == key)
                .and_then(|(_, v)| v.clone())
                .unwrap()
        };
        assert_eq!(value("PATH"), "/usr/bin:/bin");
        assert_eq!(value("LANG"), "en_GB.UTF-8");
        assert_eq!(value("HOME"), dirs.home.to_string_lossy());
        assert_eq!(value("CLAUDE_CONFIG_DIR"), dirs.config.to_string_lossy());
        assert_eq!(command.get_current_dir(), Some(dirs.home.as_path()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn verify_refuses_other_signers_and_unsigned_copies() {
        let helper = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/talos-ai-aarch64-apple-darwin");
        assert_eq!(verify(&helper), Err(VerifyError::Rejected));
        let root = temp_root("verify");
        let copy = copy_of_ls(&root);
        assert_eq!(verify(&copy), Err(VerifyError::Rejected));
        assert_eq!(
            verify(Path::new("/nonexistent/claude")),
            Err(VerifyError::Missing)
        );
        assert_eq!(verify(&root), Err(VerifyError::Missing), "a folder is not a binary");
        // Every call runs codesign: a second check of the same copy is rejected the same way.
        assert_eq!(verify(&copy), Err(VerifyError::Rejected));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Needs the owner's install; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn verify_accepts_the_installed_claude_code() {
        let bin = dirs::home_dir()
            .unwrap()
            .join(".local/share/claude/versions/2.1.287");
        let verified = verify(&bin).unwrap();
        assert_eq!(verified.path(), bin);
        assert!(verify(&bin).is_ok(), "a second check passes too");
    }

    #[test]
    fn locate_prefers_the_highest_supported_verified_install() {
        let root = temp_root("locate");
        let home = root.join("home");
        let versions = home.join(".local/share/claude/versions");
        std::fs::create_dir_all(&versions).unwrap();
        for name in ["2.1.258", "2.1.260", "2.1.290", "junk"] {
            std::fs::write(versions.join(name), b"x").unwrap();
        }
        std::fs::create_dir_all(home.join(".local/bin")).unwrap();
        std::os::unix::fs::symlink(versions.join("2.1.260"), home.join(".local/bin/claude"))
            .unwrap();
        let dirs = Dirs::under(&root.join("data"));
        let rejects_290 = |path: &Path| -> Option<Verified> {
            (path.file_name()?.to_str()? != "2.1.290").then(|| Verified::trusted_for_tests(path))
        };
        let never = |_: &Verified| -> Option<Version> { panic!("file names carry the version") };
        let found = locate_with(Some(&home), &dirs, &rejects_290, &never).unwrap();
        assert_eq!(found.version, Version(2, 1, 260));
        assert_eq!(found.source, Source::Existing);
        assert_eq!(found.bin.path(), versions.join("2.1.260"));

        let accepts_all =
            |path: &Path| -> Option<Verified> { Some(Verified::trusted_for_tests(path)) };
        let found = locate_with(Some(&home), &dirs, &accepts_all, &never).unwrap();
        assert_eq!(found.version, Version(2, 1, 290));

        // Only the symlink remains: its canonical name carries the version.
        for name in ["2.1.258", "2.1.290", "junk"] {
            std::fs::remove_file(versions.join(name)).unwrap();
        }
        let only_link = |path: &Path| -> Option<Verified> {
            (path == versions.join("2.1.260")).then(|| Verified::trusted_for_tests(path))
        };
        let found = locate_with(Some(&home), &dirs, &only_link, &never).unwrap();
        assert_eq!(found.version, Version(2, 1, 260));

        // Nothing of the person's verifies: fall back to installed.json under our versions dir.
        let none = |_: &Path| -> Option<Verified> { None };
        assert!(locate_with(Some(&home), &dirs, &none, &never).is_none());
        std::fs::create_dir_all(&dirs.versions).unwrap();
        let ours = dirs.versions.join("2.1.292");
        std::fs::write(&ours, b"x").unwrap();
        let installed = serde_json::json!({ "version": "2.1.292", "path": ours });
        std::fs::write(&dirs.installed, installed.to_string()).unwrap();
        assert!(
            locate_with(Some(&home), &dirs, &none, &never).is_none(),
            "ours must verify too"
        );
        let found = locate_with(None, &dirs, &accepts_all, &never).unwrap();
        assert_eq!(found.source, Source::Fetched);
        assert_eq!(found.version, Version(2, 1, 292));
        // A path outside our versions dir is never trusted.
        let elsewhere = serde_json::json!({ "version": "2.1.292", "path": "/tmp/claude" });
        std::fs::write(&dirs.installed, elsewhere.to_string()).unwrap();
        assert!(locate_with(None, &dirs, &accepts_all, &never).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn manifest_parse_reads_the_platform_entry() {
        let text = r#"{"version":"2.1.292","platforms":{"darwin-arm64":{"binary":"claude","checksum":"97A01E5BC74A199E67189435D0331EA3A24EAC2E07DB4B76D9148C5B0386138F","size":235017328},"darwin-x64":{"binary":"claude","checksum":"a9739a215728ce72435885fedb19d1317ee1ccec61e246fbfb3acaf01689c473","size":243514624}}}"#;
        assert_eq!(
            parse_manifest(text, "darwin-arm64"),
            Some(Manifest {
                checksum: "97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f".into(),
                size: 235017328,
            })
        );
        assert_eq!(parse_manifest(text, "linux-x64"), None);
        assert_eq!(
            parse_manifest(
                r#"{"platforms":{"darwin-arm64":{"checksum":"zz","size":1}}}"#,
                "darwin-arm64"
            ),
            None
        );
        assert_eq!(parse_manifest("nope", "darwin-arm64"), None);
        assert!(platform().starts_with("darwin-"));
    }

    #[test]
    fn auth_status_parses_a_fixture_and_keeps_two_fields() {
        let fixture = r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"someone@example.com","orgName":"Example","subscriptionType":"max"}"#;
        let status = parse_auth_status(fixture).unwrap();
        assert_eq!(
            status,
            AuthStatus {
                logged_in: true,
                auth_method: "claude.ai".into()
            }
        );
        assert!(status.plan_signed_in());
        let none = parse_auth_status(r#"{"loggedIn":false,"authMethod":"none"}"#).unwrap();
        assert!(!none.plan_signed_in());
        let key = parse_auth_status(r#"{"loggedIn":true,"authMethod":"api_key"}"#).unwrap();
        assert!(!key.plan_signed_in(), "an API key is not the plan");
        assert_eq!(parse_auth_status("Not logged in (exit 1)"), None);
    }

    #[test]
    fn validation_adds_the_leading_dash_rule() {
        let mut req = GenerateRequest {
            id: "ok1".into(),
            task: super::super::protocol::Task::Explain,
            instructions: "Explain.".into(),
            prompt: "{}".into(),
        };
        assert_eq!(validate(&req), Ok(()));
        req.instructions = "--system-prompt".into();
        assert_eq!(validate(&req), Err("invalid_text".into()));
        req.instructions = "x".repeat(MAX_INSTRUCTIONS_CHARS + 1);
        assert_eq!(validate(&req), Err("instructions_too_long".into()));
        req.instructions = "ok".into();
        req.prompt = "y".repeat(MAX_PROMPT_CHARS + 1);
        assert_eq!(validate(&req), Err("prompt_too_long".into()));
        req.prompt.clear();
        req.id = "Bad".into();
        assert_eq!(validate(&req), Err("invalid_id".into()));
    }

    #[test]
    fn dirs_are_owner_only_and_run_dirs_vanish() {
        let root = temp_root("dirs");
        let dirs = Dirs::under(&root);
        dirs.ensure().unwrap();
        for dir in [&dirs.root, &dirs.config, &dirs.home, &dirs.versions] {
            let mode = std::fs::metadata(dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700, "{}", dir.display());
        }
        let path = {
            let run = RunDir::create().unwrap();
            assert_eq!(run.path().parent(), Some(Path::new(RUN_DIR_ROOT)));
            assert!(
                !run.path().starts_with(std::env::temp_dir()),
                "never under the per-user temp dir"
            );
            let mode = std::fs::metadata(run.path()).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
            run.path().to_path_buf()
        };
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn status_without_a_binary_is_not_connected_and_errors_are_remembered() {
        let root = temp_root("status");
        let dirs = Dirs::under(&root.join("data"));
        let claude = ClaudeCode::default();
        if offered() {
            // The person's own install may exist on this Mac; only the error cache is asserted.
            claude.remember_error("limit_reached", Some("2099-01-01T00:00:00Z".into()));
            let status = claude.current_error(false).unwrap();
            assert_eq!(status.state, ProviderState::LimitReached);
            assert_eq!(status.until.as_deref(), Some("2099-01-01T00:00:00Z"));
            claude.remember_error("limit_reached", Some("2000-01-01T00:00:00Z".into()));
            assert!(
                claude.current_error(false).is_none(),
                "a past reset time expires"
            );
            claude.remember_error("provider_unavailable", None);
            assert_eq!(
                claude.current_error(false).map(|s| s.state),
                Some(ProviderState::ProviderUnavailable)
            );
            assert!(claude.current_error(true).is_none(), "fresh clears it");
            claude.remember_error("needs_sign_in", None);
            assert_eq!(
                claude.current_error(true).map(|s| s.state),
                Some(ProviderState::NeedsSignIn)
            );
            // With a binary on this Mac the logout runs under the throwaway config dir and the
            // status probe reports no sign-in; without one, disconnect must refuse rather than
            // claim the sign-in is cleared.
            let has_binary = locate(&dirs).is_some();
            let cleared = claude.disconnect(&dirs);
            assert_eq!(cleared.is_ok(), has_binary, "{cleared:?}");
            assert_eq!(claude.current_error(false).is_none(), has_binary);
        } else {
            assert_eq!(claude.status(&dirs, true).state, ProviderState::NotOffered);
        }
        let info = ClaudeCode::default().info(&Dirs::under(&root.join("empty")));
        assert_eq!(info.offered, offered());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_cancel_during_a_stalled_download_is_seen_and_a_full_body_is_checked() {
        use std::net::TcpListener;
        let root = temp_root("download");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (release, held) = mpsc::channel::<()>();
        // Headers and one chunk, then nothing until the test lets go.
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut head = [0u8; 4096];
            let _ = stream.read(&mut head);
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\n");
            let _ = stream.write_all(&[7u8; 1024]);
            let _ = stream.flush();
            let _ = held.recv_timeout(Duration::from_secs(20));
        });
        let url = format!("http://127.0.0.1:{port}/stalled");
        let manifest = Manifest {
            checksum: "0".repeat(64),
            size: 1_000_000,
        };
        let part = root.join("stalled.part");
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancel);
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            flag.store(true, Ordering::SeqCst);
        });
        let started = Instant::now();
        let result = download(&url, &manifest, &part, &cancel);
        assert_eq!(result.unwrap_err(), FetchError::Cancelled);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "cancel seen while the body stalls"
        );
        canceller.join().unwrap();
        let _ = release.send(());
        server.join().unwrap();

        // A complete body is hashed and compared with the manifest.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let body = vec![9u8; 200 * 1024];
        let digest: String = Sha256::digest(&body)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let served = body.clone();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut head = [0u8; 4096];
            let _ = stream.read(&mut head);
            let _ = stream.write_all(
                format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", served.len()).as_bytes(),
            );
            let _ = stream.write_all(&served);
            let _ = stream.flush();
        });
        let url = format!("http://127.0.0.1:{port}/claude");
        let part = root.join("whole.part");
        let wrong = Manifest {
            checksum: "0".repeat(64),
            size: body.len() as u64,
        };
        assert_eq!(
            download(&url, &wrong, &part, &AtomicBool::new(false)).unwrap_err(),
            FetchError::ChecksumMismatch
        );
        server.join().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let served = body.clone();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut head = [0u8; 4096];
            let _ = stream.read(&mut head);
            let _ = stream.write_all(
                format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", served.len()).as_bytes(),
            );
            let _ = stream.write_all(&served);
            let _ = stream.flush();
        });
        let url = format!("http://127.0.0.1:{port}/claude");
        let right = Manifest {
            checksum: digest,
            size: body.len() as u64,
        };
        download(&url, &right, &part, &AtomicBool::new(false)).unwrap();
        assert_eq!(std::fs::read(&part).unwrap(), body);
        server.join().unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Manual recorder, run once by hand. Points Claude Code at a local listener that answers 401
    /// and checks what the first request carries. Uses throwaway HOME and config dirs only.
    #[test]
    #[ignore]
    fn recorder_shows_the_prompt_on_stdin_and_no_canary() {
        use std::io::BufRead;
        use std::net::TcpListener;
        let bin_path = dirs::home_dir()
            .unwrap()
            .join(".local/share/claude/versions/2.1.287");
        let bin = verify(&bin_path).unwrap();
        let root = temp_root("recorder");
        let dirs = Dirs::under(&root.join("data"));
        dirs.ensure().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let capture = std::thread::spawn(move || {
            // Claude Code first sends HEAD /api/hello, then POSTs the message, maybe on the same
            // keep-alive connection. Answer the probe 200 and capture the first POST.
            let deadline = Instant::now() + Duration::from_secs(45);
            while Instant::now() < deadline {
                let Ok((mut stream, _)) = listener.accept() else {
                    continue;
                };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                loop {
                    let mut head = String::new();
                    let mut length = 0usize;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 {
                            break;
                        }
                        if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                            length = v.trim().parse().unwrap_or(0);
                        }
                        head.push_str(&line);
                        if line == "\r\n" {
                            break;
                        }
                    }
                    if head.is_empty() {
                        break;
                    }
                    let mut body = vec![0u8; length];
                    let _ = reader.read_exact(&mut body);
                    if head.starts_with("POST ") {
                        let _ = stream.write_all(
                            b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                        );
                        return (head, String::from_utf8_lossy(&body).into_owned());
                    }
                    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
                }
            }
            (String::new(), String::new())
        });
        let run_dir = RunDir::create().unwrap();
        let canary_dir = run_dir.path().parent().unwrap().to_path_buf();
        let canary = canary_dir.join("CLAUDE.md");
        std::fs::write(&canary, "CANARY-CLAUDE-MD-7731").unwrap();
        let args = generate_args("SYSTEM-PROMPT-MARKER-4412 You explain.", schemas::EXPLAIN);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let mut command = claude_command(&bin, &dirs, run_dir.path(), &refs);
        command
            .stdin(Stdio::piped())
            .env("ANTHROPIC_API_KEY", "dummy")
            .env("ANTHROPIC_BASE_URL", format!("http://127.0.0.1:{port}"));
        let mut child = command.spawn().unwrap();
        {
            let mut stdin = child.stdin.take().unwrap();
            stdin
                .write_all(b"{\"turns\":[{\"role\":\"user\",\"content\":\"PROMPT-MARKER-9901\"}]}")
                .unwrap();
        }
        let stdout = child.stdout.take().and_then(exec::spawn_reader);
        let _ = child.wait_timeout(Duration::from_secs(60));
        kill(&mut child);
        let (out, _) = exec::join(stdout);
        let (head, body) = capture.join().unwrap();
        let _ = std::fs::remove_file(&canary);
        let _ = std::fs::remove_dir_all(&root);
        let home = dirs::home_dir().unwrap().to_string_lossy().into_owned();
        let account = std::env::var("USER").unwrap_or_default();
        eprintln!(
            "--- request head ---\n{head}\n--- body ({} bytes) ---\n{body}\n--- stdout ---\n{}",
            body.len(),
            String::from_utf8_lossy(out.as_slice())
        );
        assert!(
            body.contains("PROMPT-MARKER-9901"),
            "the prompt arrived via stdin"
        );
        assert!(
            body.contains("SYSTEM-PROMPT-MARKER-4412"),
            "the system prompt is sent"
        );
        assert!(
            !body.contains("CANARY-CLAUDE-MD-7731"),
            "no ancestor CLAUDE.md"
        );
        assert!(!body.contains(&home), "no home path");
        if !account.is_empty() {
            assert!(!body.contains(&account), "no account name");
        }
        // Claude Code names the cwd; it must carry no per-user path.
        assert!(!body.contains("/var/folders/"), "no per-user temp path");
        assert!(
            !body.contains(&std::env::temp_dir().to_string_lossy().into_owned()),
            "no per-user temp path"
        );
    }
}
