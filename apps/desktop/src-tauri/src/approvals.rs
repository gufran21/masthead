//! Approve Claude Code permission requests from the notch.
//!
//! With the switch on, Claude Code posts each permission request to an HTTP hook
//! on this machine (see [`hook`]). Masthead shows it in the notch and answers with
//! the user's choice. Without an answer in time, or when the user picks "Answer
//! in terminal", it answers with no decision and Claude Code shows its usual
//! prompt. If Masthead isn't running, the hook can't connect and Claude Code
//! carries on as if it weren't there.

use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{notch, settings::SettingsStore};

/// Fixed so the hook entry in Claude Code's settings never has to change.
pub const PORT: u16 = 47821;
const PATH: &str = "/hooks/permission";
const TOKEN_HEADER: &str = "x-masthead-token";
const MAX_BODY: usize = 1 << 20;
/// How often a waiting request checks whether Claude Code gave up on it.
const POLL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: u64,
    pub session_id: String,
    pub project_name: Option<String>,
    pub project_path: Option<String>,
    /// The tool asking, e.g. `Bash`, `Edit`, `mcp__github__create_issue`.
    pub tool: String,
    /// One line: the command, file, URL or pattern.
    pub summary: String,
    /// More of the input when it doesn't fit on one line.
    pub detail: Option<String>,
    /// When the terminal prompt takes over, in milliseconds since the epoch.
    pub deadline_ms: u64,
}

enum Answer {
    Allow,
    Deny,
    /// Let Claude Code ask in the terminal.
    Pass,
}

pub struct Approvals {
    token: String,
    next_id: AtomicU64,
    pending: Mutex<Vec<(Approval, mpsc::Sender<Answer>)>>,
}

impl Approvals {
    /// Loads the secret the hook sends with each request, creating it on first run.
    pub fn load(app: &AppHandle) -> Self {
        let file = app
            .path()
            .app_config_dir()
            .ok()
            .map(|d| d.join("approval-token"));
        let token = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .map(|t| t.trim().to_string())
            .filter(|t| t.len() == 64)
            .unwrap_or_else(|| {
                let token = new_token();
                if let Some(f) = &file {
                    if let Some(dir) = f.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    let _ = std::fs::write(f, &token);
                }
                token
            });
        Self {
            token,
            next_id: AtomicU64::new(1),
            pending: Mutex::new(Vec::new()),
        }
    }

    fn list(&self) -> Vec<Approval> {
        self.pending
            .lock()
            .map(|p| p.iter().map(|(a, _)| a.clone()).collect())
            .unwrap_or_default()
    }

    fn take(&self, id: u64) -> Option<mpsc::Sender<Answer>> {
        let mut pending = self.pending.lock().ok()?;
        let i = pending.iter().position(|(a, _)| a.id == id)?;
        Some(pending.remove(i).1)
    }
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("the OS random source is unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn changed(app: &AppHandle) {
    let _ = app.emit("approvals-changed", app.state::<Approvals>().list());
}

/// Starts listening on 127.0.0.1. If the port is taken, approvals simply stay
/// off: the hook can't reach Masthead and Claude Code asks in the terminal.
pub fn start(app: &AppHandle) {
    let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Masthead: approvals are off, port {PORT} is unavailable ({e})");
            return;
        }
    };
    let app = app.clone();
    let _ = thread::Builder::new()
        .name("approvals".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let app = app.clone();
                let _ = thread::Builder::new()
                    .name("approval".into())
                    .spawn(move || handle(&app, stream));
            }
        });
}

struct Request {
    method: String,
    path: String,
    token: Option<String>,
    body: Vec<u8>,
}

