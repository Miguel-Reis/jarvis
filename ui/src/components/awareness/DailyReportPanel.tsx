import React, { useState } from "react";
import { useApiData } from "../../hooks/useApi";

type DailyReport = {
  date: string;
  totalActiveMinutes: number;
  appBreakdown: Array<{ app: string; minutes: number; percentage: number; captureCount: number }>;
  sessionCount: number;
  sessions: Array<{ topic: string | null; durationMinutes: number; apps: string[] }>;
  focusScore: number;
  contextSwitches: number;
  longestFocusMinutes: number;
  suggestions: { total: number; actedOn: number };
  aiTakeaways: string[];
};

export function DailyReportPanel() {
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const { data, loading, error } = useApiData<DailyReport>(`/api/awareness/report?date=${date}`, [date]);

  return (
    <div style={cardStyle}>
      <div style={{ ...headerStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Daily Report</span>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={dateInputStyle}
        />
      </div>

      {loading && (
        <div style={{ padding: "16px", color: "var(--j-text-muted)", fontSize: "13px" }}>
          Generating report...
        </div>
      )}

      {error && (
        <div style={{ padding: "16px", color: "#ff4444", fontSize: "13px" }}>{error}</div>
      )}

      {data && !loading && (
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Score cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
            <ScoreCard label="Active Time" value={`${data.totalActiveMinutes}m`} />
            <ScoreCard label="Focus Score" value={`${data.focusScore}`} accent={data.focusScore >= 70} />
            <ScoreCard label="Switches" value={`${data.contextSwitches}`} />
            <ScoreCard label="Longest Focus" value={`${data.longestFocusMinutes}m`} />
          </div>

          {/* App breakdown */}
          {data.appBreakdown.length > 0 && (
            <div>
              <div style={sectionTitle}>App Usage</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {data.appBreakdown.slice(0, 8).map(app => (
                  <div key={app.app} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "80px", fontSize: "12px", color: "var(--j-text)" }}>{app.app}</div>
                    <div style={{ flex: 1, height: "16px", background: "var(--j-bg)", borderRadius: "8px", overflow: "hidden" }}>
                      <div style={{
                        width: `${app.percentage}%`,
                        height: "100%",
                        background: "var(--j-accent)",
                        borderRadius: "8px",
                        opacity: 0.7,
                      }} />
                    </div>
                    <div style={{ width: "50px", fontSize: "11px", color: "var(--j-text-muted)", textAlign: "right" }}>
                      {app.minutes}m ({app.percentage}%)
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sessions */}
          {data.sessions.length > 0 && (
            <div>
              <div style={sectionTitle}>Sessions ({data.sessionCount})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {data.sessions.slice(0, 10).map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                    <span style={{ color: "var(--j-text)" }}>{s.topic || "Unnamed"}</span>
                    <span style={{ color: "var(--j-text-muted)" }}>{s.durationMinutes}m</span>
                    <span style={{ color: "var(--j-text-dim)", marginLeft: "auto" }}>{s.apps.join(", ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Takeaways */}
          {data.aiTakeaways.length > 0 && (
            <div>
              <div style={sectionTitle}>AI Takeaways</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {data.aiTakeaways.map((t, i) => (
                  <div key={i} style={{
                    fontSize: "12px",
                    color: "var(--j-text)",
                    padding: "8px 12px",
                    background: "rgba(0, 212, 255, 0.05)",
                    borderRadius: "6px",
                    borderLeft: "2px solid var(--j-accent)",
                  }}>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggestion stats */}
          <div style={{ fontSize: "12px", color: "var(--j-text-muted)", paddingTop: "8px", borderTop: "1px solid var(--j-border)" }}>
            Suggestions: {data.suggestions.total} generated, {data.suggestions.actedOn} acted on
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      padding: "12px",
      background: "var(--j-bg)",
      borderRadius: "6px",
      textAlign: "center",
    }}>
      <div style={{
        fontSize: "20px",
        fontWeight: 700,
        color: accent ? "var(--j-accent)" : "var(--j-text)",
      }}>
        {value}
      </div>
      <div style={{ fontSize: "11px", color: "var(--j-text-muted)", marginTop: "2px" }}>{label}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--j-surface)",
  border: "1px solid var(--j-border)",
  borderRadius: "8px",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--j-text)",
  borderBottom: "1px solid var(--j-border)",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--j-text)",
  marginBottom: "8px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const dateInputStyle: React.CSSProperties = {
  background: "var(--j-bg)",
  border: "1px solid var(--j-border)",
  borderRadius: "4px",
  color: "var(--j-text)",
  fontSize: "12px",
  padding: "4px 8px",
};
