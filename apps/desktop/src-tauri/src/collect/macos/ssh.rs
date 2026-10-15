//! SSH directory permissions and key encryption from key headers. `ssh-keygen` is never run.

use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::atomic::AtomicBool;

use base64::Engine;

use super::{check_cancel, home, is_not_found, is_permission_error, mode_string};
use crate::collect::{to_section, Fail};
use crate::state::{Section, Ssh, SshKey, SshKeyFormat};

pub const HEAD_BYTES: usize = 4096;
const OPENSSH_MAGIC: &[u8] = b"openssh-key-v1\0";

/// The ciphername string that follows the openssh-key-v1 magic in the decoded body.
pub fn openssh_cipher(body_base64: &str) -> Option<String> {
    // Bytes, not a String: the body comes from an untrusted file and a byte cut inside a multi-byte char would panic.
    let compact: Vec<u8> = body_base64.bytes().filter(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=')).collect();
    let usable = compact.len().min(256) / 4 * 4;
    let bytes = base64::engine::general_purpose::STANDARD.decode(compact.get(..usable)?).ok()?;
    let rest = bytes.strip_prefix(OPENSSH_MAGIC)?;
    let len = u32::from_be_bytes([*rest.first()?, *rest.get(1)?, *rest.get(2)?, *rest.get(3)?]) as usize;
    let name = rest.get(4..4 + len)?;
    Some(String::from_utf8_lossy(name).into_owned())
}

/// (format, encrypted) from the first bytes of a key file. None when the file is not a private key.
pub fn classify_key(head: &[u8]) -> Option<(SshKeyFormat, Option<bool>)> {
    let text = String::from_utf8_lossy(head);
    let first = text.lines().find(|l| !l.trim().is_empty())?.trim();
    if !first.starts_with("-----BEGIN ") || !first.contains("PRIVATE KEY") {
        return None;
    }
    if first == "-----BEGIN OPENSSH PRIVATE KEY-----" {
        let body: Vec<&str> = text.lines().skip_while(|l| l.trim() != first).skip(1).take_while(|l| !l.starts_with("-----END")).collect();
        let encrypted = openssh_cipher(&body.join("")).map(|cipher| cipher != "none");
        return Some((SshKeyFormat::Openssh, encrypted));
    }
    if first == "-----BEGIN ENCRYPTED PRIVATE KEY-----" {
        return Some((SshKeyFormat::Pkcs8, Some(true)));
    }
    if first == "-----BEGIN PRIVATE KEY-----" {
        return Some((SshKeyFormat::Pkcs8, Some(false)));
    }
    if ["-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----", "-----BEGIN DSA PRIVATE KEY-----"].contains(&first) {
        let encrypted = text.lines().take(6).any(|l| l.trim().starts_with("Proc-Type: 4,ENCRYPTED"));
        return Some((SshKeyFormat::Pem, Some(encrypted)));
    }
    Some((SshKeyFormat::Unknown, None))
}

fn read_head(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    let mut buf = Vec::with_capacity(HEAD_BYTES);
    file.by_ref().take(HEAD_BYTES as u64).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Keys directly under `dir`, sorted by path. Unreadable files are skipped.
pub fn scan_keys(dir: &Path) -> Result<Vec<SshKey>, Fail> {
    let entries = std::fs::read_dir(dir).map_err(|err| Fail::io(&err, "read_dir: .ssh"))?;
    let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    let mut keys = Vec::new();
    for path in paths {
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        if !meta.is_file() {
            continue;
        }
        let Ok(head) = read_head(&path) else { continue };
        if let Some((format, encrypted)) = classify_key(&head) {
            keys.push(SshKey {
                path: path.to_string_lossy().into_owned(),
                format,
                encrypted,
                mode: Some(mode_string(meta.permissions().mode())),
            });
        }
    }
    Ok(keys)
}

pub fn scan(dir: &Path) -> Result<Ssh, Fail> {
    let meta = match std::fs::metadata(dir) {
        Ok(meta) => meta,
        Err(err) if is_not_found(&err) => return Ok(Ssh { dir_exists: false, dir_mode: None, keys: Vec::new() }),
        Err(err) if is_permission_error(&err) => return Err(Fail::io(&err, "stat: .ssh")),
        Err(err) => return Err(Fail::io(&err, "stat: .ssh")),
    };
    let keys = scan_keys(dir)?;
    Ok(Ssh { dir_exists: true, dir_mode: Some(mode_string(meta.permissions().mode())), keys })
}

fn inner(cancel: &AtomicBool) -> Result<Ssh, Fail> {
    check_cancel(cancel)?;
    scan(&home()?.join(".ssh"))
}

pub fn collect(cancel: &AtomicBool) -> Section<Ssh> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::process::Command;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("talos-ssh-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        dir
    }

    fn keygen(dir: &Path, name: &str, passphrase: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        let status = Command::new("/usr/bin/ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", passphrase, "-f"])
            .arg(&path)
            .status()
            .expect("ssh-keygen runs");
        assert!(status.success());
        path
    }

    #[test]
    fn generated_keys_classify_by_cipher() {
        let dir = temp_dir("keygen");
        let plain = keygen(&dir, "id_plain", "");
        let locked = keygen(&dir, "id_locked", "pass");
        let plain_head = read_head(&plain).unwrap();
        assert_eq!(classify_key(&plain_head), Some((SshKeyFormat::Openssh, Some(false))));
        let locked_head = read_head(&locked).unwrap();
        assert_eq!(classify_key(&locked_head), Some((SshKeyFormat::Openssh, Some(true))));
        let body: String = String::from_utf8_lossy(&locked_head).lines().skip(1).take_while(|l| !l.starts_with("-----END")).collect();
        assert_eq!(openssh_cipher(&body).as_deref(), Some("aes256-ctr"));

        let ssh = scan(&dir).unwrap();
        assert!(ssh.dir_exists);
        assert_eq!(ssh.dir_mode.as_deref(), Some("700"));
        assert_eq!(ssh.keys.len(), 2, "public keys are not listed");
        let json = serde_json::to_string(&ssh).unwrap();
        let plain_bytes = std::fs::read(&plain).unwrap();
        let plain_text = String::from_utf8_lossy(&plain_bytes);
        let body_line = plain_text.lines().nth(1).unwrap();
        assert!(!json.contains(body_line), "key material never reaches the state");
        for key in &ssh.keys {
            assert_eq!(key.format, SshKeyFormat::Openssh);
            assert_eq!(key.mode.as_deref(), Some("600"));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pem_headers() {
        let plain = b"-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n";
        assert_eq!(classify_key(plain), Some((SshKeyFormat::Pem, Some(false))));
        let locked = b"-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,ABCDEF\n\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n";
        assert_eq!(classify_key(locked), Some((SshKeyFormat::Pem, Some(true))));
        let ec = b"-----BEGIN EC PRIVATE KEY-----\nMHQCAQEE\n-----END EC PRIVATE KEY-----\n";
        assert_eq!(classify_key(ec), Some((SshKeyFormat::Pem, Some(false))));
        assert_eq!(classify_key(b"-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF\n"), Some((SshKeyFormat::Pkcs8, Some(true))));
        assert_eq!(classify_key(b"-----BEGIN PRIVATE KEY-----\nMIIE\n"), Some((SshKeyFormat::Pkcs8, Some(false))));
        assert_eq!(classify_key(b"-----BEGIN SOMETHING PRIVATE KEY-----\nabc\n"), Some((SshKeyFormat::Unknown, None)));
        assert_eq!(classify_key(b"ssh-ed25519 AAAA user@host\n"), None);
        assert_eq!(classify_key(b"Host github.com\n  User git\n"), None);
        assert_eq!(classify_key(b""), None);
    }

    #[test]
    fn openssh_body_without_magic_is_unknown_encryption() {
        assert_eq!(openssh_cipher("AAAA"), None);
        assert_eq!(classify_key(b"-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n"), Some((SshKeyFormat::Openssh, None)));
    }

    #[test]
    fn non_ascii_and_invalid_bytes_in_the_body_do_not_panic() {
        assert_eq!(openssh_cipher("aaa\u{e9}"), None);
        assert_eq!(openssh_cipher("b3Blab\u{200b}"), None);
        assert_eq!(openssh_cipher("\u{feff}b3BlbnNzaC1rZXktdjEAAAAABG5vbmU=").as_deref(), Some("none"), "a BOM is dropped and the rest decodes");
        let euros: String = std::iter::repeat_n('\u{20ac}', 100).collect();
        assert_eq!(openssh_cipher(&euros), None);
        let garbage = b"-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blab\xff\xff\n-----END OPENSSH PRIVATE KEY-----\n";
        assert_eq!(classify_key(garbage), Some((SshKeyFormat::Openssh, None)));
    }

    #[test]
    fn whitespace_inside_the_body_is_ignored() {
        // openssh-key-v1\0 followed by the length-prefixed cipher name "none".
        let body = "b3BlbnNzaC1rZXktdjEAAAAABG5vbmU=";
        let (a, b) = body.split_at(12);
        assert_eq!(openssh_cipher(&format!("{a}\n  {b}")).as_deref(), Some("none"));
    }

    #[test]
    fn missing_dir() {
        let ssh = scan(Path::new("/nonexistent/talos-ssh")).unwrap();
        assert_eq!(ssh, Ssh { dir_exists: false, dir_mode: None, keys: vec![] });
    }
}
