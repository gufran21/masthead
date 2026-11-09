import type { Agent, Session } from "../lib/api";
import { agentName, compact, isToday, relativeTime, totalTokens } from "../lib/format";
import { AgentBadge } from "../components/badges";
import { SessionSections } from "../components/SessionCard";

interface Props {
  sessions: Session[];
  onOpen: (s: Session) => void;
  onViewAll: () => void;
}

const AGENTS: Agent[] = ["claudeCode", "codex", "antigravity"];

export function Overview({ sessions, onOpen, onViewAll }: Props) {
  const main = sessions.filter((s) => !s.isSubagent);
  const active = main.filter((s) => s.state === "active");
  const today = main.filter((s) => isToday(s.lastActivity));
  const tokensToday = today.reduce((sum, s) => sum + totalTokens(s.tokens), 0);
  const projectsToday = new Set(today.map((s) => s.projectPath).filter(Boolean));
  const activeAgents = [...new Set(active.map((s) => agentName[s.agent]))];

  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <span className="pill active">
          <span className="dot" />
          Monitoring
        </span>
      </div>

      <div className="stats">
        <Stat label="Active now" value={active.length} sub={activeAgents.length ? activeAgents.join(", ") : "No agent is working"} />
        <Stat label="Sessions today" value={today.length} sub={`${main.length} found in total`} />
        <Stat label="Tokens today" value={compact(tokensToday)} sub="Including cached input" />
        <Stat label="Projects today" value={projectsToday.size} sub="Folders agents worked in" />
      </div>

      <div className="overview-grid">
        <section aria-label="Recent sessions">
          <div className="section-head">
            Recent sessions
            <button className="chip" onClick={onViewAll}>
              View all
            </button>
          </div>
          {main.length === 0 ? (
            <div className="tile empty">
              <strong>No sessions yet</strong>
              Start Claude Code or Codex and your sessions appear here automatically.
            </div>
          ) : (
            <SessionSections sessions={main} onSelect={onOpen} endedLimit={6} />
          )}
        </section>

        <div className="side">
          <section className="tile">
            <div className="card-head">Agents</div>
            <div className="list">
              {AGENTS.map((agent) => {
                const mine = main.filter((s) => s.agent === agent);
                const live = mine.filter((s) => s.state === "active").length;
                const today = mine.filter((s) => isToday(s.lastActivity));
                const tokens = today.reduce((n, s) => n + totalTokens(s.tokens), 0);
                return (
                  <div className="list-item" key={agent}>
                    <AgentBadge agent={agent} />
                    <div className="grow">
                      <div className="name">{agentName[agent]}</div>
                      <div className="meta">
                        {mine.length
                          ? `${mine.length} ${mine.length === 1 ? "session" : "sessions"} · ${live} active`
                          : "No sessions found"}
                      </div>
                    </div>
                    <div className="num">{compact(tokens)} today</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="tile">
            <div className="card-head">Projects</div>
            <Projects sessions={main} />
          </section>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="tile stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function Projects({ sessions }: { sessions: Session[] }) {
  const byProject = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = s.projectPath ?? "Unknown folder";
    byProject.set(key, [...(byProject.get(key) ?? []), s]);
  }
  // Sessions arrive newest first, so the first entry of each group is its latest.
  const projects = [...byProject.entries()].slice(0, 5);
  if (projects.length === 0) return <div className="empty">No projects yet</div>;
  return (
    <div className="list">
      {projects.map(([path, list]) => (
        <div className="list-item" key={path} title={path}>
          <div className="grow">
            <div className="name">{list[0].projectName ?? path}</div>
            <div className="meta">
              {list.length} {list.length === 1 ? "session" : "sessions"} ·{" "}
              {[...new Set(list.map((s) => agentName[s.agent]))].join(", ")}
            </div>
          </div>
          <div className="num">{relativeTime(list[0].lastActivity)}</div>
        </div>
      ))}
    </div>
  );
}
