import { useCallback, useEffect, useMemo, useState } from "react";
import { listPorts, openPort, openPortFolder, stopPort, type Listener, type Session } from "../lib/api";
import { agentName, dateTime, displayTitle } from "../lib/format";
import { GROUPS, identify, type ServerKind } from "../lib/servers";
import { usePref } from "../lib/usePref";
import { AgentBadge } from "../components/badges";
import { ProjectBox } from "../components/ProjectBox";
import { CheckIcon, ClearIcon, CopyIcon, SearchIcon } from "../components/icons";

/** How often the list refreshes while the page is open. */
const REFRESH_MS = 3000;
const NOTICE_MS = 3500;

type Show = "mine" | "all";

interface Server {
  key: string;
  listener: Listener;
  kind: ServerKind;
  /** The agent session working in the folder the server runs from. */
  session?: Session;
  folder: string | null;
}

const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

function sessionFor(cwd: string | null, sessions: Session[]): Session | undefined {
  if (!cwd) return undefined;
  const dir = norm(cwd);
  return sessions.find((s) => {
    if (!s.projectPath) return false;
    const project = norm(s.projectPath);
    return dir === project || dir.startsWith(`${project}\\`);
  });
}

const folderName = (path: string | null) =>
  path
    ?.replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || null;

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function uptime(startedAt: number | null): string {
  if (!startedAt) return "";
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - startedAt) / 60));
  if (minutes < 1) return "Just started";
  if (minutes < 60) return `Up ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Up ${hours}h ${minutes % 60}m`;
  return `Up ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const url = (port: number) => `http://localhost:${port}`;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = Object.assign(document.createElement("textarea"), { value: text });
    area.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** A two-step Stop: the first click asks, the second stops. */
