import { invoke } from "@tauri-apps/api/core";

export type Agent = "claudeCode" | "codex" | "antigravity";
export type SessionState = "active" | "idle" | "ended";
/** Where the agent is in its exchange with the user. */
export type Turn = "working" | "done" | "interrupted";

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Mirrors `masthead_core::Session`. */
export interface Session {
  id: string;
  agent: Agent;
  title: string;
  projectPath: string | null;
  projectName: string | null;
  gitBranch: string | null;
  model: string | null;
  startedAt: string | null;
  lastActivity: string | null;
  userMessages: number;
  tokens: TokenUsage;
  contextUsed: number | null;
  contextWindow: number | null;
  isSubagent: boolean;
  sourceFile: string;
  turn: Turn;
  state: SessionState;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** A Claude Code permission request waiting in the notch. Mirrors `approvals::Approval`. */
export interface Approval {
  id: number;
  sessionId: string;
  projectName: string | null;
  projectPath: string | null;
  tool: string;
  summary: string;
  detail: string | null;
  deadlineMs: number;
}

export type ApprovalAnswer = "allow" | "deny" | "terminal";

export async function listApprovals(): Promise<Approval[]> {
  return inTauri ? invoke<Approval[]>("list_approvals") : [];
}

export async function answerApproval(id: number, answer: ApprovalAnswer): Promise<void> {
  await invoke("answer_approval", { id, answer });
}

/** Whether Masthead's hook is in Claude Code's settings; null outside the desktop app. */
export async function getApprovalHook(): Promise<boolean | null> {
  return inTauri ? invoke<boolean>("get_approval_hook") : null;
}

export async function setApprovalHook(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("set_approval_hook", { enabled });
}

/** A listening TCP port and its process. Mirrors `ports::Listener`. */
export interface Listener {
  port: number;
  addresses: string[];
  exposed: boolean;
  pid: number;
  name: string;
  exe: string | null;
  command: string | null;
  cwd: string | null;
  startedAt: number | null;
  memoryBytes: number;
  mine: boolean;
}

export async function listPorts(): Promise<Listener[]> {
  if (!inTauri) return samplePorts();
  return invoke<Listener[]>("list_ports");
}

/** Opens http://localhost:<port> in the default browser. */
export async function openPort(port: number): Promise<void> {
  if (inTauri) await invoke("open_port", { port });
  else window.open(`http://localhost:${port}`, "_blank");
}

/** Opens the folder the process on `port` runs from (Rust finds the folder itself). */
export async function openPortFolder(port: number, pid: number): Promise<void> {
  if (!inTauri) throw new Error("Opening folders works in the desktop app");
  await invoke("open_port_folder", { port, pid });
}

/** Stops the process on `port`; Rust re-checks that it is the user's own. */
export async function stopPort(port: number, pid: number): Promise<void> {
  if (!inTauri) throw new Error("Stopping processes works in the desktop app");
  await invoke("stop_port", { port, pid });
}

function samplePorts(): Listener[] {
  const now = Math.floor(Date.now() / 1000);
  const base = { exe: null, mine: true, exposed: false };
  return [
    {
      ...base,
      port: 3000,
      addresses: ["127.0.0.1", "::1"],
      pid: 18432,
      name: "node.exe",
      command: "node node_modules/next/dist/bin/next dev",
      cwd: "D:\\Code\\web-app",
      startedAt: now - 47 * 60,
      memoryBytes: 412 * 1024 * 1024,
    },
    {
      ...base,
      port: 5173,
      addresses: ["0.0.0.0"],
      exposed: true,
      pid: 20116,
      name: "node.exe",
      command: "node vite --host",
      cwd: "D:\\Code\\api-server\\ui",
      startedAt: now - 5 * 60,
      memoryBytes: 168 * 1024 * 1024,
    },
    {
      ...base,
      port: 8000,
      addresses: ["127.0.0.1"],
      pid: 9920,
      name: "python.exe",
      command: "python -m http.server 8000",
      cwd: "D:\\Code\\docs",
      startedAt: now - 26 * 3600,
      memoryBytes: 24 * 1024 * 1024,
    },
    {
      ...base,
      port: 135,
      addresses: ["0.0.0.0", "::"],
      exposed: true,
      pid: 1184,
      name: "svchost.exe",
      command: null,
      cwd: null,
      startedAt: now - 3 * 86400,
      memoryBytes: 9 * 1024 * 1024,
      mine: false,
    },
  ];
}

/** The notch page is listening for events; Rust may show its window. */
export async function notchReady(): Promise<void> {
  if (inTauri) await invoke("notch_ready");
}

/** Where the island sits in the notch window (CSS px), for hover and click-through. */
export async function notchIsland(x: number, y: number, width: number, height: number): Promise<void> {
  if (inTauri) await invoke("notch_island", { x, y, width, height });
}

/** Pops the notch open for `ms`, wherever the cursor is (an agent finished). */
export async function notchAnnounce(ms: number): Promise<void> {
  if (inTauri) await invoke("notch_announce", { ms });
}

/** While pinned, the notch stays open after the cursor leaves. */
export async function notchPin(pinned: boolean): Promise<void> {
  if (inTauri) await invoke("notch_pin", { pinned });
}

/** The screen behind the notch window as RGBA, or null when capture isn't available. */
export async function captureBackdrop(): Promise<{ width: number; height: number; pixels: Uint8Array } | null> {
  if (!inTauri) return null;
  try {
    const buffer = await invoke<ArrayBuffer>("capture_backdrop");
    const view = new DataView(buffer);
    return { width: view.getUint32(0, true), height: view.getUint32(4, true), pixels: new Uint8Array(buffer, 8) };
  } catch {
    return null;
  }
}

/** Shows the main window, on one session when `key` is given (`agent:id`). */
export async function openInMain(key = ""): Promise<void> {
  if (inTauri) await invoke("open_session", { key });
}

/** Opens a session's project folder in File Explorer (desktop app only). */
export async function openFolder(path: string): Promise<void> {
  if (!inTauri) throw new Error("Opening folders works in the desktop app");
  await invoke("open_folder", { path });
}

export async function listSessions(): Promise<Session[]> {
  if (!inTauri) return sampleSessions();
  return invoke<Session[]>("list_sessions");
}

/** Lets the UI run in a plain browser (`pnpm dev:web`) without the Rust side. */
function sampleSessions(): Session[] {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const base = {
    gitBranch: "main",
    isSubagent: false,
    sourceFile: "",
    contextWindow: null,
  };
  return [
    {
      ...base,
      id: "sample-1",
      agent: "claudeCode",
      title: "Add user roles migration",
      projectPath: "D:\\Code\\api-server",
      projectName: "api-server",
      model: "claude-opus-5-5",
      startedAt: ago(18),
      lastActivity: ago(1),
      userMessages: 6,
      tokens: { input: 1_200, output: 42_000, cacheRead: 1_400_000, cacheWrite: 96_000 },
      contextUsed: 118_000,
      turn: "working",
      state: "active",
    },
    {
      ...base,
      id: "sample-2",
      agent: "codex",
      title: "Fix hydration warning",
      projectPath: "D:\\Code\\web-app",
      projectName: "web-app",
      model: "gpt-5-codex",
      startedAt: ago(40),
      lastActivity: ago(12),
      userMessages: 3,
      tokens: { input: 10_000, output: 900, cacheRead: 30_000, cacheWrite: 0 },
      contextUsed: 22_000,
      contextWindow: 258_400,
      turn: "done",
      state: "idle",
    },
    {
      ...base,
      id: "sample-3",
      agent: "claudeCode",
      title: "Tidy the README",
      projectPath: "D:\\Code\\docs",
      projectName: "docs",
      model: "claude-sonnet-5-5",
      startedAt: ago(60 * 26),
      lastActivity: ago(60 * 25),
      userMessages: 2,
      tokens: { input: 300, output: 4_000, cacheRead: 80_000, cacheWrite: 20_000 },
      contextUsed: 24_000,
      turn: "done",
      state: "ended",
    },
    {
      ...base,
      id: "sample-4",
      agent: "antigravity",
      title: "Redesign the onboarding flow",
      projectPath: "D:\\Code\\web-app",
      projectName: "web-app",
      model: "gemini-3.7-flash",
      startedAt: ago(65),
      lastActivity: ago(40),
      userMessages: 4,
      tokens: { input: 8_000, output: 3_100, cacheRead: 210_000, cacheWrite: 0 },
      contextUsed: 31_000,
      contextWindow: 1_000_000,
      turn: "done",
      state: "idle",
    },
  ];
}
