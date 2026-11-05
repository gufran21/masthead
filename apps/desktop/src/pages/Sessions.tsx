import { useMemo } from "react";
import type { Agent, Session } from "../lib/api";
import {
  agentName,
  compact,
  contextFraction,
  dateTime,
  displayTitle,
  duration,
  durationMs,
  relativeTime,
  totalTokens,
} from "../lib/format";
import { usePref } from "../lib/usePref";
import { AgentBadge, StatePill } from "../components/badges";
import { SessionSections, sessionKey } from "../components/SessionCard";
import { ClearIcon, SortIcon } from "../components/icons";
import { Dropdown } from "../components/Dropdown";
import { ProjectBox } from "../components/ProjectBox";

interface Props {
  sessions: Session[];
  query: string;
  selectedKey: string | null;
  onSelect: (s: Session) => void;
}

type SortKey = "lastActivity" | "startedAt" | "duration" | "tokens";
type Period = "all" | "today" | "week" | "month";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "lastActivity", label: "Last active" },
  { id: "startedAt", label: "Started" },
  { id: "duration", label: "Duration" },
  { id: "tokens", label: "Tokens" },
];

const PERIODS: { id: Period; label: string; days: number }[] = [
  { id: "all", label: "Any time", days: Infinity },
  { id: "today", label: "Today", days: 1 },
  { id: "week", label: "Last 7 days", days: 7 },
  { id: "month", label: "Last 30 days", days: 30 },
];

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

function sortValue(s: Session, by: SortKey): number {
  switch (by) {
    case "startedAt":
      return time(s.startedAt);
    case "duration":
      return durationMs(s);
    case "tokens":
      return totalTokens(s.tokens);
    default:
      return time(s.lastActivity);
  }
}

function withinPeriod(s: Session, period: Period): boolean {
  if (period === "all") return true;
  if (period === "today") return new Date(time(s.lastActivity)).toDateString() === new Date().toDateString();
  const days = PERIODS.find((p) => p.id === period)!.days;
  return Date.now() - time(s.lastActivity) <= days * 86_400_000;
}

export function Sessions({ sessions, query, selectedKey, onSelect }: Props) {
  const [agent, setAgent] = usePref<Agent | "all">("sessions.agent", "all");
  const [project, setProject] = usePref<string>("sessions.project", "");
  const [period, setPeriod] = usePref<Period>("sessions.period", "all");
  const [savedSort, setSortBy] = usePref<SortKey>("sessions.sort", "lastActivity");
  // A saved choice that is no longer offered (e.g. the old "Title") falls back to last active.
  const sortBy: SortKey = SORTS.some((s) => s.id === savedSort) ? savedSort : "lastActivity";
  const [descending, setDescending] = usePref("sessions.descending", true);

  const projects = useMemo(
    () => [...new Set(sessions.map((s) => s.projectName).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b)),
    [sessions],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = sessions.filter(
      (s) =>
        (agent === "all" || s.agent === agent) &&
        (!project || s.projectName === project) &&
        withinPeriod(s, period) &&
        (!q || [s.title, s.projectName, s.projectPath, s.model].some((v) => v?.toLowerCase().includes(q))),
    );
    const dir = descending ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = sortValue(a, sortBy);
      const y = sortValue(b, sortBy);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [sessions, query, agent, project, period, sortBy, descending]);

  const selected =
    shown.find((s) => sessionKey(s) === selectedKey) ?? shown.find((s) => s.state !== "ended") ?? shown[0] ?? null;
  const filtered = agent !== "all" || !!project || period !== "all";
  const reset = () => {
    setAgent("all");
    setProject("");
    setPeriod("all");
  };

  return (
    <>
      <div className="page-head">
        <h1>Sessions</h1>
        <span className="head-count">{shown.length}</span>
      </div>

      <div className="toolbar" role="group" aria-label="Filter and sort sessions">
        <div className="segmented" role="group" aria-label="Agent">
          {(["all", "claudeCode", "codex"] as const).map((a) => (
            <button key={a} className={agent === a ? "on" : ""} aria-pressed={agent === a} onClick={() => setAgent(a)}>
              {a === "all" ? "All" : agentName[a]}
            </button>
          ))}
        </div>
        <Dropdown
          label="Project"
          value={project}
          options={[{ value: "", label: "All projects" }, ...projects.map((p) => ({ value: p, label: p }))]}
          onChange={setProject}
        />
        <Dropdown
          label="Period"
          value={period}
          options={PERIODS.map((p) => ({ value: p.id, label: p.label }))}
          onChange={setPeriod}
        />
        <span className="toolbar-divider" aria-hidden="true" />
        <Dropdown
          label="Sort by"
          prefix="Sort"
          value={sortBy}
          options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
          onChange={setSortBy}
        />
        <button
          className="glass-control icon-button"
          aria-label={descending ? "Sorted descending" : "Sorted ascending"}
          title={descending ? "Descending" : "Ascending"}
          onClick={() => setDescending((d) => !d)}
        >
          <SortIcon descending={descending} />
        </button>
        {filtered && (
          <button className="glass-control icon-button clear" aria-label="Clear filters" title="Clear filters" onClick={reset}>
            <ClearIcon />
          </button>
        )}
      </div>

      <div className="split">
        <section aria-label="Sessions">
          {shown.length === 0 ? (
            <div className="tile empty">
              <strong>No matching sessions</strong>
              Try another search or clear the filters.
            </div>
          ) : (
            <SessionSections sessions={shown} selectedKey={selected ? sessionKey(selected) : null} onSelect={onSelect} />
          )}
        </section>
        {selected && <Detail session={selected} />}
      </div>
    </>
  );
}

