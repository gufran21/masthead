import type { Agent, Session } from "../lib/api";
import { agentName, stateLabel } from "../lib/format";
// Agent logos from Lobe Icons (MIT); the marks belong to their owners.
import claudeCodeLogo from "@lobehub/icons-static-svg/icons/claudecode-color.svg";
import codexLogo from "@lobehub/icons-static-svg/icons/codex-color.svg";

const LOGOS: Record<Agent, string> = {
  claudeCode: claudeCodeLogo,
  codex: codexLogo,
};

export function AgentBadge({ agent }: { agent: Agent }) {
  return (
    <span className={`agent-badge ${agent}`} title={agentName[agent]}>
      <img src={LOGOS[agent]} alt={agentName[agent]} />
    </span>
  );
}

export function StatePill({ session }: { session: Session }) {
  return (
    <span className={`pill ${session.state}`}>
      {session.state === "active" && <span className="dot" />}
      {stateLabel[session.state]}
    </span>
  );
}
