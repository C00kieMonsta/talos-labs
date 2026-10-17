//! "Sign in with ChatGPT": PKCE in the browser, a loopback callback, the token exchange and
//! refresh, the five Rust-only Keychain items. The webview only ever sees a current access token.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::provider::{
    CONNECT_DEADLINE, ConnectJob, ConnectOutcome, ConnectPoll, ProviderState, ProviderStatus, Stage,
};
use crate::secret;

pub const AUTHORIZE_URL: &str = "https://auth.openai.com/api/accounts/authorize";
pub const TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
pub const RESOURCE: &str = "https://api.openai.com/v1";
/// The models-and-inference doc: GET /v1/models with the plan token answers `{ models: [{ slug, display_name, visibility }] }`.
pub const MODELS_URL: &str = "https://api.openai.com/v1/models";
pub const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
pub const BOOTSTRAP_CLIENT_ID: &str = "dynamic_agent_client";
pub const AGENT_NAME_HINT: &str = "Talos Labs";
pub const CALLBACK_PATH: &str = "/auth/callback";
pub const STATE_FILE: &str = "chatgpt.json";

pub const SECRET_ACCESS: &str = "chatgpt_access_token";
pub const SECRET_REFRESH: &str = "chatgpt_refresh_token";
pub const SECRET_CLIENT_ID: &str = "chatgpt_client_id";
pub const SECRET_SCOPE: &str = "chatgpt_scope";
pub const SECRET_EXPIRES_AT: &str = "chatgpt_token_expires_at";
/// Written in this order; `expires_at` last so a partial write reads as not connected.
pub const SECRET_NAMES: [&str; 5] = [
    SECRET_ACCESS,
    SECRET_REFRESH,
    SECRET_CLIENT_ID,
    SECRET_SCOPE,
    SECRET_EXPIRES_AT,
];
/// The items a sign-out removes. The issued client id stays: it names this app on this Mac, not the person, and a new sign-in reuses it instead of registering again.
pub const SECRET_TOKEN_NAMES: [&str; 4] = [SECRET_ACCESS, SECRET_REFRESH, SECRET_SCOPE, SECRET_EXPIRES_AT];

/// Refresh when the access token expires within this.
pub const REFRESH_MARGIN: Duration = Duration::from_secs(60);
const MAX_MISMATCHES: u32 = 5;
const REQUEST_CAP: usize = 8 * 1024;
const BODY_CAP: u64 = 1024 * 1024;
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
/// Refresh error codes that mean the sign-in is gone.
const SIGN_IN_GONE: [&str; 5] = [
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
];

/// Build flag: release builds keep ChatGPT at `not_offered` until OpenAI issues an approval.
pub fn offered() -> bool {
    cfg!(debug_assertions) || option_env!("TALOS_CHATGPT_APPROVED") == Some("1")
}

// ---------- storage ----------

/// The Keychain, or a map in tests.
pub trait Store {
    fn get(&self, name: &str) -> Result<Option<String>, String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    fn delete(&self, name: &str) -> Result<(), String>;
}

pub struct Keychain;

impl Store for Keychain {
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        secret::get(name)
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        secret::set(name, value)
    }
    fn delete(&self, name: &str) -> Result<(), String> {
        secret::delete(name)
    }
}

/// What the Keychain holds for a connected account. Debug prints no token.
pub struct Tokens {
    pub access: Zeroizing<String>,
    pub refresh: Zeroizing<String>,
    pub client_id: String,
    pub scope: String,
    pub expires_at: String,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Tokens")
            .field("client_id", &self.client_id)
            .field("expires_at", &self.expires_at)
            .finish_non_exhaustive()
    }
}

/// None when any of the five is missing; the rest are then deleted.
pub fn load_tokens(store: &dyn Store) -> Result<Option<Tokens>, String> {
    let mut values: Vec<Option<String>> = Vec::with_capacity(SECRET_NAMES.len());
    for name in SECRET_NAMES {
        values.push(store.get(name)?);
    }
    let mut values = values.into_iter();
    let fields = (
        values.next().flatten(),
        values.next().flatten(),
        values.next().flatten(),
        values.next().flatten(),
        values.next().flatten(),
    );
    match fields {
        (Some(access), Some(refresh), Some(client_id), Some(scope), Some(expires_at)) => {
            Ok(Some(Tokens {
                access: Zeroizing::new(access),
                refresh: Zeroizing::new(refresh),
                client_id,
                scope,
                expires_at,
            }))
        }
        _ => {
            clear_tokens(store)?;
            Ok(None)
        }
    }
}

pub fn save_tokens(store: &dyn Store, tokens: &Tokens) -> Result<(), String> {
    store.set(SECRET_ACCESS, &tokens.access)?;
    store.set(SECRET_REFRESH, &tokens.refresh)?;
    store.set(SECRET_CLIENT_ID, &tokens.client_id)?;
    store.set(SECRET_SCOPE, &tokens.scope)?;
    store.set(SECRET_EXPIRES_AT, &tokens.expires_at)
}

/// Deletes the four token items and keeps the client id.
pub fn clear_tokens(store: &dyn Store) -> Result<(), String> {
    let mut first_err = None;
    for name in SECRET_TOKEN_NAMES {
        if let Err(err) = store.delete(name) {
            first_err.get_or_insert(err);
        }
    }
    first_err.map_or(Ok(()), Err)
}

/// `<app_data>/chatgpt.json`: the stable host id, the chosen model slug, whether the last
/// models call said the plan is not eligible and whether the last refresh said the sign-in is
/// gone. Not secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostState {
    #[serde(default)]
    pub host_id: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub plan_not_eligible: bool,
    #[serde(default)]
    pub needs_sign_in: bool,
}

fn state_path(dir: &Path) -> PathBuf {
    dir.join(STATE_FILE)
}

