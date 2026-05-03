import React, { useState, useEffect, useCallback } from "react";
import type { GoalEvent } from "../hooks/useWebSocket";
import { GoalConstellation } from "../components/goals/GoalConstellation";
import { GoalTimeline } from "../components/goals/GoalTimeline";
import { GoalMetrics } from "../components/goals/GoalMetrics";
import { GoalDetail } from "../components/goals/GoalDetail";
import { GoalCreateModal } from "../components/goals/GoalCreateModal";
import "../styles/goals.css";

export type Goal = {
  id: string;
  parent_id: string | null;
  level: string;
  title: string;
  description: string;
  success_criteria: string;
  time_horizon: string;
  score: number;
  score_reason: string | null;
  status: string;
  health: string;
  deadline: number | null;
  started_at: number | null;
  estimated_hours: number | null;
  actual_hours: number;
  authority_level: number;
  tags: string[];
  dependencies: string[];
  escalation_stage: string;
  escalation_started_at: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type Tab = "constellation" | "timeline" | "metrics";

type Props = {
  goalEvents: GoalEvent[];
};

export default function GoalsPage({ goalEvents }: Props) {
  const [tab, setTab] = useState<Tab>("constellation");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createInitialText, setCreateInitialText] = useState("");
  const [showDailyActions, setShowDailyActions] = useState(false);
  const [showOverdue, setShowOverdue] = useState(false);
  const [overdueGoals, setOverdueGoals] = useState<Goal[]>([]);
  const [exportOpen, setExportOpen] = useState(false);

  const openCreate = (prefill = "") => {
    setCreateInitialText(prefill);
    setShowCreate(true);
  };

  useEffect(() => {
    const handler = () => openCreate();
    window.addEventListener("jarvis:new-item", handler);
    return () => window.removeEventListener("jarvis:new-item", handler);
  }, []);

  const fetchGoals = useCallback(async () => {
    try {
      const resp = await fetch("/api/goals?limit=200");
      if (resp.ok) {
        const data = await resp.json();
        setGoals(data);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);

  // Prefetch overdue count for badge
  useEffect(() => {
    fetch("/api/goals/overdue").then(r => r.ok ? r.json() : []).then(setOverdueGoals).catch(() => {});
  }, []);

  // Re-fetch on goal events
  useEffect(() => {
    if (goalEvents.length > 0) fetchGoals();
  }, [goalEvents.length, fetchGoals]);

  const handleSelect = (goal: Goal) => setSelectedGoal(goal);
  const handleClose = () => setSelectedGoal(null);

  const handleCreated = () => {
    setShowCreate(false);
    fetchGoals();
  };

  const handleUpdated = () => {
    fetchGoals();
    if (selectedGoal) {
      fetch(`/api/goals/${selectedGoal.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((g) => { if (g) setSelectedGoal(g); else setSelectedGoal(null); })
        .catch(() => setSelectedGoal(null));
    }
  };

  const activeCount = goals.filter((g) => g.status === "active").length;

  const handleExport = useCallback((format: "csv" | "json") => {
    const data = showOverdue ? overdueGoals : goals;
    let content: string;
    let mime: string;
    let filename: string;

    if (format === "json") {
      content = JSON.stringify(data, null, 2);
      mime = "application/json";
      filename = `goals-${new Date().toISOString().slice(0, 10)}.json`;
    } else {
      const cols = ["id", "title", "level", "status", "health", "score", "deadline", "time_horizon", "created_at"];
      const escape = (v: unknown) => {
        const s = v == null ? "" : typeof v === "number" && v > 1e12 ? new Date(v).toISOString() : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      const rows = data.map(g => cols.map(c => escape(g[c as keyof Goal])).join(","));
      content = [cols.join(","), ...rows].join("\n");
      mime = "text/csv";
      filename = `goals-${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  }, [goals, overdueGoals, showOverdue]);

  const handleToggleOverdue = useCallback(async () => {
    if (showOverdue) { setShowOverdue(false); return; }
    try {
      const resp = await fetch("/api/goals/overdue");
      if (resp.ok) setOverdueGoals(await resp.json());
    } catch { /* ignore */ }
    setShowOverdue(true);
  }, [showOverdue]);

  const displayGoals = showOverdue ? overdueGoals : goals;

  return (
    <div className="goals-page">
      {/* 3-layer atmosphere */}
      <div className="goals-atmos" aria-hidden="true">
        <div className="goals-atmos-aurora" />
        <div className="goals-atmos-dots" />
      </div>

      {/* Header — always rendered */}
      <header className="goals-header">
        {/* View tabs */}
        <nav className="goals-view-tabs" aria-label="Goal views">
          <button
            className={`goals-view-tab${tab === "constellation" ? " active" : ""}`}
            onClick={() => setTab("constellation")}
            aria-current={tab === "constellation" ? "page" : undefined}
          >
            Constellation
          </button>
          <button
            className={`goals-view-tab${tab === "timeline" ? " active" : ""}`}
            onClick={() => setTab("timeline")}
            aria-current={tab === "timeline" ? "page" : undefined}
          >
            Timeline
          </button>
          <button
            className={`goals-view-tab${tab === "metrics" ? " active" : ""}`}
            onClick={() => setTab("metrics")}
            aria-current={tab === "metrics" ? "page" : undefined}
          >
            Metrics
          </button>
        </nav>

        <div className="goals-spacer" />

        {/* Overdue filter */}
        <button
          className={`goals-search-btn${showOverdue ? " active" : ""}`}
          onClick={handleToggleOverdue}
          aria-label="Show overdue goals"
          title="Overdue goals"
          style={{ fontSize: "11px", padding: "0 10px", width: "auto", fontWeight: showOverdue ? 700 : 500, gap: "5px", color: showOverdue ? "#FB7185" : undefined, borderColor: showOverdue ? "rgba(251,113,133,0.35)" : undefined }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M5 2.5v3l1.5 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Overdue
          {overdueGoals.length > 0 && !showOverdue && (
            <span style={{ background: "rgba(251,113,133,0.2)", color: "#FB7185", borderRadius: "8px", padding: "0 4px", fontSize: "9px", fontWeight: 800 }}>{overdueGoals.length}</span>
          )}
        </button>

        {/* Search */}
        <button className="goals-search-btn" aria-label="Search goals" title="Search goals">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        {/* Daily plan */}
        <button
          className={`goals-search-btn${showDailyActions ? " active" : ""}`}
          onClick={() => setShowDailyActions((v) => !v)}
          aria-label="Toggle daily actions plan"
          title="Daily Plan"
          style={{ fontSize: "11px", padding: "0 10px", width: "auto", fontWeight: showDailyActions ? 700 : 500, gap: "5px" }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="1" y="2" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4 1v2M8 1v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M3 6h6M3 8.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Daily Plan
        </button>

        {/* Export */}
        <div style={{ position: "relative", display: "inline-block" }}>
          <button
            className="goals-search-btn"
            onClick={() => setExportOpen(v => !v)}
            title="Export goals"
            style={{ fontSize: "11px", padding: "0 10px", width: "auto", gap: "5px" }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M6 1v7M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Export
          </button>
          {exportOpen && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#12121E", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", zIndex: 100, minWidth: "100px", overflow: "hidden" }}>
              <button onClick={() => handleExport("csv")} style={{ width: "100%", padding: "8px 14px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", cursor: "pointer", textAlign: "left" }}>CSV</button>
              <button onClick={() => handleExport("json")} style={{ width: "100%", padding: "8px 14px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", cursor: "pointer", textAlign: "left" }}>JSON</button>
            </div>
          )}
        </div>

        {/* New goal */}
        <button
          className="goals-new-btn"
          onClick={() => openCreate()}
          aria-label="Create a new goal"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          New Goal
        </button>
      </header>

      {/* Content area */}
      {loading ? (
        <div className="goals-skeleton-grid" role="status" aria-label="Loading goals">
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} className="goals-skeleton-card" style={{ animationDelay: `${(i-1) * 0.08}s` }}>
              <div className="goals-skeleton-line" style={{ width: "70%" }} />
              <div className="goals-skeleton-line" style={{ width: "45%", height: "8px", marginTop: "4px" }} />
              <div className="goals-skeleton-bar" />
            </div>
          ))}
        </div>
      ) : goals.length === 0 ? (
        <EmptyState onCreateClick={openCreate} />
      ) : (
        <div className="goals-body">
          <div className="goals-content">
            {tab === "constellation" && (
              <GoalConstellation
                goals={displayGoals}
                onSelect={handleSelect}
                selectedGoalId={selectedGoal?.id}
              />
            )}
            {tab === "timeline" && (
              <GoalTimeline goals={displayGoals} onSelect={handleSelect} />
            )}
            {tab === "metrics" && (
              <GoalMetrics goals={displayGoals} />
            )}
          </div>

          {/* Detail panel */}
          {selectedGoal && (
            <GoalDetail
              goal={selectedGoal}
              onClose={handleClose}
              onUpdated={handleUpdated}
            />
          )}

          {/* Daily actions panel */}
          {showDailyActions && !selectedGoal && (
            <DailyActionsPanel onClose={() => setShowDailyActions(false)} onSelectGoal={(g) => { setSelectedGoal(g); setShowDailyActions(false); }} />
          )}
        </div>
      )}

      {/* Create modal overlay */}
      {showCreate && (
        <GoalCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          initialText={createInitialText}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------
   Empty state sub-component
   ---------------------------------------------------------------- */
type EmptyStateProps = {
  onCreateClick: (prefill?: string) => void;
};

function EmptyState({ onCreateClick }: EmptyStateProps) {
  const suggestions = [
    {
      label: "I want to launch a product",
      icon: (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path d="M5.5 1L6.8 4.2H10L7.4 6.2L8.5 9.5L5.5 7.8L2.5 9.5L3.6 6.2L1 4.2H4.2L5.5 1Z" fill="var(--violet-bright)" opacity="0.7" />
        </svg>
      ),
    },
    {
      label: "Get in shape this year",
      icon: (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <circle cx="5.5" cy="5.5" r="4" stroke="var(--blue)" strokeWidth="1.2" />
        </svg>
      ),
    },
    {
      label: "Learn a new skill",
      icon: (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="9" height="9" rx="2" stroke="var(--emerald)" strokeWidth="1.2" />
        </svg>
      ),
    },
    {
      label: "Hit Q2 targets",
      icon: (
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <line x1="1" y1="5.5" x2="10" y2="5.5" stroke="var(--amber)" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="5.5" y1="1" x2="5.5" y2="10" stroke="var(--amber)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <div className="goals-empty" role="status" aria-label="No goals yet">
      {/* Ghost orbit rings */}
      <div className="goals-empty-ring" style={{ width: 200, height: 200, animationDelay: "0s" }} aria-hidden="true" />
      <div className="goals-empty-ring" style={{ width: 340, height: 340, animationDelay: "1s", borderColor: "rgba(139,92,246,0.05)" }} aria-hidden="true" />
      <div className="goals-empty-ring" style={{ width: 500, height: 500, animationDelay: "2s", borderColor: "rgba(96,165,250,0.04)" }} aria-hidden="true" />

      {/* Hint dots */}
      <div className="goals-empty-hint-dot" style={{ top: "calc(50% - 80px)", left: "calc(50% + 60px)", animationDelay: "0s" }} aria-hidden="true" />
      <div className="goals-empty-hint-dot" style={{ top: "calc(50% + 40px)", left: "calc(50% - 90px)", animationDelay: "1s", background: "rgba(96,165,250,0.3)" }} aria-hidden="true" />
      <div className="goals-empty-hint-dot" style={{ top: "calc(50% - 50px)", left: "calc(50% - 110px)", animationDelay: "2s", background: "rgba(52,211,153,0.3)" }} aria-hidden="true" />
      <div className="goals-empty-hint-dot" style={{ top: "calc(50% + 90px)", left: "calc(50% + 80px)", animationDelay: "0.5s", background: "rgba(251,191,36,0.25)" }} aria-hidden="true" />

      {/* Central breathing orb */}
      <div className="goals-empty-orb" aria-hidden="true">
        <div className="goals-empty-orb-inner" />
      </div>

      <h2 className="goals-empty-title">No goals yet</h2>
      <p className="goals-empty-desc">
        Create your first goal to watch the constellation form.
      </p>

      <button className="goals-empty-cta" onClick={() => onCreateClick()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        + Create Goal
      </button>

      {/* Suggestion pills */}
      <div className="goals-empty-pills" role="list" aria-label="Goal suggestions">
        {suggestions.map(({ label, icon }) => (
          <button
            key={label}
            className="goals-empty-pill"
            onClick={() => onCreateClick(label)}
            role="listitem"
            aria-label={`Suggested goal: ${label}`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
   Daily Actions Panel
   ---------------------------------------------------------------- */
type DailyActionsPanelProps = {
  onClose: () => void;
  onSelectGoal: (goal: Goal) => void;
};

function DailyActionsPanel({ onClose, onSelectGoal }: DailyActionsPanelProps) {
  const [actions, setActions] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/goals/daily-actions")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setActions(data))
      .catch(() => setActions([]))
      .finally(() => setLoading(false));
  }, []);

  const healthColor = (health: string) => {
    if (health === "on_track") return "#34D399";
    if (health === "at_risk") return "#FBBF24";
    return "#FB7185";
  };

  return (
    <aside className="goal-detail-panel" aria-label="Daily actions plan">
      <div className="gdp-header">
        <div className="gdp-title-row">
          <span className="gdp-title">Daily Plan</span>
          <span className="gdp-subtitle">{loading ? "…" : `${actions.length} action${actions.length !== 1 ? "s" : ""} today`}</span>
        </div>
        <button className="gdp-close-btn" onClick={onClose} aria-label="Close daily plan" title="Close">×</button>
      </div>

      <div className="gdp-body" style={{ padding: "16px" }}>
        {loading ? (
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px", textAlign: "center", paddingTop: "32px" }}>Loading...</div>
        ) : actions.length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px", textAlign: "center", paddingTop: "32px", lineHeight: 1.6 }}>
            No daily actions scheduled.<br />
            Create goals with level "daily_action" to see them here.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {actions.map((action) => (
              <button
                key={action.id}
                onClick={() => onSelectGoal(action)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  transition: "background 150ms",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
              >
                <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: healthColor(action.health), flexShrink: 0, marginTop: "4px", boxShadow: `0 0 6px ${healthColor(action.health)}80` }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.88)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{action.title}</div>
                  {action.description && (
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.38)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{action.description}</div>
                  )}
                </div>
                <div style={{ fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px", background: `${healthColor(action.health)}20`, color: healthColor(action.health), flexShrink: 0 }}>
                  {Math.round(action.score * 10)}%
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
