//! Antigravity keeps each conversation in its own SQLite database under
//! `~/.gemini/antigravity/conversations/`, with the steps as protobuf blobs, and
//! one row per conversation in `conversation_summaries.db` (title, workspace,
//! status, times). Masthead reads both read-only: the summary row for the list,
//! and the conversation's model calls for model, tokens and context ([`details`]).
//!
//! There is no published schema; the field numbers below were mapped from real
//! data and are read defensively, so a format change leaves fields empty rather
//! than failing.

use std::path::{Path, PathBuf};

use chrono::{DateTime, NaiveDateTime, Utc};
use rusqlite::{Connection, OpenFlags};

use crate::model::{title_from, Agent, Session, TokenUsage, Turn};

pub fn default_index() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join(".gemini")
            .join("antigravity")
            .join("conversation_summaries.db")
    })
}

/// Every conversation in the summaries database. The database is opened
/// read-only; Antigravity may be writing to it at the same time.
pub fn parse_index(path: &Path) -> anyhow::Result<Vec<Session>> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    db.busy_timeout(std::time::Duration::from_millis(250))?;
    let mut query = db.prepare(
        "SELECT conversation_id, title, preview, last_modified_time, workspace_uris,
                status, parent_conversation_id, nesting_depth, not_fully_idle, killed,
                raw_summary
         FROM conversation_summaries",
    )?;
    let conversations = path.parent().map(|d| d.join("conversations"));
    let rows = query.query_map([], |row| {
        let id: String = row.get(0)?;
        let title: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
        let preview: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
        let modified: Option<String> = row.get(3)?;
        let workspaces: Option<String> = row.get(4)?;
        let status: String = row.get::<_, Option<String>>(5)?.unwrap_or_default();
        let parent: String = row.get::<_, Option<String>>(6)?.unwrap_or_default();
        let depth: i64 = row.get::<_, Option<i64>>(7)?.unwrap_or(0);
        let not_fully_idle: bool = row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0;
        let killed: bool = row.get::<_, Option<i64>>(9)?.unwrap_or(0) != 0;
        let raw: Vec<u8> = row.get::<_, Option<Vec<u8>>>(10)?.unwrap_or_default();

        let file = conversations
            .as_ref()
            .map(|d| d.join(format!("{id}.db")))
            .filter(|f| f.exists())
            .unwrap_or_else(|| path.to_path_buf());
        let mut s = Session::new(id, Agent::Antigravity, file);
        s.title = Some(title.trim())
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .or_else(|| title_from(&preview))
            .unwrap_or_else(|| "Untitled conversation".into());
        if let Some(dir) = workspaces.as_deref().and_then(first_workspace) {
            s.set_project(&dir);
        }
        // The summary blob: 7 = created, 9.4 = git branch.
        s.started_at = pb::time(&raw, &[7]);
        s.last_activity = modified.as_deref().and_then(parse_time).or(s.started_at);
        s.git_branch = pb::text(&raw, &[9, 4])
            .filter(|b| !b.is_empty())
            .map(str::to_string);
        s.is_subagent = depth > 0 || !parent.is_empty();
        s.turn = if killed {
            Turn::Interrupted
        } else if not_fully_idle || status.ends_with("_RUNNING") {
            Turn::Working
        } else {
            Turn::Done
        };
        Ok(s)
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// What a conversation's own database adds to its summary row.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Details {
    pub model: Option<String>,
    pub tokens: TokenUsage,
    pub context_used: Option<u64>,
    pub context_window: Option<u64>,
    pub prompts: u32,
}

impl Details {
    pub fn apply(&self, s: &mut Session) {
        s.model = self.model.clone().or(s.model.take());
        s.tokens = self.tokens.clone();
        s.context_used = self.context_used;
        s.context_window = self.context_window;
        s.user_messages = self.prompts;
    }
}

/// Step type of a message the user typed.
const USER_INPUT_STEP: i64 = 14;

/// Model, token use and context from each model call (`gen_metadata`), and the
/// number of prompts from the steps. In each call: 1.19 = model, 1.4.2 = input,
/// 1.4.3 = output, 1.4.5 = cached input, 1.9.10.1 / 1.9.10.4 = context used / size.
pub fn details(conversation: &Path) -> anyhow::Result<Details> {
    let db = Connection::open_with_flags(
        conversation,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    db.busy_timeout(std::time::Duration::from_millis(250))?;
    let mut d = Details::default();
    let mut calls = db.prepare("SELECT data FROM gen_metadata ORDER BY idx")?;
    let mut rows = calls.query([])?;
    while let Some(row) = rows.next()? {
        let Some(data) = row.get::<_, Option<Vec<u8>>>(0)? else {
            continue;
        };
        let n = |path: &[u64]| pb::int(&data, path).unwrap_or(0);
        d.tokens.input += n(&[1, 4, 2]);
        d.tokens.output += n(&[1, 4, 3]);
        d.tokens.cache_read += n(&[1, 4, 5]);
        if let Some(model) = pb::text(&data, &[1, 19]).filter(|m| !m.is_empty()) {
            d.model = Some(model.to_string());
        }
        if let Some(used) = pb::int(&data, &[1, 9, 10, 1]) {
            d.context_used = Some(used);
            d.context_window = pb::int(&data, &[1, 9, 10, 4]).or(d.context_window);
        }
    }
    d.prompts = db.query_row(
        "SELECT count(*) FROM steps WHERE step_type = ?1",
        [USER_INPUT_STEP],
        |r| r.get(0),
    )?;
    Ok(d)
}

/// Just enough of the protobuf wire format to pick known fields out of
/// Antigravity's blobs. Malformed data gives `None`, never a panic.
mod pb {
    use chrono::{DateTime, Utc};

    enum Value<'a> {
        Int(u64),
        Bytes(&'a [u8]),
    }

    fn varint(b: &[u8], i: &mut usize) -> Option<u64> {
        let mut n = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = *b.get(*i)?;
            *i += 1;
            n |= u64::from(byte & 0x7f) << shift;
            if byte < 0x80 {
                return Some(n);
            }
        }
        None
    }

    /// The first value of `field` at this level of `b`.
    fn field(b: &[u8], field: u64) -> Option<Value<'_>> {
        let mut i = 0;
        while i < b.len() {
            let key = varint(b, &mut i)?;
            let value = match key & 7 {
                0 => Some(Value::Int(varint(b, &mut i)?)),
                1 => {
                    i = i.checked_add(8)?;
                    None
                }
                2 => {
                    let len = usize::try_from(varint(b, &mut i)?).ok()?;
                    let end = i.checked_add(len)?;
                    let bytes = b.get(i..end)?;
                    i = end;
                    Some(Value::Bytes(bytes))
                }
                5 => {
                    i = i.checked_add(4)?;
                    None
                }
                _ => return None,
            };
            if key >> 3 == field {
                return value;
            }
        }
        None
    }

    fn at<'a>(mut b: &'a [u8], path: &[u64]) -> Option<Value<'a>> {
        let (last, parents) = path.split_last()?;
        for f in parents {
            match field(b, *f)? {
                Value::Bytes(inner) => b = inner,
                Value::Int(_) => return None,
            }
        }
        field(b, *last)
    }

    pub fn int(b: &[u8], path: &[u64]) -> Option<u64> {
        match at(b, path)? {
            Value::Int(n) => Some(n),
            Value::Bytes(_) => None,
        }
    }

    pub fn text<'a>(b: &'a [u8], path: &[u64]) -> Option<&'a str> {
        match at(b, path)? {
            Value::Bytes(s) => std::str::from_utf8(s).ok(),
            Value::Int(_) => None,
        }
    }

    /// A `google.protobuf.Timestamp` (1 = seconds, 2 = nanos).
    pub fn time(b: &[u8], path: &[u64]) -> Option<DateTime<Utc>> {
        let mut full = path.to_vec();
        full.push(1);
        let secs = i64::try_from(int(b, &full)?).ok()?;
        *full.last_mut()? = 2;
        let nanos = int(b, &full)
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(0);
        DateTime::from_timestamp(secs, nanos)
    }
}

