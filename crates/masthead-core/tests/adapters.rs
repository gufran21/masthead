use std::collections::HashMap;
use std::path::PathBuf;

use masthead_core::adapters::{antigravity, claude, codex};
use masthead_core::{Agent, Roots, SessionState, SessionStore, TokenUsage, Turn};

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
}

fn codex_fixture() -> PathBuf {
    let root = fixtures().join("codex").join("sessions");
    codex::discover(&root)
        .into_iter()
        .next()
        .expect("codex fixture")
}

#[test]
fn claude_session_summary() {
    let files = claude::discover(&fixtures().join("claude"));
    assert_eq!(files.len(), 1);
    let s = claude::parse_file(&files[0]).unwrap();

    assert_eq!(s.agent, Agent::ClaudeCode);
    assert_eq!(s.id, "5f2c9a10-1111-4c3e-9a7b-000000000001");
    assert_eq!(
        s.title, "User roles migration",
        "custom title wins over first prompt"
    );
    assert_eq!(s.project_name.as_deref(), Some("api-server"));
    assert_eq!(s.git_branch.as_deref(), Some("main"));
    assert_eq!(s.model.as_deref(), Some("claude-opus-5-5"));
    assert_eq!(
        s.user_messages, 2,
        "meta lines and tool results are not prompts"
    );
    assert_eq!(
        s.tokens,
        TokenUsage {
            input: 15,
            output: 70,
            cache_read: 2010,
            cache_write: 2100
        },
        "streamed blocks of one message are counted once"
    );
    assert_eq!(s.context_used, Some(2115));
    assert_eq!(s.context_window, Some(1_000_000));
    assert_eq!(
        s.turn,
        Turn::Working,
        "the last prompt has no finished reply"
    );
    assert_eq!(
        s.started_at.unwrap().to_rfc3339(),
        "2026-10-20T10:00:00+00:00"
    );
    assert_eq!(
        s.last_activity.unwrap().to_rfc3339(),
        "2026-10-20T10:02:00+00:00"
    );
}

#[test]
fn claude_context_window_comes_from_the_model() {
    use claude::context_window;
    assert_eq!(context_window("claude-opus-5-5", 0), Some(1_000_000));
    assert_eq!(context_window("claude-sonnet-4-6", 0), Some(1_000_000));
    assert_eq!(context_window("claude-haiku-5-5", 0), Some(1_000_000));
    assert_eq!(context_window("claude-fable-5-1", 0), Some(1_000_000));
    assert_eq!(context_window("claude-haiku-4-5", 0), Some(200_000));
    assert_eq!(context_window("claude-sonnet-4-5", 0), Some(200_000));
    assert_eq!(
        context_window("claude-sonnet-4-5", 350_000),
        Some(1_000_000),
        "more than 200K in use means the 1M window"
    );
    assert_eq!(context_window("some-other-model", 0), None);
}

#[test]
fn claude_title_falls_back_to_first_prompt() {
    let dir = std::env::temp_dir().join("masthead-test-claude-title");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("abc.jsonl");
    std::fs::write(
        &file,
        concat!(
            r#"{"type":"user","message":{"content":"<command-name>/clear</command-name>"},"timestamp":"2026-10-20T10:00:00Z"}"#,
            "\n",
            r#"{"type":"user","message":{"content":"  Refactor the payment service\nand add retries"},"timestamp":"2026-10-20T10:00:01Z"}"#,
            "\n"
        ),
    )
    .unwrap();
    let s = claude::parse_file(&file).unwrap();
    assert_eq!(s.title, "Refactor the payment service");
    assert_eq!(s.id, "abc", "file name is the id when lines carry none");
}

#[test]
fn codex_session_summary() {
    let titles = codex::read_index(&fixtures().join("codex").join("session_index.jsonl"));
    let s = codex::parse_file(&codex_fixture(), &titles).unwrap();

    assert_eq!(s.agent, Agent::Codex);
    assert_eq!(s.id, "0190aaaa-0000-7000-8000-000000000002");
    assert_eq!(s.title, "Fix hydration warning");
    assert_eq!(s.project_name.as_deref(), Some("web-app"));
    assert_eq!(s.model.as_deref(), Some("gpt-5-codex"));
    assert_eq!(s.user_messages, 1, "environment context is not a prompt");
    assert_eq!(
        s.tokens,
        TokenUsage {
            input: 10_000,
            output: 900,
            cache_read: 30_000,
            cache_write: 0
        }
    );
    assert_eq!(s.context_used, Some(22_000));
    assert_eq!(s.context_window, Some(258_400));
    assert!(!s.is_subagent);
}

#[test]
fn codex_reads_zstd_rollouts() {
    let dir = std::env::temp_dir().join("masthead-test-codex-zst");
    std::fs::create_dir_all(&dir).unwrap();
    let plain = std::fs::read(codex_fixture()).unwrap();
    let packed = zstd::encode_all(plain.as_slice(), 3).unwrap();
    let file = dir.join("rollout-2026-10-20T11-00-00-x.jsonl.zst");
    std::fs::write(&file, packed).unwrap();

    assert_eq!(codex::discover(&dir), vec![file.clone()]);
    let s = codex::parse_file(&file, &HashMap::new()).unwrap();
    assert_eq!(s.id, "0190aaaa-0000-7000-8000-000000000002");
    assert_eq!(
        s.title, "Fix the hydration warning on the home page",
        "first prompt when the index has no name"
    );
}

