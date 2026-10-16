use std::os::unix::fs::symlink;
use std::path::Path;

use super::FixError;
use super::inputs::*;
use crate::state::{SshKey, SshKeyFormat};

fn tmp(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("talos-fix-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn key(path: &Path, format: SshKeyFormat, encrypted: Option<bool>) -> SshKey {
    SshKey {
        path: path.to_string_lossy().into_owned(),
        format,
        encrypted,
        mode: Some("600".into()),
    }
}

const LISTING: &str = r#"{"Public":{"path":"/Users/alice/Public","smb_name":"Alice's Public Folder","smb_guest_access":1},"Bad'Name":{"path":"/Users/alice/Bad","smb_guest_access":1}}"#;

#[test]
fn share_names_bind_from_the_listing_and_reject_bad_ones() {
    assert_eq!(
        bind_share("/Users/alice/Public", LISTING),
        Ok("Public".into())
    );
    assert_eq!(
        bind_share("/Users/alice/Bad", LISTING),
        Err(FixError::InvalidChoice)
    );
    assert_eq!(
        bind_share("/Users/alice/Other", LISTING),
        Err(FixError::InvalidChoice)
    );
    assert_eq!(
        bind_share("/Users/alice/Public\n", LISTING),
        Err(FixError::InvalidChoice)
    );
    assert_eq!(
        bind_share("/Users/alice/Public", "not json"),
        Err(FixError::InvalidChoice)
    );
    assert!(valid_share_name("My Share_1.0-x"));
    assert!(!valid_share_name(""));
    assert!(!valid_share_name(&"a".repeat(65)));
    assert!(!valid_share_name("quote'"));
    assert!(!valid_share_name("semi;colon"));
}

#[test]
fn key_format_flags_follow_the_fixed_table() {
    assert_eq!(key_format_flags(SshKeyFormat::Openssh), Ok(&[][..]));
    assert_eq!(key_format_flags(SshKeyFormat::Pem), Ok(&["-m", "PEM"][..]));
    assert_eq!(
        key_format_flags(SshKeyFormat::Pkcs8),
        Ok(&["-m", "PKCS8"][..])
    );
    assert_eq!(
        key_format_flags(SshKeyFormat::Unknown),
        Err(FixError::InvalidChoice)
    );
}

#[test]
fn key_paths_must_be_listed_regular_files_under_the_ssh_dir() {
    let home = tmp("keys").canonicalize().unwrap();
    let ssh = home.join(".ssh");
    std::fs::create_dir(&ssh).unwrap();
    let good = ssh.join("id_ed25519");
    std::fs::write(&good, "-----BEGIN OPENSSH PRIVATE KEY-----\n").unwrap();
    let outside = home.join("id_rsa");
    std::fs::write(&outside, "-----BEGIN RSA PRIVATE KEY-----\n").unwrap();
    let link = ssh.join("link");
    symlink(&good, &link).unwrap();
    let nested = ssh.join("sub");
    std::fs::create_dir(&nested).unwrap();
    let deep = nested.join("key");
    std::fs::write(&deep, "x").unwrap();
    let keys = vec![
        key(&good, SshKeyFormat::Openssh, Some(false)),
        key(&outside, SshKeyFormat::Pem, Some(false)),
        key(&link, SshKeyFormat::Openssh, Some(false)),
        key(&deep, SshKeyFormat::Openssh, Some(false)),
        key(&nested, SshKeyFormat::Openssh, Some(false)),
    ];
    let canonical_ssh = ssh.canonicalize().unwrap();
    let good_canon = canonical_ssh.join("id_ed25519");
    let keys_canon = vec![key(&good_canon, SshKeyFormat::Openssh, Some(false))];
    assert_eq!(
        check_key_path(&good_canon.to_string_lossy(), &keys_canon, &ssh),
        Ok(good_canon.clone())
    );
    let err = |p: &Path| check_key_path(&p.to_string_lossy(), &keys, &ssh);
    assert_eq!(
        err(&outside),
        Err(FixError::InvalidChoice),
        "outside ~/.ssh"
    );
    assert_eq!(err(&link), Err(FixError::InvalidChoice), "symlink");
    assert_eq!(err(&deep), Err(FixError::InvalidChoice), "nested");
    assert_eq!(err(&nested), Err(FixError::InvalidChoice), "directory");
    assert_eq!(
        err(Path::new("/nope/key")),
        Err(FixError::InvalidChoice),
        "unlisted"
    );
    let newline = format!("{}\n", good_canon.to_string_lossy());
    assert_eq!(
        check_key_path(&newline, &keys_canon, &ssh),
        Err(FixError::InvalidChoice)
    );
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn a_key_owned_by_another_uid_is_rejected() {
    let root_owned = Path::new("/private/etc/ssh/ssh_config");
    if !root_owned.exists() {
        eprintln!("skipped: no /private/etc/ssh/ssh_config on this machine");
        return;
    }
    let keys = vec![key(root_owned, SshKeyFormat::Openssh, Some(false))];
    assert_eq!(
        check_key_path(
            &root_owned.to_string_lossy(),
            &keys,
            Path::new("/private/etc/ssh")
        ),
        Err(FixError::InvalidChoice)
    );
}

#[test]
fn unencrypted_binding_needs_a_known_format_and_a_clear_key() {
    let home = tmp("bind").canonicalize().unwrap();
    let ssh = home.join(".ssh");
    std::fs::create_dir_all(&ssh).unwrap();
    let pem = ssh.join("pem");
    let unknown = ssh.join("unknown");
    let locked = ssh.join("locked");
    for p in [&pem, &unknown, &locked] {
        std::fs::write(p, "-----BEGIN RSA PRIVATE KEY-----\n").unwrap();
    }
    let keys = vec![
        key(&pem, SshKeyFormat::Pem, Some(false)),
        key(&unknown, SshKeyFormat::Unknown, None),
        key(&locked, SshKeyFormat::Openssh, Some(true)),
    ];
    let (path, flags) = bind_unencrypted_key(&pem.to_string_lossy(), &keys, &ssh).unwrap();
    assert_eq!(path, pem);
    assert_eq!(flags, &["-m", "PEM"]);
    assert_eq!(
        bind_unencrypted_key(&unknown.to_string_lossy(), &keys, &ssh),
        Err(FixError::InvalidChoice)
    );
    assert_eq!(
        bind_unencrypted_key(&locked.to_string_lossy(), &keys, &ssh),
        Err(FixError::InvalidChoice)
    );
    assert_eq!(bind_all_keys(&keys, &ssh).len(), 3);
    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn passphrase_and_previous_rules() {
    assert_eq!(check_passphrase("short"), Err(FixError::InvalidInput));
    assert_eq!(check_passphrase("eight ok"), Ok(()));
    assert_eq!(check_passphrase(&"é".repeat(256)), Ok(()));
    assert_eq!(
        check_passphrase(&"a".repeat(257)),
        Err(FixError::InvalidInput)
    );
    assert_eq!(
        check_passphrase("has a tab\there"),
        Err(FixError::InvalidInput)
    );
    assert_eq!(
        check_passphrase("has a newline\n"),
        Err(FixError::InvalidInput)
    );
    assert_eq!(parse_previous("1200\n", true), Some("1200".into()));
    assert_eq!(parse_previous("", true), None);
    assert_eq!(parse_previous("12 00", true), None);
    assert_eq!(parse_previous("1200", false), None);
    assert_eq!(check_slot("ok"), Ok(()));
    assert_eq!(check_slot("nul\0"), Err(FixError::InvalidInput));
    assert_eq!(check_slot(""), Err(FixError::InvalidInput));
}