/// `2026-10-23 20:04:49.6307804+00:00`: SQLite text, not quite RFC 3339.
fn parse_time(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f%:z")
        .map(|d| d.with_timezone(&Utc))
        .or_else(|_| DateTime::parse_from_rfc3339(s).map(|d| d.with_timezone(&Utc)))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f")
                .ok()
                .map(|n| n.and_utc())
        })
}

/// The first folder in `["file:///d%3A/Workspace/app", …]`, as a local path.
fn first_workspace(json: &str) -> Option<String> {
    let uris: Vec<String> = serde_json::from_str(json).ok()?;
    uris.iter().find_map(|u| file_uri_to_path(u))
}

fn file_uri_to_path(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let decoded = percent_decode(rest);
    // `/d:/Workspace/app` on Windows: drop the slash, capitalise the drive.
    let bytes = decoded.as_bytes();
    if bytes.len() >= 3 && bytes[0] == b'/' && bytes[2] == b':' && bytes[1].is_ascii_alphabetic() {
        let drive = (bytes[1] as char).to_ascii_uppercase();
        return Some(format!("{drive}:{}", decoded[3..].replace('/', "\\")));
    }
    Some(decoded)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = s
            .get(i + 1..i + 3)
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        if let (b'%', Some(b)) = (bytes[i], hex) {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uris_become_windows_paths() {
        assert_eq!(
            file_uri_to_path("file:///d%3A/Workspace/my%20app").as_deref(),
            Some("D:\\Workspace\\my app")
        );
        assert_eq!(
            file_uri_to_path("file:///home/me/app").as_deref(),
            Some("/home/me/app")
        );
        assert_eq!(file_uri_to_path("https://example.com"), None);
    }

    #[test]
    fn protobuf_fields_are_read() {
        // 2: 28, 7: {1: 1761248799}, 9: {4: "main"}, then a truncated field.
        let blob = [
            0x10, 28, 0x3a, 0x06, 0x08, 0x9f, 0x8c, 0xea, 0xc7, 0x06, 0x4a, 0x06, 0x22, 0x04, b'm',
            b'a', b'i', b'n', 0x52, 0x09,
        ];
        assert_eq!(pb::int(&blob, &[2]), Some(28));
        assert_eq!(pb::text(&blob, &[9, 4]), Some("main"));
        assert_eq!(
            pb::time(&blob, &[7]).map(|t| t.timestamp()),
            Some(1_761_248_799)
        );
        assert_eq!(pb::int(&blob, &[3]), None, "a missing field is None");
        assert_eq!(
            pb::int(&[0xff; 12], &[1]),
            None,
            "garbage is None, not a panic"
        );
    }

    #[test]
    fn sqlite_times_parse() {
        let t = parse_time("2026-10-23 20:04:49.6307804+00:00").unwrap();
        assert_eq!(t.to_rfc3339(), "2026-10-23T20:04:49.630780400+00:00");
    }
}