#[test]
fn store_lists_all_agents_newest_first() {
    let mut store = SessionStore::new(Roots {
        claude: Some(fixtures().join("claude")),
        codex: Some(fixtures().join("codex").join("sessions")),
        codex_index: Some(fixtures().join("codex").join("session_index.jsonl")),
        antigravity: None,
    });
    let first = store.refresh();
    assert_eq!(first.len(), 2);
    assert_eq!(first[0].agent, Agent::Codex, "11:05 is newer than 10:02");
    assert_eq!(first[1].agent, Agent::ClaudeCode);

    let again = store.refresh();
    assert_eq!(again.len(), 2, "unchanged files come from the cache");

    assert!(store.is_known_project("D:\\Code\\api-server"));
    assert!(store.is_known_project("D:\\Code\\web-app"));
    assert!(!store.is_known_project("C:\\Windows\\System32"));
}

/// Writes JSON lines to a fresh temp file and returns its path.
fn temp_log(name: &str, lines: &[&str]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("masthead-test-{name}"));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join(format!("{name}.jsonl"));
    std::fs::write(
        &file,
        lines.join(
            "
",
        ) + "
",
    )
    .unwrap();
    file
}

#[test]
fn claude_turn_follows_the_conversation() {
    let prompt = r#"{"type":"user","message":{"content":"Fix the build"},"timestamp":"2026-10-20T10:00:00Z"}"#;
    let tool_use = r#"{"type":"assistant","message":{"id":"m1","stop_reason":"tool_use","content":[{"type":"tool_use"}]},"timestamp":"2026-10-20T10:00:05Z"}"#;
    let tool_result = r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]},"timestamp":"2026-10-20T10:00:09Z"}"#;
    let side_done = r#"{"type":"assistant","isSidechain":true,"message":{"id":"s1","stop_reason":"end_turn","content":[{"type":"text","text":"sub"}]},"timestamp":"2026-10-20T10:00:10Z"}"#;
    let done = r#"{"type":"assistant","message":{"id":"m2","stop_reason":"end_turn","content":[{"type":"text","text":"Fixed."}]},"timestamp":"2026-10-20T10:00:12Z"}"#;
    let interrupted = r#"{"type":"user","message":{"content":[{"type":"text","text":"[Request interrupted by user]"}]},"timestamp":"2026-10-20T10:00:13Z"}"#;

    let turn =
        |name: &str, lines: &[&str]| claude::parse_file(&temp_log(name, lines)).unwrap().turn;
    assert_eq!(
        turn("ct-1", &[prompt, tool_use, tool_result]),
        Turn::Working
    );
    assert_eq!(
        turn("ct-2", &[prompt, tool_use, tool_result, side_done]),
        Turn::Working,
        "a subagent finishing doesn't end the main turn"
    );
    assert_eq!(
        turn("ct-3", &[prompt, tool_use, tool_result, done]),
        Turn::Done
    );
    assert_eq!(
        turn("ct-4", &[prompt, tool_use, interrupted]),
        Turn::Interrupted
    );

    let s = claude::parse_file(&temp_log("ct-5", &[prompt, interrupted])).unwrap();
    assert_eq!(
        s.user_messages, 1,
        "the interruption notice is not a prompt"
    );
}

#[test]
fn codex_turn_follows_task_events() {
    let started = r#"{"type":"event_msg","timestamp":"2026-10-20T10:00:00Z","payload":{"type":"task_started"}}"#;
    let complete = r#"{"type":"event_msg","timestamp":"2026-10-20T10:00:30Z","payload":{"type":"task_complete"}}"#;
    let aborted = r#"{"type":"event_msg","timestamp":"2026-10-20T10:00:30Z","payload":{"type":"turn_aborted"}}"#;
    let none = HashMap::new();
    let turn = |name: &str, lines: &[&str]| {
        codex::parse_file(&temp_log(name, lines), &none)
            .unwrap()
            .turn
    };
    assert_eq!(turn("xt-1", &[started]), Turn::Working);
    assert_eq!(turn("xt-2", &[started, complete]), Turn::Done);
    assert_eq!(turn("xt-3", &[started, aborted]), Turn::Interrupted);
}