pub fn read_host_state(dir: &Path) -> HostState {
    std::fs::read(state_path(dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn write_host_state(dir: &Path, state: &HostState) -> Result<(), String> {
    let bytes = serde_json::to_vec(state).map_err(|e| e.to_string())?;
    crate::report_store::write_private(&state_path(dir), &bytes).map_err(|e| e.to_string())
}

/// The host id, generated once.
pub fn ensure_host_state(dir: &Path) -> Result<HostState, String> {
    let mut state = read_host_state(dir);
    if state.host_id.len() != 32 || !state.host_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        state.host_id = random_hex(16);
        write_host_state(dir, &state)?;
    }
    Ok(state)
}

// ---------- PKCE and URLs ----------

pub fn random_bytes<const N: usize>() -> [u8; N] {
    use rand::RngCore;
    let mut buf = [0u8; N];
    rand::rng().fill_bytes(&mut buf);
    buf
}

pub fn random_hex(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub struct Pkce {
    pub verifier: Zeroizing<String>,
    pub challenge: String,
}

/// S256: challenge = base64url(sha256(verifier)).
pub fn challenge_for(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

pub fn pkce_from_bytes(bytes: &[u8; 32]) -> Pkce {
    let verifier = b64url(bytes);
    let challenge = challenge_for(&verifier);
    Pkce {
        verifier: Zeroizing::new(verifier),
        challenge,
    }
}

pub fn random_pkce() -> Pkce {
    pkce_from_bytes(&random_bytes::<32>())
}

/// RFC 3986 unreserved characters stay; everything else is percent-encoded.
pub fn url_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Percent-decoding with `+` as a space. None on a bad escape or invalid UTF-8.
pub fn url_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes.get(i)? {
            b'+' => out.push(b' '),
            b'%' => {
                let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 2;
            }
            b => out.push(*b),
        }
        i += 1;
    }
    String::from_utf8(out).ok()
}

pub struct AuthorizeParams<'a> {
    pub client_id: &'a str,
    pub first_registration: bool,
    pub host_id: &'a str,
    pub redirect_uri: &'a str,
    pub state: &'a str,
    pub nonce: &'a str,
    pub code_challenge: &'a str,
}

pub fn authorize_url(p: &AuthorizeParams<'_>) -> String {
    let mut pairs: Vec<(&str, &str)> = vec![("client_id", p.client_id)];
    if p.first_registration {
        pairs.push(("agent_name_hint", AGENT_NAME_HINT));
    }
    pairs.extend([
        ("ext_agent_host_id", p.host_id),
        ("response_type", "code"),
        ("redirect_uri", p.redirect_uri),
        ("scope", SCOPES),
        ("resource", RESOURCE),
        ("state", p.state),
        ("nonce", p.nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", p.code_challenge),
    ]);
    let query: Vec<String> = pairs
        .iter()
        .map(|(k, v)| format!("{}={}", url_encode(k), url_encode(v)))
        .collect();
    format!("{AUTHORIZE_URL}?{}", query.join("&"))
}

pub fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}{CALLBACK_PATH}")
}

pub fn valid_issued_client_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("oaiapp_") else {
        return false;
    };
    !rest.is_empty()
        && rest.len() <= 128
        && rest
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

// ---------- the loopback callback ----------

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Callback {
    pub code: Option<String>,
    pub state: Option<String>,
    pub client_id: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
}

pub fn parse_callback_query(query: &str) -> Callback {
    let mut cb = Callback::default();
    for pair in query.split('&') {
        let (key, value) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        let Some(value) = url_decode(value) else {
            continue;
        };
        match key {
            "code" => cb.code = Some(value),
            "state" => cb.state = Some(value),
            "client_id" => cb.client_id = Some(value),
            "scope" => cb.scope = Some(value),
            "error" => cb.error = Some(value),
            _ => {}
        }
    }
    cb
}