fn read_request(stream: &TcpStream) -> std::io::Result<Request> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut length = 0usize;
    let mut token = None;
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 || line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            if name == "content-length" {
                length = value.trim().parse().unwrap_or(0);
            } else if name == TOKEN_HEADER {
                token = Some(value.trim().to_string());
            }
        }
    }
    if length > MAX_BODY {
        return Err(std::io::Error::new(
            ErrorKind::InvalidData,
            "body too large",
        ));
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    Ok(Request {
        method,
        path,
        token,
        body,
    })
}

fn respond(mut stream: &TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

/// Compares without stopping at the first difference.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn handle(app: &AppHandle, stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let Ok(req) = read_request(&stream) else {
        return respond(&stream, "400 Bad Request", "");
    };
    if req.method != "POST" || req.path != PATH {
        return respond(&stream, "404 Not Found", "");
    }
    let approvals = app.state::<Approvals>();
    if !req.token.is_some_and(|t| same(&t, &approvals.token)) {
        return respond(&stream, "401 Unauthorized", "");
    }
    let Ok(input) = serde_json::from_slice::<Value>(&req.body) else {
        return respond(&stream, "400 Bad Request", "");
    };
    if input.get("hook_event_name").and_then(Value::as_str) != Some("PermissionRequest") {
        return respond(&stream, "200 OK", "");
    }
    let settings = app.state::<SettingsStore>().get();
    if !settings.notch_enabled {
        return respond(&stream, "200 OK", "");
    }

    let wait = Duration::from_secs(u64::from(settings.approval_wait_secs));
    let (approval, rx) = {
        let id = approvals.next_id.fetch_add(1, Ordering::Relaxed);
        let approval = describe(id, &input, now_ms() + wait.as_millis() as u64);
        let (tx, rx) = mpsc::channel();
        if let Ok(mut pending) = approvals.pending.lock() {
            pending.push((approval.clone(), tx));
        }
        (approval, rx)
    };
    changed(app);
    notch::announce(app, wait);

    let answer = wait_for_answer(&stream, &rx, wait);
    if answer.is_none() {
        approvals.take(approval.id);
    }
    changed(app);

    let body = match answer {
        Some(Answer::Allow) => json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": { "behavior": "allow" }
            }
        })
        .to_string(),
        Some(Answer::Deny) => json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": { "behavior": "deny", "message": "The user denied this from Masthead." }
            }
        })
        .to_string(),
        // No decision: Claude Code shows its own prompt.
        Some(Answer::Pass) | None => String::new(),
    };
    respond(&stream, "200 OK", &body);
}

/// Waits for the user, until the deadline, or until Claude Code hangs up
/// (the user pressed Esc, or the session ended).
fn wait_for_answer(
    stream: &TcpStream,
    rx: &mpsc::Receiver<Answer>,
    wait: Duration,
) -> Option<Answer> {
    let end = Instant::now() + wait;
    loop {
        let left = end.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return None;
        }
        match rx.recv_timeout(left.min(POLL)) {
            Ok(answer) => return Some(answer),
            Err(mpsc::RecvTimeoutError::Disconnected) => return None,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if hung_up(stream) {
            return None;
        }
    }
}

fn hung_up(stream: &TcpStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return false;
    }
    let mut byte = [0u8; 1];
    let closed = match stream.peek(&mut byte) {
        Ok(0) => true,
        Ok(_) => false,
        Err(e) => e.kind() != ErrorKind::WouldBlock,
    };
    let _ = stream.set_nonblocking(false);
    closed
}

