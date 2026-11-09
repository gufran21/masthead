//! The System page: live CPU, memory, disks and network, the busiest
//! processes, and which processes each running agent has started.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use masthead_core::Agent;
use serde::Serialize;
use sysinfo::{
    Disks, Networks, Pid, Process, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind,
};
use tauri::State;

/// Keeps sysinfo's state between calls: CPU use and network rates are
/// measured as the change since the previous snapshot.
pub struct Monitor(Mutex<Inner>);

struct Inner {
    sys: System,
    networks: Networks,
    disks: Disks,
    last: Option<Instant>,
}

impl Default for Monitor {
    fn default() -> Self {
        Self(Mutex::new(Inner {
            sys: System::new(),
            networks: Networks::new_with_refreshed_list(),
            disks: Disks::new_with_refreshed_list(),
            last: None,
        }))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// 0–100, the whole machine.
    pub cpu: f32,
    pub cores: Vec<f32>,
    pub memory_used: u64,
    pub memory_total: u64,
    pub disks: Vec<Drive>,
    /// Bytes per second, all network adapters together.
    pub download_rate: u64,
    pub upload_rate: u64,
    pub uptime_secs: u64,
    /// The busiest processes by CPU, then memory.
    pub top: Vec<Proc>,
    pub agents: Vec<AgentGroup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub mount: String,
    pub name: String,
    pub total: u64,
    pub available: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub pid: u32,
    pub name: String,
    pub command: Option<String>,
    /// 0–100 of the whole machine.
    pub cpu: f32,
    pub memory: u64,
    /// The agent this process was started by, if any.
    pub agent: Option<Agent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGroup {
    pub pid: u32,
    pub agent: Agent,
    /// Where it runs: "VS Code", "Claude app", "Terminal"…
    pub host: Option<String>,
    /// The agent and everything it started, together.
    pub cpu: f32,
    pub memory: u64,
    pub started_at: u64,
    /// What it started, busiest first.
    pub children: Vec<Proc>,
}

fn lower(s: &std::ffi::OsStr) -> String {
    s.to_string_lossy().to_lowercase()
}

/// Whether a process is a coding agent itself (not the desktop apps around it).
pub fn agent_of(name: &str, exe: &str, command: &str) -> Option<Agent> {
    let name = name.trim_end_matches(".exe");
    // npm installs on Windows show up as `node …\node_modules\@anthropic-ai\claude-code\cli.js`.
    let command = command.replace('\\', "/");
    if name == "claude" && (exe.contains("claude-code") || exe.contains("native-binary")) {
        return Some(Agent::ClaudeCode);
    }
    if command.contains("@anthropic-ai/claude-code") {
        return Some(Agent::ClaudeCode);
    }
    if name == "codex" || command.contains("@openai/codex") {
        return Some(Agent::Codex);
    }
    if name.starts_with("language_server") && exe.contains("antigravity") {
        return Some(Agent::Antigravity);
    }
    None
}

fn host_of(parent: Option<&Process>, exe: &str) -> Option<String> {
    if exe.contains(".vscode") || exe.contains("\\code\\") {
        return Some("VS Code".into());
    }
    if exe.contains("cursor") {
        return Some("Cursor".into());
    }
    if exe.contains("claude-data") || exe.contains("windowsapps\\claude") {
        return Some("Claude app".into());
    }
    let parent = parent.map(|p| lower(p.name()))?;
    Some(
        match parent.trim_end_matches(".exe") {
            "code" => "VS Code",
            "cursor" => "Cursor",
            "claude" => "Claude app",
            "windowsterminal" | "openconsole" | "pwsh" | "powershell" | "cmd" | "bash"
            | "wezterm-gui" | "alacritty" => "Terminal",
            "antigravity" => "Antigravity",
            _ => return None,
        }
        .into(),
    )
}

fn command_of(p: &Process) -> Option<String> {
    let cmd: Vec<_> = p.cmd().iter().map(|a| a.to_string_lossy()).collect();
    (!cmd.is_empty()).then(|| {
        let joined = cmd.join(" ");
        if joined.chars().count() > 300 {
            format!("{}…", joined.chars().take(299).collect::<String>())
        } else {
            joined
        }
    })
}

/// For every process, the nearest agent above it (the process itself excluded).
fn agent_ancestors(sys: &System, agents: &HashMap<Pid, Agent>) -> HashMap<Pid, (Pid, Agent)> {
    let mut found = HashMap::new();
    for (&pid, p) in sys.processes() {
        let mut parent = p.parent();
        for _ in 0..32 {
            let Some(up) = parent else { break };
            if let Some(&agent) = agents.get(&up) {
                found.insert(pid, (up, agent));
                break;
            }
            parent = sys.process(up).and_then(Process::parent);
        }
    }
    found
}

#[tauri::command]
pub fn system_snapshot(monitor: State<'_, Monitor>) -> Result<Snapshot, String> {
    let mut inner = monitor.0.lock().map_err(|e| e.to_string())?;
    Ok(snapshot(&mut inner))
}

fn snapshot(inner: &mut Inner) -> Snapshot {
    let now = Instant::now();
    let elapsed = inner.last.map(|t| now.duration_since(t).as_secs_f64());
    inner.last = Some(now);

    let sys = &mut inner.sys;
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_cmd(UpdateKind::OnlyIfNotSet),
    );
    inner.networks.refresh(true);
    inner.disks.refresh(true);

    let cores = sys.cpus().len().max(1) as f32;
    let share = |p: &Process| (p.cpu_usage() / cores).min(100.0);

    let mut agents: HashMap<Pid, Agent> = HashMap::new();
    for (&pid, p) in sys.processes() {
        let exe = p
            .exe()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let command = command_of(p).unwrap_or_default().to_lowercase();
        if let Some(agent) = agent_of(&lower(p.name()), &exe, &command) {
            agents.insert(pid, agent);
        }
    }
    // An agent started by another agent (a subagent) belongs to the outer one.
    let ancestors = agent_ancestors(sys, &agents);
    agents.retain(|pid, _| !ancestors.contains_key(pid));
    let ancestors = agent_ancestors(sys, &agents);

    let proc = |pid: Pid, p: &Process| Proc {
        pid: pid.as_u32(),
        name: p.name().to_string_lossy().into_owned(),
        command: command_of(p),
        cpu: share(p),
        memory: p.memory(),
        agent: ancestors
            .get(&pid)
            .map(|(_, a)| *a)
            .or_else(|| agents.get(&pid).copied()),
    };

    let mut groups: Vec<AgentGroup> = agents
        .iter()
        .filter_map(|(&pid, &agent)| {
            let p = sys.process(pid)?;
            let exe = p
                .exe()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let mut children: Vec<Proc> = ancestors
                .iter()
                .filter(|(_, (owner, _))| *owner == pid)
                .filter_map(|(&child, _)| sys.process(child).map(|c| proc(child, c)))
                // Every console program gets a console host; it's not something the agent ran.
                .filter(|c| !c.name.eq_ignore_ascii_case("conhost.exe"))
                .collect();
            children.sort_by(|a, b| b.cpu.total_cmp(&a.cpu).then(b.memory.cmp(&a.memory)));
            Some(AgentGroup {
                pid: pid.as_u32(),
                agent,
                host: host_of(p.parent().and_then(|pp| sys.process(pp)), &exe),
                cpu: share(p) + children.iter().map(|c| c.cpu).sum::<f32>(),
                memory: p.memory() + children.iter().map(|c| c.memory).sum::<u64>(),
                started_at: p.start_time(),
                children,
            })
        })
        .collect();
    groups.sort_by_key(|g| std::cmp::Reverse(g.started_at));

    let mut top: Vec<Proc> = sys
        .processes()
        .iter()
        .filter(|(pid, p)| pid.as_u32() > 4 && !p.name().is_empty())
        .map(|(&pid, p)| proc(pid, p))
        .collect();
    top.sort_by(|a, b| b.cpu.total_cmp(&a.cpu).then(b.memory.cmp(&a.memory)));
    top.truncate(10);

    let (mut down, mut up) = (0u64, 0u64);
    for data in inner.networks.values() {
        down += data.received();
        up += data.transmitted();
    }
    let rate = |bytes: u64| {
        elapsed
            .filter(|s| *s > 0.0)
            .map_or(0, |s| (bytes as f64 / s) as u64)
    };

    let mut disks: Vec<Drive> = inner
        .disks
        .iter()
        .filter(|d| d.total_space() > 0 && !d.is_removable())
        .map(|d| Drive {
            mount: d.mount_point().to_string_lossy().into_owned(),
            name: d.name().to_string_lossy().into_owned(),
            total: d.total_space(),
            available: d.available_space(),
        })
        .collect();
    disks.sort_by(|a, b| a.mount.cmp(&b.mount));
    disks.dedup_by(|a, b| a.mount == b.mount);

    Snapshot {
        cpu: sys.global_cpu_usage(),
        cores: sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
        memory_used: sys.used_memory(),
        memory_total: sys.total_memory(),
        disks,
        download_rate: rate(down),
        upload_rate: rate(up),
        uptime_secs: System::uptime(),
        top,
        agents: groups,
    }
}

/// Stops a process an agent started. Checked here: it must still be running,
/// have an agent above it, belong to the current user, and not be the agent
/// itself or Masthead.
#[tauri::command]
pub fn stop_agent_process(monitor: State<'_, Monitor>, pid: u32) -> Result<(), String> {
    let mut inner = monitor.0.lock().map_err(|e| e.to_string())?;
    stop(&mut inner.sys, pid)
}

fn stop(sys: &mut System, pid: u32) -> Result<(), String> {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_cmd(UpdateKind::OnlyIfNotSet)
            .with_user(UpdateKind::OnlyIfNotSet),
    );
    let target = Pid::from_u32(pid);
    let me = sysinfo::get_current_pid().map_err(|e| e.to_string())?;
    if target == me {
        return Err("That's Masthead itself".into());
    }
    let agents: HashMap<Pid, Agent> = sys
        .processes()
        .iter()
        .filter_map(|(&p, proc)| {
            let exe = proc
                .exe()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let command = command_of(proc).unwrap_or_default().to_lowercase();
            agent_of(&lower(proc.name()), &exe, &command).map(|a| (p, a))
        })
        .collect();
    if agents.contains_key(&target) {
        return Err("That's the agent itself; stop it from where it runs".into());
    }
    if !agent_ancestors(sys, &agents).contains_key(&target) {
        return Err("Only processes an agent started can be stopped here".into());
    }
    let process = sys
        .process(target)
        .ok_or("That process has already exited")?;
    let mine = sys.process(me).and_then(Process::user_id);
    if mine.is_none() || process.user_id() != mine {
        return Err("That process belongs to another user, so Masthead won't stop it".into());
    }
    if process.kill() {
        Ok(())
    } else {
        Err("Windows didn't let Masthead stop that process".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agents_are_told_apart_from_their_apps() {
        let code =
            "c:\\users\\me\\appdata\\local\\claude-data\\claude\\claude-code\\2.1.309\\claude.exe";
        assert_eq!(agent_of("claude.exe", code, ""), Some(Agent::ClaudeCode));
        let ext = "c:\\users\\me\\.vscode\\extensions\\anthropic.claude-code-2.1\\resources\\native-binary\\claude.exe";
        assert_eq!(agent_of("claude.exe", ext, ""), Some(Agent::ClaudeCode));
        let app = "c:\\program files\\windowsapps\\claude_4.4\\app\\claude.exe";
        assert_eq!(
            agent_of("claude.exe", app, ""),
            None,
            "the Claude desktop app isn't an agent"
        );
        assert_eq!(
            agent_of(
                "node.exe",
                "c:\\node\\node.exe",
                "node c:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"
            ),
            Some(Agent::ClaudeCode),
            "npm installs on Windows use backslashes"
        );
        assert_eq!(
            agent_of(
                "node.exe",
                "node.exe",
                "node /npm/node_modules/@anthropic-ai/claude-code/cli.js"
            ),
            Some(Agent::ClaudeCode)
        );
        assert_eq!(
            agent_of("codex.exe", "c:\\codex.exe", ""),
            Some(Agent::Codex)
        );
        assert_eq!(agent_of("code.exe", "c:\\vscode\\code.exe", ""), None);
    }

    #[test]
    fn snapshot_reads_this_machine() {
        let mut inner = Monitor::default().0.into_inner().unwrap();
        let first = snapshot(&mut inner);
        std::thread::sleep(std::time::Duration::from_millis(300));
        let s = snapshot(&mut inner);
        assert!(s.memory_total > 0 && s.memory_used <= s.memory_total);
        assert!(!s.cores.is_empty());
        assert!((0.0..=100.0).contains(&s.cpu));
        assert!(!s.top.is_empty(), "there are always processes");
        assert!(s.top.iter().all(|p| (0.0..=100.0).contains(&p.cpu)));
        assert!(!s.disks.is_empty(), "at least the system drive");
        assert!(s.uptime_secs > 0);
        assert_eq!(
            first.download_rate, 0,
            "no rate before there's a previous sample"
        );
    }

    #[test]
    fn stop_refuses_masthead_and_missing_processes() {
        let mut sys = System::new();
        let me = std::process::id();
        assert_eq!(stop(&mut sys, me).unwrap_err(), "That's Masthead itself");
        // PIDs on Windows are multiples of 4, so this one can't exist.
        assert!(stop(&mut sys, 4_294_967_291).is_err());
    }
}
