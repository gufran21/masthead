//! The Ports page: which local TCP ports are listening, and the process,
//! project and command behind each, so dev servers that agents started can be
//! found, opened and stopped.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::State;

/// A socket in the listening state: which address and port, and who owns it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Socket {
    pub address: String,
    pub port: u16,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    pub port: u16,
    /// e.g. `127.0.0.1`, `0.0.0.0`, `::1`, `::`.
    pub addresses: Vec<String>,
    /// Reachable from other machines (bound to all interfaces or a LAN address).
    pub exposed: bool,
    pub pid: u32,
    pub name: String,
    pub exe: Option<String>,
    pub command: Option<String>,
    /// The process's working folder: usually the project it serves.
    pub cwd: Option<String>,
    /// Seconds since the epoch.
    pub started_at: Option<u64>,
    pub memory_bytes: u64,
    /// Runs as the current user, so Masthead may stop it.
    pub mine: bool,
}

/// Process details are refreshed in place rather than re-read from scratch.
pub struct Processes(Mutex<System>);

impl Default for Processes {
    fn default() -> Self {
        Self(Mutex::new(System::new()))
    }
}

fn is_loopback(address: &str) -> bool {
    address.starts_with("127.") || address == "::1"
}

/// Groups sockets by port and process (IPv4 and IPv6 of one server become one entry).
pub fn group(sockets: Vec<Socket>) -> BTreeMap<(u16, u32), Vec<String>> {
    let mut grouped: BTreeMap<(u16, u32), Vec<String>> = BTreeMap::new();
    for s in sockets {
        let addresses = grouped.entry((s.port, s.pid)).or_default();
        if !addresses.contains(&s.address) {
            addresses.push(s.address);
        }
    }
    grouped
}

fn clip(s: String, max: usize) -> String {
    if s.chars().count() <= max {
        s
    } else {
        let cut: String = s.chars().take(max - 1).collect();
        format!("{cut}…")
    }
}

/// Every listening TCP port with its process, lowest port first.
#[tauri::command]
pub async fn list_ports(processes: State<'_, Processes>) -> Result<Vec<Listener>, String> {
    let sockets = tauri::async_runtime::spawn_blocking(sockets::listening)
        .await
        .map_err(|e| e.to_string())??;
    let mut sys = processes.0.lock().map_err(|e| e.to_string())?;
    Ok(describe(&mut sys, sockets))
}