const SEGMENTS = [
  { key: "cacheRead", label: "Cache read", color: "rgba(255,255,255,0.42)" },
  { key: "cacheWrite", label: "Cache write", color: "#8F7CFF" },
  { key: "input", label: "Input", color: "var(--accent)" },
  { key: "output", label: "Output", color: "var(--running)" },
] as const;

function Detail({ session: s }: { session: Session }) {
  const total = totalTokens(s.tokens);
  const fill = contextFraction(s);
  return (
    <aside className="tile detail" aria-label="Session details">
      <div className="detail-head">
        <AgentBadge agent={s.agent} />
        <span className="agent">{agentName[s.agent]}</span>
        <StatePill session={s} />
      </div>
      <h2 title={s.title}>{displayTitle(s.title)}</h2>
      {s.projectPath && (
        <ProjectBox name={s.projectName} path={s.projectPath} />
      )}

      <div className="mini-stats">
        <div>
          <span className="label">Prompts</span>
          <span className="value">{s.userMessages}</span>
        </div>
        <div>
          <span className="label">Duration</span>
          <span className="value">{duration(s)}</span>
        </div>
        <div>
          <span className="label">Tokens</span>
          <span className="value">{compact(total)}</span>
        </div>
        <div>
          <span className="label">In context</span>
          <span className="value">{s.contextUsed ? compact(s.contextUsed) : "—"}</span>
          {fill !== null && (
            <span className="meter" role="img" aria-label={`Context ${Math.round(fill * 100)}% full`}>
              <span style={{ width: `${Math.round(fill * 100)}%` }} />
            </span>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="breakdown">
          <div className="bar" role="img" aria-label="Token breakdown">
            {SEGMENTS.map(({ key, color }) =>
              s.tokens[key] > 0 ? <span key={key} style={{ flexGrow: s.tokens[key], background: color }} /> : null,
            )}
          </div>
          <ul className="legend">
            {SEGMENTS.map(({ key, label, color }) => (
              <li key={key}>
                <span className="swatch" style={{ background: color }} />
                {label}
                <span className="amount">{compact(s.tokens[key])}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="kv">
        <dt>Model</dt>
        <dd>{s.model ?? "—"}</dd>
        <dt>Branch</dt>
        <dd>{s.gitBranch ?? "—"}</dd>
        <dt>Started</dt>
        <dd>{dateTime(s.startedAt)}</dd>
        <dt>Last activity</dt>
        <dd>{relativeTime(s.lastActivity)}</dd>
      </dl>
    </aside>
  );
}
