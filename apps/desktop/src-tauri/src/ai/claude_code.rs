
    // ----- the chat session -----

    /// A `#!/bin/sh` stand-in for Claude Code's stream-json loop. It prints the init line,
    /// logs every stdin line under `out/<pid>.lines`, and answers each user line by the
    /// `MODE:<name>` word in its content (two deltas and a result by default).
    const FAKE_CHILD: &str = r#"#!/bin/sh
OUT=__OUT__
LOG="$OUT/$$.lines"
: > "$LOG"
echo '{"type":"system","subtype":"init","capabilities":["interrupt_receipt_v1"],"session_id":"s","uuid":"i"}'
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$LOG"
  case "$line" in
    *'"type":"user"'*) ;;
    *) continue ;;
  esac
  uuid=$(printf '%s' "$line" | sed -n 's/.*"uuid":"\([^"]*\)".*/\1/p')
  mode=$(printf '%s' "$line" | sed -n 's/.*MODE:\([A-Z0-9_]*\).*/\1/p')
  case "$mode" in
    SLEEP)
      IFS= read -r ctl && printf '%s\n' "$ctl" >> "$LOG"
      echo '{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["Request interrupted by user"],"user_message_uuid":"'"$uuid"'"}'
      continue ;;
    AUTH_RETRY)
      echo '{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed"}'
      IFS= read -r ctl && printf '%s\n' "$ctl" >> "$LOG"
      continue ;;
    EXIT)
      echo eof >> "$LOG"
      exit 0 ;;
    ERR400)
      echo '{"type":"result","subtype":"success","is_error":true,"api_error_status":"400","result":"bad request","user_message_uuid":"'"$uuid"'"}'
      continue ;;
    STRAY)
      echo '{"type":"result","subtype":"success","is_error":false,"user_message_uuid":"not-this-one","structured_output":{"reply":"stray","relatedRuleIds":[],"outsideScope":false,"intents":[]}}' ;;
  esac
  echo '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"reply\":\"Hello"}}}'
  echo '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":" there\",\"relatedRuleIds\":[],\"outsideScope\":false,\"intents\":[]}"}}}'
  echo '{"type":"result","subtype":"success","is_error":false,"user_message_uuid":"'"$uuid"'","result_index":0,"structured_output":{"reply":"Hello there","relatedRuleIds":[],"outsideScope":false,"intents":[]}}'