/// Joins sockets with what `sys` knows about their processes.
fn describe(sys: &mut System, sockets: Vec<Socket>) -> Vec<Listener> {
    let grouped = group(sockets);
    let mut pids: Vec<Pid> = grouped.keys().map(|(_, pid)| Pid::from_u32(*pid)).collect();
    let me = sysinfo::get_current_pid().ok();
    pids.extend(me);
    // Find every process first (cheap: no details), then read details only
    // for the ones that listen; a fresh table doesn't add processes by id.
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        false,
        ProcessRefreshKind::nothing()
            .with_memory()
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_cmd(UpdateKind::OnlyIfNotSet)
            .with_cwd(UpdateKind::OnlyIfNotSet)
            .with_user(UpdateKind::OnlyIfNotSet),
    );
    let my_user = me
        .and_then(|p| sys.process(p))
        .and_then(|p| p.user_id())
        .cloned();

    let text = |p: &Path| p.display().to_string();
    grouped
        .into_iter()
        .map(|((port, pid), addresses)| {
            let process = sys.process(Pid::from_u32(pid));
            let command = process
                .map(|p| {
                    p.cmd()
                        .iter()
                        .map(|a| a.to_string_lossy())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .filter(|c| !c.is_empty())
                .map(|c| clip(c, 600));
            let exposed = addresses.iter().any(|a| !is_loopback(a));
            Listener {
                port,
                exposed,
                addresses,
                pid,
                name: process
                    .map(|p| p.name().to_string_lossy().into_owned())
                    .unwrap_or_else(|| {
                        if pid == 4 {
                            "System".into()
                        } else {
                            format!("PID {pid}")
                        }
                    }),
                exe: process.and_then(|p| p.exe()).map(text),
                command,
                cwd: process
                    .and_then(|p| p.cwd())
                    .map(text)
                    .filter(|c| !c.is_empty()),
                started_at: process.map(|p| p.start_time()).filter(|t| *t > 0),
                memory_bytes: process.map(|p| p.memory()).unwrap_or(0),
                mine: my_user.is_some() && process.and_then(|p| p.user_id()) == my_user.as_ref(),
            }
        })
        .collect()
}

/// Opens `http://localhost:<port>` in the default browser.
#[tauri::command]
pub fn open_port(port: u16) -> Result<(), String> {
    let url = format!("http://localhost:{port}");
    #[cfg(windows)]
    let mut command = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", &url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Opens the folder a listening process runs from. The folder comes from the
/// process itself, found again by port and PID, never from the page.
#[tauri::command]
pub async fn open_port_folder(
    processes: State<'_, Processes>,
    port: u16,
    pid: u32,
) -> Result<(), String> {
    let sockets = tauri::async_runtime::spawn_blocking(sockets::listening)
        .await
        .map_err(|e| e.to_string())??;
    let folder = {
        let mut sys = processes.0.lock().map_err(|e| e.to_string())?;
        describe(&mut sys, sockets)
            .into_iter()
            .find(|l| l.port == port && l.pid == pid)
            .ok_or("That process is no longer listening on this port")?
            .cwd
            .ok_or("Windows doesn't say which folder that process runs from")?
    };
    if !Path::new(&folder).is_dir() {
        return Err("That folder no longer exists".into());
    }
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(&folder)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Stops the process listening on `port`. Checked again here, not trusted from
/// the page: it must still own that port, run as the current user, and not be
/// Masthead itself.
#[tauri::command]
pub async fn stop_port(processes: State<'_, Processes>, port: u16, pid: u32) -> Result<(), String> {
    let sockets = tauri::async_runtime::spawn_blocking(sockets::listening)
        .await
        .map_err(|e| e.to_string())??;
    let mut sys = processes.0.lock().map_err(|e| e.to_string())?;
    stop(&mut sys, &sockets, port, pid)
}

fn stop(sys: &mut System, sockets: &[Socket], port: u16, pid: u32) -> Result<(), String> {
    if !sockets.iter().any(|s| s.port == port && s.pid == pid) {
        return Err("That process is no longer listening on this port".into());
    }
    let me = sysinfo::get_current_pid().map_err(|e| e.to_string())?;
    let target = Pid::from_u32(pid);
    if target == me {
        return Err("That's Masthead itself".into());
    }
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[target, me]),
        false,
        ProcessRefreshKind::nothing().with_user(UpdateKind::Always),
    );
    let mine = sys.process(me).and_then(|p| p.user_id());
    let process = sys
        .process(target)
        .ok_or("That process has already exited")?;
    if mine.is_none() || process.user_id() != mine {
        return Err(
            "That process belongs to another user or to Windows, so Masthead won't stop it".into(),
        );
    }
    if process.kill() {
        Ok(())
    } else {
        Err("Windows didn't let Masthead stop that process".into())
    }
}

#[cfg(windows)]
mod sockets {
    use std::net::{Ipv4Addr, Ipv6Addr};

    use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR};
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID,
        TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    use super::Socket;

    /// The table for one address family, as raw bytes (u32-aligned).
    fn table(family: u32) -> Result<Vec<u32>, String> {
        let mut size = 0u32;
        let mut buf: Vec<u32> = Vec::new();
        for _ in 0..4 {
            let ptr = (!buf.is_empty()).then(|| buf.as_mut_ptr().cast());
            // SAFETY: `buf` holds at least `size` bytes whenever `ptr` is Some.
            let rc = unsafe {
                GetExtendedTcpTable(
                    ptr,
                    &mut size,
                    false,
                    family,
                    TCP_TABLE_OWNER_PID_LISTENER,
                    0,
                )
            };
            if rc == NO_ERROR.0 {
                return Ok(buf);
            }
            if rc != ERROR_INSUFFICIENT_BUFFER.0 {
                return Err(format!("Windows couldn't list ports (error {rc})"));
            }
            // Room for the reported size plus a little, in case sockets were added meanwhile.
            buf = vec![0u32; (size as usize).div_ceil(4) + 64];
            size = (buf.len() * 4) as u32;
        }
        Err("The port list kept changing; try again".into())
    }

    /// Rows after the leading entry count, read without assuming alignment.
    fn rows<T: Copy>(buf: &[u32]) -> Vec<T> {
        let Some(&count) = buf.first() else {
            return Vec::new();
        };
        let bytes = buf.len() * 4;
        // The row array starts after the count, at the row type's alignment.
        let start = std::mem::align_of::<T>().max(4);
        let row = std::mem::size_of::<T>();
        let fits = (bytes.saturating_sub(start)) / row;
        let base = buf.as_ptr().cast::<u8>();
        (0..(count as usize).min(fits))
            // SAFETY: each row lies within `buf`, checked by `fits` above.
            .map(|i| unsafe { std::ptr::read_unaligned(base.add(start + i * row).cast::<T>()) })
            .collect()
    }

    fn port(raw: u32) -> u16 {
        u16::from_be(raw as u16)
    }

    pub fn listening() -> Result<Vec<Socket>, String> {
        let mut out = Vec::new();
        for r in rows::<MIB_TCPROW_OWNER_PID>(&table(u32::from(AF_INET.0))?) {
            out.push(Socket {
                address: Ipv4Addr::from(u32::from_be(r.dwLocalAddr)).to_string(),
                port: port(r.dwLocalPort),
                pid: r.dwOwningPid,
            });
        }
        for r in rows::<MIB_TCP6ROW_OWNER_PID>(&table(u32::from(AF_INET6.0))?) {
            out.push(Socket {
                address: Ipv6Addr::from(r.ucLocalAddr).to_string(),
                port: port(r.dwLocalPort),
                pid: r.dwOwningPid,
            });
        }
        Ok(out)
    }
}

