import React from "react";
import { useApiData } from "../../hooks/useApi";

type HealthStatus = {
  uptime: number;
  services: Record<string, string>;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  database: { connected: boolean; size: number };
  startedAt: number;
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function HealthPanel() {
  const { data: health, loading } = useApiData<HealthStatus>("/api/health", []);

  if (loading || !health) {
    return <div style={cardStyle}><span style={loadingText}>Loading health status...</span></div>;
  }

  const memPercent = health.memory.heapTotal > 0
    ? ((health.memory.heapUsed / health.memory.heapTotal) * 100).toFixed(0)
    : "0";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Uptime + DB */}
      <div style={{ display: "flex", gap: "12px" }}>
        <StatCard label="Uptime" value={formatUptime(health.uptime)} color="var(--j-accent)" />
        <StatCard label="Started" value={new Date(health.startedAt).toLocaleString()} color="var(--j-text-dim)" />
        <StatCard
          label="Database"
          value={health.database.connected ? formatBytes(health.database.size) : "Disconnected"}
          color={health.database.connected ? "var(--j-success)" : "var(--j-error)"}
        />
      </div>

      {/* Services */}
      <div style={cardStyle}>
        <h3 style={cardHeader}>Services</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {Object.entries(health.services).map(([name, status]) => {
            const isOk = status === "running";
            return (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: isOk ? "var(--j-success)" : "var(--j-error)",
                    display: "inline-block",
                  }}
                />
                <span style={{ color: "var(--j-text)", flex: 1 }}>{name}</span>
                <span
                  style={{
                    fontSize: "11px",
                    color: isOk ? "var(--j-success)" : "var(--j-error)",
                    textTransform: "uppercase",
                  }}
                >
                  {status}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Memory */}
      <div style={cardStyle}>
        <h3 style={cardHeader}>Memory</h3>
        <div style={{ marginBottom: "8px" }}>
          <div
            style={{
              height: "6px",
              background: "var(--j-bg)",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${memPercent}%`,
                background: parseInt(memPercent) > 80 ? "var(--j-error)" : "var(--j-accent)",
                borderRadius: "3px",
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--j-text-dim)" }}>
          <span>Heap: {formatBytes(health.memory.heapUsed)} / {formatBytes(health.memory.heapTotal)}</span>
          <span>RSS: {formatBytes(health.memory.rss)}</span>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "14px 16px",
        background: "var(--j-surface)",
        border: "1px solid var(--j-border)",
        borderRadius: "8px",
      }}
    >
      <div style={{ fontSize: "11px", color: "var(--j-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
        {label}
      </div>
      <div style={{ fontSize: "16px", fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: "16px",
  background: "var(--j-surface)",
  border: "1px solid var(--j-border)",
  borderRadius: "8px",
};

const cardHeader: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--j-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: "12px",
};

const loadingText: React.CSSProperties = { color: "var(--j-text-muted)", fontSize: "13px" };
