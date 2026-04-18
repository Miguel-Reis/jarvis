import React, { useState, useCallback, useEffect, useMemo } from "react";
import type { WorkflowEvent } from "../hooks/useWebSocket";
import { useApiData, api } from "../hooks/useApi";
import { useToast } from "../components/Toast";
import WorkflowList from "../components/workflows/WorkflowList";
import WorkflowCanvas from "../components/workflows/WorkflowCanvas";
import "../styles/workflows.css";

type WorkflowSuggestion = {
  id: string;
  title: string;
  description: string;
  confidence: number;
  category: string;
  patternEvidence: string[];
};

export type Workflow = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  current_version: number;
  execution_count: number;
  last_executed_at: number | null;
  last_success_at: number | null;
  last_failure_at: number | null;
  created_at: number;
  updated_at: number;
};

type WorkflowDefinition = {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    position: { x: number; y: number };
    config: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    label?: string;
  }>;
  settings: Record<string, unknown>;
};

type VersionEntry = {
  id: string;
  workflow_id: string;
  version: number;
  definition: WorkflowDefinition;
  changelog: string | null;
  created_at: number;
};

type Filter = "all" | "active" | "paused" | "disabled";

export default function WorkflowsPage({
  workflowEvents,
  sendMessage,
}: {
  workflowEvents: WorkflowEvent[];
  sendMessage: (text: string) => void;
}) {
  const { showToast } = useToast();
  const [view, setView] = useState<"list" | "canvas">("list");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importYaml, setImportYaml] = useState("");
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [defMap, setDefMap] = useState<Map<string, WorkflowDefinition>>(new Map());
  const [suggestions, setSuggestions] = useState<WorkflowSuggestion[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("wf-dismissed-suggestions") ?? "[]")); } catch { return new Set(); }
  });
  const { data: workflows, loading, refetch } = useApiData<Workflow[]>("/api/workflows");

  // Fetch definitions for mini preview chain on cards
  useEffect(() => {
    if (!workflows || workflows.length === 0) return;
    const fetchDefs = async () => {
      const entries = await Promise.allSettled(
        workflows.map(wf =>
          fetch(`/api/workflows/${wf.id}/versions`)
            .then(r => r.ok ? r.json() as Promise<VersionEntry[]> : [])
            .then(versions => [wf.id, versions[0]?.definition] as const)
        )
      );
      const map = new Map<string, WorkflowDefinition>();
      for (const entry of entries) {
        if (entry.status === "fulfilled" && entry.value[1]) {
          map.set(entry.value[0], entry.value[1]);
        }
      }
      setDefMap(map);
    };
    fetchDefs();
  }, [workflows]);

  // Filter + search
  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    let list = workflows;

    if (filter !== "all") {
      list = list.filter(wf => {
        if (filter === "active") return wf.enabled;
        if (filter === "paused" || filter === "disabled") return !wf.enabled;
        return true;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(wf =>
        wf.name.toLowerCase().includes(q) ||
        wf.description.toLowerCase().includes(q) ||
        wf.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    return list;
  }, [workflows, filter, search]);

  // Stats
  const stats = useMemo(() => {
    if (!workflows) return { total: 0, active: 0, paused: 0, executions: 0 };
    return {
      total: workflows.length,
      active: workflows.filter(w => w.enabled).length,
      paused: workflows.filter(w => !w.enabled).length,
      executions: workflows.reduce((sum, w) => sum + w.execution_count, 0),
    };
  }, [workflows]);

  const handleSelect = useCallback((id: string) => {
    setSelectedWorkflowId(id);
    setView("canvas");
  }, []);

  // Fetch workflow suggestions on mount
  useEffect(() => {
    fetch("/api/workflows/suggest")
      .then(r => r.ok ? r.json() as Promise<WorkflowSuggestion[]> : [])
      .then(data => setSuggestions(data))
      .catch(() => {});
  }, []);

  const handleDismissSuggestion = useCallback(async (id: string) => {
    try { await fetch(`/api/workflows/suggest/${id}/dismiss`, { method: "POST" }); } catch {}
    setDismissedSuggestions(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem("wf-dismissed-suggestions", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const handleCreateFromSuggestion = useCallback(async (s: WorkflowSuggestion) => {
    try {
      const wf = await api<Workflow>("/api/workflows", {
        method: "POST",
        body: JSON.stringify({ name: s.title, description: s.description }),
      });
      handleDismissSuggestion(s.id);
      handleSelect(wf.id);
    } catch {
      showToast("Failed to create workflow from suggestion", "error");
    }
  }, [showToast, handleSelect, handleDismissSuggestion]);

  const visibleSuggestions = useMemo(
    () => suggestions.filter(s => !dismissedSuggestions.has(s.id)),
    [suggestions, dismissedSuggestions]
  );

  const handleBack = useCallback(() => {
    setView("list");
    setSelectedWorkflowId(null);
    refetch();
  }, [refetch]);

  const handleImport = useCallback(async () => {
    if (!importYaml.trim()) return;
    setImporting(true);
    try {
      const wf = await api<Workflow>("/api/workflows/import", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: importYaml,
      });
      setImportYaml("");
      setShowImport(false);
      showToast(`Imported "${wf.name}"`, "success");
      handleSelect(wf.id);
    } catch {
      showToast("Failed to import workflow — check YAML syntax", "error");
    } finally {
      setImporting(false);
    }
  }, [importYaml, showToast]);

  const handleCreate = useCallback(async () => {
    const name = prompt("Workflow name:");
    if (!name) return;
    try {
      const wf = await api<Workflow>("/api/workflows", {
        method: "POST",
        body: JSON.stringify({
          name,
          definition: {
            nodes: [{
              id: "trigger-1",
              type: "trigger.manual",
              label: "Manual Trigger",
              position: { x: 100, y: 200 },
              config: {},
            }],
            edges: [],
            settings: {
              maxRetries: 3,
              retryDelayMs: 5000,
              timeoutMs: 300000,
              parallelism: "parallel",
              onError: "stop",
            },
          },
        }),
      });
      handleSelect(wf.id);
    } catch (err) {
      console.error("Failed to create workflow:", err);
    }
  }, [handleSelect]);

  // CMD+N shortcut
  useEffect(() => {
    const handler = () => handleCreate();
    window.addEventListener("jarvis:new-item", handler);
    return () => window.removeEventListener("jarvis:new-item", handler);
  }, [handleCreate]);

  const selectedWorkflow = workflows?.find(w => w.id === selectedWorkflowId);

  // ── Canvas View ──
  if (view === "canvas" && selectedWorkflowId) {
    return (
      <div className="wf-page">
        <div className="wf-canvas-header">
          <button className="wf-back-btn" onClick={handleBack}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
          <div className="wf-canvas-divider" />
          <div className="wf-canvas-title">{selectedWorkflow?.name ?? "Workflow"}</div>
          <div className={`wf-canvas-badge ${selectedWorkflow?.enabled ? "active" : "disabled"}`}>
            {selectedWorkflow?.enabled ? "Active" : "Disabled"}
          </div>
          <div className="wf-canvas-spacer" />
          <div className="wf-canvas-actions">
            <button className="wf-canvas-btn">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v4l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              v{selectedWorkflow?.current_version ?? 1}
            </button>
            <button
              className="wf-canvas-btn"
              onClick={async () => {
                if (!selectedWorkflowId) return;
                try {
                  await api(`/api/workflows/${selectedWorkflowId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ enabled: !selectedWorkflow?.enabled }),
                  });
                  refetch();
                } catch (err) {
                  console.error("Failed to toggle:", err);
                }
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="1.5" y="1" width="2.5" height="8" rx="0.5" fill="currentColor"/>
                <rect x="6" y="1" width="2.5" height="8" rx="0.5" fill="currentColor"/>
              </svg>
              {selectedWorkflow?.enabled ? "Pause" : "Enable"}
            </button>
            <button
              className="wf-canvas-btn primary"
              onClick={async () => {
                try {
                  await api(`/api/workflows/${selectedWorkflowId}/execute`, { method: "POST", body: "{}" });
                } catch (err) {
                  console.error("Failed to run:", err);
                }
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 1l7 4-7 4V1z" fill="currentColor"/>
              </svg>
              Run Now
            </button>
          </div>
        </div>
        <WorkflowCanvas
          workflowId={selectedWorkflowId}
          workflowEvents={workflowEvents}
          sendMessage={sendMessage}
        />
      </div>
    );
  }

  // ── List View ──
  return (
    <div className="wf-page">
      {/* Header */}
      <div className="wf-header">
        <div className="wf-header-title">Workflows</div>
        <div className="wf-header-count">{stats.total}</div>
        <div className="wf-header-spacer" />
        <div className="wf-search-wrap">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            className="wf-search"
            placeholder="Search workflows..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button
          className={`wf-filter-btn${filter !== "all" ? " active" : ""}`}
          onClick={() => setFilter(f => f === "all" ? "active" : f === "active" ? "paused" : "all")}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 2h10M3 6h6M5 10h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          {filter === "all" ? "Filter" : filter.charAt(0).toUpperCase() + filter.slice(1)}
        </button>
        <button
          className="wf-filter-btn"
          onClick={() => setShowImport(v => !v)}
          title="Import workflow from YAML"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v7M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Import
        </button>
        <button className="wf-new-btn" onClick={handleCreate}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          New Workflow
        </button>
      </div>

      {/* Import YAML modal */}
      {showImport && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowImport(false)}>
          <div style={{
            background: "#0E0E18", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "14px",
            width: "520px", maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>Import Workflow YAML</span>
              <button onClick={() => setShowImport(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", fontSize: "20px", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: "16px 18px" }}>
              <textarea
                style={{
                  width: "100%", boxSizing: "border-box", height: "220px",
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px", padding: "10px 12px", fontSize: "12px", fontFamily: "monospace",
                  color: "rgba(255,255,255,0.88)", resize: "vertical", outline: "none",
                }}
                placeholder="Paste workflow YAML here..."
                value={importYaml}
                onChange={e => setImportYaml(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", padding: "0 18px 16px" }}>
              <button onClick={() => setShowImport(false)} style={{ padding: "7px 14px", borderRadius: "7px", fontSize: "12px", background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", cursor: "pointer" }}>Cancel</button>
              <button
                onClick={handleImport}
                disabled={importing || !importYaml.trim()}
                style={{ padding: "7px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 700, background: "rgba(139,92,246,0.25)", border: "1px solid rgba(139,92,246,0.4)", color: "#A78BFA", cursor: "pointer", opacity: importing || !importYaml.trim() ? 0.4 : 1 }}
              >
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="wf-stats-bar">
        <div className="wf-stat-card">
          <div className="wf-stat-label">Total Workflows</div>
          <div className="wf-stat-value violet">{stats.total}</div>
          <div className="wf-stat-sub">
            {stats.active} active · {stats.paused} paused
          </div>
        </div>
        <div className="wf-stat-card">
          <div className="wf-stat-label">Total Executions</div>
          <div className="wf-stat-value emerald">{stats.executions.toLocaleString()}</div>
          <div className="wf-stat-sub">across all workflows</div>
        </div>
        <div className="wf-stat-card">
          <div className="wf-stat-label">Active</div>
          <div className="wf-stat-value blue">{stats.active}</div>
          <div className="wf-stat-sub">{stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0}% of total</div>
        </div>
        <div className="wf-stat-card">
          <div className="wf-stat-label">Recent Events</div>
          <div className="wf-stat-value amber">{workflowEvents.length}</div>
          <div className="wf-stat-sub">this session</div>
        </div>
      </div>

      {/* Suggestions Panel */}
      {visibleSuggestions.length > 0 && (
        <div style={{ padding: "0 20px 4px" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>
            Suggested for you
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {visibleSuggestions.slice(0, 3).map(s => (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "10px 14px", borderRadius: "10px",
                background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.18)",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.88)", marginBottom: "2px" }}>{s.title}</div>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(139,92,246,0.15)", color: "#A78BFA", fontWeight: 600 }}>
                    {Math.round(s.confidence * 100)}%
                  </span>
                  <button
                    onClick={() => handleCreateFromSuggestion(s)}
                    style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600, background: "rgba(139,92,246,0.2)", border: "1px solid rgba(139,92,246,0.35)", color: "#A78BFA", cursor: "pointer" }}
                  >
                    Create
                  </button>
                  <button
                    onClick={() => handleDismissSuggestion(s.id)}
                    style={{ padding: "4px 8px", borderRadius: "6px", fontSize: "11px", background: "none", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)", cursor: "pointer" }}
                    title="Dismiss"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <WorkflowList
        workflows={filteredWorkflows}
        loading={loading}
        onSelect={handleSelect}
        onRefetch={refetch}
        onCreate={handleCreate}
        workflowEvents={workflowEvents}
        definitionMap={defMap}
      />
    </div>
  );
}
