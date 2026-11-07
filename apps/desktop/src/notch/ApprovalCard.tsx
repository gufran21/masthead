import { useEffect, useState } from "react";
import { answerApproval, type Approval, type ApprovalAnswer } from "../lib/api";
import { AgentBadge } from "../components/badges";

/** Height of the island while it shows a request. */
export const APPROVAL_H = 214;

/**
 * A Claude Code permission request, answered from the notch. The bar runs down
 * to the moment Claude Code stops waiting and asks in the terminal instead.
 */
export function ApprovalCard({ approval, waiting, total }: { approval: Approval; waiting: number; total: number }) {
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setBusy(false);
    setError("");
  }, [approval.id]);

  const left = Math.max(0, approval.deadlineMs - now);
  const span = Math.max(1, total * 1000);
  const answer = async (choice: ApprovalAnswer) => {
    setBusy(true);
    setError("");
    try {
      await answerApproval(approval.id, choice);
    } catch (e) {
      setBusy(false);
      setError(String(e));
    }
  };

  return (
    <div className="peek approval" role="alertdialog" aria-label={`Claude Code wants to use ${approval.tool}`}>
      <div className="approval-head">
        <AgentBadge agent="claudeCode" />
        <span className="approval-title">
          Allow <strong>{approval.tool}</strong>?
        </span>
        {waiting > 1 && <span className="peek-badge">+{waiting - 1} waiting</span>}
        <span className="approval-left">{Math.ceil(left / 1000)} s</span>
      </div>
      <pre className="approval-input" title={approval.detail ?? approval.summary}>
        {approval.detail ?? (approval.summary || "No details")}
      </pre>
      <div className="approval-meta">
        {error || [approval.projectName, "Claude Code"].filter(Boolean).join(" · ")}
      </div>
      <div className="approval-actions">
        <button className="approval-btn quiet" disabled={busy} onClick={() => answer("terminal")}>
          Answer in terminal
        </button>
        <span className="grow" />
        <button className="approval-btn" disabled={busy} onClick={() => answer("deny")}>
          Deny
        </button>
        <button className="approval-btn allow" disabled={busy} onClick={() => answer("allow")}>
          Allow
        </button>
      </div>
      <div className="approval-timer" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (left / span) * 100)}%` }} />
      </div>
    </div>
  );
}
