import React, { useState, useEffect, useCallback } from "react";

type CheckResult = {
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
  message: string;
};

type DiagnosticsResult = {
  checks: CheckResult[];
  summary: { ok: number; warn: number; fail: number; skip: number };
};

type HealthData = {
  uptime: number;
  startedAt: number;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  database: { connected: boolean; size: number };
  services: Record<string, string>;
  dbIntegrity: string;
  sidecarConnected: boolean;
};

const STATUS_COLOR: Record<string, string> = {
  ok: "var(--j-success)",
  warn: "var(--j-warning)",
  fail: "var(--j-error)",
  skip: "var(--j-text-muted)",
};

const STATUS_ICON: Record<string, string> = {
  ok: "✓",
  warn: "!",
  fail: "✗",
  skip: "○",
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "var(--j-surface)",
      border: "1px solid var(--j-border-bright)",
      borderRadius: "12px",
      padding: "20px",
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--j-text-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "14px" }}>
      {children}
    </div>
  );
}

export function DiagnosticsPanel() {
  const [tab, setTab] = useState<"health" | "checks" | "reset">("health");
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [checks, setChecks] = useState<DiagnosticsResult | null>(null);
  const [checksRunning, setChecksRunning] = useState(false);
  const [checksError, setChecksError] = useState<string | null>(null);
  const [resetStatus, setResetStatus] = useState<"idle" | "confirming" | "running" | "done" | "error">("idle");
  const [resetMessage, setResetMessage] = useState("");

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/diagnostics/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth(await res.json());
      setHealthError(null);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (tab === "health") {
      fetchHealth();
      const interval = setInterval(fetchHealth, 15000);
      return () => clearInterval(interval);
    }
  }, [tab, fetchHealth]);

  async function runChecks() {
    setChecksRunning(true);
    setChecksError(null);
    try {
      const res = await fetch("/api/diagnostics/run", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setChecks(await res.json());
    } catch (err) {
      setChecksError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecksRunning(false);
    }
  }

  async function doReset() {
    setResetStatus("running");
    try {
      const res = await fetch("/api/system/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResetMessage(data.message ?? "Reset complete.");
      setResetStatus("done");
    } catch (err) {
      setResetMessage(err instanceof Error ? err.message : String(err));
      setResetStatus("error");
    }
  }

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "health", label: "System Health" },
    { key: "checks", label: "Run Checks" },
    { key: "reset", label: "Reset" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--j-border)", paddingBottom: "0" }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: "none",
              border: "none",
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: "13px",
              fontFamily: "inherit",
              fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? "var(--j-accent2)" : "var(--j-text-dim)",
              borderBottom: tab === t.key ? "2px solid var(--j-accent)" : "2px solid transparent",
              marginBottom: "-1px",
              transition: "all 150ms",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Health tab */}
      {tab === "health" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {healthError && (
            <div style={{ color: "var(--j-error)", fontSize: "13px", padding: "12px", background: "rgba(251,113,133,0.08)", borderRadius: "8px" }}>
              Error loading health: {healthError}
            </div>
          )}
          {health && (
            <>
              <Card>
                <SectionTitle>Overview</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
                  {[
                    { label: "Uptime", value: formatUptime(health.uptime) },
                    { label: "Started", value: new Date(health.startedAt).toLocaleTimeString() },
                    { label: "Heap Used", value: formatBytes(health.memory.heapUsed) },
                    { label: "RSS", value: formatBytes(health.memory.rss) },
                    { label: "DB Size", value: health.database.size > 0 ? formatBytes(health.database.size) : "—" },
                    { label: "DB Integrity", value: health.dbIntegrity },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: "rgba(255,255,255,0.02)", borderRadius: "8px", padding: "10px 12px" }}>
                      <div style={{ fontSize: "10px", color: "var(--j-text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--j-text)", marginTop: "4px" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <SectionTitle>Services</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {Object.entries(health.services).map(([name, status]) => (
                    <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "13px", color: "var(--j-text-dim)" }}>{name}</span>
                      <span style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: status === "running" ? "var(--j-success)" : status === "error" ? "var(--j-error)" : "var(--j-warning)",
                        background: status === "running" ? "rgba(52,211,153,0.1)" : status === "error" ? "rgba(251,113,133,0.1)" : "rgba(251,191,36,0.1)",
                        padding: "2px 8px",
                        borderRadius: "4px",
                      }}>
                        {status}
                      </span>
                    </div>
                  ))}
                  {Object.keys(health.services).length === 0 && (
                    <div style={{ fontSize: "13px", color: "var(--j-text-muted)" }}>No service data</div>
                  )}
                </div>
              </Card>

              <Card>
                <SectionTitle>Connectivity</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {[
                    { label: "Database", ok: health.database.connected },
                    { label: "Sidecar", ok: health.sidecarConnected },
                  ].map(({ label, ok }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: ok ? "var(--j-success)" : "var(--j-error)", flexShrink: 0 }} />
                      <span style={{ fontSize: "13px", color: "var(--j-text-dim)" }}>{label}</span>
                      <span style={{ fontSize: "12px", color: ok ? "var(--j-success)" : "var(--j-error)", marginLeft: "auto" }}>{ok ? "Connected" : "Offline"}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
          {!health && !healthError && (
            <div style={{ color: "var(--j-text-muted)", fontSize: "13px" }}>Loading...</div>
          )}
        </div>
      )}

      {/* Run Checks tab */}
      {tab === "checks" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <button
            onClick={runChecks}
            disabled={checksRunning}
            style={{
              alignSelf: "flex-start",
              padding: "10px 20px",
              background: checksRunning ? "rgba(139,92,246,0.15)" : "var(--j-accent)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: checksRunning ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              transition: "all 150ms",
            }}
          >
            {checksRunning ? "Running..." : checks ? "Re-run Checks" : "Run Diagnostics"}
          </button>

          {checksError && (
            <div style={{ color: "var(--j-error)", fontSize: "13px", padding: "12px", background: "rgba(251,113,133,0.08)", borderRadius: "8px" }}>
              {checksError}
            </div>
          )}

          {checks && (
            <Card>
              <div style={{ display: "flex", gap: "16px", marginBottom: "16px", fontSize: "12px" }}>
                {[
                  { label: "Passed", count: checks.summary.ok, color: "var(--j-success)" },
                  { label: "Warnings", count: checks.summary.warn, color: "var(--j-warning)" },
                  { label: "Failed", count: checks.summary.fail, color: "var(--j-error)" },
                  { label: "Skipped", count: checks.summary.skip, color: "var(--j-text-muted)" },
                ].map(({ label, count, color }) => (
                  <span key={label} style={{ color }}>{count} {label}</span>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                {checks.checks.map((check) => (
                  <div key={check.name} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "8px 0",
                    borderBottom: "1px solid var(--j-border)",
                  }}>
                    <span style={{ width: "16px", textAlign: "center", fontSize: "13px", color: STATUS_COLOR[check.status], fontWeight: 700, flexShrink: 0 }}>
                      {STATUS_ICON[check.status]}
                    </span>
                    <span style={{ fontSize: "13px", color: "var(--j-text)", width: "140px", flexShrink: 0 }}>{check.name}</span>
                    <span style={{ fontSize: "12px", color: "var(--j-text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{check.message}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Reset tab */}
      {tab === "reset" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <Card>
            <SectionTitle>Flush Agent Memory</SectionTitle>
            <p style={{ fontSize: "13px", color: "var(--j-text-dim)", marginBottom: "16px", lineHeight: 1.6 }}>
              Clears the in-memory conversation history, flushes completed tasks, and revokes all temporary tool permissions.
              Your vault data (messages, goals, knowledge) is <strong style={{ color: "var(--j-text)" }}>not deleted</strong>.
              Use this when the AI is behaving strangely or stuck in a loop.
            </p>

            {resetStatus === "idle" && (
              <button
                onClick={() => setResetStatus("confirming")}
                style={{
                  padding: "10px 20px",
                  background: "rgba(251,113,133,0.12)",
                  color: "var(--j-error)",
                  border: "1px solid rgba(251,113,133,0.25)",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 150ms",
                }}
              >
                Flush Agent Memory
              </button>
            )}

            {resetStatus === "confirming" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <p style={{ fontSize: "13px", color: "var(--j-warning)", fontWeight: 600 }}>
                  Confirm: this will reset the active AI session. The current context will be lost.
                </p>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    onClick={doReset}
                    style={{ padding: "8px 18px", background: "var(--j-error)", color: "white", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Yes, Reset
                  </button>
                  <button
                    onClick={() => setResetStatus("idle")}
                    style={{ padding: "8px 18px", background: "rgba(255,255,255,0.05)", color: "var(--j-text-dim)", border: "1px solid var(--j-border)", borderRadius: "8px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {resetStatus === "running" && (
              <div style={{ fontSize: "13px", color: "var(--j-text-muted)" }}>Resetting...</div>
            )}

            {resetStatus === "done" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "13px", color: "var(--j-success)", fontWeight: 600 }}>
                  ✓ {resetMessage}
                </div>
                <button
                  onClick={() => setResetStatus("idle")}
                  style={{ alignSelf: "flex-start", padding: "8px 14px", background: "rgba(255,255,255,0.05)", color: "var(--j-text-dim)", border: "1px solid var(--j-border)", borderRadius: "8px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {resetStatus === "error" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "13px", color: "var(--j-error)" }}>
                  Error: {resetMessage}
                </div>
                <button
                  onClick={() => setResetStatus("idle")}
                  style={{ alignSelf: "flex-start", padding: "8px 14px", background: "rgba(255,255,255,0.05)", color: "var(--j-text-dim)", border: "1px solid var(--j-border)", borderRadius: "8px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
                >
                  Try Again
                </button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