/// Turns a hook payload into what the notch shows.
fn describe(id: u64, input: &Value, deadline_ms: u64) -> Approval {
    let text = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    let tool = text(input, "tool_name").unwrap_or_else(|| "A tool".into());
    let tool_input = input.get("tool_input").cloned().unwrap_or(Value::Null);
    let project_path = text(input, "cwd");
    let project_name = project_path.as_deref().map(|p| {
        p.trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(p)
            .to_string()
    });

    let field = [
        "command",
        "file_path",
        "notebook_path",
        "url",
        "pattern",
        "query",
        "path",
    ]
    .iter()
    .find_map(|k| text(&tool_input, k));
    let full = field.unwrap_or_else(|| match &tool_input {
        Value::Null => String::new(),
        other => other.to_string(),
    });
    let mut lines = full.lines();
    let first = lines.next().unwrap_or_default();
    let summary = clip(first, 160);
    let detail = (full.chars().count() > summary.chars().count()).then(|| clip(&full, 1200));
    let detail = detail.or_else(|| text(&tool_input, "description").map(|d| clip(&d, 300)));

    Approval {
        id,
        session_id: text(input, "session_id").unwrap_or_default(),
        project_name,
        project_path,
        tool,
        summary,
        detail,
        deadline_ms,
    }
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max - 1).collect();
        format!("{}…", cut.trim_end())
    }
}

#[tauri::command]
pub fn list_approvals(approvals: State<'_, Approvals>) -> Vec<Approval> {
    approvals.list()
}

/// The user's choice in the notch: `allow`, `deny` or `terminal`.
#[tauri::command]
pub fn answer_approval(app: AppHandle, id: u64, answer: String) -> Result<(), String> {
    let answer = match answer.as_str() {
        "allow" => Answer::Allow,
        "deny" => Answer::Deny,
        "terminal" => Answer::Pass,
        other => return Err(format!("Unknown answer: {other}")),
    };
    let tx = app
        .state::<Approvals>()
        .take(id)
        .ok_or("This request is no longer waiting")?;
    let _ = tx.send(answer);
    changed(&app);
    Ok(())
}

#[tauri::command]
pub fn get_approval_hook() -> Result<bool, String> {
    let path = hook::settings_path().ok_or("Claude Code's folder wasn't found")?;
    Ok(hook::read(&path)?.is_some_and(|doc| hook::installed(&doc)))
}

/// Adds or removes Masthead's hook in Claude Code's user settings.
#[tauri::command]
pub fn set_approval_hook(approvals: State<'_, Approvals>, enabled: bool) -> Result<bool, String> {
    let path = hook::settings_path().ok_or("Claude Code's folder wasn't found")?;
    let doc = hook::read(&path)?.unwrap_or_else(|| json!({}));
    let next = hook::with_hook(doc, &approvals.token, enabled)?;
    hook::write(&path, &next)?;
    Ok(hook::installed(&next))
}

/// Masthead's entry in Claude Code's `settings.json`.
pub mod hook {
    use super::*;

    /// Longer than any wait Masthead allows, so Masthead always answers first.
    const TIMEOUT_SECS: u64 = 300;

    pub fn url() -> String {
        format!("http://127.0.0.1:{PORT}{PATH}")
    }

    pub fn settings_path() -> Option<PathBuf> {
        masthead_core::adapters::claude::config_dir().map(|d| d.join("settings.json"))
    }

