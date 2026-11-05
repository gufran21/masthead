use std::collections::HashMap;
use std::path::PathBuf;

use masthead_core::adapters::{claude, codex};
use masthead_core::{Agent, Roots, SessionStore, TokenUsage};

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