#[cfg(not(windows))]
mod sockets {
    use super::Socket;

    pub fn listening() -> Result<Vec<Socket>, String> {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(address: &str, port: u16, pid: u32) -> Socket {
        Socket {
            address: address.into(),
            port,
            pid,
        }
    }

    #[test]
    fn ipv4_and_ipv6_of_one_server_are_one_entry() {
        let g = group(vec![
            s("127.0.0.1", 5173, 10),
            s("::1", 5173, 10),
            s("0.0.0.0", 3000, 20),
            s("0.0.0.0", 3000, 20),
            s("0.0.0.0", 135, 900),
        ]);
        let keys: Vec<_> = g.keys().copied().collect();
        assert_eq!(
            keys,
            [(135, 900), (3000, 20), (5173, 10)],
            "lowest port first"
        );
        assert_eq!(g[&(5173, 10)], ["127.0.0.1", "::1"]);
        assert_eq!(g[&(3000, 20)], ["0.0.0.0"], "duplicates are dropped");
    }

    #[test]
    fn loopback_is_local_only() {
        assert!(is_loopback("127.0.0.1"));
        assert!(is_loopback("::1"));
        assert!(!is_loopback("0.0.0.0"));
        assert!(!is_loopback("192.168.1.20"));
    }

    #[cfg(windows)]
    #[test]
    fn this_machine_lists_listening_ports() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let sockets = sockets::listening().unwrap();
        assert!(
            sockets
                .iter()
                .any(|s| s.port == port && s.pid == std::process::id()),
            "the test's own listener on {port} is found with its PID"
        );

        let mut sys = System::new();
        let all = describe(&mut sys, sockets);
        let me = all
            .iter()
            .find(|l| l.port == port)
            .expect("the listener is described");
        assert!(me.mine, "a process of the current user is marked as theirs");
        assert!(!me.exposed, "127.0.0.1 is this PC only");
        assert!(
            me.name.to_lowercase().contains("masthead"),
            "name: {}",
            me.name
        );
        assert!(me.cwd.is_some(), "the working folder is known");
        assert!(me.memory_bytes > 0);
        let system = all.iter().find(|l| l.pid == 4);
        assert!(
            system.is_none_or(|s| !s.mine),
            "Windows' own listeners aren't the user's"
        );
    }

    /// Starts a throwaway server, then checks Stop's refusals and that it frees the port.
    #[cfg(windows)]
    #[test]
    fn stop_frees_the_port_and_refuses_the_wrong_targets() {
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};

        // A free port: bind, note it, release it for the child.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let script = format!(
            "$l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, {port}); $l.Start(); Start-Sleep -Seconds 60"
        );
        let mut child = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("powershell starts");
        let pid = child.id();

        let deadline = Instant::now() + Duration::from_secs(20);
        let listening = |port| {
            sockets::listening()
                .unwrap()
                .iter()
                .any(|s| s.port == port && s.pid == pid)
        };
        while !listening(port) {
            assert!(Instant::now() < deadline, "the test server never started");
            std::thread::sleep(Duration::from_millis(100));
        }

        let mut sys = System::new();
        let sockets = sockets::listening().unwrap();
        let other_port = if port == u16::MAX { port - 1 } else { port + 1 };
        assert!(
            stop(&mut sys, &sockets, other_port, pid).is_err(),
            "wrong port is refused"
        );
        let me = std::process::id();
        assert!(
            stop(&mut sys, &sockets, port, me).is_err(),
            "a pid not on that port is refused"
        );

        stop(&mut sys, &sockets, port, pid).expect("the user's own server is stopped");
        let exited = child.wait().expect("the server exits");
        assert!(!exited.success(), "it was ended, not finished");
        assert!(!listening(port), "the port is free again");
    }
}
