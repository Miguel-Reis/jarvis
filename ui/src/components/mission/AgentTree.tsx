import React from "react";
import { useApiData } from "../../hooks/useApi";
import { AgentCard } from "./AgentCard";

type Agent = {
  id: string;
  role: { id: string; name: string; authority_level: number };
  parent_id: string | null;
  status: string;
  current_task: string | null;
  authority: { max_authority_level: number; allowed_tools: string[] };
  created_at: number;
};

type AgentTree = {
  primary: Agent | null;
  children: Agent[];
};

export function AgentTreePanel() {
  const { data: tree, loading } = useApiData<AgentTree>("/api/agents/tree", []);

  if (loading) {
    return (
      <div style={{ padding: "16px", color: "var(--j-text-muted)", fontSize: "13px" }}>
        Loading agents...
      </div>
    );
  }

  if (!tree?.primary) {
    return (
      <div style={{ padding: "16px", color: "var(--j-text-muted)", fontSize: "13px" }}>
        No active agents
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {/* Primary agent */}
      <div>
        <div
          style={{
            fontSize: "10px",
            color: "var(--j-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: "6px",
            paddingLeft: "2px",
          }}
        >
          Primary Agent
        </div>
        <AgentCard agent={tree.primary} />
      </div>

      {/* Children */}
      {tree.children.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "10px",
              color: "var(--j-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "6px",
              marginTop: "8px",
              paddingLeft: "2px",
            }}
          >
            Active Specialists ({tree.children.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingLeft: "16px", borderLeft: "2px solid var(--j-border)" }}>
            {tree.children.map((child) => (
              <AgentCard key={child.id} agent={child} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
