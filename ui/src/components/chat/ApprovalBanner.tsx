import React, { useState } from "react";
import type { ApprovalRequest } from "../../hooks/useWebSocket";

type Props = {
  approvals: ApprovalRequest[];
  onResolved: (id: string) => void;
};

const CATEGORY_LABELS: Record<string, string> = {
  file_system: "File System",
  network: "Network",
  shell: "Shell Command",
  browser: "Browser",
  app_control: "App Control",
  data: "Data",
  memory: "Memory",
};

export function ApprovalBanner({ approvals, onResolved }: Props) {
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState<string | null>(null);

  if (approvals.length === 0) return null;

  const current = approvals[Math.min(idx, approvals.length - 1)]!;
  const total = approvals.length;
  const currentIdx = Math.min(idx, total - 1);

  const decide = async (action: "approve" | "deny") => {
    setLoading(action);
    try {
      await fetch(`/api/authority/approvals/${current.id}/${action}`, { method: "POST" });
    } catch {
      // Optimistically remove anyway
    } finally {
      setLoading(null);
      onResolved(current.id);
      // Adjust index if we removed last item
      if (currentIdx >= total - 1) setIdx(Math.max(0, currentIdx - 1));
    }
  };

  let args = "";
  try {
    const parsed = JSON.parse(current.tool_arguments);
    args = typeof parsed === "object" ? Object.entries(parsed).map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`).join(", ") : String(current.tool_arguments).slice(0, 120);
  } catch {
    args = String(current.tool_arguments).slice(0, 120);
  }

  const catLabel = CATEGORY_LABELS[current.action_category] ?? current.action_category;
  const isUrgent = current.urgency === "urgent";

  return (
    <div className={`approval-banner${isUrgent ? " approval-banner--urgent" : ""}`}>
      <div className="approval-banner-icon">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1L13 12H1L7 1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="7" cy="10.5" r="0.7" fill="currentColor"/>
        </svg>
      </div>
      <div className="approval-banner-body">
        <div className="approval-banner-title">
          Approval needed
          {total > 1 && (
            <span className="approval-banner-counter">
              <button className="approval-counter-btn" onClick={() => setIdx(Math.max(0, currentIdx - 1))} disabled={currentIdx === 0}>‹</button>
              {currentIdx + 1} / {total}
              <button className="approval-counter-btn" onClick={() => setIdx(Math.min(total - 1, currentIdx + 1))} disabled={currentIdx === total - 1}>›</button>
            </span>
          )}
        </div>
        <div className="approval-banner-tool">
          <code className="approval-banner-code">{current.tool_name}</code>
          {args && <span className="approval-banner-args">{args}</span>}
        </div>
        {current.reason && (
          <div className="approval-banner-reason">{current.reason}</div>
        )}
        <div className="approval-banner-meta">
          <span className="approval-banner-tag">{catLabel}</span>
          {isUrgent && <span className="approval-banner-tag approval-banner-tag--urgent">urgent</span>}
          <span className="approval-banner-agent">{current.agent_name}</span>
        </div>
      </div>
      <div className="approval-banner-actions">
        <button
          className="approval-btn approval-btn--deny"
          onClick={() => decide("deny")}
          disabled={!!loading}
        >
          {loading === "deny" ? "…" : "Deny"}
        </button>
        <button
          className="approval-btn approval-btn--approve"
          onClick={() => decide("approve")}
          disabled={!!loading}
        >
          {loading === "approve" ? "…" : "Approve"}
        </button>
      </div>
    </div>
  );
}
