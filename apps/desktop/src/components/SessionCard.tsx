import { useState } from "react";
import type { Session } from "../lib/api";
import { compact, contextFraction, displayTitle, duration, relativeTime, totalTokens } from "../lib/format";
import { AgentBadge, StatePill } from "./badges";
import { ChevronIcon, ClockIcon, TokensIcon } from "./icons";

interface Props {
  session: Session;
  selected?: boolean;
  onSelect?: (s: Session) => void;
}

export const sessionKey = (s: Session) => `${s.agent}:${s.id}`;

export function SessionCard({ session: s, selected, onSelect }: Props) {
  const meta = [s.projectName, s.model].filter(Boolean).join(" · ");
  const fill = contextFraction(s);
  return (
    <button
      className={`tile session-card ${s.state}${selected ? " selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect?.(s)}
    >
      <span className="card-top">
        <AgentBadge agent={s.agent} />
        {s.isSubagent && <span className="tag">Subagent</span>}
        <StatePill session={s} />
      </span>
      <span className="card-title" title={s.title}>
        {displayTitle(s.title)}
      </span>
      <span className="card-meta">{meta}</span>
      <span className="card-foot">
        <span className="when">{relativeTime(s.lastActivity)}</span>
        {s.startedAt && (
          <span className="fig" title="Duration">
            <ClockIcon />
            {duration(s)}
          </span>
        )}
        <span className="fig" title="Tokens">
          <TokensIcon />
          {compact(totalTokens(s.tokens))}
        </span>
      </span>
      {fill !== null && (
        <span className="meter" role="img" aria-label={`Context ${Math.round(fill * 100)}% full`}>
          <span style={{ width: `${Math.round(fill * 100)}%` }} />
        </span>
      )}
    </button>
  );
}

interface GridProps {
  sessions: Session[];
  selectedKey?: string | null;
  onSelect: (s: Session) => void;
}

export function SessionGrid({ sessions, selectedKey, onSelect }: GridProps) {
  return (
    <div className="card-grid">
      {sessions.map((s) => (
        <SessionCard key={sessionKey(s)} session={s} selected={sessionKey(s) === selectedKey} onSelect={onSelect} />
      ))}
    </div>
  );
}

/**
 * Live sessions (active or idle) first; ended ones in their own section,
 * collapsed until the user opens it.
 */
export function SessionSections({
  sessions,
  selectedKey,
  onSelect,
  endedLimit,
}: GridProps & { endedLimit?: number }) {
  const [showEnded, setShowEnded] = useState(false);
  const live = sessions.filter((s) => s.state !== "ended");
  const ended = sessions.filter((s) => s.state === "ended");
  const endedShown = endedLimit ? ended.slice(0, endedLimit) : ended;

  return (
    <div className="sections">
      {live.length > 0 ? (
        <SessionGrid sessions={live} selectedKey={selectedKey} onSelect={onSelect} />
      ) : (
        <div className="quiet">No agent is working right now.</div>
      )}
      {ended.length > 0 && (
        <div className="ended-section">
          <button className="section-toggle" aria-expanded={showEnded} onClick={() => setShowEnded((v) => !v)}>
            <ChevronIcon open={showEnded} />
            Ended
            <span className="head-count">{ended.length}</span>
          </button>
          {showEnded && <SessionGrid sessions={endedShown} selectedKey={selectedKey} onSelect={onSelect} />}
        </div>
      )}
    </div>
  );
}
