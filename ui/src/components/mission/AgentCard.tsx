import React from "react";

type Agent = {
  id: string;
  role: { id: string; name: string; authority_level: number };
  parent_id: string | null;
  status: string;
  current_task: string | null;
  authority: { max_authority_level: number; allowed_tools: string[] };
  created_at: number;
};

type Props = {
  agent: Agent;
  isSelected?: boolean;
  onClick?: () => void;
};

export function AgentCard({ agent, isSelected, onClick }: Props) {
  const statusColor =
    agent.status === "active"
      ? "var(--j-success)"
      : agent.status === "idle"
        ? "var(--j-warning)"
        : "var(--j-text-muted)";

  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "12px 14px",
        background: isSelected ? "var(--j-surface-hover)" : "var(--j-surface)",
        border: `1px solid ${isSelected ? "var(--j-accent-dim)" : "var(--j-border)"}`,
        borderRadius: "8px",
        color: "var(--j-text)",
        textAlign: "left",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: statusColor,
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: "14px", fontWeight: 600 }}>{agent.role.name}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: "10px",
            color: "var(--j-text-muted)",
            textTransform: "uppercase",
          }}
        >
          {agent.status}
        </span>
      </div>

      <div style={{ fontSize: "11px", color: "var(--j-text-muted)", display: "flex", gap: "8px" }}>
        <span>Authority: {agent.authority.max_authority_level}/10</span>
        <span>Tools: {agent.authority.allowed_tools.length}</span>
      </div>

      {agent.current_task && (
        <div
          style={{
            marginTop: "8px",
            padding: "6px 8px",
            background: "var(--j-bg)",
            borderRadius: "4px",
            fontSize: "12px",
            color: "var(--j-accent)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {agent.current_task}
        </div>
      )}
    </button>
  );
}
