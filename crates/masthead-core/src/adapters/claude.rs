//! Claude Code keeps one JSON Lines file per session at
//! `~/.claude/projects/<project-slug>/<session-id>.jsonl`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{for_each_json_line, message_text};
use crate::model::{parse_ts, title_from, Agent, Session, TokenUsage};

/// Default location of Claude Code's session logs.
pub fn default_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("projects"))
}

/// Session files directly inside each project folder (subagent transcripts in
/// deeper folders are not separate sessions).
pub fn discover(root: &Path) -> Vec<PathBuf> {
    let Ok(projects) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    projects
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| std::fs::read_dir(e.path()).ok())
        .flat_map(|files| files.flatten())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .collect()
}

pub fn parse_file(path: &Path) -> anyhow::Result<Session> {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut session = Session::new(stem, Agent::ClaudeCode, path.to_path_buf());
    let mut custom_title: Option<String> = None;
    let mut first_prompt: Option<String> = None;
    // Streaming writes one line per content block, each repeating the message's
    // usage, so usage is keyed by message id and counted once.
    let mut usage_by_message: HashMap<String, TokenUsage> = HashMap::new();
    let mut last_context: Option<u64> = None;

    for_each_json_line(path, |line| {
        if let Some(ts) = parse_ts(line.get("timestamp")) {
            session.see_timestamp(ts);
        }
        if let Some(id) = line.get("sessionId").and_then(Value::as_str) {
            session.id = id.to_string();
        }
        if let Some(cwd) = line.get("cwd").and_then(Value::as_str) {
            session.set_project(cwd);
        }
        if let Some(branch) = line.get("gitBranch").and_then(Value::as_str) {
            if !branch.is_empty() {
                session.git_branch = Some(branch.to_string());
            }
        }

        match line.get("type").and_then(Value::as_str) {
            Some("custom-title") => {
                if let Some(t) = line.get("customTitle").and_then(Value::as_str) {
                    custom_title = Some(t.to_string());
                }
            }
            Some("user") => {
                let is_meta = line.get("isMeta").and_then(Value::as_bool).unwrap_or(false);
                let is_side = line
                    .get("isSidechain")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let text = line
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(message_text)
                    .and_then(title_from);
                // Tool results also arrive as `user` lines but carry no text block.
                if let (false, false, Some(text)) = (is_meta, is_side, text) {
                    session.user_messages += 1;
                    first_prompt.get_or_insert(text);
                }
            }
            Some("assistant") => {
                let Some(message) = line.get("message") else {
                    return;
                };
                if let Some(model) = message.get("model").and_then(Value::as_str) {
                    if !model.starts_with('<') {
                        session.model = Some(model.to_string());
                    }
                }
                if let Some(usage) = message.get("usage") {
                    let n = |k: &str| usage.get(k).and_then(Value::as_u64).unwrap_or(0);
                    let u = TokenUsage {
                        input: n("input_tokens"),
                        output: n("output_tokens"),
                        cache_read: n("cache_read_input_tokens"),
                        cache_write: n("cache_creation_input_tokens"),
                    };
                    last_context = Some(u.input + u.cache_read + u.cache_write);
                    let key = message
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| usage_by_message.len().to_string());
                    usage_by_message.insert(key, u);
                }
            }
            _ => {}
        }
    })?;

    for u in usage_by_message.values() {
        session.tokens.input += u.input;
        session.tokens.output += u.output;
        session.tokens.cache_read += u.cache_read;
        session.tokens.cache_write += u.cache_write;
    }
    session.context_used = last_context;
    session.context_window = session
        .model
        .as_deref()
        .and_then(|m| context_window(m, last_context.unwrap_or(0)));
    session.title = custom_title
        .or(first_prompt)
        .unwrap_or_else(|| "Untitled session".to_string());
    Ok(session)
}

/// Claude Code logs don't record the context window, so it comes from the model.
/// Current models (Opus 4.6 and later, Sonnet 4.6 and later, Haiku 5, Fable,
/// Mythos) have 1M tokens; earlier ones have 200K. Unknown models get `None`.
/// A request that already used more than 200K proves a 1M window.
pub fn context_window(model: &str, used: u64) -> Option<u64> {
    const SMALL: u64 = 200_000;
    const LARGE: u64 = 1_000_000;
    let m = model.to_ascii_lowercase();
    if !m.starts_with("claude") {
        return None;
    }
    if m.contains("[1m]") || used > SMALL {
        return Some(LARGE);
    }
    let large_families = [
        "fable-",
        "mythos-",
        "opus-5",
        "opus-4-6",
        "opus-4-7",
        "opus-4-8",
        "sonnet-5",
        "sonnet-4-6",
        "haiku-5",
    ];
    if large_families.iter().any(|f| m.contains(f)) {
        return Some(LARGE);
    }
    let small_families = ["haiku-4", "sonnet-4", "opus-4", "claude-3"];
    if small_families.iter().any(|f| m.contains(f)) {
        return Some(SMALL);
    }
    None
}
