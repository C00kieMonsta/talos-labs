use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::FixError;
use super::batch::*;
use super::catalog::{Arg, Choice, FixBin, FixSpec, Privilege, Reversible, Secret, Step, spec_for};
use super::plan::{Bound, PLAN_TTL, Plan, PlanStore, Running, Stored};
use super::privileged::{as_quote, classify, shell_line};
use super::run::PRECONDITION_STUB;
use crate::state::SectionKey;

fn tokens(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| (*s).to_owned()).collect()
}

fn plan(rule: &str) -> Plan {
    Plan::new(spec_for(rule).unwrap(), Bound::default(), None)
}

fn batch(items: Vec<Plan>) -> BatchPlan {
    BatchPlan {
        id: super::plan::new_id(),
        items,
        excluded: Vec::new(),
        created: Instant::now(),
    }
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("talos-batch-{name}-{}", super::plan::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn sh(script: &[String]) -> std::process::Output {
    Command::new("/bin/sh")
        .arg("-c")
        .arg(script.join("; "))
        .output()
        .unwrap()
}

#[test]
fn item_block_for_019_silences_both_steps_and_reports_once() {
    let block = item_block(3, &item_lines(&plan("TL-MAC-019")));
    assert_eq!(block.matches("} >/dev/null 2>&1").count(), 2);
    assert_eq!(block.matches("test $? -eq 3").count(), 1);
    assert!(block.contains("exit 10"));
    assert!(block.contains("exit 11"));
    assert!(block.ends_with("; echo R 3 $?"), "{block}");
    assert!(
        block.starts_with("( { '/bin/launchctl' 'disable'"),
        "{block}"
    );
}

#[test]
fn a_four_item_script_runs_through_sh_with_markers_in_order() {
    let dir = temp_dir("sh");
    let never = dir.join("never");
    let blocks = [
        item_block(0, &[shell_line(0, &tokens(&["/bin/echo", "a"]), None)]),
        item_block(1, &[shell_line(0, &tokens(&["/usr/bin/false"]), Some(1))]),
        item_block(
            2,
            &[
                shell_line(0, &tokens(&["/bin/echo", "b"]), None),
                shell_line(1, &tokens(&["/usr/bin/false"]), None),
                shell_line(
                    2,
                    &tokens(&["/usr/bin/touch", &never.to_string_lossy()]),
                    None,
                ),
            ],
        ),
        item_block(3, &[shell_line(0, &tokens(&["/bin/echo", "c"]), None)]),
    ];
    let script = batch_script(&blocks);
    assert_eq!(script.last().map(String::as_str), Some("exit 0"));
    assert_eq!(script.len(), 5);
    let out = sh(&script);
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(stdout, "R 0 0\nR 1 0\nR 2 11\nR 3 0\n", "{stdout}");
    assert!(!never.exists(), "the failing item's later step ran");
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(
        parse_markers(&stdout, 4),
        [Some(0), Some(0), Some(11), Some(0)]
    );
}

#[test]
fn parse_markers_accepts_every_line_ending_and_ignores_junk() {
    assert_eq!(parse_markers("R 0 0\nR 1 11\n", 2), [Some(0), Some(11)]);
    assert_eq!(parse_markers("R 0 0\rR 1 11\r", 2), [Some(0), Some(11)]);
    assert_eq!(parse_markers("R 0 0\r\nR 1 11\r\n", 2), [Some(0), Some(11)]);
    assert_eq!(
        parse_markers("noise\nR 0 0\nR x 1\nR 1\nR 1 11 extra\nR 1 2\n", 2),
        [Some(0), Some(2)]
    );
    assert_eq!(parse_markers("R 0 0\n", 2), [Some(0), None], "missing item");
    assert_eq!(parse_markers("R 7 0\n", 2), [None, None], "out of range");
    // A forged line from a command's own output cannot happen (every command is silenced); the later line wins.
    assert_eq!(parse_markers("R 0 11\nR 0 0\n", 1), [Some(0)]);
    assert_eq!(parse_markers("", 0), Vec::<Option<i32>>::new());
}

#[test]
fn timeout_and_prompt_are_fixed() {
    assert_eq!(batch_timeout(17), Duration::from_secs(375));
    assert_eq!(batch_timeout(0), super::privileged::ADMIN_TIMEOUT);
    assert_eq!(
        prompt_for_batch(3),
        "Talos Labs wants to fix 3 things on this Mac."
    );
    assert_eq!(
        prompt_for_batch(1),
        "Talos Labs wants to fix 1 thing on this Mac."
    );
}

#[test]
fn a_batch_script_survives_the_applescript_string_layer() {
    let blocks = [
        item_block(0, &item_lines(&plan("TL-MAC-019"))),
        item_block(
            1,
            &[shell_line(
                0,
                &tokens(&["/bin/echo", "it's \"q\" $(x)"]),
                None,
            )],
        ),
    ];
    let script = batch_script(&blocks).join("; ");
    let source = format!("return \"{}\"", as_quote(&script));
    let mut child = Command::new(super::privileged::OSASCRIPT)
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
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim_end(), script);
    assert!(
        super::privileged::admin_source_batch(std::slice::from_ref(&script), "p")
            .ends_with("with administrator privileges without altering line endings")
    );
}

fn with_precondition<T>(holds: bool, f: impl FnOnce() -> T) -> T {
    PRECONDITION_STUB.with(|s| s.set(Some(holds)));
    let out = f();
    PRECONDITION_STUB.with(|s| s.set(None));
    out
}

#[test]
fn preview_batch_applies_the_batch_rules() {
    let err = |rules: &[&str]| preview_batch(&tokens(rules)).err();
    assert_eq!(
        err(&["TL-MAC-002", "TL-MAC-002"]),
        Some(FixError::InvalidChoice)
    );
    assert_eq!(
        err(&["TL-MAC-002", "TL-MAC-022"]),
        Some(FixError::InvalidChoice)
    );
    assert_eq!(err(&["TL-MAC-029"]), Some(FixError::InvalidChoice));
    assert_eq!(err(&[]), Some(FixError::InvalidChoice));
    assert_eq!(
        err(&["TL-MAC-002", "TL-MAC-001"]),
        Some(FixError::NotInCatalog)
    );
    assert_eq!(err(&["TL-MAC-999"]), Some(FixError::NotInCatalog));
    with_precondition(false, || {
        assert_eq!(
            err(&["TL-MAC-020"]),
            Some(FixError::InvalidChoice),
            "all excluded"
        );
        let plan = preview_batch(&tokens(&["TL-MAC-020", "TL-MAC-002"])).unwrap();
        assert_eq!(plan.items.len(), 1);
        assert_eq!(plan.excluded.len(), 1);
        assert_eq!(plan.excluded[0].rule_id, "TL-MAC-020");
        assert_eq!(plan.excluded[0].error, FixError::PreconditionChanged);
    });
}

#[test]
fn preview_batch_orders_admin_first_in_catalog_order_and_unions_recheck() {
    let plan = with_precondition(true, || {
        preview_batch(&tokens(&[
            "TL-MAC-013",
            "TL-MAC-019",
            "TL-MAC-002",
            "TL-MAC-020",
        ]))
        .unwrap()
    });
    let order: Vec<&str> = plan.items.iter().map(|p| p.spec.rule).collect();
    assert_eq!(
        order,
        ["TL-MAC-002", "TL-MAC-019", "TL-MAC-020", "TL-MAC-013"]
    );
    let wire = plan.wire();
    let json = serde_json::to_value(&wire).unwrap();
    assert_eq!(json["needsPassword"], true);
    assert_eq!(
        json["recheck"],
        serde_json::json!(["firewall", "screenLock", "listeners", "remoteAccess"])
    );
    assert_eq!(json["items"][0]["ruleId"], "TL-MAC-002");
    assert_eq!(json["items"][0]["lines"][0]["privilege"], "admin");
    assert_eq!(
        json["items"][3]["recheck"],
        serde_json::json!(["screenLock"])
    );
    assert_eq!(json["excluded"], serde_json::json!([]));
    assert_eq!(json["planId"].as_str().unwrap().len(), 32);
    assert!(json["expiresAt"].as_str().unwrap().ends_with('Z'));
}

#[test]
fn stored_kinds_reject_each_other_and_share_the_running_slot() {
    let store = PlanStore::default();
    let batch_id = store.insert_batch(batch(vec![plan("TL-MAC-002")])).plan_id;
    let single_id = store.insert(plan("TL-MAC-003")).plan_id;
    let (stored, _running) = store.start(&batch_id).unwrap();
    assert!(matches!(stored, Stored::Batch(_)));
    assert_eq!(
        store.start(&single_id).err(),
        Some(FixError::Busy),
        "single while a batch runs"
    );
    assert_eq!(
        stored.into_single().err(),
        Some(FixError::PlanExpired),
        "fix_apply on a batch id"
    );
    store.finish(&batch_id);
    assert_eq!(
        store.start(&batch_id).err(),
        Some(FixError::PlanExpired),
        "a batch id runs once"
    );
    let (stored, _running) = store.start(&single_id).unwrap();
    assert!(matches!(stored, Stored::Single(_)));
    let other_batch = store.insert_batch(batch(vec![plan("TL-MAC-002")])).plan_id;
    assert_eq!(
        store.start(&other_batch).err(),
        Some(FixError::Busy),
        "batch while a single runs"
    );
    assert_eq!(
        stored.into_batch().err(),
        Some(FixError::PlanExpired),
        "fix_apply_batch on a single id"
    );
    store.finish(&single_id);
    assert!(store.start(&other_batch).is_ok());
    store.finish(&other_batch);
}

#[test]
fn a_batch_id_expires() {
    let store = PlanStore::default();
    let mut stale = batch(vec![plan("TL-MAC-002")]);
    stale.created = Instant::now() - PLAN_TTL - Duration::from_secs(1);
    assert!(stale.expired());
    let id = store.insert_batch(stale).plan_id;
    assert_eq!(store.start(&id).err(), Some(FixError::PlanExpired));
    assert!(!store.is_running());
}

#[test]
fn dialog_failures_leave_every_item_not_run() {
    let plan = batch(vec![plan("TL-MAC-002"), plan("TL-MAC-013")]);
    let fixtures = [
        (
            "execution error: User canceled. (-128)\n",
            FixError::Cancelled,
        ),
        (
            "execution error: The administrator user name or password was incorrect. (-60005)\n",
            FixError::WrongPassword,
        ),
    ];
    for (stderr, expected) in fixtures {
        let Err((err, _)) = classify(stderr, Some(1)) else {
            panic!("{stderr:?}")
        };
        assert_eq!(err, expected);
        let outcome = settle(&plan, vec![None, None], Some(err));
        assert_eq!(outcome.error, Some(expected));
        assert!(!outcome.ok);
        assert!(outcome.items.iter().all(|i| i.status == ItemStatus::NotRun));
    }
    let timeout = settle(&plan, vec![None, None], Some(FixError::Timeout));
    assert_eq!(
        serde_json::to_value(&timeout).unwrap(),
        serde_json::json!({
            "ok": false,
            "items": [
                { "ruleId": "TL-MAC-002", "status": "not_run", "error": null, "step": null },
                { "ruleId": "TL-MAC-013", "status": "not_run", "error": null, "step": null }
            ],
            "error": "timeout"
        })
    );
}

#[test]
fn item_codes_map_to_outcomes() {
    assert_eq!(outcome_for_code("r", Some(0)).status, ItemStatus::Done);
    let marked = outcome_for_code("r", Some(11));
    assert_eq!(
        (marked.status, marked.error, marked.step),
        (ItemStatus::Failed, Some(FixError::CommandFailed), Some(1))
    );
    let plain = outcome_for_code("r", Some(1));
    assert_eq!((plain.status, plain.step), (ItemStatus::Failed, None));
    let missing = outcome_for_code("r", None);
    assert_eq!(
        (missing.status, missing.error),
        (ItemStatus::Failed, Some(FixError::CommandFailed))
    );
}

/// A user-level spec that only touches the temp dir bound as `SshDir`.
static CHMOD_DIR: FixSpec = FixSpec {
    rule: "TL-TEST-DIR",
    steps: &[Step {
        bin: FixBin::Chmod,
        args: &[Arg::Lit("700"), Arg::SshDir],
        privilege: Privilege::User,
        tolerate_exit: None,
        per_key: false,
    }],
    choice: Choice::AllSshKeys,
    secret: Secret::None,
    precondition: None,
    reversible: Reversible::No,
    recheck: &[SectionKey::Ssh],
    previous: None,
    expect: "",
};

fn dir_item(dir: &std::path::Path) -> Plan {
    let bound = Bound {
        ssh_dir: Some(dir.to_path_buf()),
        ..Bound::default()
    };
    Plan::new(&CHMOD_DIR, bound, None)
}

#[test]
fn user_level_items_run_one_by_one_with_item_status() {
    let dir = temp_dir("apply");
    let missing = dir.join("missing");
    let plan = batch(vec![dir_item(&dir), dir_item(&missing), dir_item(&dir)]);
    let seen = std::sync::Mutex::new(Vec::new());
    let running = std::sync::Arc::new(Running::default());
    let outcome = apply_batch(&plan, &running, &|s| seen.lock().unwrap().push(s)).unwrap();
    assert!(!outcome.ok);
    assert_eq!(outcome.error, None);
    let statuses: Vec<ItemStatus> = outcome.items.iter().map(|i| i.status).collect();
    assert_eq!(
        statuses,
        [ItemStatus::Done, ItemStatus::Failed, ItemStatus::Done]
    );
    assert_eq!(outcome.items[1].error, Some(FixError::CommandFailed));
    assert_eq!(outcome.items[1].step, Some(0));
    let items: Vec<Option<usize>> = seen.lock().unwrap().iter().map(|s| s.item).collect();
    assert_eq!(items, [Some(0), Some(1), Some(2)]);
    let json = serde_json::to_value(&seen.lock().unwrap()[0]).unwrap();
    assert_eq!(json["item"], 0);
    assert_eq!(json["phase"], "running");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn cancel_before_the_run_leaves_every_item_not_run() {
    let dir = temp_dir("cancel");
    let plan = batch(vec![dir_item(&dir), dir_item(&dir)]);
    let running = std::sync::Arc::new(Running::default());
    running.cancel();
    let outcome = apply_batch(&plan, &running, &|_| {}).unwrap();
    assert!(!outcome.ok);
    assert!(outcome.items.iter().all(|i| i.status == ItemStatus::NotRun));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_precondition_that_fails_at_apply_is_failed_and_the_dialog_is_skipped() {
    let dir = temp_dir("pre");
    let plan = batch(vec![plan("TL-MAC-020"), dir_item(&dir)]);
    let running = std::sync::Arc::new(Running::default());
    let seen = std::sync::Mutex::new(Vec::new());
    let outcome = with_precondition(false, || {
        apply_batch(&plan, &running, &|s| seen.lock().unwrap().push(s)).unwrap()
    });
    assert_eq!(outcome.items[0].status, ItemStatus::Failed);
    assert_eq!(outcome.items[0].error, Some(FixError::PreconditionChanged));
    assert_eq!(outcome.items[1].status, ItemStatus::Done);
    assert!(
        seen.lock()
            .unwrap()
            .iter()
            .all(|s| s.phase == super::run::FixPhase::Running),
        "no password dialog was opened"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_single_path_status_has_no_item_key() {
    let status = super::run::FixStatus {
        plan_id: "x".into(),
        phase: super::run::FixPhase::WaitingForPassword,
        step: 1,
        of: 2,
        item: None,
    };
    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "planId": "x", "phase": "waiting_for_password", "step": 1, "of": 2 })
    );
}
