import { invoke } from "@tauri-apps/api/core";

export type Agent = "claudeCode" | "codex";
export type SessionState = "active" | "idle" | "ended";

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
  state: SessionState;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
      state: "ended",
    },
  ];
}
