import React from "react";
import { useApiData } from "../../hooks/useApi";

type Observation = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  processed: boolean;
  created_at: number;
};

const TYPE_COLORS: Record<string, string> = {
  file_change: "var(--j-accent)",
  notification: "var(--j-warning)",
  clipboard: "var(--j-accent2)",
  app_activity: "var(--j-success)",
  calendar: "var(--j-warning)",
  email: "var(--j-accent)",
  browser: "var(--j-accent2)",
  process: "var(--j-text-dim)",
};

export function ObservationFeed() {
  const { data: observations, loading } = useApiData<Observation[]>(
    "/api/vault/observations?limit=30",
    []
  );

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
        Recent Observations
      </h3>

      {loading && (
        <div style={{ color: "var(--j-text-muted)", fontSize: "13px" }}>Loading...</div>
      )}

      {!loading && (!observations || observations.length === 0) && (
        <div style={{ color: "var(--j-text-muted)", fontSize: "13px" }}>
          No observations recorded yet
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "400px", overflow: "auto" }}>
        {observations?.map((obs) => (
          <div
            key={obs.id}
            style={{
              padding: "8px 10px",
              background: "var(--j-bg)",
              border: "1px solid var(--j-border)",
              borderRadius: "4px",
              fontSize: "12px",
              display: "flex",
              gap: "8px",
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                padding: "1px 6px",
                borderRadius: "3px",
                background: `${TYPE_COLORS[obs.type] ?? "var(--j-text-muted)"}20`,
                color: TYPE_COLORS[obs.type] ?? "var(--j-text-muted)",
                fontSize: "10px",
                fontWeight: 500,
                whiteSpace: "nowrap",
                marginTop: "1px",
              }}
            >
              {obs.type}
            </span>
            <span style={{ color: "var(--j-text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
              {JSON.stringify(obs.data).slice(0, 150)}
            </span>
            <span style={{ color: "var(--j-text-muted)", whiteSpace: "nowrap", fontSize: "10px" }}>
              {new Date(obs.created_at).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
