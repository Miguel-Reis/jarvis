import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useApiData, api } from "../hooks/useApi";
import { TaskModal } from "../components/mission/TaskModal";
import { useToast } from "../components/Toast";
import type { TaskEvent } from "../hooks/useWebSocket";
import "../styles/tasks.css";

type Commitment = {
  id: string;
  what: string;
  when_due: number | null;
  context: string | null;
  priority: string;
  status: string;
  assigned_to: string | null;
  created_from: string | null;
  created_at: number;
  completed_at: number | null;
  result: string | null;
  sort_order: number;
};

type Status = "pending" | "active" | "completed" | "failed" | "escalated";

const COLUMNS: { status: Status; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "active", label: "Active" },
  { status: "completed", label: "Completed" },
  { status: "failed", label: "Failed" },
  { status: "escalated", label: "Escalated" },
];

type Props = {
  taskEvents: TaskEvent[];
};

// ── Helpers ──

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDueDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(ts: number | null, status: string): boolean {
  if (!ts || status === "completed") return false;
  return ts < Date.now();
}

function getAssigneeLabel(name: string | null): string {
  if (!name) return "";
  if (name.toLowerCase() === "user" || name.toLowerCase() === "me") return "You";
  if (name.toLowerCase() === "jarvis") return "JARVIS";
  // Capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ── Main component ──

export default function TasksPage({ taskEvents }: Props) {
  const { showToast } = useToast();
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(new Set());
  const lastProcessedRef = useRef(0);

  const { data: fetchedTasks, loading, refetch } = useApiData<Commitment[]>(
    "/api/vault/commitments",
    [refreshKey]
  );
  const [localTasks, setLocalTasks] = useState<Commitment[]>([]);

  // Sync fetched tasks into local state
  useEffect(() => {
    if (fetchedTasks) setLocalTasks(fetchedTasks);
  }, [fetchedTasks]);

  // Process real-time task events
  useEffect(() => {
    if (!taskEvents || taskEvents.length === 0) return;
    const newEvents = taskEvents.filter((e) => e.timestamp > lastProcessedRef.current);
    if (newEvents.length === 0) return;

    lastProcessedRef.current = newEvents[newEvents.length - 1]!.timestamp;

    setLocalTasks((prev) => {
      let updated = [...prev];
      const newUpdatedIds = new Set<string>();

      for (const event of newEvents) {
        const { action, task } = event;
        const idx = updated.findIndex((t) => t.id === task.id);

        if (action === "created") {
          if (idx === -1) { updated.push(task); newUpdatedIds.add(task.id); }
        } else if (action === "updated") {
          if (idx !== -1) updated[idx] = task; else updated.push(task);
          newUpdatedIds.add(task.id);
        } else if (action === "deleted") {
          if (idx !== -1) updated.splice(idx, 1);
        }
      }

      if (newUpdatedIds.size > 0) {
        setRecentlyUpdated((prev) => new Set([...prev, ...newUpdatedIds]));
        setTimeout(() => {
          setRecentlyUpdated((prev) => {
            const next = new Set(prev);
            for (const id of newUpdatedIds) next.delete(id);
            return next;
          });
        }, 1500);
      }

      return updated;
    });
  }, [taskEvents]);

  // Filter tasks by search
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return localTasks;
    const q = searchQuery.toLowerCase();
    return localTasks.filter(
      (t) =>
        t.what.toLowerCase().includes(q) ||
        (t.context && t.context.toLowerCase().includes(q)) ||
        (t.assigned_to && t.assigned_to.toLowerCase().includes(q))
    );
  }, [localTasks, searchQuery]);

  // Group tasks by status
  const grouped = useMemo(() => {
    const map: Record<string, Commitment[]> = {};
    for (const col of COLUMNS) map[col.status] = [];
    for (const t of filteredTasks) {
      if (map[t.status]) map[t.status]!.push(t);
      else map["pending"]!.push(t);
    }
    return map;
  }, [filteredTasks]);

  // Stats
  const stats = useMemo(() => {
    const active = localTasks.filter((t) => t.status === "active").length;
    const completedToday = localTasks.filter((t) => {
      if (t.status !== "completed" || !t.completed_at) return false;
      const d = new Date(t.completed_at);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length;
    const overdue = localTasks.filter((t) => isOverdue(t.when_due, t.status)).length;

    // Avg completion time for completed tasks
    const completed = localTasks.filter((t) => t.status === "completed" && t.completed_at);
    let avgCompletion = "—";
    if (completed.length > 0) {
      const totalMs = completed.reduce((sum, t) => sum + (t.completed_at! - t.created_at), 0);
      const avgMs = totalMs / completed.length;
      const avgHours = avgMs / 3600000;
      avgCompletion = avgHours < 1 ? `${Math.round(avgHours * 60)}m` : `${avgHours.toFixed(1)}h`;
    }

    const agents = new Set(localTasks.filter((t) => t.status === "active" && t.assigned_to).map((t) => t.assigned_to));

    return { active, completedToday, overdue, avgCompletion, activeAgents: agents.size };
  }, [localTasks]);

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, taskId: string, fromStatus: string) => {
    e.dataTransfer.setData("taskId", taskId);
    e.dataTransfer.setData("fromStatus", fromStatus);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(status);
  };

  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  const handleDrop = async (e: React.DragEvent, toStatus: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const taskId = e.dataTransfer.getData("taskId");
    const fromStatus = e.dataTransfer.getData("fromStatus");
    if (!taskId || fromStatus === toStatus) return;

    // Optimistic update
    setLocalTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: toStatus } : t))
    );

    try {
      await api(`/api/vault/commitments/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: toStatus }),
      });
      refetch();
    } catch {
      showToast("Failed to update task status", "error");
      refetch(); // revert on failure
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    // Optimistic update
    setLocalTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status } : t))
    );
    try {
      await api(`/api/vault/commitments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      refetch();
    } catch {
      showToast("Failed to update task", "error");
      refetch();
    }
  };

  const handleFieldChange = useCallback(async (id: string, fields: { priority?: string; context?: string | null }) => {
    setLocalTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...fields } : t));
    try {
      await api(`/api/vault/commitments/${id}`, {
        method: "PATCH",
        body: JSON.stringify(fields),
      });
    } catch {
      showToast("Failed to update task", "error");
      refetch();
    }
  }, [refetch, showToast]);

  // CMD+N shortcut
  useEffect(() => {
    const handler = () => setModalOpen(true);
    window.addEventListener("jarvis:new-item", handler);
    return () => window.removeEventListener("jarvis:new-item", handler);
  }, []);

  const handleTaskCreated = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleExport = useCallback((format: "csv" | "json") => {
    const tasks = localTasks;
    let content: string;
    let mime: string;
    let filename: string;

    if (format === "json") {
      content = JSON.stringify(tasks, null, 2);
      mime = "application/json";
      filename = `tasks-${new Date().toISOString().slice(0, 10)}.json`;
    } else {
      const cols = ["id", "what", "status", "priority", "when_due", "assigned_to", "created_at", "completed_at", "context"];
      const escape = (v: unknown) => {
        const s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "number" && v > 1e12 ? new Date(v).toISOString() : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      const rows = tasks.map(t => cols.map(c => escape(t[c as keyof Commitment])).join(","));
      content = [cols.join(","), ...rows].join("\n");
      mime = "text/csv";
      filename = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }, [localTasks]);

  return (
    <div className="tk-page">
      {/* Atmosphere */}
      <div className="tk-atmosphere" />

      {/* Header */}
      <div className="tk-header">
        <div className="tk-header-left">
          <span className="tk-header-title">Tasks</span>
          <span className="tk-header-count">{localTasks.length}</span>
        </div>

        <div className="tk-header-spacer" />

        <div className="tk-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="tk-header-search"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ position: "relative", display: "inline-block" }}>
          <button
            className="tk-new-btn"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)" }}
            onClick={() => setExportOpen(v => !v)}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v7M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Export
          </button>
          {exportOpen && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#12121E", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", zIndex: 100, minWidth: "100px", overflow: "hidden" }}>
              <button onClick={() => { handleExport("csv"); setExportOpen(false); }} style={{ width: "100%", padding: "8px 14px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", cursor: "pointer", textAlign: "left" }}>CSV</button>
              <button onClick={() => { handleExport("json"); setExportOpen(false); }} style={{ width: "100%", padding: "8px 14px", background: "none", border: "none", color: "rgba(255,255,255,0.7)", fontSize: "12px", cursor: "pointer", textAlign: "left" }}>JSON</button>
            </div>
          )}
        </div>

        <button className="tk-new-btn" onClick={() => setModalOpen(true)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Task
        </button>
      </div>

      {/* Stats ribbon */}
      <div className="tk-stats-ribbon">
        <div className="tk-stat">
          <div className="tk-stat-label">Total Active</div>
          <div className="tk-stat-value" style={{ color: "#A78BFA" }}>{stats.active}</div>
          <div className="tk-stat-sub">across {stats.activeAgents} agent{stats.activeAgents !== 1 ? "s" : ""}</div>
        </div>
        <div className="tk-stat">
          <div className="tk-stat-label">Completed Today</div>
          <div className="tk-stat-value" style={{ color: "#34D399" }}>{stats.completedToday}</div>
          <div className="tk-stat-sub">tasks finished</div>
        </div>
        <div className="tk-stat">
          <div className="tk-stat-label">Overdue</div>
          <div className="tk-stat-value" style={{ color: "#FB7185" }}>{stats.overdue}</div>
          <div className="tk-stat-sub">past due date</div>
        </div>
        <div className="tk-stat">
          <div className="tk-stat-label">Avg Completion</div>
          <div className="tk-stat-value" style={{ color: "#22D3EE" }}>{stats.avgCompletion}</div>
          <div className="tk-stat-sub">time to complete</div>
        </div>
      </div>

      {/* Kanban columns */}
      {loading ? (
        <div className="tk-skeleton-board">
          {COLUMNS.map((col) => (
            <div key={col.status} className="tk-skeleton-col">
              <div className="tk-skeleton-col-head" />
              {[80, 60, 90].map((w, i) => (
                <div key={i} className="tk-skeleton-card" style={{ animationDelay: `${i * 0.1}s` }}>
                  <div className="tk-skeleton-line" style={{ width: `${w}%` }} />
                  <div className="tk-skeleton-line tiny" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="tk-kanban">
          {COLUMNS.map((col) => {
            const items = grouped[col.status] ?? [];
            const isDragOver = dragOverCol === col.status;

            return (
              <div
                key={col.status}
                className={`tk-column ${col.status}${isDragOver ? " drop-hover" : ""}`}
                onDragOver={(e) => handleDragOver(e, col.status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.status)}
              >
                {/* Column header with gravity well */}
                <div className="tk-col-header">
                  <div className="tk-gravity-well">
                    <div className="core" />
                    <div className="ring ring-1" />
                    <div className="ring ring-2" />
                  </div>
                  <div className="tk-col-label">{col.label}</div>
                  <div className="tk-col-count">{items.length}</div>
                </div>

                {/* Task cards */}
                <div className="tk-card-list">
                  {items.map((task, i) => (
                    <TaskCardGravity
                      key={task.id}
                      task={task}
                      index={i}
                      justUpdated={recentlyUpdated.has(task.id)}
                      onDragStart={handleDragStart}
                      onStatusChange={handleStatusChange}
                      onFieldChange={handleFieldChange}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className="tk-card-empty">
                      <div className="tk-empty-ring">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3 }}>
                          <circle cx="12" cy="12" r="10" />
                        </svg>
                      </div>
                      <p>Drop tasks here</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Task creation modal */}
      <TaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleTaskCreated}
      />
    </div>
  );
}

// ── Task Card (Gravity Wells style) ──

const PRIORITIES = ["low", "normal", "high", "critical"] as const;
const PRIORITY_COLORS: Record<string, string> = {
  low: "#6B7280",
  normal: "#8B5CF6",
  high: "#F59E0B",
  critical: "#EF4444",
};

function TaskCardGravity({
  task,
  index,
  justUpdated,
  onDragStart,
  onStatusChange,
  onFieldChange,
}: {
  task: Commitment;
  index: number;
  justUpdated: boolean;
  onDragStart: (e: React.DragEvent, taskId: string, fromStatus: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onFieldChange: (id: string, fields: { priority?: string; context?: string | null }) => void;
}) {
  const isDone = task.status === "completed" || task.status === "failed";
  const assigneeLabel = getAssigneeLabel(task.assigned_to);
  const overdue = isOverdue(task.when_due, task.status);

  const [priorityOpen, setPriorityOpen] = useState(false);
  const [editingContext, setEditingContext] = useState(false);
  const [contextVal, setContextVal] = useState(task.context ?? "");
  const contextRef = useRef<HTMLInputElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);

  // Sync context value if task changes externally
  useEffect(() => { setContextVal(task.context ?? ""); }, [task.context]);

  // Focus context input when opened
  useEffect(() => {
    if (editingContext) contextRef.current?.focus();
  }, [editingContext]);

  // Close priority dropdown on outside click
  useEffect(() => {
    if (!priorityOpen) return;
    const close = (e: MouseEvent) => {
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) {
        setPriorityOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [priorityOpen]);

  const handleContextBlur = () => {
    setEditingContext(false);
    const newVal = contextVal.trim() || null;
    if (newVal !== (task.context ?? null)) {
      onFieldChange(task.id, { context: newVal });
    }
  };

  const handleContextKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      contextRef.current?.blur();
    }
  };

  return (
    <div
      className={`tk-task-card${justUpdated ? " just-updated" : ""}${task.status === "completed" ? " completed" : ""}`}
      style={{ animationDelay: `${0.05 + index * 0.04}s` }}
      draggable
      onDragStart={(e) => onDragStart(e, task.id, task.status)}
    >
      <div className="tk-card-top">
        {/* Priority pip — click to change */}
        <div ref={priorityRef} style={{ position: "relative", flexShrink: 0 }}>
          <div
            className={`tk-priority-pip ${task.priority}`}
            style={{ cursor: isDone ? "default" : "pointer" }}
            title={`Priority: ${task.priority}${isDone ? "" : " — click to change"}`}
            onClick={(e) => { if (!isDone) { e.stopPropagation(); setPriorityOpen(v => !v); } }}
          />
          {priorityOpen && (
            <div className="tk-priority-menu">
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  className={`tk-priority-option${task.priority === p ? " active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPriorityOpen(false);
                    if (p !== task.priority) onFieldChange(task.id, { priority: p });
                  }}
                >
                  <span className="tk-priority-option-pip" style={{ background: PRIORITY_COLORS[p] }} />
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`tk-card-title${isDone ? " done" : ""}`}>{task.what}</div>
        {!isDone && (
          <div className="tk-card-actions">
            <button
              className="tk-card-action-btn complete"
              title="Complete"
              onClick={(e) => { e.stopPropagation(); onStatusChange(task.id, "completed"); }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20,6 9,17 4,12" />
              </svg>
            </button>
            <button
              className="tk-card-action-btn fail"
              title="Fail"
              onClick={(e) => { e.stopPropagation(); onStatusChange(task.id, "failed"); }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div className="tk-card-meta">
        {assigneeLabel && <span className="tk-meta-tag agent">{assigneeLabel}</span>}
        {task.when_due && (
          <span className={`tk-meta-tag due${overdue ? " overdue" : ""}`}>
            {overdue ? "Overdue · " : ""}{formatDueDate(task.when_due)}
          </span>
        )}

        {/* Context — click to edit inline */}
        {editingContext ? (
          <input
            ref={contextRef}
            className="tk-context-input"
            value={contextVal}
            onChange={(e) => setContextVal(e.target.value)}
            onBlur={handleContextBlur}
            onKeyDown={handleContextKey}
            placeholder="context..."
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="tk-meta-tag context"
            style={{ cursor: isDone ? "default" : "pointer", opacity: task.context ? 1 : 0.4 }}
            title={isDone ? undefined : "Click to edit context"}
            onClick={(e) => { if (!isDone) { e.stopPropagation(); setEditingContext(true); } }}
          >
            {task.context || (isDone ? null : "add context")}
          </span>
        )}

        {task.result && task.status === "completed" && (
          <span className="tk-meta-tag result-tag" title={task.result}>{task.result}</span>
        )}
        {task.result && task.status === "failed" && (
          <span className="tk-meta-tag error-tag" title={task.result}>{task.result}</span>
        )}
        <span className="tk-card-time">{timeAgo(task.created_at)}</span>
      </div>
    </div>
  );
}
