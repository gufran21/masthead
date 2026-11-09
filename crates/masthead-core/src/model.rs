use std::path::PathBuf;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

/// The coding agent that produced a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Agent {
    ClaudeCode,
    Codex,
    Antigravity,
}

/// Activity state derived from the turn and how recently the log changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    /// The agent is working: a turn is in progress and the log changed in the
    /// last ten minutes (a long build or test run can be quiet for a while).
    Active,
    /// Waiting for the user, within an hour of the last activity.
    Idle,
    /// Older than that.
    Ended,
}

/// Where the agent is in its exchange with the user.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Turn {
    /// Replying or running tools.
    Working,
    /// Finished its reply; waiting for the user.
    #[default]
    Done,
    /// The user stopped the reply.
    Interrupted,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

impl TokenUsage {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub agent: Agent,
    pub title: String,
    /// Working directory the agent ran in.
    pub project_path: Option<String>,
    /// Last path component of `project_path`.
    pub project_name: Option<String>,
    pub git_branch: Option<String>,
    pub model: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub last_activity: Option<DateTime<Utc>>,
    /// Prompts typed by the user.
    pub user_messages: u32,
    pub tokens: TokenUsage,
    /// Tokens in the most recent request, i.e. how full the context window is.
    pub context_used: Option<u64>,
    pub context_window: Option<u64>,
    /// Sessions started by another agent (subagents, reviewers).
    pub is_subagent: bool,
    pub source_file: PathBuf,
    pub turn: Turn,
    pub state: SessionState,
}

impl Session {
    pub(crate) fn new(id: String, agent: Agent, source_file: PathBuf) -> Self {
        Self {
            id,
            agent,
            title: String::new(),
            project_path: None,
            project_name: None,
            git_branch: None,
            model: None,
            started_at: None,
            last_activity: None,
            user_messages: 0,
            tokens: TokenUsage::default(),
            context_used: None,
            context_window: None,
            is_subagent: false,
            source_file,
            turn: Turn::Done,
            state: SessionState::Ended,
        }
    }

    pub(crate) fn see_timestamp(&mut self, ts: DateTime<Utc>) {
        if self.started_at.map_or(true, |s| ts < s) {
            self.started_at = Some(ts);
        }
        if self.last_activity.map_or(true, |l| ts > l) {
            self.last_activity = Some(ts);
        }
    }

    pub(crate) fn set_project(&mut self, cwd: &str) {
        if self.project_path.is_some() || cwd.is_empty() {
            return;
        }
        let name = cwd
            .trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(cwd)
            .to_string();
        self.project_path = Some(cwd.to_string());
        self.project_name = Some(name);
    }

    /// Recomputes [`Session::state`] relative to `now`.
    pub fn refresh_state(&mut self, now: DateTime<Utc>) {
        let quiet = self.last_activity.map(|t| now - t);
        self.state = match quiet {
            Some(q) if self.turn == Turn::Working && q <= Duration::minutes(10) => {
                SessionState::Active
            }
            Some(q) if q <= Duration::hours(1) => SessionState::Idle,
            _ => SessionState::Ended,
        };
    }
}

pub(crate) fn parse_ts(value: Option<&serde_json::Value>) -> Option<DateTime<Utc>> {
    let s = value?.as_str()?;
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// Trims prompt text to a one-line title.
pub(crate) fn title_from(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    // Agents inject tagged context (<system-reminder>, <environment_context>, …)
    // as user messages; those are not what the user typed.
    if line.starts_with('<') {
        return None;
    }
    const MAX: usize = 80;
    Some(if line.chars().count() > MAX {
        let cut: String = line.chars().take(MAX - 1).collect();
        format!("{}…", cut.trim_end())
    } else {
        line.to_string()
    })
}