done
echo eof >> "$LOG"
"#;

    struct FakeSetup {
        claude: ClaudeCode,
        dirs: Dirs,
        out: PathBuf,
        root: PathBuf,
    }

    /// A `ClaudeCode` whose located binary is the fake, under a throwaway app-data dir.
    fn with_fake(tag: &str, limits: ChatLimits) -> FakeSetup {
        let root = temp_root(tag);
        let out = root.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let script = root.join("claude-fake");
        std::fs::write(
            &script,
            FAKE_CHILD.replace("__OUT__", &out.to_string_lossy()),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let dirs = Dirs::under(&root.join("data"));
        dirs.ensure().unwrap();
        let claude = ClaudeCode::with_chat_limits(limits);
        *lock(&claude.fake_bin) = Some(script);
        FakeSetup {
            claude,
            dirs,
            out,
            root,
        }
    }

    impl FakeSetup {
        /// Marks the cached sign-in so a warm spawns without a probe.
        fn signed_in(&self) {
            *lock(&self.claude.auth_cache) = Some((true, Instant::now()));
        }

        fn lines_of(&self, pid: u32) -> String {
            std::fs::read_to_string(self.out.join(format!("{pid}.lines"))).unwrap_or_default()
        }

        /// Polls until the child's log holds `needle`.
        fn wait_for_line(&self, pid: u32, needle: &str) -> String {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let text = self.lines_of(pid);
                if text.contains(needle) || Instant::now() >= deadline {
                    return text;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        fn turn(&self, id: &str, instructions: &str, prompt: &str) -> Result<Vec<StreamPayload>, String> {
            let events = Mutex::new(Vec::new());
            let request = GenerateRequest {
                id: id.into(),
                task: Task::Chat,
                instructions: instructions.into(),
                prompt: prompt.into(),
            };
            self.claude
                .chat_turn(&self.dirs, request, &|p| lock(&events).push(p))?;
            Ok(events.into_inner().unwrap_or_default())
        }

        fn finish(self) {
            self.claude.end_chat();
            std::thread::sleep(Duration::from_millis(100));
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn kinds(events: &[StreamPayload]) -> Vec<(super::super::StreamKind, Option<String>)> {
        events
            .iter()
            .map(|e| (e.kind, e.code.clone()))
            .collect()
    }

    fn done_reply(events: &[StreamPayload]) -> Option<String> {
        events
            .iter()
            .find(|e| e.kind == super::super::StreamKind::Done)
            .and_then(|e| e.json.as_ref())
            .and_then(|j| j.get("reply"))
            .and_then(Value::as_str)
            .map(str::to_owned)
    }

    const INSTR: &str = "You chat. Chat prompt marker.";

    #[test]
    fn chat_args_add_stream_json_input_and_keep_the_locked_flags() {
        let plain = generate_args(INSTR, schemas::CHAT);
        let chat = chat_args(INSTR, schemas::CHAT);
        assert_eq!(chat.len(), plain.len() + 2);
        let out = chat.iter().position(|a| a == "--output-format").unwrap();
        assert_eq!(
            chat.get(out..out + 4).unwrap(),
            ["--output-format", "stream-json", "--input-format", "stream-json"]
        );
        let mut without: Vec<String> = chat.clone();
        without.drain(out + 2..out + 4);
        assert_eq!(without, plain, "nothing else differs");
        for flag in [
            "-p",
            "--safe-mode",
            "--disable-slash-commands",
            "--tools",
            "--allowedTools",
            "--strict-mcp-config",
            "--system-prompt",
            "--max-turns",
            "--no-session-persistence",
            "--permission-prompts",
            "--permission-mode",
            "--verbose",
            "--include-partial-messages",
            "--json-schema",
        ] {
            assert!(chat.contains(&flag.to_owned()), "{flag}");
        }
        for absent in ["--replay-user-messages", "--resume", "--bare", "--model", "--continue"] {
            assert!(!chat.contains(&absent.to_owned()), "{absent}");
        }
        assert_eq!(chat.last().map(String::as_str), Some(schemas::CHAT));
        let turns = chat.iter().position(|a| a == "--max-turns").unwrap();
        assert_eq!(chat.get(turns + 1).map(String::as_str), Some("2"));
        assert_ne!(
            SessionKey::of(INSTR, schemas::CHAT),
            SessionKey::of("other", schemas::CHAT)
        );
        let uuid = random_uuid_v4();
        assert_eq!(uuid.len(), 36);
        assert_eq!(uuid.get(14..15), Some("4"));
        assert!(matches!(uuid.get(19..20), Some("8" | "9" | "a" | "b")));
        assert_eq!(
            ChatLimits::DEFAULT,
            ChatLimits {
                idle: Duration::from_secs(600),
                lifetime: Duration::from_secs(1800),
                max_turns: 3
            }
        );
    }

    #[test]
    fn a_chat_session_answers_two_turns_over_one_child() {
        let f = with_fake("chat-two", ChatLimits::DEFAULT);
        f.signed_in();
        assert_eq!(
            f.claude.warm_chat(&f.dirs, INSTR),
            Ok(ChatWarm {
                state: ChatWarmState::Ready
            })
        );
        let pid = f.claude.chat_pid().unwrap();
        assert_eq!(
            f.claude.warm_chat(&f.dirs, INSTR).map(|w| w.state),
            Ok(ChatWarmState::Ready),
            "idempotent"
        );
        assert_eq!(f.claude.chat_pid(), Some(pid));
        assert!(!f.claude.is_busy());

        let one = f.turn("one", INSTR, "{\"turns\":[\"first MARKER-1\"]}").unwrap();
        assert_eq!(done_reply(&one).as_deref(), Some("Hello there"));
        assert!(
            one.iter().any(|e| e.kind == super::super::StreamKind::Partial),
            "{:?}",
            kinds(&one)
        );
        let two = f.turn("two", INSTR, "{\"turns\":[\"second MARKER-2\"]}").unwrap();
        assert_eq!(done_reply(&two).as_deref(), Some("Hello there"));
        assert_eq!(f.claude.chat_pid(), Some(pid), "the same child");
        assert!(!f.claude.is_busy());
        assert!(lock(&f.claude.inflight).is_none());

        let log = f.lines_of(pid);
        let users: Vec<&str> = log.lines().filter(|l| l.contains("\"type\":\"user\"")).collect();
        assert_eq!(users.len(), 2, "{log}");
        for (line, marker) in users.iter().zip(["MARKER-1", "MARKER-2"]) {
            let value: Value = serde_json::from_str(line).unwrap();
            assert_eq!(value["type"], "user");
            assert_eq!(value["message"]["role"], "user");
            assert!(value["message"]["content"].as_str().unwrap().contains(marker));
            assert_eq!(value["parent_tool_use_id"], Value::Null);
            assert_eq!(value["client_composed"], true);
            assert_eq!(value["uuid"].as_str().unwrap().len(), 36);
            assert_eq!(value.as_object().unwrap().len(), 5, "no other field");
        }
        let first: Value = serde_json::from_str(users[0]).unwrap();
        let second: Value = serde_json::from_str(users[1]).unwrap();
        assert_ne!(first["uuid"], second["uuid"]);
        assert!(!log.contains("control_request"));
        f.finish();
    }

    #[test]
    fn a_turn_without_a_warm_spawns_and_a_changed_instructions_respawns() {
        let f = with_fake("chat-cold", ChatLimits::DEFAULT);
        assert_eq!(f.claude.chat_pid(), None);
        let one = f.turn("one", INSTR, "{}").unwrap();
        assert_eq!(done_reply(&one).as_deref(), Some("Hello there"));
        let first = f.claude.chat_pid().unwrap();
        let two = f.turn("two", "You chat differently.", "{}").unwrap();
        assert_eq!(done_reply(&two).as_deref(), Some("Hello there"));
        let second = f.claude.chat_pid().unwrap();
        assert_ne!(first, second, "a changed prompt is a new process");
        let old = f.wait_for_line(first, "eof");
        assert!(old.contains("eof"), "the old child saw stdin close: {old}");
        assert!(!old.contains("control_request"), "no interrupt without a turn in flight");
        let held = lock(&f.claude.chat).as_ref().unwrap().run_dir.path().to_path_buf();
        assert!(lock(&LIVE_RUN_DIRS).contains(&held), "the live session holds its run dir");
        assert!(held.exists());
        f.finish();
    }

    #[test]
    fn a_cancel_interrupts_then_closes_stdin_and_frees_the_slot_at_once() {
        let f = Arc::new(with_fake("chat-cancel", ChatLimits::DEFAULT));
        f.signed_in();
        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        let first = f.claude.chat_pid().unwrap();
        let first_dir = lock(&f.claude.chat).as_ref().unwrap().run_dir.path().to_path_buf();
        let runner = Arc::clone(&f);
        let turn = std::thread::spawn(move || runner.turn("stall", INSTR, "MODE:SLEEP {}"));
        let deadline = Instant::now() + Duration::from_secs(5);
        while lock(&f.claude.inflight).as_ref().map(|i| i.id.as_str()) != Some("stall") {
            assert!(Instant::now() < deadline, "the turn registers");
            std::thread::sleep(Duration::from_millis(10));
        }
        f.wait_for_line(first, "\"type\":\"user\"");
        f.claude.cancel("stall");
        let events = turn.join().unwrap().unwrap();
        assert_eq!(
            kinds(&events),
            [(super::super::StreamKind::Error, Some("cancelled".into()))]
        );
        // The slot is free at once: a turn within 100 ms answers on a new child.
        let started = Instant::now();
        let next = f.turn("next", INSTR, "{}").unwrap();
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(done_reply(&next).as_deref(), Some("Hello there"));
        let second = f.claude.chat_pid().unwrap();
        assert_ne!(first, second, "the interrupted process is never reused");
        let old = f.wait_for_line(first, "eof");
        let control = old.find("control_request").expect(&old);
        let eof = old.find("eof").expect(&old);
        assert!(control < eof, "interrupt, then stdin closed: {old}");
        assert!(old.contains("\"request\":{\"subtype\":\"interrupt\"}"), "{old}");
        assert!(old.contains("\"request_id\":\"int-1\""), "{old}");
        let deadline = Instant::now() + Duration::from_secs(5);
        while lock(&LIVE_RUN_DIRS).contains(&first_dir) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!lock(&LIVE_RUN_DIRS).contains(&first_dir), "the old run dir is released");
        assert!(!first_dir.exists(), "and removed");
        Arc::try_unwrap(f).ok().unwrap().finish();
    }

    #[test]
    fn a_stray_result_for_another_uuid_is_ignored() {
        let f = with_fake("chat-stray", ChatLimits::DEFAULT);
        let events = f.turn("one", INSTR, "MODE:STRAY {}").unwrap();
        assert_eq!(done_reply(&events).as_deref(), Some("Hello there"));
        let pid = f.claude.chat_pid().unwrap();
        // An API error filed under success ends the turn and the session.
        let bad = f.turn("two", INSTR, "MODE:ERR400 {}").unwrap();
        assert_eq!(
            kinds(&bad),
            [(
                super::super::StreamKind::Error,
                Some("provider_unavailable".into())
            )]
        );
        assert_eq!(f.claude.chat_pid(), None);
        f.wait_for_line(pid, "eof");
        f.finish();
    }

    #[test]
    fn an_auth_retry_ends_the_turn_as_needs_sign_in_and_the_session() {
        let f = with_fake("chat-auth", ChatLimits::DEFAULT);
        let started = Instant::now();
        let events = f.turn("one", INSTR, "MODE:AUTH_RETRY {}").unwrap();
        assert!(started.elapsed() < Duration::from_secs(5), "no wait for the retries");
        assert_eq!(
            kinds(&events),
            [(
                super::super::StreamKind::Error,
                Some("needs_sign_in".into())
            )]
        );
        assert_eq!(f.claude.chat_pid(), None);
        assert_eq!(
            f.claude.current_error(false).map(|s| s.state),
            Some(ProviderState::NeedsSignIn)
        );
        assert_eq!(
            f.claude.warm_chat(&f.dirs, INSTR),
            Err("needs_sign_in".into()),
            "the cached error refuses the respawn"
        );
        f.finish();
    }

    #[test]
    fn an_exit_without_a_result_is_provider_unavailable() {
        let f = with_fake("chat-exit", ChatLimits::DEFAULT);
        let events = f.turn("one", INSTR, "MODE:EXIT {}").unwrap();
        assert_eq!(
            kinds(&events),
            [(
                super::super::StreamKind::Error,
                Some("provider_unavailable".into())
            )]
        );
        assert_eq!(f.claude.chat_pid(), None);
        assert_eq!(
            f.claude.current_error(false).map(|s| s.state),
            Some(ProviderState::ProviderUnavailable)
        );
        assert!(!f.claude.is_busy());
        f.finish();
    }

    #[test]
    fn idle_lifetime_and_the_turn_cap_end_the_session() {
        let limits = ChatLimits {
            idle: Duration::from_millis(100),
            lifetime: Duration::from_secs(1),
            max_turns: 2,
        };
        let f = with_fake("chat-limits", limits);
        f.signed_in();
        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        assert!(!f.claude.chat_sweep(), "fresh");
        std::thread::sleep(Duration::from_millis(150));
        assert!(f.claude.chat_sweep(), "idle");
        assert_eq!(f.claude.chat_pid(), None);

        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        let pid = f.claude.chat_pid().unwrap();
        f.turn("one", INSTR, "{}").unwrap();
        assert_eq!(f.claude.chat_pid(), Some(pid));
        f.turn("two", INSTR, "{}").unwrap();
        assert_eq!(f.claude.chat_pid(), None, "the turn cap ends it after the done");
        f.wait_for_line(pid, "eof");

        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        std::thread::sleep(Duration::from_millis(1100));
        // Past the lifetime a turn respawns rather than reuse the old child.
        let old = f.claude.chat_pid().unwrap();
        f.turn("three", INSTR, "{}").unwrap();
        assert_ne!(f.claude.chat_pid(), Some(old));
        f.claude.end_chat();
        std::thread::sleep(Duration::from_millis(100));
        // A child that died on its own is swept too.
        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        let pid = f.claude.chat_pid().unwrap();
        // SAFETY: our own child, by the pid we spawned.
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
        std::thread::sleep(Duration::from_millis(50));
        assert!(f.claude.chat_sweep(), "gone");
        assert_eq!(f.claude.chat_pid(), None);
        f.finish();
    }

    #[test]
    fn the_credential_gate_refuses_warm_and_turn_and_ends_the_session() {
        let f = with_fake("chat-gate", ChatLimits::DEFAULT);
        f.signed_in();
        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        let pid = f.claude.chat_pid().unwrap();
        {
            let _hold = GateHold::new(&f.claude.chat_gate);
            f.claude.end_chat();
            assert_eq!(f.claude.chat_pid(), None);
            assert_eq!(
                f.claude.warm_chat(&f.dirs, INSTR),
                Err("not_connected".into())
            );
            assert_eq!(f.turn("one", INSTR, "{}"), Err("not_connected".into()));
            assert!(!f.claude.is_busy());
            f.wait_for_line(pid, "eof");
        }
        assert!(!f.claude.chat_gate.load(Ordering::SeqCst));
        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        assert!(f.claude.chat_pid().is_some());
        f.finish();
    }

    #[test]
    fn a_disconnect_ends_the_chat_session() {
        let f = with_fake("chat-disconnect", ChatLimits::DEFAULT);
        f.signed_in();
        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        let pid = f.claude.chat_pid().unwrap();
        // The fake's logout exits 0; the real codesign then rejects the script, so the
        // sign-out reports unavailable. The session is gone either way.
        let _ = f.claude.disconnect(&f.dirs);
        assert_eq!(f.claude.chat_pid(), None);
        assert!(!f.claude.chat_gate.load(Ordering::SeqCst), "the hold is released");
        f.wait_for_line(pid, "eof");
        f.signed_in();
        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        f.finish();
    }

    #[test]
    fn the_busy_slot_is_shared_with_the_judge() {
        let f = with_fake("chat-busy", ChatLimits::DEFAULT);
        // A watch call holds the slot: the chat cancels it and waits for the slot.
        let cancel = Arc::new(AtomicBool::new(false));
        f.claude.busy.store(true, Ordering::SeqCst);
        *lock(&f.claude.inflight) = Some(InFlight {
            id: "watch1".into(),
            task: Task::Watch,
            cancel: Arc::clone(&cancel),
        });
        let flag = Arc::clone(&cancel);
        let events = std::thread::scope(|scope| {
            scope.spawn(|| {
                while !flag.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(10));
                }
                *lock(&f.claude.inflight) = None;
                f.claude.busy.store(false, Ordering::SeqCst);
            });
            f.turn("one", INSTR, "{}").unwrap()
        });
        assert_eq!(done_reply(&events).as_deref(), Some("Hello there"));
        assert!(!f.claude.is_busy());
        // An explanation holds the slot: the chat answers busy.
        f.claude.busy.store(true, Ordering::SeqCst);
        *lock(&f.claude.inflight) = Some(InFlight {
            id: "explain1".into(),
            task: Task::Explain,
            cancel: Arc::new(AtomicBool::new(false)),
        });
        assert_eq!(f.turn("two", INSTR, "{}"), Err("busy".into()));
        *lock(&f.claude.inflight) = None;
        f.claude.busy.store(false, Ordering::SeqCst);
        // And a chat turn holds it against the judge.
        let bad = GenerateRequest {
            id: "x".into(),
            task: Task::Explain,
            instructions: INSTR.into(),
            prompt: "{}".into(),
        };
        assert_eq!(
            f.claude.chat_turn(&f.dirs, bad, &|_| panic!("nothing streams")),
            Err("invalid_input".into())
        );
        f.finish();
    }

    #[test]
    fn a_full_writer_queue_ends_the_session() {
        let f = with_fake("chat-queue", ChatLimits::DEFAULT);
        f.signed_in();
        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        let pid = f.claude.chat_pid().unwrap();
        // A rendezvous channel with nobody receiving reads as full.
        let (full, _kept) = mpsc::sync_channel::<String>(0);
        let original = lock(&f.claude.chat).as_mut().unwrap().stdin.replace(full);
        let events = f.turn("one", INSTR, "{}").unwrap();
        drop(original);
        assert_eq!(
            kinds(&events),
            [(
                super::super::StreamKind::Error,
                Some("provider_unavailable".into())
            )]
        );
        assert_eq!(f.claude.chat_pid(), None);
        f.wait_for_line(pid, "eof");
        // A writer that has gone reads the same.
        f.claude.warm_chat(&f.dirs, INSTR).unwrap();
        let (gone, dropped) = mpsc::sync_channel::<String>(1);
        drop(dropped);
        let original = lock(&f.claude.chat).as_mut().unwrap().stdin.replace(gone);
        let events = f.turn("two", INSTR, "{}").unwrap();
        drop(original);
        assert_eq!(
            kinds(&events).first().and_then(|(_, c)| c.clone()).as_deref(),
            Some("provider_unavailable")
        );
        assert_eq!(f.claude.chat_pid(), None);
        f.finish();
    }

    #[test]
    fn session_files_naming_a_dead_run_dir_are_removed() {
        let root = temp_root("sessions");
        let dirs = Dirs::under(&root.join("data"));
        dirs.ensure().unwrap();
        let sessions = dirs.config.join(SESSIONS_DIR);
        std::fs::create_dir_all(&sessions).unwrap();
        let live = RunDir::create().unwrap();
        let write = |pid: u32, cwd: &str| {
            std::fs::write(
                sessions.join(format!("{pid}.json")),
                serde_json::json!({ "pid": pid, "cwd": cwd, "sessionId": "s" }).to_string(),
            )
            .unwrap();
            std::fs::write(sessions.join(format!("{pid}.abc.key")), "k").unwrap();
        };
        write(101, "/private/tmp/talos-claude-0123456789abcdef");
        write(102, "/Users/someone/project");
        write(103, &live.path().to_string_lossy());
        write(104, "/private/tmp/talos-claude-not-a-run-dir");
        std::fs::write(sessions.join("notes.json"), "{}").unwrap();
        std::fs::write(sessions.join("105.json"), "not json").unwrap();
        assert_eq!(sweep_session_files(&dirs), 1);
        assert!(!sessions.join("101.json").exists());
        assert!(!sessions.join("101.abc.key").exists());
        assert!(sessions.join("102.json").exists(), "another folder");
        assert!(sessions.join("102.abc.key").exists());
        assert!(sessions.join("103.json").exists(), "held by this process");
        assert!(sessions.join("104.json").exists(), "not our name");
        assert!(sessions.join("105.json").exists());
        assert!(sessions.join("notes.json").exists());
        let gone = live.path().to_path_buf();
        drop(live);
        assert!(!gone.exists());
        assert_eq!(sweep_session_files(&dirs), 1, "released and gone, it is swept");
        assert!(!sessions.join("103.json").exists());
        assert!(!sessions.join("103.abc.key").exists());
        remove_session_files(&dirs, 102);
        assert!(!sessions.join("102.json").exists());
        assert!(!sessions.join("102.abc.key").exists());
        assert_eq!(sweep_session_files(&Dirs::under(&root.join("none"))), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn warm_skips_the_spawn_on_a_cached_error_or_no_sign_in() {
        let f = with_fake("chat-warm", ChatLimits::DEFAULT);
        assert_eq!(
            f.claude.warm_chat(&f.dirs, "-flag"),
            Err("invalid_text".into())
        );
        assert_eq!(
            f.claude.warm_chat(&f.dirs, &"x".repeat(MAX_INSTRUCTIONS_CHARS + 1)),
            Err("instructions_too_long".into())
        );
        f.claude.remember_error("limit_reached", Some("2099-01-01T00:00:00Z".into()));
        assert_eq!(
            f.claude.warm_chat(&f.dirs, INSTR),
            Err("limit_reached".into())
        );
        assert_eq!(f.claude.chat_pid(), None, "no spawn");
        f.claude.remember_error("plan_not_eligible", None);
        assert_eq!(
            f.claude.warm_chat(&f.dirs, INSTR),
            Err("plan_not_eligible".into())
        );
        f.claude.remember_error("provider_unavailable", None);
        assert_eq!(
            f.claude.warm_chat(&f.dirs, INSTR),
            Err("provider_unavailable".into())
        );
        f.claude.clear_errors();
        // No cached sign-in: the probe runs the fake's `auth status`, which reports none.
        assert_eq!(
            f.claude.warm_chat(&f.dirs, INSTR),
            Err("not_connected".into())
        );
        assert_eq!(f.claude.chat_pid(), None);
        f.signed_in();
        assert_eq!(
            f.claude.warm_chat(&f.dirs, INSTR).map(|w| w.state),
            Ok(ChatWarmState::Ready)
        );
        assert!(f.claude.chat_pid().is_some());
        assert!(!f.claude.is_busy(), "warm never takes the slot");
        f.finish();
    }

    /// One POST the recorder saw.
    struct Recorded {
        head: String,
        body: String,
        at: Instant,
    }

    /// Canned Anthropic streaming bodies: a StructuredOutput call, then an end_turn text.
    fn sse(events: &[(&str, Value)]) -> String {
        events
            .iter()
            .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
            .collect()
    }

    fn sse_tool_use(reply: &str) -> String {
        let input = serde_json::json!({
            "reply": reply,
            "relatedRuleIds": [],
            "outsideScope": false,
            "intents": []
        })
        .to_string();
        let (head, tail) = input.split_at(input.len() / 2);
        sse(&[
            ("message_start", serde_json::json!({"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}})),
            ("content_block_start", serde_json::json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"StructuredOutput","input":{}}})),
            ("content_block_delta", serde_json::json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":head}})),
            ("content_block_delta", serde_json::json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":tail}})),
            ("content_block_stop", serde_json::json!({"type":"content_block_stop","index":0})),
            ("message_delta", serde_json::json!({"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":20}})),
            ("message_stop", serde_json::json!({"type":"message_stop"})),
        ])
    }

    fn sse_end_turn() -> String {
        sse(&[
            ("message_start", serde_json::json!({"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}})),
            ("content_block_start", serde_json::json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}})),
            ("content_block_delta", serde_json::json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done."}})),
            ("content_block_stop", serde_json::json!({"type":"content_block_stop","index":0})),
            ("message_delta", serde_json::json!({"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}})),
            ("message_stop", serde_json::json!({"type":"message_stop"})),
        ])
    }

    /// Answers HEAD and GET with 200 and empty, POSTs with the canned stream (a tool call for a
    /// fresh message, an end_turn after a tool result); holds a POST open while `stall` is set.
    fn recorder(
        listener: std::net::TcpListener,
        records: Arc<Mutex<Vec<Recorded>>>,
        stall: Arc<AtomicBool>,
        stop: Arc<AtomicBool>,
    ) {
        use std::io::BufRead;
        listener.set_nonblocking(true).unwrap();
        while !stop.load(Ordering::SeqCst) {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(20));
                continue;
            };
            let records = Arc::clone(&records);
            let stall = Arc::clone(&stall);
            let stop = Arc::clone(&stop);
            std::thread::spawn(move || {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
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
                        return;
                    }
                    let mut body = vec![0u8; length];
                    let _ = reader.read_exact(&mut body);
                    let body = String::from_utf8_lossy(&body).into_owned();
                    if !head.starts_with("POST ") {
                        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
                        continue;
                    }
                    lock(&records).push(Recorded {
                        head: head.clone(),
                        body: body.clone(),
                        at: Instant::now(),
                    });
                    if stall.load(Ordering::SeqCst) {
                        // Hold the request open; the client gives up or the test ends.
                        while stall.load(Ordering::SeqCst) && !stop.load(Ordering::SeqCst) {
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        return;
                    }
                    let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                    let last_has_tool_result = value["messages"]
                        .as_array()
                        .and_then(|m| m.last())
                        .map(|m| m.to_string().contains("tool_result"))
                        .unwrap_or(false);
                    let marker = value["messages"]
                        .as_array()
                        .and_then(|m| m.first())
                        .map(|m| m.to_string())
                        .and_then(|t| t.find("PROMPT-MARKER-").map(|i| t.get(i..i + 18).unwrap_or("").to_owned()))
                        .unwrap_or_default();
                    let payload = if last_has_tool_result {
                        sse_end_turn()
                    } else {
                        sse_tool_use(&format!("Reply to {marker}"))
                    };
                    let _ = stream.write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{payload}",
                            payload.len()
                        )
                        .as_bytes(),
                    );
                    let _ = stream.flush();
                }
            });
        }
    }

    /// The go/no-go gate for the long-lived session, run by hand:
    /// `cargo test chat_session_recorder -- --ignored --nocapture`. Needs the owner's 2.1.287.
    /// A throwaway config dir, a dummy API key and a local recorder in place of the API; the
    /// real HOME and USER as in the app; nothing signed in; everything removed at the end.
    #[test]
    #[ignore]
    fn chat_session_recorder_answers_two_messages_over_one_process() {
        use std::net::TcpListener;
        let bin_path = dirs::home_dir()
            .unwrap()
            .join(".local/share/claude/versions/2.1.287");
        let bin = verify(&bin_path).unwrap();
        let root = temp_root("chat-recorder");
        let dirs = Dirs::under(&root.join("data"));
        dirs.ensure().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let records = Arc::new(Mutex::new(Vec::<Recorded>::new()));
        let stall = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let server = {
            let (records, stall, stop) = (Arc::clone(&records), Arc::clone(&stall), Arc::clone(&stop));
            std::thread::spawn(move || recorder(listener, records, stall, stop))
        };
        let posts = |n: usize| -> Vec<(String, String)> {
            lock(&records)
                .iter()
                .skip(n)
                .map(|r| (r.head.clone(), r.body.clone()))
                .collect()
        };

        let instructions = "SYSTEM-PROMPT-MARKER-4412 You chat.";
        let run_dir = RunDir::create().unwrap();
        let canary = run_dir.path().parent().unwrap().join("CLAUDE.md");
        std::fs::write(&canary, "CANARY-CLAUDE-MD-7731").unwrap();
        let mut command = chat_command(&bin, &dirs, run_dir.path(), instructions, schemas::CHAT);
        command
            .env("ANTHROPIC_API_KEY", "dummy")
            .env("ANTHROPIC_BASE_URL", format!("http://127.0.0.1:{port}"));
        let spawned_at = Instant::now();
        let session = spawn_chat_from(
            command,
            run_dir,
            &dirs,
            SessionKey::of(instructions, schemas::CHAT),
        )
        .unwrap();
        let pid = session.pid;
        let claude = ClaudeCode::default();
        *lock(&claude.auth_cache) = Some((true, Instant::now()));
        *lock(&claude.chat) = Some(session);
        std::thread::sleep(Duration::from_secs(3));
        let before_first = lock(&records).len();

        let turn = |id: &str, prompt: &str| -> (Vec<StreamPayload>, Duration) {
            let events = Mutex::new(Vec::new());
            let request = GenerateRequest {
                id: id.into(),
                task: Task::Chat,
                instructions: instructions.into(),
                prompt: prompt.into(),
            };
            let started = Instant::now();
            claude
                .chat_turn(&dirs, request, &|p| lock(&events).push(p))
                .unwrap();
            (events.into_inner().unwrap(), started.elapsed())
        };
        let (one, one_took) = turn("one", "{\"turns\":[{\"role\":\"user\",\"content\":\"PROMPT-MARKER-9901\"}]}");
        let after_one = lock(&records).len();
        let (two, two_took) = turn("two", "{\"turns\":[{\"role\":\"user\",\"content\":\"PROMPT-MARKER-9902\"}]}");
        let after_two = lock(&records).len();
        let pid_after_two = claude.chat_pid();
        let rss_kb = Command::new("/bin/ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
            .unwrap_or_default();

        // Turn three stalls at the recorder; the session is ended with an interrupt.
        stall.store(true, Ordering::SeqCst);
        let mut session = lock(&claude.chat).take().unwrap();
        let uuid = random_uuid_v4();
        assert!(session.send_line(ChatSession::user_line(
            &uuid,
            "{\"turns\":[{\"role\":\"user\",\"content\":\"PROMPT-MARKER-9903\"}]}"
        )));
        let stalled_deadline = Instant::now() + Duration::from_secs(20);
        while lock(&records).len() == after_two && Instant::now() < stalled_deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let three_posted = lock(&records).len() > after_two;
        std::thread::sleep(Duration::from_millis(500));
        let interrupt_supported = session.interrupt_supported;
        let ending = Instant::now();
        let report = end_session(session, Some(uuid.clone()), false);
        let end_took = ending.elapsed();
        stall.store(false, Ordering::SeqCst);
        stop.store(true, Ordering::SeqCst);
        let still_running = Command::new("/bin/ps")
            .args(["-p", &pid.to_string()])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false);
        let sessions_left: Vec<String> = std::fs::read_dir(dirs.config.join(SESSIONS_DIR))
            .map(|d| d.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect())
            .unwrap_or_default();
        let _ = std::fs::remove_file(&canary);
        let _ = std::fs::remove_dir_all(&root);
        server.join().unwrap();

        let real = account().unwrap();
        let home = real.home.to_string_lossy().into_owned();
        let config = dirs.config.to_string_lossy().into_owned();
        let all = posts(0);
        eprintln!("--- Claude Code 2.1.287, pid {pid}, alive {:?} at the end ---", spawned_at.elapsed());
        eprintln!("POSTs before the first user line: {before_first}");
        eprintln!("turn one: {one_took:?}, POSTs {} ({:?})", after_one - before_first, kinds(&one));
        eprintln!("turn two: {two_took:?}, POSTs {} ({:?})", after_two - after_one, kinds(&two));
        eprintln!("same pid after two turns: {:?}", pid_after_two == Some(pid));
        eprintln!("idle RSS after turn two: {rss_kb} kB");
        eprintln!("init capabilities had interrupt_receipt_v1: {interrupt_supported}");
        eprintln!("turn three POSTed before the interrupt: {three_posted}");
        eprintln!("end: {report:?} in {end_took:?}; still running after: {still_running}");
        eprintln!("sessions files left after the end: {sessions_left:?}");
        for (i, (head, body)) in all.iter().enumerate() {
            let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
            let messages = value["messages"].as_array().map(Vec::len).unwrap_or(0);
            let first_line = head.lines().next().unwrap_or("");
            eprintln!(
                "POST {}: {first_line}; {} bytes; {messages} messages; markers 9901 {} 9902 {} 9903 {}",
                i + 1,
                body.len(),
                body.contains("PROMPT-MARKER-9901"),
                body.contains("PROMPT-MARKER-9902"),
                body.contains("PROMPT-MARKER-9903"),
            );
        }
        if let Some((_, body)) = all.first() {
            eprintln!("--- first body ---\n{body}");
        }
        if let Some((_, body)) = all.get(after_one) {
            eprintln!("--- first body of turn two ---\n{body}");
        }

        assert_eq!(before_first, 0, "no POST before the first user line");
        assert_eq!(done_reply(&one).as_deref(), Some("Reply to PROMPT-MARKER-9901"));
        assert_eq!(done_reply(&two).as_deref(), Some("Reply to PROMPT-MARKER-9902"));
        assert_eq!(pid_after_two, Some(pid), "one process for both messages");
        assert!(interrupt_supported, "system/init names interrupt_receipt_v1");
        let turn_one = all.get(before_first..after_one).unwrap_or(&[]);
        let turn_two = all.get(after_one..after_two).unwrap_or(&[]);
        assert!(!turn_one.is_empty() && !turn_two.is_empty());
        assert!(turn_one.iter().all(|(_, b)| b.contains("PROMPT-MARKER-9901") && !b.contains("PROMPT-MARKER-9902")));
        assert!(turn_two.iter().all(|(_, b)| b.contains("PROMPT-MARKER-9902")));
        assert!(
            turn_two.iter().all(|(_, b)| b.contains("SYSTEM-PROMPT-MARKER-4412")),
            "the second POST still carries the system prompt"
        );
        for (_, body) in &all {
            assert!(!body.contains("CANARY-CLAUDE-MD-7731"), "no ancestor CLAUDE.md");
            assert!(!body.contains(&home), "no home path");
            assert!(!body.contains(&real.user), "no account name");
            assert!(!body.contains("/Users/"), "no path under /Users");
            assert!(!body.contains(&config), "no config dir path");
            assert!(!body.contains("/var/folders/"), "no per-user temp path");
        }
        assert!(three_posted, "the stalled turn reached the recorder");
        assert!(report.interrupted, "the interrupted turn answered within CHAT_INTERRUPT_WAIT");
        assert!(report.exited, "the child exited within CHAT_END_WAIT of stdin closing");
        assert!(!still_running, "the child is gone");
        assert!(
            sessions_left.iter().all(|n| !n.starts_with(&format!("{pid}."))),
            "the registry entry is removed: {sessions_left:?}"
        );
    }
}