/// Method, path and query from a request head. None when it is not an HTTP request line.
pub fn parse_request_line(head: &str) -> Option<(String, String, String)> {
    let line = head.lines().next()?;
    let mut parts = line.split(' ');
    let method = parts.next()?;
    let target = parts.next()?;
    let version = parts.next()?;
    if !version.starts_with("HTTP/") || parts.next().is_some() {
        return None;
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    Some((method.to_owned(), path.to_owned(), query.to_owned()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListenOutcome {
    Callback {
        code: Zeroizing<String>,
        client_id: Option<String>,
        scope: Option<String>,
    },
    /// The person refused on the provider's page.
    Closed,
    ProviderUnavailable,
    Timeout,
    Cancelled,
}

pub struct ListenParams<'a> {
    pub expected_state: &'a str,
    pub stored_client_id: Option<&'a str>,
    pub cancel: &'a AtomicBool,
    pub deadline: Instant,
    pub io_timeout: Duration,
}

const PAGE_OK: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Talos Labs</title></head><body style=\"font-family:-apple-system,sans-serif;padding:48px\"><p>You can go back to Talos Labs.</p></body></html>";

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let reply = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(reply.as_bytes());
    let _ = stream.flush();
}

enum Head {
    Complete(String),
    /// Nothing arrived, or the client went away.
    Empty,
    /// The whole-connection budget ran out, or the job was cancelled or timed out meanwhile.
    /// `partial` is true when some bytes had arrived, which a browser's idle pre-connection never sends.
    OutOfTime {
        partial: bool,
    },
}

/// Reads the request head, capped at `REQUEST_CAP` bytes, within one wall-clock budget of
/// `io_timeout` for the whole connection so a dripping client cannot hold the listener.
fn read_head(stream: &mut TcpStream, params: &ListenParams<'_>) -> Head {
    let started = Instant::now();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let out_of_time = Head::OutOfTime {
            partial: !buf.is_empty(),
        };
        if params.cancel.load(Ordering::SeqCst) || Instant::now() >= params.deadline {
            return out_of_time;
        }
        let Some(remaining) = params.io_timeout.checked_sub(started.elapsed()) else {
            return out_of_time;
        };
        if remaining.is_zero() || stream.set_read_timeout(Some(remaining)).is_err() {
            return out_of_time;
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(chunk.get(..n).unwrap_or(&[]));
                if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() >= REQUEST_CAP {
                    break;
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(err)
                if err.kind() == std::io::ErrorKind::WouldBlock
                    || err.kind() == std::io::ErrorKind::TimedOut =>
            {
                return Head::OutOfTime {
                    partial: !buf.is_empty(),
                };
            }
            Err(_) => break,
        }
    }
    if buf.is_empty() {
        return Head::Empty;
    }
    buf.truncate(REQUEST_CAP);
    Head::Complete(String::from_utf8_lossy(&buf).into_owned())
}

enum Handled {
    Continue,
    Mismatch,
    Done(ListenOutcome),
}

fn handle_connection(mut stream: TcpStream, params: &ListenParams<'_>) -> Handled {
    let _ = stream.set_write_timeout(Some(params.io_timeout));
    let head = match read_head(&mut stream, params) {
        Head::Complete(head) => head,
        Head::Empty | Head::OutOfTime { partial: false } => return Handled::Continue,
        // A client that drips bytes counts like a bad request, so it trips the cap.
        Head::OutOfTime { partial: true } => return Handled::Mismatch,
    };
    let Some((method, path, query)) = parse_request_line(&head) else {
        respond(&mut stream, "400 Bad Request", "");
        return Handled::Continue;
    };
    if method != "GET" || path != CALLBACK_PATH {
        respond(&mut stream, "404 Not Found", "");
        return Handled::Continue;
    }
    let cb = parse_callback_query(&query);
    if cb.state.as_deref() != Some(params.expected_state) {
        respond(&mut stream, "400 Bad Request", "");
        return Handled::Mismatch;
    }
    if let Some(error) = cb.error {
        respond(&mut stream, "200 OK", PAGE_OK);
        return Handled::Done(if error == "access_denied" {
            ListenOutcome::Closed
        } else {
            ListenOutcome::ProviderUnavailable
        });
    }
    let Some(code) = cb.code.filter(|c| !c.is_empty()) else {
        respond(&mut stream, "400 Bad Request", "");
        return Handled::Mismatch;
    };
    if let Some(id) = &cb.client_id {
        let matches_stored = params.stored_client_id.is_none_or(|stored| stored == id);
        if !valid_issued_client_id(id) || !matches_stored {
            respond(&mut stream, "400 Bad Request", "");
            return Handled::Mismatch;
        }
    }
    respond(&mut stream, "200 OK", PAGE_OK);
    Handled::Done(ListenOutcome::Callback {
        code: Zeroizing::new(code),
        client_id: cb.client_id,
        scope: cb.scope,
    })
}

/// Accepts connections until one valid callback, a cancel, the deadline or too many mismatches.
/// The listener is dropped on return. Request lines are parsed and never logged.
pub fn listen(listener: TcpListener, params: &ListenParams<'_>) -> ListenOutcome {
    let _ = listener.set_nonblocking(true);
    let mut mismatches = 0u32;
    loop {
        if params.cancel.load(Ordering::SeqCst) {
            return ListenOutcome::Cancelled;
        }
        if Instant::now() >= params.deadline {
            return ListenOutcome::Timeout;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                let _ = stream.set_nonblocking(false);
                match handle_connection(stream, params) {
                    Handled::Continue => {}
                    Handled::Mismatch => {
                        mismatches += 1;
                        if mismatches >= MAX_MISMATCHES {
                            return ListenOutcome::ProviderUnavailable;
                        }
                    }
                    Handled::Done(outcome) => return outcome,
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

// ---------- HTTP ----------

pub struct HttpReply {
    pub status: u16,
    pub body: Zeroizing<String>,
}

pub trait Http {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Option<HttpReply>;
    fn get_bearer(&self, url: &str, token: &str) -> Option<HttpReply>;
}

pub struct Ureq;

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(HTTP_TIMEOUT))
        .build()
        .into()
}

fn reply_of(mut response: ureq::http::Response<ureq::Body>) -> Option<HttpReply> {
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .with_config()
        .limit(BODY_CAP)
        .read_to_string()
        .ok()?;
    Some(HttpReply {
        status,
        body: Zeroizing::new(body),
    })
}

impl Http for Ureq {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Option<HttpReply> {
        let response = agent()
            .post(url)
            .header("Accept", "application/json")
            .send_form(form.iter().copied())
            .ok()?;
        reply_of(response)
    }

    fn get_bearer(&self, url: &str, token: &str) -> Option<HttpReply> {
        let response = agent()
            .get(url)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {token}"))
            .call()
            .ok()?;
        reply_of(response)
    }
}

/// The four fields read from a token response. `id_token` is never read.
struct TokenReply {
    access_token: Zeroizing<String>,
    refresh_token: Option<Zeroizing<String>>,
    expires_in: Option<u64>,
    scope: Option<String>,
}

fn parse_token_reply(body: &str) -> Option<TokenReply> {
    let value: Value = serde_json::from_str(body).ok()?;
    let access_token = value.get("access_token")?.as_str()?.to_owned();
    let refresh_token = value
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(|s| Zeroizing::new(s.to_owned()));
    Some(TokenReply {
        access_token: Zeroizing::new(access_token),
        refresh_token,
        expires_in: value.get("expires_in").and_then(Value::as_u64),
        scope: value
            .get("scope")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

/// `{ "error": { "code": ... } }` or the OAuth `{ "error": "..." }`.
pub fn error_code(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let error = value.get("error")?;
    if let Some(text) = error.as_str() {
        return Some(text.to_owned());
    }
    error
        .get("code")
        .or_else(|| error.get("type"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

/// The first usable slug (or id) in a models reply; `visibility` other than "list" is skipped.
pub fn first_model_slug(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let list = value
        .get("models")
        .or_else(|| value.get("data"))
        .and_then(Value::as_array)?;
    list.iter()
        .filter(|m| {
            m.get("visibility")
                .and_then(Value::as_str)
                .is_none_or(|v| v == "list")
        })
        .find_map(|m| {
            m.get("slug")
                .or_else(|| m.get("id"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        })
}

fn expires_at(now: DateTime<Utc>, expires_in: Option<u64>) -> String {
    let seconds = expires_in.unwrap_or(3600).min(u64::from(u32::MAX));
    (now + chrono::Duration::seconds(seconds as i64))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenError {
    NotConnected,
    NeedsSignIn,
    ProviderUnavailable,
    NotOffered,
}

impl TokenError {
    pub fn code(self) -> &'static str {
        match self {
            TokenError::NotConnected => "not_connected",
            TokenError::NeedsSignIn => "needs_sign_in",
            TokenError::ProviderUnavailable => "provider_unavailable",
            TokenError::NotOffered => "not_offered",
        }
    }
}

fn needs_refresh(expires_at: &str, now: DateTime<Utc>) -> bool {
    match DateTime::parse_from_rfc3339(expires_at) {
        Ok(at) => {
            at.with_timezone(&Utc) - now
                < chrono::Duration::from_std(REFRESH_MARGIN).unwrap_or_default()
        }
        Err(_) => true,
    }
}

/// Exchanges the authorization code for tokens.
pub fn exchange(
    http: &dyn Http,
    now: DateTime<Utc>,
    code: &str,
    verifier: &str,
    client_id: &str,
    redirect: &str,
) -> Option<Tokens> {
    let reply = http.post_form(
        TOKEN_URL,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect),
            ("resource", RESOURCE),
        ],
    )?;
    if reply.status != 200 {
        return None;
    }
    let parsed = parse_token_reply(&reply.body)?;
    Some(Tokens {
        access: parsed.access_token,
        refresh: parsed.refresh_token?,
        client_id: client_id.to_owned(),
        scope: parsed.scope.unwrap_or_else(|| SCOPES.to_owned()),
        expires_at: expires_at(now, parsed.expires_in),
    })
}

/// A current access token: the stored one, or a refreshed one when it is about to expire.
pub fn current_tokens(
    store: &dyn Store,
    http: &dyn Http,
    now: DateTime<Utc>,
    force_refresh: bool,
) -> Result<Tokens, TokenError> {
    let tokens = load_tokens(store)
        .map_err(|_| TokenError::ProviderUnavailable)?
        .ok_or(TokenError::NotConnected)?;
    if !force_refresh && !needs_refresh(&tokens.expires_at, now) {
        return Ok(tokens);
    }
    let Some(reply) = http.post_form(
        TOKEN_URL,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", &tokens.client_id),
            ("refresh_token", &tokens.refresh),
        ],
    ) else {
        return Err(TokenError::ProviderUnavailable);
    };
    if reply.status == 200 {
        let parsed = parse_token_reply(&reply.body).ok_or(TokenError::ProviderUnavailable)?;
        let rotated = Tokens {
            access: parsed.access_token,
            refresh: parsed.refresh_token.unwrap_or(tokens.refresh),
            client_id: tokens.client_id,
            scope: parsed.scope.unwrap_or(tokens.scope),
            expires_at: expires_at(now, parsed.expires_in),
        };
        save_tokens(store, &rotated).map_err(|_| TokenError::ProviderUnavailable)?;
        return Ok(rotated);
    }
    if (400..500).contains(&reply.status) {
        if let Some(code) = error_code(&reply.body)
            && SIGN_IN_GONE.contains(&code.as_str())
        {
            let _ = clear_tokens(store);
            return Err(TokenError::NeedsSignIn);
        }
        if reply.status == 401 {
            let _ = clear_tokens(store);
            return Err(TokenError::NeedsSignIn);
        }
    }
    Err(TokenError::ProviderUnavailable)
}

// ---------- the provider ----------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_at: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptInfo {
    pub offered: bool,
    pub client_id: Option<String>,
}

pub type Opener = Box<dyn FnOnce(&str) -> Result<(), String> + Send>;

#[derive(Default)]
pub struct ChatGpt {
    pub job: ConnectJob,
}

impl ChatGpt {
    pub fn status(&self, store: &dyn Store, dir: &Path, _fresh: bool) -> ProviderStatus {
        if !offered() {
            return ProviderStatus::plain(ProviderState::NotOffered);
        }
        if self.job.alive() {
            return ProviderStatus::plain(ProviderState::Connecting);
        }
        // A failed refresh clears the tokens, so the flag is read before the Keychain.
        let host = read_host_state(dir);
        if host.needs_sign_in {
            return ProviderStatus::plain(ProviderState::NeedsSignIn);
        }
        match load_tokens(store) {
            Ok(Some(_)) => {}
            Ok(None) => return ProviderStatus::plain(ProviderState::NotConnected),
            Err(_) => return ProviderStatus::plain(ProviderState::ProviderUnavailable),
        }
        if host.plan_not_eligible {
            return ProviderStatus::plain(ProviderState::PlanNotEligible);
        }
        ProviderStatus::plain(ProviderState::Available)
    }

    pub fn info(&self, store: &dyn Store) -> ChatGptInfo {
        ChatGptInfo {
            offered: offered(),
            client_id: store
                .get(SECRET_CLIENT_ID)
                .ok()
                .flatten()
                .filter(|id| valid_issued_client_id(id)),
        }
    }

    /// The webview's per-call token. Never cached on the Rust side beyond the Keychain.
    pub fn token(
        &self,
        store: &dyn Store,
        http: &dyn Http,
        dir: &Path,
        force_refresh: bool,
    ) -> Result<TokenResponse, TokenError> {
        if !offered() {
            return Err(TokenError::NotOffered);
        }
        match current_tokens(store, http, Utc::now(), force_refresh) {
            Ok(tokens) => Ok(TokenResponse {
                access_token: tokens.access.to_string(),
                expires_at: tokens.expires_at.clone(),
                model: read_host_state(dir).model,
            }),
            Err(TokenError::NeedsSignIn) => {
                // Persisted next to the plan flag so a relaunch still says "Sign in again".
                let mut host = read_host_state(dir);
                if !host.needs_sign_in {
                    host.needs_sign_in = true;
                    let _ = write_host_state(dir, &host);
                }
                Err(TokenError::NeedsSignIn)
            }
            Err(err) => Err(err),
        }
    }

    pub fn disconnect(&self, store: &dyn Store, dir: &Path) -> Result<(), String> {
        clear_tokens(store)?;
        let mut host = read_host_state(dir);
        if host.plan_not_eligible || host.needs_sign_in {
            host.plan_not_eligible = false;
            host.needs_sign_in = false;
            write_host_state(dir, &host)?;
        }
        Ok(())
    }

    /// Opens the authorize page and waits for the loopback callback on a worker thread. Answers
    /// with the seeded stage.
    pub fn start(self: &Arc<Self>, dir: PathBuf, open: Opener) -> Result<ConnectPoll, String> {
        if !offered() {
            return Err("not_offered".to_owned());
        }
        if !self.job.try_start() {
            return Err("busy".to_owned());
        }
        // Seeded before the worker opens the page, so the first poll never reads idle.
        let seeded = ConnectPoll::stage(Stage::SigningIn);
        self.job.set(seeded);
        let me = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("talos-chatgpt-connect".into())
            .spawn(move || {
                let outcome = me.connect(&Keychain, &Ureq, &dir, open);
                me.job.finish(outcome);
            });
        if spawned.is_err() {
            self.job
                .finish(ConnectPoll::failed(ConnectOutcome::ProviderUnavailable));
            return Err("busy".to_owned());
        }
        Ok(seeded)
    }

    fn connect(&self, store: &dyn Store, http: &dyn Http, dir: &Path, open: Opener) -> ConnectPoll {
        let unavailable = ConnectPoll::failed(ConnectOutcome::ProviderUnavailable);
        let Ok(listener) = TcpListener::bind("127.0.0.1:0") else {
            return unavailable;
        };
        let Ok(port) = listener.local_addr().map(|a| a.port()) else {
            return unavailable;
        };
        let redirect = redirect_uri(port);
        let pkce = random_pkce();
        let state = random_hex(16);
        let nonce = random_hex(16);
        let Ok(host) = ensure_host_state(dir) else {
            return unavailable;
        };
        let stored_client_id = store
            .get(SECRET_CLIENT_ID)
            .ok()
            .flatten()
            .filter(|id| valid_issued_client_id(id));
        let url = authorize_url(&AuthorizeParams {
            client_id: stored_client_id.as_deref().unwrap_or(BOOTSTRAP_CLIENT_ID),
            first_registration: stored_client_id.is_none(),
            host_id: &host.host_id,
            redirect_uri: &redirect,
            state: &state,
            nonce: &nonce,
            code_challenge: &pkce.challenge,
        });
        if open(&url).is_err() {
            return unavailable;
        }
        self.job.set(ConnectPoll::stage(Stage::SigningIn));
        let outcome = listen(
            listener,
            &ListenParams {
                expected_state: &state,
                stored_client_id: stored_client_id.as_deref(),
                cancel: self.job.cancel_flag(),
                deadline: Instant::now() + CONNECT_DEADLINE,
                io_timeout: Duration::from_secs(2),
            },
        );
        let (code, client_id) = match outcome {
            ListenOutcome::Callback {
                code, client_id, ..
            } => (code, client_id),
            ListenOutcome::Closed | ListenOutcome::Cancelled => {
                return ConnectPoll::failed(ConnectOutcome::Closed);
            }
            ListenOutcome::Timeout => return ConnectPoll::failed(ConnectOutcome::Timeout),
            ListenOutcome::ProviderUnavailable => return unavailable,
        };
        let Some(client_id) = client_id.or(stored_client_id) else {
            return unavailable;
        };
        let Some(tokens) = exchange(
            http,
            Utc::now(),
            &code,
            &pkce.verifier,
            &client_id,
            &redirect,
        ) else {
            return unavailable;
        };
        self.finish_connect(store, http, dir, host, tokens)
    }

    /// The eligibility check and the stores, shared by the real and the test flow.
    fn finish_connect(
        &self,
        store: &dyn Store,
        http: &dyn Http,
        dir: &Path,
        mut host: HostState,
        tokens: Tokens,
    ) -> ConnectPoll {
        let unavailable = ConnectPoll::failed(ConnectOutcome::ProviderUnavailable);
        let Some(models) = http.get_bearer(MODELS_URL, &tokens.access) else {
            return unavailable;
        };
        match models.status {
            200 => {
                if let Some(slug) = first_model_slug(&models.body) {
                    host.model = slug;
                }
                host.plan_not_eligible = false;
                host.needs_sign_in = false;
                let _ = write_host_state(dir, &host);
                if save_tokens(store, &tokens).is_err() {
                    let _ = clear_tokens(store);
                    return unavailable;
                }
                ConnectPoll::stage(Stage::Done)
            }
            403 => {
                // The flag lives next to the host id so a relaunch still reports the plan state.
                host.plan_not_eligible = true;
                host.needs_sign_in = false;
                if write_host_state(dir, &host).is_err() || save_tokens(store, &tokens).is_err() {
                    let _ = clear_tokens(store);
                    return unavailable;
                }
                ConnectPoll::failed(ConnectOutcome::PlanNotEligible)
            }
            _ => unavailable,
        }
    }
}

#[tauri::command]
pub async fn chatgpt_token(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::provider::Providers>,
    force_refresh: bool,
) -> Result<TokenResponse, String> {
    let dir = crate::commands::app_data_dir(&app)?;
    let chatgpt = Arc::clone(&state.chatgpt);
    tauri::async_runtime::spawn_blocking(move || {
        chatgpt
            .token(&Keychain, &Ureq, &dir, force_refresh)
            .map_err(|e| e.code().to_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn chatgpt_info(
    state: tauri::State<'_, super::provider::Providers>,
) -> Result<ChatGptInfo, String> {
    let chatgpt = Arc::clone(&state.chatgpt);
    tauri::async_runtime::spawn_blocking(move || chatgpt.info(&Keychain))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::net::TcpStream;

    #[derive(Default)]
    struct MemoryStore {
        map: RefCell<HashMap<String, String>>,
        writes: RefCell<Vec<String>>,
    }

    impl Store for MemoryStore {
        fn get(&self, name: &str) -> Result<Option<String>, String> {
            Ok(self.map.borrow().get(name).cloned())
        }
        fn set(&self, name: &str, value: &str) -> Result<(), String> {
            self.writes.borrow_mut().push(name.to_owned());
            self.map
                .borrow_mut()
                .insert(name.to_owned(), value.to_owned());
            Ok(())
        }
        fn delete(&self, name: &str) -> Result<(), String> {
            self.map.borrow_mut().remove(name);
            Ok(())
        }
    }

    /// Scripted replies per (method, url); records the forms it saw.
    #[derive(Default)]
    struct FakeHttp {
        replies: RefCell<Vec<(u16, String)>>,
        forms: RefCell<Vec<Vec<(String, String)>>>,
        bearers: RefCell<Vec<String>>,
    }

    impl FakeHttp {
        fn reply(&self, status: u16, body: &str) -> &Self {
            self.replies.borrow_mut().push((status, body.to_owned()));
            self
        }
        fn next(&self) -> Option<HttpReply> {
            if self.replies.borrow().is_empty() {
                return None;
            }
            let (status, body) = self.replies.borrow_mut().remove(0);
            Some(HttpReply {
                status,
                body: Zeroizing::new(body),
            })
        }
    }

    impl Http for FakeHttp {
        fn post_form(&self, _url: &str, form: &[(&str, &str)]) -> Option<HttpReply> {
            self.forms.borrow_mut().push(
                form.iter()
                    .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                    .collect(),
            );
            self.next()
        }
        fn get_bearer(&self, _url: &str, token: &str) -> Option<HttpReply> {
            self.bearers.borrow_mut().push(token.to_owned());
            self.next()
        }
    }

    fn at(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn seed(store: &MemoryStore, expires_at: &str) {
        save_tokens(
            store,
            &Tokens {
                access: Zeroizing::new("acc1".into()),
                refresh: Zeroizing::new("ref1".into()),
                client_id: "oaiapp_abc".into(),
                scope: SCOPES.into(),
                expires_at: expires_at.into(),
            },
        )
        .unwrap();
        store.writes.borrow_mut().clear();
    }

    #[test]
    fn pkce_matches_the_rfc_7636_vector() {
        // RFC 7636 appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let bytes: [u8; 32] = [
            116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212,
            37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
        ];
        let pkce = pkce_from_bytes(&bytes);
        assert_eq!(pkce.verifier.as_str(), verifier);
        assert_eq!(
            pkce.challenge,
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let random = random_pkce();
        assert_eq!(random.verifier.len(), 43);
        assert_eq!(random.challenge, challenge_for(&random.verifier));
    }

    #[test]
    fn the_authorize_url_carries_every_parameter_and_the_hint_only_first() {
        let url = authorize_url(&AuthorizeParams {
            client_id: BOOTSTRAP_CLIENT_ID,
            first_registration: true,
            host_id: "00ff",
            redirect_uri: "http://127.0.0.1:1455/auth/callback",
            state: "st",
            nonce: "nn",
            code_challenge: "ch",
        });
        assert!(url.starts_with("https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&agent_name_hint=Talos%20Labs&ext_agent_host_id=00ff&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&scope=openid%20profile%20email%20offline_access%20resource.invoke%20chatgpt.tokens.use.direct&resource=https%3A%2F%2Fapi.openai.com%2Fv1&state=st&nonce=nn&code_challenge_method=S256&code_challenge=ch"), "{url}");
        let again = authorize_url(&AuthorizeParams {
            client_id: "oaiapp_x1",
            first_registration: false,
            host_id: "00ff",
            redirect_uri: "http://127.0.0.1:1455/auth/callback",
            state: "st",
            nonce: "nn",
            code_challenge: "ch",
        });
        assert!(again.contains("client_id=oaiapp_x1&ext_agent_host_id"));
        assert!(!again.contains("agent_name_hint"));
        assert_eq!(redirect_uri(1455), "http://127.0.0.1:1455/auth/callback");
        assert_eq!(url_decode("a%20b+c%2F"), Some("a b c/".into()));
        assert_eq!(url_decode("%zz"), None);
        assert!(valid_issued_client_id("oaiapp_abc-DEF_9"));
        assert!(!valid_issued_client_id("oaiapp_"));
        assert!(!valid_issued_client_id("dynamic_agent_client"));
        assert!(!valid_issued_client_id(&format!(
            "oaiapp_{}",
            "a".repeat(129)
        )));
    }

    #[test]
    fn callback_queries_parse_their_five_fields() {
        let cb = parse_callback_query(
            "code=c%201&state=s&client_id=oaiapp_x&scope=openid%20email&junk=1",
        );
        assert_eq!(
            cb,
            Callback {
                code: Some("c 1".into()),
                state: Some("s".into()),
                client_id: Some("oaiapp_x".into()),
                scope: Some("openid email".into()),
                error: None,
            }
        );
        let denied = parse_callback_query("error=access_denied&state=s");
        assert_eq!(denied.error.as_deref(), Some("access_denied"));
        assert_eq!(denied.code, None);
        assert_eq!(
            parse_request_line("GET /auth/callback?code=1&state=s HTTP/1.1\r\nHost: x\r\n\r\n"),
            Some((
                "GET".into(),
                "/auth/callback".into(),
                "code=1&state=s".into()
            ))
        );
        assert_eq!(parse_request_line("garbage"), None);
    }

    fn serve(
        stored: Option<&'static str>,
        io_timeout: Duration,
    ) -> (u16, std::thread::JoinHandle<ListenOutcome>, Arc<AtomicBool>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancel);
        let handle = std::thread::spawn(move || {
            listen(
                listener,
                &ListenParams {
                    expected_state: "good-state",
                    stored_client_id: stored,
                    cancel: &flag,
                    deadline: Instant::now() + Duration::from_secs(20),
                    io_timeout,
                },
            )
        });
        (port, handle, cancel)
    }

    fn request(port: u16, line: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .write_all(format!("{line}\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .unwrap();
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply);
        reply
    }

    #[test]
    fn the_listener_rejects_wrong_paths_and_states_then_takes_one_callback() {
        let (port, handle, _cancel) = serve(None, Duration::from_millis(300));
        let reply = request(port, "GET /favicon.ico HTTP/1.1");
        assert!(reply.starts_with("HTTP/1.1 404"), "{reply}");
        let reply = request(port, "POST /auth/callback?code=1&state=good-state HTTP/1.1");
        assert!(reply.starts_with("HTTP/1.1 404"), "{reply}");
        let reply = request(port, "GET /auth/callback?code=1&state=wrong HTTP/1.1");
        assert!(reply.starts_with("HTTP/1.1 400"), "{reply}");
        let reply = request(port, "GET /auth/callback?state=good-state HTTP/1.1");
        assert!(reply.starts_with("HTTP/1.1 400"), "no code: {reply}");
        let reply = request(
            port,
            "GET /auth/callback?code=1&state=good-state&client_id=bogus HTTP/1.1",
        );
        assert!(reply.starts_with("HTTP/1.1 400"), "bad client id: {reply}");
        // A silent connection is dropped after the io timeout and the loop goes on.
        {
            let _silent = TcpStream::connect(("127.0.0.1", port)).unwrap();
            std::thread::sleep(Duration::from_millis(500));
        }
        let reply = request(
            port,
            "GET /auth/callback?code=the-code&state=good-state&client_id=oaiapp_new1&scope=openid HTTP/1.1",
        );
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
        assert!(reply.contains("Cache-Control: no-store"));
        assert!(reply.contains("You can go back to Talos Labs."));
        assert_eq!(
            handle.join().unwrap(),
            ListenOutcome::Callback {
                code: Zeroizing::new("the-code".into()),
                client_id: Some("oaiapp_new1".into()),
                scope: Some("openid".into()),
            }
        );
        // The listener is gone: a second callback is refused at the socket.
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    }

    #[test]
    fn the_listener_holds_the_stored_client_id_and_counts_mismatches() {
        let (port, handle, _cancel) = serve(Some("oaiapp_mine"), Duration::from_millis(300));
        let reply = request(
            port,
            "GET /auth/callback?code=1&state=good-state&client_id=oaiapp_other HTTP/1.1",
        );
        assert!(reply.starts_with("HTTP/1.1 400"), "{reply}");
        let reply = request(
            port,
            "GET /auth/callback?code=1&state=good-state&client_id=oaiapp_mine HTTP/1.1",
        );
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
        assert!(
            matches!(handle.join().unwrap(), ListenOutcome::Callback { client_id: Some(id), .. } if id == "oaiapp_mine")
        );

        let (port, handle, _cancel) = serve(None, Duration::from_millis(300));
        for _ in 0..5 {
            let reply = request(port, "GET /auth/callback?code=1&state=nope HTTP/1.1");
            assert!(reply.starts_with("HTTP/1.1 400"));
        }
        assert_eq!(handle.join().unwrap(), ListenOutcome::ProviderUnavailable);

        let (port, handle, _cancel) = serve(None, Duration::from_millis(300));
        let reply = request(
            port,
            "GET /auth/callback?error=access_denied&state=good-state HTTP/1.1",
        );
        assert!(reply.starts_with("HTTP/1.1 200"));
        assert_eq!(handle.join().unwrap(), ListenOutcome::Closed);

        let (port, handle, _cancel) = serve(None, Duration::from_millis(300));
        let reply = request(
            port,
            "GET /auth/callback?error=server_error&state=good-state HTTP/1.1",
        );
        assert!(reply.starts_with("HTTP/1.1 200"));
        assert_eq!(handle.join().unwrap(), ListenOutcome::ProviderUnavailable);

        let (_port, handle, cancel) = serve(None, Duration::from_millis(300));
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(handle.join().unwrap(), ListenOutcome::Cancelled);
    }

    /// Writes one byte every `every` until the socket closes or `for_at_most` passes.
    fn drip(port: u16, every: Duration, for_at_most: Duration) -> std::thread::JoinHandle<()> {
        std::thread::spawn(move || {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
            let started = Instant::now();
            while started.elapsed() < for_at_most && stream.write_all(b"G").is_ok() {
                std::thread::sleep(every);
            }
        })
    }

    #[test]
    fn a_dripping_client_cannot_hold_the_listener_past_its_budget() {
        // One byte every 100 ms never trips a 300 ms per-read timeout, but the whole head has 300 ms.
        let (port, handle, _cancel) = serve(None, Duration::from_millis(300));
        let dripper = drip(port, Duration::from_millis(100), Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        let reply = request(port, "GET /auth/callback?code=1&state=good-state HTTP/1.1");
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
        assert!(
            started.elapsed() < Duration::from_millis(1500),
            "the callback waited {:?}",
            started.elapsed()
        );
        assert!(matches!(
            handle.join().unwrap(),
            ListenOutcome::Callback { .. }
        ));
        dripper.join().unwrap();

        // Cancel lands while a client is dripping.
        let (port, handle, cancel) = serve(None, Duration::from_secs(5));
        let dripper = drip(port, Duration::from_millis(50), Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(150));
        cancel.store(true, Ordering::SeqCst);
        let started = Instant::now();
        assert_eq!(handle.join().unwrap(), ListenOutcome::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(1));
        dripper.join().unwrap();

        // Five dripping clients in a row count as mismatches; the listener gives up.
        let (port, handle, _cancel) = serve(None, Duration::from_millis(100));
        for _ in 0..5 {
            drip(port, Duration::from_millis(20), Duration::from_millis(400))
                .join()
                .unwrap();
        }
        assert_eq!(handle.join().unwrap(), ListenOutcome::ProviderUnavailable);
    }

    #[test]
    fn tokens_are_written_in_order_and_a_partial_set_reads_as_nothing() {
        let store = MemoryStore::default();
        assert!(load_tokens(&store).unwrap().is_none());
        seed(&store, "2026-10-16T12:00:00Z");
        let store2 = MemoryStore::default();
        seed(&store2, "2026-10-16T12:00:00Z");
        store2.writes.borrow_mut().clear();
        save_tokens(&store2, &load_tokens(&store).unwrap().unwrap()).unwrap();
        assert_eq!(
            store2.writes.borrow().as_slice(),
            SECRET_NAMES.map(str::to_owned)
        );
        store.delete(SECRET_EXPIRES_AT).unwrap();
        assert!(load_tokens(&store).unwrap().is_none());
        assert_eq!(store.map.borrow().len(), 1, "the tokens are deleted");
        assert!(store.map.borrow().contains_key(SECRET_CLIENT_ID), "the client id stays");
    }

    #[test]
    fn the_refresh_decision_table() {
        let now = at("2026-10-16T12:00:00Z");
        // Fresh enough: no network call.
        let store = MemoryStore::default();
        seed(&store, "2026-10-16T12:05:00Z");
        let http = FakeHttp::default();
        let tokens = current_tokens(&store, &http, now, false).unwrap();
        assert_eq!(tokens.access.as_str(), "acc1");
        assert!(http.forms.borrow().is_empty());
        assert_eq!(
            current_tokens(&store, &http, now, true).unwrap_err(),
            TokenError::ProviderUnavailable,
            "forced refresh with no network"
        );

        // Expiring within 60 s: refresh, rotate the refresh token, store it.
        let store = MemoryStore::default();
        seed(&store, "2026-10-16T12:00:30Z");
        let http = FakeHttp::default();
        http.reply(200, r#"{"access_token":"acc2","refresh_token":"ref2","expires_in":3600,"scope":"openid","id_token":"never-read","token_type":"Bearer"}"#);
        let tokens = current_tokens(&store, &http, now, false).unwrap();
        assert_eq!(tokens.access.as_str(), "acc2");
        assert_eq!(tokens.refresh.as_str(), "ref2");
        assert_eq!(tokens.expires_at, "2026-10-16T13:00:00Z");
        assert_eq!(tokens.scope, "openid");
        let form = &http.forms.borrow()[0];
        assert!(form.contains(&("grant_type".into(), "refresh_token".into())));
        assert!(form.contains(&("client_id".into(), "oaiapp_abc".into())));
        assert!(form.contains(&("refresh_token".into(), "ref1".into())));
        assert_eq!(store.get(SECRET_REFRESH).unwrap().as_deref(), Some("ref2"));
        assert_eq!(
            store.writes.borrow().last().map(String::as_str),
            Some(SECRET_EXPIRES_AT)
        );

        // No rotated refresh token: keep the old one.
        let store = MemoryStore::default();
        seed(&store, "2026-10-16T11:00:00Z");
        let http = FakeHttp::default();
        http.reply(200, r#"{"access_token":"acc3","expires_in":60}"#);
        let tokens = current_tokens(&store, &http, now, false).unwrap();
        assert_eq!(tokens.refresh.as_str(), "ref1");
        assert_eq!(tokens.scope, SCOPES);

        // The sign-in is gone: clear everything.
        for body in [
            r#"{"error":{"code":"refresh_token_reused","message":"x"}}"#,
            r#"{"error":"invalid_grant"}"#,
            r#"{"error":{"type":"token_expired"}}"#,
        ] {
            let store = MemoryStore::default();
            seed(&store, "2026-10-16T11:00:00Z");
            let http = FakeHttp::default();
            http.reply(400, body);
            assert_eq!(
                current_tokens(&store, &http, now, false).unwrap_err(),
                TokenError::NeedsSignIn,
                "{body}"
            );
            assert_eq!(store.map.borrow().len(), 1, "{body}: only the client id stays");
            assert!(store.map.borrow().contains_key(SECRET_CLIENT_ID));
        }
        let store = MemoryStore::default();
        seed(&store, "2026-10-16T11:00:00Z");
        let http = FakeHttp::default();
        http.reply(401, "{}");
        assert_eq!(
            current_tokens(&store, &http, now, false).unwrap_err(),
            TokenError::NeedsSignIn
        );

        // 5xx or an unknown 4xx: unavailable, tokens kept.
        for status in [500, 503, 429] {
            let store = MemoryStore::default();
            seed(&store, "2026-10-16T11:00:00Z");
            let http = FakeHttp::default();
            http.reply(
                status,
                r#"{"error":{"code":"subscription_sharing_usage_unavailable"}}"#,
            );
            assert_eq!(
                current_tokens(&store, &http, now, false).unwrap_err(),
                TokenError::ProviderUnavailable,
                "{status}"
            );
            assert_eq!(store.map.borrow().len(), 5);
        }
        // Nothing stored.
        let store = MemoryStore::default();
        assert_eq!(
            current_tokens(&store, &FakeHttp::default(), now, false).unwrap_err(),
            TokenError::NotConnected
        );
    }

    #[test]
    fn exchange_sends_the_pkce_form_and_needs_a_refresh_token() {
        let now = at("2026-10-16T12:00:00Z");
        let http = FakeHttp::default();
        http.reply(200, r#"{"access_token":"a","refresh_token":"r","expires_in":600,"scope":"s","id_token":"x"}"#);
        let tokens = exchange(
            &http,
            now,
            "code1",
            "ver1",
            "oaiapp_new",
            "http://127.0.0.1:1/auth/callback",
        )
        .unwrap();
        assert_eq!(tokens.client_id, "oaiapp_new");
        assert_eq!(tokens.expires_at, "2026-10-16T12:10:00Z");
        let form = &http.forms.borrow()[0];
        assert_eq!(
            form.as_slice(),
            [
                ("grant_type".to_owned(), "authorization_code".to_owned()),
                ("client_id".into(), "oaiapp_new".into()),
                ("code".into(), "code1".into()),
                ("code_verifier".into(), "ver1".into()),
                (
                    "redirect_uri".into(),
                    "http://127.0.0.1:1/auth/callback".into()
                ),
                ("resource".into(), RESOURCE.into()),
            ]
        );
        let http = FakeHttp::default();
        http.reply(200, r#"{"access_token":"a","expires_in":600}"#);
        assert!(
            exchange(&http, now, "c", "v", "oaiapp_n", "r").is_none(),
            "no refresh token"
        );
        let http = FakeHttp::default();
        http.reply(400, r#"{"error":"invalid_grant"}"#);
        assert!(exchange(&http, now, "c", "v", "oaiapp_n", "r").is_none());
    }

    #[test]
    fn the_models_reply_yields_the_first_listed_slug() {
        let body = r#"{"models":[{"slug":"hidden-model","display_name":"Hidden","visibility":"hidden"},{"slug":"gpt-5","display_name":"GPT-5","visibility":"list"}]}"#;
        assert_eq!(first_model_slug(body).as_deref(), Some("gpt-5"));
        assert_eq!(
            first_model_slug(r#"{"data":[{"id":"gpt-4.1"}]}"#).as_deref(),
            Some("gpt-4.1")
        );
        assert_eq!(first_model_slug(r#"{"models":[]}"#), None);
        assert_eq!(first_model_slug("nope"), None);
        assert_eq!(
            error_code(
                r#"{"error":{"code":"subscription_sharing_user_not_eligible","message":"m"}}"#
            )
            .as_deref(),
            Some("subscription_sharing_user_not_eligible")
        );
    }

    #[test]
    fn finish_connect_stores_tokens_and_flags_an_ineligible_plan() {
        let dir = std::env::temp_dir().join(format!(
            "talos-chatgpt-test-{}-{}",
            std::process::id(),
            random_hex(4)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let chatgpt = ChatGpt::default();
        let host = ensure_host_state(&dir).unwrap();
        assert_eq!(host.host_id.len(), 32);
        assert_eq!(
            ensure_host_state(&dir).unwrap().host_id,
            host.host_id,
            "generated once"
        );
        let tokens = || Tokens {
            access: Zeroizing::new("acc".into()),
            refresh: Zeroizing::new("ref".into()),
            client_id: "oaiapp_abc".into(),
            scope: SCOPES.into(),
            expires_at: "2020-01-01T00:00:00Z".into(),
        };
        let store = MemoryStore::default();
        let http = FakeHttp::default();
        http.reply(200, r#"{"models":[{"slug":"gpt-5","visibility":"list"}]}"#);
        let poll = chatgpt.finish_connect(&store, &http, &dir, host.clone(), tokens());
        assert_eq!(poll, ConnectPoll::stage(Stage::Done));
        assert_eq!(http.bearers.borrow().as_slice(), ["acc"]);
        assert_eq!(read_host_state(&dir).model, "gpt-5");
        assert_eq!(
            store.writes.borrow().as_slice(),
            SECRET_NAMES.map(str::to_owned)
        );
        if offered() {
            assert_eq!(
                chatgpt.status(&store, &dir, false).state,
                ProviderState::Available
            );
            let token = chatgpt.token(&store, &FakeHttp::default(), &dir, false);
            assert!(
                token.is_err(),
                "the fixed expiry is in the past, so a refresh is tried"
            );
            assert_eq!(
                chatgpt.info(&store).client_id.as_deref(),
                Some("oaiapp_abc")
            );
        }

        let store = MemoryStore::default();
        let http = FakeHttp::default();
        http.reply(
            403,
            r#"{"error":{"code":"subscription_sharing_user_not_eligible"}}"#,
        );
        let poll = chatgpt.finish_connect(&store, &http, &dir, host.clone(), tokens());
        assert_eq!(poll, ConnectPoll::failed(ConnectOutcome::PlanNotEligible));
        assert_eq!(
            store.map.borrow().len(),
            5,
            "tokens kept so Settings can show the state"
        );
        assert!(
            read_host_state(&dir).plan_not_eligible,
            "the plan state survives a relaunch"
        );
        if offered() {
            assert_eq!(
                chatgpt.status(&store, &dir, false).state,
                ProviderState::PlanNotEligible
            );
            assert_eq!(
                ChatGpt::default().status(&store, &dir, false).state,
                ProviderState::PlanNotEligible,
                "a fresh process reads the persisted flag"
            );
        }
        chatgpt.disconnect(&store, &dir).unwrap();
        assert_eq!(store.map.borrow().len(), 1, "only the client id stays");
        assert!(store.map.borrow().contains_key(SECRET_CLIENT_ID));
        assert!(!read_host_state(&dir).plan_not_eligible);
        assert_eq!(
            read_host_state(&dir).host_id,
            host.host_id,
            "the host id stays"
        );
        if offered() {
            assert_eq!(
                chatgpt.status(&store, &dir, false).state,
                ProviderState::NotConnected
            );
        }

        let store = MemoryStore::default();
        let http = FakeHttp::default();
        http.reply(503, "{}");
        let poll = chatgpt.finish_connect(&store, &http, &dir, host, tokens());
        assert_eq!(
            poll,
            ConnectPoll::failed(ConnectOutcome::ProviderUnavailable)
        );
        assert!(
            store.map.borrow().is_empty(),
            "nothing stored on an unknown answer"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_refresh_that_says_the_sign_in_is_gone_reports_needs_sign_in_until_disconnect() {
        if !offered() {
            return;
        }
        let dir = std::env::temp_dir().join(format!(
            "talos-chatgpt-signin-test-{}-{}",
            std::process::id(),
            random_hex(4)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let host = ensure_host_state(&dir).unwrap();
        let chatgpt = ChatGpt::default();
        let store = MemoryStore::default();
        seed(&store, "2020-01-01T00:00:00Z");
        assert_eq!(
            chatgpt.status(&store, &dir, false).state,
            ProviderState::Available
        );
        let http = FakeHttp::default();
        http.reply(400, r#"{"error":"invalid_grant"}"#);
        assert_eq!(
            chatgpt.token(&store, &http, &dir, false).unwrap_err(),
            TokenError::NeedsSignIn
        );
        assert_eq!(store.map.borrow().len(), 1, "the stale tokens are cleared, the client id stays");
        assert!(store.map.borrow().contains_key(SECRET_CLIENT_ID));
        assert_eq!(
            chatgpt.status(&store, &dir, false).state,
            ProviderState::NeedsSignIn,
            "read before the empty Keychain"
        );
        assert!(read_host_state(&dir).needs_sign_in);
        assert_eq!(
            ChatGpt::default().status(&store, &dir, false).state,
            ProviderState::NeedsSignIn,
            "a fresh process reads the persisted flag"
        );
        assert_eq!(
            chatgpt.token(&store, &FakeHttp::default(), &dir, false),
            Err(TokenError::NotConnected),
            "no refresh is tried without tokens"
        );
        chatgpt.disconnect(&store, &dir).unwrap();
        assert!(!read_host_state(&dir).needs_sign_in);
        assert_eq!(read_host_state(&dir).host_id, host.host_id);
        assert_eq!(
            chatgpt.status(&store, &dir, false).state,
            ProviderState::NotConnected
        );

        // A new sign-in clears the flag too.
        seed(&store, "2020-01-01T00:00:00Z");
        let http = FakeHttp::default();
        http.reply(400, r#"{"error":"invalid_grant"}"#);
        let _ = chatgpt.token(&store, &http, &dir, false);
        assert!(read_host_state(&dir).needs_sign_in);
        let http = FakeHttp::default();
        http.reply(200, r#"{"models":[{"slug":"gpt-5","visibility":"list"}]}"#);
        let tokens = Tokens {
            access: Zeroizing::new("acc".into()),
            refresh: Zeroizing::new("ref".into()),
            client_id: "oaiapp_abc".into(),
            scope: SCOPES.into(),
            expires_at: "2999-01-01T00:00:00Z".into(),
        };
        let poll = chatgpt.finish_connect(&store, &http, &dir, read_host_state(&dir), tokens);
        assert_eq!(poll, ConnectPoll::stage(Stage::Done));
        assert!(!read_host_state(&dir).needs_sign_in);
        assert_eq!(
            chatgpt.status(&store, &dir, false).state,
            ProviderState::Available
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wire_shapes_are_camel_case() {
        let token = serde_json::to_value(TokenResponse {
            access_token: "a".into(),
            expires_at: "e".into(),
            model: "m".into(),
        })
        .unwrap();
        assert_eq!(
            token,
            serde_json::json!({ "accessToken": "a", "expiresAt": "e", "model": "m" })
        );
        let info = serde_json::to_value(ChatGptInfo {
            offered: true,
            client_id: None,
        })
        .unwrap();
        assert_eq!(
            info,
            serde_json::json!({ "offered": true, "clientId": null })
        );
        assert_eq!(TokenError::NeedsSignIn.code(), "needs_sign_in");
    }
}