function useStop(onDone: (s: Server, error?: string) => void) {
  const [asking, setAsking] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const stop = async (s: Server) => {
    setAsking(null);
    setStopping(s.key);
    try {
      await stopPort(s.listener.port, s.listener.pid);
      onDone(s);
    } catch (e) {
      onDone(s, e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(null);
    }
  };
  return { asking, setAsking, stopping, stop };
}

export function Ports({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (s: Session) => void }) {
  const [ports, setPorts] = useState<Listener[] | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = usePref<Show>("ports.show", "mine");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPorts(await listPorts());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const servers = useMemo<Server[]>(() => {
    const recent = [...sessions].sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
    return (ports ?? []).map((l) => {
      const session = sessionFor(l.cwd, recent);
      return {
        key: `${l.port}:${l.pid}`,
        listener: l,
        kind: identify(l),
        session,
        folder: session?.projectName ?? folderName(l.cwd),
      };
    });
  }, [ports, sessions]);

  const q = query.trim().toLowerCase().replace(/^:/, "");
  const visible = servers.filter((s) => {
    if (show === "mine" && s.kind.group === "system") return false;
    if (!q) return true;
    const l = s.listener;
    return [String(l.port), s.kind.label, l.name, s.folder ?? "", s.session ? agentName[s.session.agent] : ""].some(
      (t) => t.toLowerCase().includes(q),
    );
  });
  const current = servers.find((s) => s.key === selected);

  const { asking, setAsking, stopping, stop } = useStop((s, err) => {
    const what = `${s.kind.label} on :${s.listener.port}`;
    if (err) {
      setNotice({ text: `Couldn't stop ${what}: ${err}`, bad: true });
    } else {
      setNotice({ text: `Stopped ${what}` });
      if (selected === s.key) setSelected(null);
    }
    refresh();
  });

  return (
    <>
      <div className="page-head ports-head">
        <h1>Ports</h1>
        <span className="head-count">{visible.length}</span>
      </div>

      <div className="toolbar ports-toolbar" role="group" aria-label="Find ports">
        <label className="glass-control ports-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Port, app or project"
            aria-label="Find a port, app or project"
          />
          {query && (
            <button className="icon-button clear" onClick={() => setQuery("")} aria-label="Clear search">
              <ClearIcon />
            </button>
          )}
        </label>
        <div className="segmented" role="group" aria-label="Show">
          {(
            [
              ["mine", "Yours"],
              ["all", "Everything"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={show === value ? "on" : ""}
              aria-pressed={show === value}
              onClick={() => setShow(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="tile alert" role="alert" style={{ marginBottom: 14 }}>
          Couldn't list ports: {error}
        </div>
      )}

      <div className={current ? "split" : undefined}>
        <div>
          {ports === null ? (
            <div className="empty">Looking for running servers…</div>
          ) : visible.length === 0 ? (
            <div className="tile ports-empty">
              <strong>{q ? `Nothing matches “${query.trim()}”` : "No servers running"}</strong>
              <span>
                {q
                  ? "Try a port number like 3000, or an app like Vite."
                  : "When you or an agent starts a dev server, it shows up here with its project, so you can open or stop it."}
              </span>
            </div>
          ) : (
            GROUPS.map((group) => {
              const items = visible.filter((s) => s.kind.group === group.id);
              if (!items.length) return null;
              return (
                <section key={group.id} className="ports-group" aria-label={group.title}>
                  <h2 className="section-title">
                    {group.title}
                    <span className="section-count">{items.length}</span>
                  </h2>
                  <div className="card-grid ports">
                    {items.map((s) => (
                      <PortCard
                        key={s.key}
                        server={s}
                        selected={s.key === selected}
                        asking={asking === s.key}
                        stopping={stopping === s.key}
                        onSelect={() => setSelected(s.key === selected ? null : s.key)}
                        onAsk={() => setAsking(s.key)}
                        onCancel={() => setAsking(null)}
                        onStop={() => stop(s)}
                      />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>

        {current && (
          <PortDetail
            server={current}
            asking={asking === current.key}
            stopping={stopping === current.key}
            onClose={() => setSelected(null)}
            onAsk={() => setAsking(current.key)}
            onCancel={() => setAsking(null)}
            onStop={() => stop(current)}
            onOpenSession={onOpenSession}
          />
        )}
      </div>

      {notice && (
        <div className={`notice${notice.bad ? " bad" : ""}`} role="status">
          {!notice.bad && <CheckIcon />}
          {notice.text}
        </div>
      )}
    </>
  );
}

interface CardProps {
  server: Server;
  selected: boolean;
  asking: boolean;
  stopping: boolean;
  onSelect: () => void;
  onAsk: () => void;
  onCancel: () => void;
  onStop: () => void;
}

function PortCard({ server: s, selected, asking, stopping, onSelect, onAsk, onCancel, onStop }: CardProps) {
  const l = s.listener;
  return (
    <article className={`tile port-card${selected ? " selected" : ""}${stopping ? " stopping" : ""}`}>
      <button
        className="port-card-body"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${s.kind.label} on port ${l.port}`}
      >
        <span className="port-card-top">
          <span className="port-kind">{s.kind.label}</span>
          <span className="port-number">:{l.port}</span>
        </span>
        <span className="port-project" title={l.cwd ?? undefined}>
          {s.session && <AgentBadge agent={s.session.agent} />}
          <span>{s.folder ?? l.name}</span>
        </span>
        <span className="port-meta">
          {l.exposed && s.kind.group !== "system" && <span className="dot-label exposed">Network</span>}
          {[uptime(l.startedAt), l.memoryBytes ? megabytes(l.memoryBytes) : ""].filter(Boolean).join(" · ")}
        </span>
      </button>

      <div className="port-actions">
        {asking ? (
          <>
            <span className="port-ask">Stop {s.kind.label}?</span>
            <button className="port-action" onClick={onCancel}>
              Cancel
            </button>
            <button className="port-action danger" onClick={onStop} autoFocus>
              Stop
            </button>
          </>
        ) : stopping ? (
          <span className="port-ask">Stopping…</span>
        ) : (
          <>
            {s.kind.web && (
              <button className="port-action" onClick={() => openPort(l.port)} title={`Open ${url(l.port)}`}>
                Open
              </button>
            )}
            <span className="grow" />
            {l.mine && (
              <button className="port-action quiet" onClick={onAsk} title={`Stop ${s.kind.label}`}>
                Stop
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

interface DetailProps {
  server: Server;
  asking: boolean;
  stopping: boolean;
  onClose: () => void;
  onAsk: () => void;
  onCancel: () => void;
  onStop: () => void;
  onOpenSession: (s: Session) => void;
}

function PortDetail({ server: s, asking, stopping, onClose, onAsk, onCancel, onStop, onOpenSession }: DetailProps) {
  const l = s.listener;
  const [copied, setCopied] = useState<"url" | "command" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async (what: "url" | "command", text: string) => {
    if (await copyText(text)) setCopied(what);
  };

  return (
    <aside className="tile detail port-detail" aria-label="Server details">
      <div className="detail-head">
        <span className="port-number big">:{l.port}</span>
        <span className="grow" />
        <button className="icon-button" onClick={onClose} aria-label="Close details">
          <ClearIcon />
        </button>
      </div>
      <h2>{s.kind.label}</h2>

      {s.kind.web && (
        <div className="port-url">
          <span className="port-url-text">{url(l.port)}</span>
          <button className="port-action" onClick={() => copy("url", url(l.port))} aria-label="Copy address">
            {copied === "url" ? <CheckIcon /> : <CopyIcon />}
          </button>
          <button className="port-action primary" onClick={() => openPort(l.port)}>
            Open
          </button>
        </div>
      )}

      {s.session && (
        <button className="port-session" onClick={() => onOpenSession(s.session!)}>
          <AgentBadge agent={s.session.agent} />
          <span>
            <span className="port-session-label">In a {agentName[s.session.agent]} session</span>
            <span className="port-session-title">{displayTitle(s.session.title)}</span>
          </span>
        </button>
      )}

      {l.cwd && <ProjectBox name={s.folder} path={l.cwd} onOpen={() => openPortFolder(l.port, l.pid)} />}

      <dl className="kv">
        <dt>Who can connect</dt>
        <dd>{l.exposed ? "This PC and other devices on your network" : "Only this PC"}</dd>
        <dt>Program</dt>
        <dd title={l.exe ?? undefined}>{l.name}</dd>
        <dt>Process ID</dt>
        <dd>{l.pid}</dd>
        <dt>Started</dt>
        <dd>{l.startedAt ? dateTime(new Date(l.startedAt * 1000).toISOString()) : "—"}</dd>
        <dt>Memory</dt>
        <dd>{l.memoryBytes ? megabytes(l.memoryBytes) : "—"}</dd>
        <dt>Listening on</dt>
        <dd>{l.addresses.join(", ")}</dd>
      </dl>

      {l.command && (
        <div className="port-command-box">
          <div className="port-command-head">
            Command
            <button className="icon-button small" onClick={() => copy("command", l.command!)} aria-label="Copy command">
              {copied === "command" ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
          <code>{l.command}</code>
        </div>
      )}

      {l.mine ? (
        asking ? (
          <div className="port-stop-ask">
            <span>
              Stop {s.kind.label} on :{l.port}? Unsaved work in it may be lost.
            </span>
            <div>
              <button className="port-action" onClick={onCancel}>
                Cancel
              </button>
              <button className="port-action danger" onClick={onStop} autoFocus>
                Stop
              </button>
            </div>
          </div>
        ) : (
          <button className="port-stop" onClick={onAsk} disabled={stopping}>
            {stopping ? "Stopping…" : `Stop ${s.kind.label}`}
          </button>
        )
      ) : (
        <p className="port-note">Run by Windows or another user, so Masthead won't stop it.</p>
      )}
    </aside>
  );
}
