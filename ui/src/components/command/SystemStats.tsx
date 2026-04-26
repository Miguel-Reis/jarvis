import React from "react";
import { useApiData } from "../../hooks/useApi";

type AgentInfo = {
  id: string;
  status: string;
  role: { name: string };
};

export function SystemStats() {
  const { data: agents } = useApiData<AgentInfo[]>("/api/agents", []);

  const activeCount = agents?.filter((a) => a.status === "active").length ?? 0;
  const totalCount = agents?.length ?? 0;

  return (
    <div
      style={{
        padding: "16px",
        background: "var(--j-surface)",
        border: "1px solid var(--j-border)",
        borderRadius: "8px",
      }}
    >
      <h3
        style={{
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--j-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: "12px",
        }}
      >
        System
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--j-text-dim)" }}>Active Agents</span>
          <span style={{ color: "var(--j-accent)", fontWeight: 600 }}>{activeCount}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--j-text-dim)" }}>Total Agents</span>
          <span style={{ color: "var(--j-text)" }}>{totalCount}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--j-text-dim)" }}>Port</span>
          <span style={{ color: "var(--j-text)" }}>3142</span>
        </div>
      </div>
    </div>
  );
}