    /// The settings document, `None` if the file doesn't exist yet. A file that
    /// isn't valid JSON is an error: Masthead never overwrites it.
    pub fn read(path: &std::path::Path) -> Result<Option<Value>, String> {
        match std::fs::read(path) {
            Ok(bytes) if bytes.iter().all(u8::is_ascii_whitespace) => Ok(None),
            Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|_| {
                format!(
                    "{} isn't valid JSON, so Masthead left it alone",
                    path.display()
                )
            }),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn is_ours(group: &Value) -> bool {
        group
            .get("hooks")
            .and_then(Value::as_array)
            .is_some_and(|hooks| {
                hooks
                    .iter()
                    .any(|h| h.get("url").and_then(Value::as_str) == Some(url().as_str()))
            })
    }

    pub fn installed(doc: &Value) -> bool {
        doc.pointer("/hooks/PermissionRequest")
            .and_then(Value::as_array)
            .is_some_and(|groups| groups.iter().any(is_ours))
    }

    /// Returns `doc` with Masthead's hook added (`on`) or removed, leaving
    /// everything else, including other hooks, as it was.
    pub fn with_hook(mut doc: Value, token: &str, on: bool) -> Result<Value, String> {
        let root = doc
            .as_object_mut()
            .ok_or("Claude Code's settings.json isn't a JSON object")?;
        let hooks = root
            .entry("hooks")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("\"hooks\" in Claude Code's settings.json isn't an object")?;
        let groups = hooks
            .entry("PermissionRequest")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or("\"hooks.PermissionRequest\" in Claude Code's settings.json isn't a list")?;
        groups.retain(|g| !is_ours(g));
        if on {
            groups.push(json!({
                "matcher": "*",
                "hooks": [{
                    "type": "http",
                    "url": url(),
                    "timeout": TIMEOUT_SECS,
                    "headers": { "X-Masthead-Token": token }
                }]
            }));
        }
        if groups.is_empty() {
            hooks.remove("PermissionRequest");
        }
        if hooks.is_empty() {
            root.remove("hooks");
        }
        Ok(doc)
    }

    /// Keeps a one-time backup of the user's original file, then replaces it
    /// through a temporary file so it is never left half-written.
    pub fn write(path: &std::path::Path, doc: &Value) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let backup = path.with_extension("json.masthead-backup");
        if path.exists() && !backup.exists() {
            std::fs::copy(path, &backup).map_err(|e| e.to_string())?;
        }
        let mut text = serde_json::to_string_pretty(doc).map_err(|e| e.to_string())?;
        text.push('\n');
        let temp = path.with_extension("json.masthead-tmp");
        std::fs::write(&temp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_is_added_and_removed_without_touching_the_rest() {
        let original = json!({
            "model": "opus",
            "hooks": {
                "Stop": [{ "hooks": [{ "type": "command", "command": "notify" }] }],
                "PermissionRequest": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "mine" }] }]
            },
            "permissions": { "allow": ["Read"] }
        });
        let on = hook::with_hook(original.clone(), "t0k3n", true).unwrap();
        assert!(hook::installed(&on));
        assert_eq!(
            on["hooks"]["PermissionRequest"].as_array().unwrap().len(),
            2
        );
        assert_eq!(
            on["hooks"]["PermissionRequest"][1]["hooks"][0]["headers"]["X-Masthead-Token"],
            "t0k3n"
        );

        let twice = hook::with_hook(on.clone(), "t0k3n", true).unwrap();
        assert_eq!(twice, on, "turning it on again doesn't add a second entry");

        let off = hook::with_hook(on, "t0k3n", false).unwrap();
        assert_eq!(off, original, "turning it off restores the file exactly");
        let keys: Vec<_> = off.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["model", "hooks", "permissions"], "key order is kept");
    }

    #[test]
    fn empty_sections_are_cleaned_up() {
        let on = hook::with_hook(json!({}), "t", true).unwrap();
        assert!(hook::installed(&on));
        assert_eq!(hook::with_hook(on, "t", false).unwrap(), json!({}));
    }

    #[test]
    fn requests_are_summarised() {
        let input = json!({
            "session_id": "s1",
            "cwd": "D:\\Code\\api-server",
            "tool_name": "Bash",
            "tool_input": { "command": "npm test\nnpm run lint", "description": "Run tests" }
        });
        let a = describe(7, &input, 0);
        assert_eq!(a.tool, "Bash");
        assert_eq!(a.summary, "npm test");
        assert_eq!(a.detail.as_deref(), Some("npm test\nnpm run lint"));
        assert_eq!(a.project_name.as_deref(), Some("api-server"));

        let edit = describe(
            8,
            &json!({ "tool_name": "Edit", "tool_input": { "file_path": "src/main.rs" } }),
            0,
        );
        assert_eq!(edit.summary, "src/main.rs");
        assert_eq!(edit.detail, None);
    }

    #[test]
    fn token_comparison() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "abcd"));
    }
}
