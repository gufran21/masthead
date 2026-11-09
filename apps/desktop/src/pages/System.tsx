import { useCallback, useEffect, useRef, useState } from "react";
import { stopAgentProcess, systemSnapshot, type AgentGroup, type SystemProc, type SystemSnapshot } from "../lib/api";
import { agentName } from "../lib/format";
import { AgentBadge } from "../components/badges";
import { CheckIcon } from "../components/icons";

const REFRESH_MS = 2000;
/** Two minutes of history at one sample every two seconds. */
const HISTORY = 60;
const CHILDREN_SHOWN = 5;
const NOTICE_MS = 3500;

const GB = 1024 ** 3;

function bytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(n >= 100 * GB ? 0 : 1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function rate(n: number): string {
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB/s`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB/s`;
  return `${n} B/s`;
}

function since(secs: number): string {
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

const pct = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;

/** A flat line of recent values; `max` fixes the scale (100 for percentages). */
function Sparkline({ values, max, second }: { values: number[]; max?: number; second?: number[] }) {
  const top = max ?? Math.max(1, ...values, ...(second ?? []));
  const line = (vs: number[]) =>
    vs
      // Spread across the full width from the start; it reads as a finished
      // chart rather than a line creeping in from the edge.
      .map((v, i) => `${(i / Math.max(1, vs.length - 1)) * 100},${30 - (Math.min(v, top) / top) * 28}`)
      .join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      {values.length > 1 && <polyline className="spark-line" points={line(values)} />}
      {second && second.length > 1 && <polyline className="spark-line second" points={line(second)} />}
    </svg>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <span className="meter" role="img" aria-label={`${Math.round(value)}%`}>
      <span style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

export function System() {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState("");
  const history = useRef({ cpu: [] as number[], mem: [] as number[], down: [] as number[], up: [] as number[] });
  const [asking, setAsking] = useState<number | null>(null);
  const [stopping, setStopping] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const s = await systemSnapshot();
      const h = history.current;
      const push = (list: number[], v: number) => {
        list.push(v);
        if (list.length > HISTORY) list.shift();
      };
      push(h.cpu, s.cpu);
      push(h.mem, s.memoryTotal ? (s.memoryUsed / s.memoryTotal) * 100 : 0);
      push(h.down, s.downloadRate);
      push(h.up, s.uploadRate);
      setSnap(s);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  const stop = async (p: SystemProc) => {
    setAsking(null);
    setStopping(p.pid);
    try {
      await stopAgentProcess(p.pid);
      setNotice({ text: `Stopped ${p.name}` });
      refresh();
    } catch (e) {
      setNotice({ text: `Couldn't stop ${p.name}: ${e instanceof Error ? e.message : String(e)}`, bad: true });
    } finally {
      setStopping(null);
    }
  };

  const h = history.current;
  const memPct = snap?.memoryTotal ? (snap.memoryUsed / snap.memoryTotal) * 100 : 0;

  return (
    <>
      <div className="page-head">
        <h1>System</h1>
        {snap && <span className="head-count">Up {since(snap.uptimeSecs)}</span>}
      </div>

      {error && (
        <div className="tile alert" role="alert" style={{ marginBottom: 14 }}>
          Couldn't read system activity: {error}
        </div>
      )}

      {!snap ? (
        <div className="empty">Reading system activity…</div>
      ) : (
        <>
          <div className="sys-tiles">
            <section className="tile sys-tile" aria-label="Processor">
              <div className="sys-label">Processor</div>
              <div className="sys-value">{pct(snap.cpu)}</div>
              <div className="sys-sub">{snap.cores.length} cores</div>
              <Sparkline values={h.cpu} max={100} />
            </section>
            <section className="tile sys-tile" aria-label="Memory">
              <div className="sys-label">Memory</div>
              <div className="sys-value">{pct(memPct)}</div>
              <div className="sys-sub">
                {bytes(snap.memoryUsed)} of {bytes(snap.memoryTotal)}
              </div>
              <Sparkline values={h.mem} max={100} />
            </section>
            <section className="tile sys-tile" aria-label="Network">
              <div className="sys-label">Network</div>
              <div className="sys-value sys-net">
                <span title="Download">↓ {rate(snap.downloadRate)}</span>
                <span title="Upload">↑ {rate(snap.uploadRate)}</span>
              </div>
              <div className="sys-sub">All adapters</div>
              <Sparkline values={h.down} second={h.up} />
            </section>
            <section className="tile sys-tile" aria-label="Disks">
              <div className="sys-label">Disks</div>
              <div className="sys-disks">
                {snap.disks.map((d) => {
                  const used = d.total - d.available;
                  return (
                    <div key={d.mount} className="sys-disk" title={d.name || d.mount}>
                      <div className="sys-disk-row">
                        <span className="sys-disk-name">{d.mount.replace(/\\$/, "")}</span>
                        <span>{bytes(d.available)} free</span>
                      </div>
                      <Meter value={(used / d.total) * 100} />
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <section className="sys-section" aria-label="Agents">
            <h2 className="section-title">
              Agents
              <span className="section-count">{snap.agents.length}</span>
            </h2>
            {snap.agents.length === 0 ? (
              <div className="tile ports-empty">
                <strong>No agents running</strong>
                <span>
                  When Claude Code, Codex or Antigravity is working, it shows up here with everything it started.
                </span>
              </div>
            ) : (
              <div className="sys-agents">
                {snap.agents.map((g) => (
                  <AgentCard
                    key={g.pid}
                    group={g}
                    expanded={!!expanded[g.pid]}
                    onToggle={() => setExpanded((e) => ({ ...e, [g.pid]: !e[g.pid] }))}
                    asking={asking}
                    stopping={stopping}
                    onAsk={setAsking}
                    onStop={stop}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="sys-section" aria-label="Busiest processes">
            <h2 className="section-title">Busiest processes</h2>
            <div className="tile sys-list">
              {snap.top.map((p) => (
                <div key={p.pid} className="sys-row">
                  <span className="sys-row-name" title={p.command ?? undefined}>
                    {p.name}
                    {p.agent && <span className="sys-tag">{agentName[p.agent]}</span>}
                  </span>
                  <span className="sys-row-cpu">
                    <Meter value={p.cpu} />
                    {pct(p.cpu)}
                  </span>
                  <span className="sys-row-mem">{bytes(p.memory)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {notice && (
        <div className={`notice${notice.bad ? " bad" : ""}`} role="status">
          {!notice.bad && <CheckIcon />}
          {notice.text}
        </div>
      )}
    </>
  );
}

interface AgentCardProps {
  group: AgentGroup;
  expanded: boolean;
  onToggle: () => void;
  asking: number | null;
  stopping: number | null;
  onAsk: (pid: number | null) => void;
  onStop: (p: SystemProc) => void;
}

function AgentCard({ group: g, expanded, onToggle, asking, stopping, onAsk, onStop }: AgentCardProps) {
  const shown = expanded ? g.children : g.children.slice(0, CHILDREN_SHOWN);
  const running = Math.max(0, Math.floor(Date.now() / 1000 - g.startedAt));
  return (
    <article className="tile sys-agent">
      <div className="sys-agent-head">
        <AgentBadge agent={g.agent} />
        <div className="sys-agent-title">
          <strong>{agentName[g.agent]}</strong>
          <span>
            {[g.host && `in ${g.host}`, g.startedAt ? `running ${since(running)}` : ""].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="sys-agent-use">
          <span>{pct(g.cpu)} CPU</span>
          <span>{bytes(g.memory)}</span>
        </div>
      </div>

      {g.children.length === 0 ? (
        <p className="sys-quiet">Nothing else running.</p>
      ) : (
        <div className="sys-children">
          <div className="sys-children-label">Started by this agent</div>
          {shown.map((c) => (
            <div key={c.pid} className="sys-row">
              <span className="sys-row-name" title={c.command ?? undefined}>
                {c.name}
                {c.command && <span className="sys-cmd">{c.command}</span>}
              </span>
              <span className="sys-row-cpu">{pct(c.cpu)}</span>
              <span className="sys-row-mem">{bytes(c.memory)}</span>
              <span className="sys-row-action">
                {asking === c.pid ? (
                  <>
                    <button className="port-action" onClick={() => onAsk(null)}>
                      Cancel
                    </button>
                    <button className="port-action danger" onClick={() => onStop(c)} autoFocus>
                      Stop
                    </button>
                  </>
                ) : stopping === c.pid ? (
                  <span className="sys-quiet">Stopping…</span>
                ) : (
                  <button className="port-action quiet" onClick={() => onAsk(c.pid)} title={`Stop ${c.name}`}>
                    Stop
                  </button>
                )}
              </span>
            </div>
          ))}
          {g.children.length > CHILDREN_SHOWN && (
            <button className="sys-more" onClick={onToggle}>
              {expanded ? "Show fewer" : `Show all ${g.children.length}`}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
