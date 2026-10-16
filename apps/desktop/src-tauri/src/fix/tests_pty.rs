use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use zeroize::Zeroizing;

use super::FixError;
use super::plan::Running;
use super::pty::*;

fn tmp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("talos-pty-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

fn stub(dir: &Path, body: &str) -> String {
    let path = dir.join("stub.sh");
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    path.to_string_lossy().into_owned()
}

fn run(program: &str, args: &[String], timeout: Duration) -> Result<(), FixError> {
    let passphrase = Zeroizing::new("correct horse battery".to_owned());
    drive(
        &Session {
            program,
            args,
            passphrase: &passphrase,
            prompt_timeout: timeout,
        },
        &Running::default(),
    )
}

#[test]
fn answers_both_prompts_and_the_answers_arrive_without_echo() {
    let dir = tmp("two");
    let out = dir.join("answers.txt");
    let program = stub(
        &dir,
        &format!(
            "stty -echo 2>/dev/null; printf 'Enter new passphrase (empty for no passphrase): '; read a; printf '\\nEnter same passphrase again: '; read b; printf '%s|%s' \"$a\" \"$b\" > '{}'",
            out.display()
        ),
    );
    assert_eq!(
        run(&program, &["-p".to_owned()], Duration::from_secs(5)),
        Ok(())
    );
    assert_eq!(
        std::fs::read_to_string(&out).unwrap(),
        "correct horse battery|correct horse battery"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_old_passphrase_prompt_aborts() {
    let dir = tmp("old");
    let program = stub(&dir, "printf 'Enter old passphrase: '; read a; exit 0");
    assert_eq!(
        run(&program, &[], Duration::from_secs(5)),
        Err(FixError::CommandFailed)
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_third_prompt_fails_and_a_missing_prompt_times_out() {
    let dir = tmp("third");
    let program = stub(
        &dir,
        "printf 'Enter new passphrase: '; read a; printf 'Enter same passphrase again: '; read b; printf 'Enter passphrase once more: '; read c",
    );
    assert_eq!(
        run(&program, &[], Duration::from_secs(5)),
        Err(FixError::CommandFailed)
    );
    let silent = stub(&dir, "printf 'Enter new passphrase: '; read a; sleep 5");
    let started = std::time::Instant::now();
    assert_eq!(
        run(&silent, &[], Duration::from_millis(400)),
        Err(FixError::Timeout)
    );
    assert!(started.elapsed() < Duration::from_secs(3));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failing_exit_is_command_failed() {
    let dir = tmp("exit");
    let program = stub(
        &dir,
        "printf 'Enter new passphrase: '; read a; printf 'Enter same passphrase again: '; read b; exit 2",
    );
    assert_eq!(
        run(&program, &[], Duration::from_secs(5)),
        Err(FixError::CommandFailed)
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(target_os = "macos")]
#[test]
fn real_ssh_keygen_adds_a_passphrase_to_a_temp_key() {
    use crate::collect::macos::ssh::classify_key;
    use crate::state::SshKeyFormat;
    let dir = tmp("keygen");
    let key = dir.join("id_ed25519");
    let generated = Command::new("/usr/bin/ssh-keygen")
        .args(["-q", "-t", "ed25519", "-N", "", "-C", "talos-test", "-f"])
        .arg(&key)
        .output()
        .unwrap();
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    assert!(still_unencrypted(&key));
    let args: Vec<String> = vec!["-p".into(), "-f".into(), key.to_string_lossy().into_owned()];
    assert_eq!(run("/usr/bin/ssh-keygen", &args, PROMPT_TIMEOUT), Ok(()));
    let head = std::fs::read(&key).unwrap();
    assert_eq!(
        classify_key(&head),
        Some((SshKeyFormat::Openssh, Some(true)))
    );
    assert!(!still_unencrypted(&key));
    let _ = std::fs::remove_dir_all(&dir);
}
