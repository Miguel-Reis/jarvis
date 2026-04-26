import React, { useState } from "react";
import { useApiData } from "../../hooks/useApi";

type DailyBreakdown = {
  date: string;
  activeMinutes: number;
  focusScore: number;
  contextSwitches: number;
  sessionCount: number;
};

type WeeklyReport = {
  weekStart: string;
  weekEnd: string;
  totalActiveMinutes: number;
  avgDailyMinutes: number;
  avgFocusScore: number;
  topApps: Array<{ app: string; minutes: number; percentage: number }>;
  dailyBreakdown: DailyBreakdown[];
  trends: { activeTime: string; focusScore: string; contextSwitches: string };
  aiInsights: string[];
};

type BehavioralInsight = {
  id: string;
  type: string;
  title: string;
  body: string;
  metric?: { name: string; current: number; previous: number; unit: string };
};

export function TrendsPanel() {
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split("T")[0];
  });

  const weeklyPath = `/api/awareness/report/weekly?weekStart=${weekStart}`;
  const insightsPath = `/api/awareness/insights?days=7`;
  const { data: weekly, loading: wLoading } = useApiData<WeeklyReport>(weeklyPath, [weekStart]);
  const { data: insights } = useApiData<BehavioralInsight[]>(insightsPath, []);

  const prevWeek = () => {
    const d = new Date(weekStart!);
    d.setDate(d.getDate() - 7);
    setWeekStart(d.toISOString().split("T")[0]);
  };

  const nextWeek = () => {
    const d = new Date(weekStart!);
    d.setDate(d.getDate() + 7);
    setWeekStart(d.toISOString().split("T")[0]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Week navigator */}
      <div style={cardStyle}>
        <div style={{ ...headerStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Weekly Trends</span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button onClick={prevWeek} style={navBtnStyle}>&larr;</button>
            <span style={{ fontSize: "12px", color: "var(--j-text-dim)" }}>
              {weekly ? `${weekly.weekStart} — ${weekly.weekEnd}` : weekStart}
            </span>
            <button onClick={nextWeek} style={navBtnStyle}>&rarr;</button>
          </div>
        </div>

        {wLoading && (
          <div style={{ padding: "16px", color: "var(--j-text-muted)", fontSize: "13px" }}>Loading weekly report...</div>
        )}

        {weekly && (
          <>
            {/* Stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", padding: "16px" }}>
              <StatCard
                label="Active Time"
                value={`${weekly.totalActiveMinutes}m`}
                sub={`avg ${weekly.avgDailyMinutes}m/day`}
                trend={weekly.trends.activeTime}
              />
              <StatCard
                label="Focus Score"
                value={`${weekly.avgFocusScore}`}
                sub="/100 avg"
                trend={weekly.trends.focusScore}
              />
              <StatCard
                label="Sessions"
                value={String(weekly.dailyBreakdown.reduce((s, d) => s + d.sessionCount, 0))}
                sub="this week"
              />
              <StatCard
                label="Ctx Switches"
                value={String(weekly.dailyBreakdown.reduce((s, d) => s + d.contextSwitches, 0))}
                sub="total"
                trend={weekly.trends.contextSwitches}
                invertTrend
              />
            </div>

            {/* Daily bar chart */}
            <div style={{ padding: "0 16px 16px" }}>
              <div style={{ fontSize: "12px", color: "var(--j-text-muted)", marginBottom: "8px" }}>Daily Activity</div>
              <div style={{ display: "flex", gap: "4px", alignItems: "flex-end", height: "100px" }}>
                {weekly.dailyBreakdown.map((d) => {
                  const maxMins = Math.max(...weekly.dailyBreakdown.map(x => x.activeMinutes), 1);
                  const pct = (d.activeMinutes / maxMins) * 100;
                  const dayLabel = new Date(d.date + "T12:00:00").toLocaleDateString([], { weekday: "short" });
                  return (
                    <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "10px", color: "var(--j-text-muted)" }}>{d.activeMinutes}m</span>
                      <div
                        style={{
                          width: "100%",
                          height: `${Math.max(pct, 2)}%`,
                          background: d.focusScore >= 60 ? "var(--j-accent)" : "rgba(0, 212, 255, 0.3)",
                          borderRadius: "3px 3px 0 0",
                          minHeight: "2px",
                        }}
                        title={`Focus: ${d.focusScore}/100, Switches: ${d.contextSwitches}`}
                      />
                      <span style={{ fontSize: "10px", color: "var(--j-text-dim)" }}>{dayLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top apps */}
            {weekly.topApps.length > 0 && (
              <div style={{ padding: "0 16px 16px" }}>
                <div style={{ fontSize: "12px", color: "var(--j-text-muted)", marginBottom: "8px" }}>Top Apps</div>
                {weekly.topApps.slice(0, 5).map(app => (
                  <div key={app.app} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "12px", color: "var(--j-text)", minWidth: "100px" }}>{app.app}</span>
                    <div style={{ flex: 1, height: "6px", background: "var(--j-border)", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ width: `${app.percentage}%`, height: "100%", background: "var(--j-accent)", borderRadius: "3px" }} />
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--j-text-muted)", minWidth: "40px", textAlign: "right" }}>
                      {app.minutes}m
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* AI Insights */}
            {weekly.aiInsights.length > 0 && (
              <div style={{ padding: "0 16px 16px" }}>
                <div style={{ fontSize: "12px", color: "var(--j-text-muted)", marginBottom: "8px" }}>Weekly Insights</div>
                {weekly.aiInsights.map((insight, i) => (
                  <div key={i} style={insightCardStyle}>
                    {insight}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Behavioral Insights */}
      {insights && insights.length > 0 && (
        <div style={cardStyle}>
          <div style={headerStyle}>Behavioral Insights (7-day)</div>
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {insights.map(ins => (
              <div key={ins.id} style={{ padding: "12px", background: "var(--j-bg)", borderRadius: "6px", border: "1px solid var(--j-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={pillStyle}>{ins.type.replace('_', ' ')}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--j-text)" }}>{ins.title}</span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--j-text-dim)" }}>{ins.body}</div>
                {ins.metric && (
                  <div style={{ marginTop: "8px", display: "flex", gap: "16px" }}>
                    <MetricDelta label="Current" value={ins.metric.current} unit={ins.metric.unit} />
                    <MetricDelta label="Previous" value={ins.metric.previous} unit={ins.metric.unit} />
                    <MetricDelta
                      label="Change"
                      value={ins.metric.current - ins.metric.previous}
                      unit={ins.metric.unit}
                      showSign
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, trend, invertTrend }: {
  label: string;
  value: string;
  sub: string;
  trend?: string;
  invertTrend?: boolean;
}) {
  const trendColor = !trend || trend === "stable"
    ? "var(--j-text-muted)"
    : (trend === "up") !== (invertTrend ?? false)
      ? "#4ade80"
      : "#f87171";
  const trendArrow = trend === "up" ? "\u2191" : trend === "down" ? "\u2193" : "";

  return (
    <div style={{ padding: "12px", background: "var(--j-bg)", borderRadius: "6px", border: "1px solid var(--j-border)" }}>
      <div style={{ fontSize: "11px", color: "var(--j-text-muted)", marginBottom: "4px" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
        <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--j-text)" }}>{value}</span>
        {trendArrow && <span style={{ fontSize: "14px", color: trendColor }}>{trendArrow}</span>}
      </div>
      <div style={{ fontSize: "11px", color: "var(--j-text-dim)", marginTop: "2px" }}>{sub}</div>
    </div>
  );
}

function MetricDelta({ label, value, unit, showSign }: {
  label: string;
  value: number;
  unit: string;
  showSign?: boolean;
}) {
  const color = showSign
    ? value > 0 ? "#4ade80" : value < 0 ? "#f87171" : "var(--j-text-dim)"
    : "var(--j-text)";
  const prefix = showSign && value > 0 ? "+" : "";

  return (
    <div>
      <div style={{ fontSize: "10px", color: "var(--j-text-muted)" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: 600, color }}>
        {prefix}{value}{unit}
      </div>
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

const navBtnStyle: React.CSSProperties = {
  background: "var(--j-bg)",
  border: "1px solid var(--j-border)",
  borderRadius: "4px",
  color: "var(--j-text)",
  fontSize: "12px",
  padding: "2px 8px",
  cursor: "pointer",
};

const pillStyle: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: "10px",
  background: "rgba(0, 212, 255, 0.1)",
  color: "var(--j-accent)",
  fontSize: "10px",
  fontWeight: 500,
  textTransform: "capitalize",
};

const insightCardStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "var(--j-bg)",
  borderRadius: "6px",
  border: "1px solid var(--j-border)",
  fontSize: "12px",
  color: "var(--j-text-dim)",
  lineHeight: "1.4",
  marginBottom: "6px",
};
