import type { Agent, Session, SessionState, TokenUsage } from "./api";

export const agentName: Record<Agent, string> = {
  claudeCode: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
};

export const stateLabel: Record<SessionState, string> = {
  active: "Active",
  idle: "Idle",
  ended: "Ended",
};

export function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

/** Claude Code appends " (fork)" each time a session is forked; show it once. */
export function displayTitle(title: string): string {
  return title.replace(/(\s*\(fork\))+\s*$/i, " (fork)");
}

export function totalTokens(t: TokenUsage): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

export function dateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function durationMs(session: Session): number {
  if (!session.startedAt || !session.lastActivity) return 0;
  return Math.max(0, new Date(session.lastActivity).getTime() - new Date(session.startedAt).getTime());
}

export function duration(session: Session): string {
  if (!session.startedAt || !session.lastActivity) return "—";
  const minutes = Math.round(durationMs(session) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Context fill as a 0–1 fraction, when the window size is known. */
export function contextFraction(session: Session): number | null {
  if (!session.contextUsed || !session.contextWindow) return null;
  return Math.min(1, session.contextUsed / session.contextWindow);
}

export function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}