#[test]
fn state_is_active_only_while_the_agent_works() {
    let started = r#"{"type":"event_msg","timestamp":"2026-10-20T10:00:00Z","payload":{"type":"task_started"}}"#;
    let complete = r#"{"type":"event_msg","timestamp":"2026-10-20T10:00:00Z","payload":{"type":"task_complete"}}"#;
    let none = HashMap::new();
    let at = |minutes: i64| {
        chrono::DateTime::parse_from_rfc3339("2026-10-20T10:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc)
            + chrono::Duration::minutes(minutes)
    };

    let mut working = codex::parse_file(&temp_log("st-1", &[started]), &none).unwrap();
    working.refresh_state(at(5));
    assert_eq!(
        working.state,
        SessionState::Active,
        "a quiet tool run is still work"
    );
    working.refresh_state(at(15));
    assert_eq!(
        working.state,
        SessionState::Idle,
        "no sign of life for 10 minutes"
    );

    let mut done = codex::parse_file(&temp_log("st-2", &[started, complete]), &none).unwrap();
    done.refresh_state(at(0));
    assert_eq!(
        done.state,
        SessionState::Idle,
        "finished means waiting for the user"
    );
    done.refresh_state(at(90));
    assert_eq!(done.state, SessionState::Ended);
}

/// A summaries database shaped like Antigravity's, with the columns Masthead reads.
fn antigravity_db(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("masthead-test-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("conversation_summaries.db");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch(
        r#"CREATE TABLE conversation_summaries (
            conversation_id text, title text NOT NULL DEFAULT "", preview text NOT NULL DEFAULT "",
            step_count integer, last_modified_time datetime NOT NULL, workspace_uris text NOT NULL,
            status text NOT NULL DEFAULT "", parent_conversation_id text, nesting_depth integer,
            not_fully_idle integer, killed integer, raw_summary blob);
        INSERT INTO conversation_summaries VALUES
          ('c1', 'Secure deck architecture', '', 2525, '2026-10-23 20:04:49.6307804+00:00',
           '["file:///d%3A/Workspace/invokemind"]', 'CASCADE_RUN_STATUS_IDLE', '', 0, 0, 0,
           X'3a06089f8ceac7064a0622046d61696e'),
          ('c2', '', 'Research the carousel app
and report back', 198, '2026-10-23 19:00:00+00:00',
           '["file:///d%3A/Workspace/invokemind"]', 'CASCADE_RUN_STATUS_IDLE', 'c1', 1, 0, 0, NULL),
          ('c3', 'Fix login', '', 12, '2026-10-23 21:00:00+00:00',
           '["file:///d%3A/Workspace/web"]', 'CASCADE_RUN_STATUS_RUNNING', '', 0, 1, 0, NULL);"#,
    )
    .unwrap();

    // Conversation c1's own database: one model call and two prompts.
    let conversations = dir.join("conversations");
    std::fs::create_dir_all(&conversations).unwrap();
    let c1 = rusqlite::Connection::open(conversations.join("c1.db")).unwrap();
    c1.execute_batch(
        "CREATE TABLE gen_metadata (idx integer, data blob, size integer);
         CREATE TABLE steps (idx integer, step_type integer);
         INSERT INTO gen_metadata VALUES
           (0, X'0a232207106418142884074a0952070888272080e2099a010c67656d696e692d332d70726f', 0);
         INSERT INTO steps VALUES (0, 14), (1, 5), (2, 9), (3, 14);",
    )
    .unwrap();
    path
}

#[test]
fn antigravity_conversations_are_read() {
    let mut list = antigravity::parse_index(&antigravity_db("antigravity")).unwrap();
    list.sort_by(|a, b| a.id.cmp(&b.id));
    assert_eq!(list.len(), 3);

    let main = &list[0];
    assert_eq!(main.agent, Agent::Antigravity);
    assert_eq!(main.title, "Secure deck architecture");
    assert_eq!(
        main.project_path.as_deref(),
        Some("D:\\Workspace\\invokemind")
    );
    assert_eq!(main.project_name.as_deref(), Some("invokemind"));
    assert_eq!(main.turn, Turn::Done);
    assert!(!main.is_subagent);
    assert_eq!(
        main.last_activity.unwrap().to_rfc3339(),
        "2026-10-23T20:04:49.630780400+00:00"
    );

    assert_eq!(
        main.started_at.unwrap().to_rfc3339(),
        "2025-10-23T19:46:39+00:00",
        "start comes from the summary blob, not the last change"
    );
    assert_eq!(main.git_branch.as_deref(), Some("main"));

    let sub = &list[1];
    assert_eq!(
        sub.title, "Research the carousel app",
        "falls back to the preview"
    );
    assert!(sub.is_subagent);

    assert_eq!(
        list[2].turn,
        Turn::Working,
        "a running conversation is working"
    );
}

#[test]
fn store_includes_antigravity() {
    let mut store = SessionStore::new(Roots {
        antigravity: Some(antigravity_db("antigravity-store")),
        ..Roots::default()
    });
    let sessions = store.refresh();
    assert_eq!(sessions.len(), 3);
    assert_eq!(sessions[0].id, "c3", "newest first");
    assert!(store.is_known_project("D:\\Workspace\\web"));

    let c1 = sessions.iter().find(|s| s.id == "c1").unwrap();
    assert_eq!(c1.model.as_deref(), Some("gemini-3-pro"));
    assert_eq!(
        c1.tokens,
        TokenUsage {
            input: 100,
            output: 20,
            cache_read: 900,
            cache_write: 0
        }
    );
    assert_eq!(
        (c1.context_used, c1.context_window),
        (Some(5000), Some(160_000))
    );
    assert_eq!(c1.user_messages, 2, "prompts are the user-input steps");
}
