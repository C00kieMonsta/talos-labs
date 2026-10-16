use std::io::Write;
use std::process::{Command, Stdio};

use super::FixError;
use super::catalog::spec_for;
use super::plan::Bound;
use super::privileged::*;

const ADVERSARIAL: [&str; 9] = [
    "it's",
    "say \"hi\"",
    "back\\slash",
    "$(whoami)",
    "`id`",
    "two words",
    "a;b",
    "'\"\\$(`x`)' ;",
    "--flag=value",
];

fn osascript(source: &str) -> String {
    let mut child = Command::new(OSASCRIPT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(source.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim_end().to_owned()
}

#[test]
fn as_quote_round_trips_through_osascript_return() {
    for text in ADVERSARIAL {
        assert_eq!(
            osascript(&format!("return \"{}\"", as_quote(text))),
            text,
            "{text:?}"
        );
    }
}

#[test]
fn sh_quote_round_trips_argv_through_sh() {
    for text in ADVERSARIAL {
        let tokens: Vec<String> = ["/usr/bin/printf", "%s\\n", text, "tail"]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
        let line = shell_line(0, &tokens, None);
        let out = Command::new("/bin/sh")
            .arg("-c")
            .arg(&line)
            .output()
            .unwrap();
        assert!(out.status.success(), "{line}");
        assert_eq!(
            String::from_utf8_lossy(&out.stdout),
            format!("{text}\ntail\n"),
            "{line}"
        );
    }
}

#[test]
fn admin_source_survives_the_applescript_layer_too() {
    // The whole admin source minus the admin clause: the sh line travels through an AppleScript string.
    let tokens: Vec<String> = ["/bin/echo", "it's \"quoted\" $(x) `y` \\z"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let line = shell_line(0, &tokens, None);
    let source = format!("do shell script \"{}\"", as_quote(&line));
    assert_eq!(osascript(&source), "it's \"quoted\" $(x) `y` \\z");
}

#[test]
fn shell_lines_for_019_carry_two_paths_one_tolerance_and_two_markers() {
    let spec = spec_for("TL-MAC-019").unwrap();
    let bound = Bound::default();
    let lines: Vec<String> = spec
        .steps
        .iter()
        .enumerate()
        .flat_map(|(i, step)| {
            bound
                .commands(step)
                .into_iter()
                .map(move |t| shell_line(i, &t, step.tolerate_exit))
        })
        .collect();
    let joined = lines.join("; ");
    assert_eq!(lines.len(), 2);
    assert_eq!(joined.matches("'/bin/launchctl'").count(), 2);
    assert_eq!(joined.matches("test $? -eq 3").count(), 1);
    assert!(joined.contains("exit 10"));
    assert!(joined.contains("exit 11"));
    assert_eq!(
        lines[0],
        "'/bin/launchctl' 'disable' 'system/com.openssh.sshd' || exit 10"
    );
}

#[test]
fn failing_step_markers_reach_osascript_stderr() {
    let lines = [
        shell_line(0, &["/usr/bin/true".to_owned()], None),
        shell_line(1, &["/usr/bin/false".to_owned()], None),
    ];
    let source = format!("do shell script \"{}\"", as_quote(&lines.join("; ")));
    let mut child = Command::new(OSASCRIPT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(source.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(
        classify(&stderr, out.status.code()),
        Err((FixError::CommandFailed, Some(1))),
        "{stderr}"
    );
}

const EN: &str =
    "execution error: The administrator user name or password was incorrect. (-60005)\n";
const EN_GB: &str =
    "execution error: The administrator username or password was incorrect. (-60005)\n";
const FR: &str =
    "execution error: Le nom et le mot de passe d'administrateur étaient incorrects. (-60005)\n";

#[test]
fn stderr_fixtures_map_to_fix_errors() {
    assert_eq!(classify("", Some(0)), Ok(()));
    for cancelled in [
        "execution error: User canceled. (-128)\n",
        "x (-60006)\n",
        "User canceled\n",
    ] {
        assert_eq!(
            classify(cancelled, Some(1)),
            Err((FixError::Cancelled, None)),
            "{cancelled:?}"
        );
    }
    for wrong in [EN, EN_GB, FR] {
        assert_eq!(
            classify(wrong, Some(1)),
            Err((FixError::WrongPassword, None)),
            "{wrong:?}"
        );
    }
    let no_number = "The administrator username or password was incorrect.\n";
    assert_eq!(
        classify(no_number, Some(1)),
        Err((FixError::WrongPassword, None))
    );
    assert_eq!(
        classify("execution error: boom (11)\n", Some(11)),
        Err((FixError::CommandFailed, Some(1)))
    );
    assert_eq!(
        classify("execution error: boom (10)", Some(10)),
        Err((FixError::CommandFailed, Some(0)))
    );
    assert_eq!(
        classify(
            "execution error: no user interaction was possible (-60007)\n",
            Some(1)
        ),
        Err((FixError::CommandFailed, None))
    );
    assert_eq!(classify("", Some(1)), Err((FixError::CommandFailed, None)));
}

#[test]
fn run_user_reports_exit_status_and_never_uses_a_shell() {
    let running = super::plan::Running::default();
    let tokens: Vec<String> = ["/bin/echo", "$(whoami)", "a;b"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let done = run_user(&tokens, &running).unwrap();
    assert_eq!(done.status, Some(0));
    assert_eq!(done.stdout, "$(whoami) a;b\n");
    let failed = run_user(&["/usr/bin/false".to_owned()], &running).unwrap();
    assert_eq!(failed.status, Some(1));
    assert_eq!(
        run_user(&["/nonexistent/talos".to_owned()], &running).err(),
        Some(FixError::CommandFailed)
    );
}
