//! Codex keeps one rollout file per thread at
//! `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, often zstd-compressed
//! (`.jsonl.zst`). Thread titles live in `~/.codex/session_index.jsonl`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::Value;
use walkdir::WalkDir;

use super::{for_each_json_line, message_text};
use crate::model::{parse_ts, title_from, Agent, Session, TokenUsage, Turn};

/// Where Codex keeps its rollouts: `$CODEX_HOME/sessions` when that is set (as
/// Codex itself does), otherwise `~/.codex/sessions`.
pub fn default_root() -> Option<PathBuf> {
    codex_home().map(|d| d.join("sessions"))
}

pub fn default_index() -> Option<PathBuf> {
    codex_home().map(|d| d.join("session_index.jsonl"))
}

fn codex_home() -> Option<PathBuf> {
    match std::env::var_os("CODEX_HOME") {
        Some(dir) if !dir.is_empty() => Some(PathBuf::from(dir)),
        _ => dirs::home_dir().map(|h| h.join(".codex")),
    }
}

pub fn discover(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default();
            name.starts_with("rollout-")
                && (name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
        })
        .collect()
}

/// Thread id → thread name, from Codex's session index.
pub fn read_index(path: &Path) -> HashMap<String, String> {
    let mut names = HashMap::new();
    let _ = for_each_json_line(path, |line| {
        if let (Some(id), Some(name)) = (
            line.get("id").and_then(Value::as_str),
            line.get("thread_name").and_then(Value::as_str),
        ) {
            names.insert(id.to_string(), name.to_string());
        }
    });
    names
}

pub fn parse_file(path: &Path, titles: &HashMap<String, String>) -> anyhow::Result<Session> {
    let mut session = Session::new(String::new(), Agent::Codex, path.to_path_buf());
    let mut first_prompt: Option<String> = None;

    for_each_json_line(path, |line| {
        if let Some(ts) = parse_ts(line.get("timestamp")) {
            session.see_timestamp(ts);
        }
        let Some(payload) = line.get("payload") else {
            return;
        };
        match line.get("type").and_then(Value::as_str) {
            Some("session_meta") => {
                if let Some(id) = payload.get("id").and_then(Value::as_str) {
                    session.id = id.to_string();
                }
                if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                    session.set_project(cwd);
                }
                if let Some(ts) = parse_ts(payload.get("timestamp")) {
                    session.see_timestamp(ts);
                }
                let has_subagent_source = payload
                    .get("source")
                    .and_then(|s| s.get("subagent"))
                    .is_some();
                session.is_subagent =
                    has_subagent_source || payload.get("parent_thread_id").is_some();
            }
            Some("turn_context") => {
                if let Some(model) = payload.get("model").and_then(Value::as_str) {
                    session.model = Some(model.to_string());
                }
                if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                    session.set_project(cwd);
                }
            }
            Some("event_msg")
                if matches!(
                    payload.get("type").and_then(Value::as_str),
                    Some("task_started" | "task_complete" | "turn_aborted")
                ) =>
            {
                session.turn = match payload.get("type").and_then(Value::as_str) {
                    Some("task_started") => Turn::Working,
                    Some("task_complete") => Turn::Done,
                    _ => Turn::Interrupted,
                };
            }
            Some("event_msg")
                if payload.get("type").and_then(Value::as_str) == Some("token_count") =>
            {
                let Some(info) = payload.get("info") else {
                    return;
                };
                if let Some(total) = info.get("total_token_usage") {
                    let n = |k: &str| total.get(k).and_then(Value::as_u64).unwrap_or(0);
                    let cached = n("cached_input_tokens");
                    // Codex reports input including the cached part.
                    session.tokens = TokenUsage {
                        input: n("input_tokens").saturating_sub(cached),
                        output: n("output_tokens"),
                        cache_read: cached,
                        cache_write: n("cache_write_input_tokens"),
                    };
                }
                if let Some(last) = info.get("last_token_usage") {
                    session.context_used = last.get("input_tokens").and_then(Value::as_u64);
                }
                if let Some(window) = info.get("model_context_window").and_then(Value::as_u64) {
                    session.context_window = Some(window);
                }
            }
            Some("response_item")
                if payload.get("type").and_then(Value::as_str) == Some("message")
                    && payload.get("role").and_then(Value::as_str) == Some("user") =>
            {
                if let Some(text) = payload
                    .get("content")
                    .and_then(message_text)
                    .and_then(title_from)
                {
                    session.user_messages += 1;
                    first_prompt.get_or_insert(text);
                }
            }
            _ => {}
        }
    })?;

    if session.id.is_empty() {
        session.id = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
    }
    session.title = titles
        .get(&session.id)
        .cloned()
        .or(first_prompt)
        .unwrap_or_else(|| "Untitled thread".to_string());
    Ok(session)
}
