import React from "react";

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
};

type Props = {
  task: Commitment;
  kanban?: boolean;
  justUpdated?: boolean;
  onMove?: (direction: "up" | "down") => void;
  onStatusChange?: (status: string) => void;
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "var(--j-error)",
  high: "var(--j-warning)",
  normal: "var(--j-accent)",
  low: "var(--j-text-muted)",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--j-warning)",
  active: "var(--j-accent)",
  completed: "var(--j-success)",
  failed: "var(--j-error)",
  escalated: "#e879f9",
};

const ASSIGNEE_COLORS: Record<string, string> = {
  jarvis: "var(--j-accent)",
  user: "var(--j-accent2)",
};

function getAssigneeColor(name: string): string {
  const lower = name.toLowerCase();
  if (ASSIGNEE_COLORS[lower]) return ASSIGNEE_COLORS[lower];
  // Generate a consistent color from the name
  let hash = 0;
  for (let i = 0; i < lower.length; i++) {
    hash = lower.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 55%)`;
}

function getAssigneeLabel(name: string | null, createdFrom: string | null): string {
  if (!name) return "Unassigned";
  if (name.toLowerCase() === "user" || name.toLowerCase() === "me") return "You";
  if (name.toLowerCase() === "jarvis") return "JARVIS";
  return name;
}

export function TaskCard({ task, kanban, justUpdated, onMove, onStatusChange }: Props) {
  const isDone = task.status === "completed" || task.status === "failed";
  const assigneeLabel = getAssigneeLabel(task.assigned_to, task.created_from);
  const assigneeColor = task.assigned_to
    ? getAssigneeColor(task.assigned_to)
    : "var(--j-text-muted)";

  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--j-surface)",
        border: justUpdated
          ? "1px solid var(--j-accent)"
          : "1px solid var(--j-border)",
        borderRadius: "8px",
        opacity: isDone ? 0.7 : 1,
        transition: "border-color 0.3s ease, box-shadow 0.3s ease",
        boxShadow: justUpdated ? "0 0 12px rgba(0, 212, 255, 0.2)" : "none",
        animation: justUpdated ? "taskPulse 1.5s ease-out" : "none",
      }}
    >
      {/* Header: priority + assignee */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
        <span
          style={{
            padding: "1px 6px",
            borderRadius: "3px",
            background: `${PRIORITY_COLORS[task.priority] ?? "var(--j-text-muted)"}20`,
            color: PRIORITY_COLORS[task.priority] ?? "var(--j-text-muted)",
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          {task.priority}
        </span>
        {!kanban && (
          <span
            style={{
              padding: "1px 6px",
              borderRadius: "3px",
              background: `${STATUS_COLORS[task.status] ?? "var(--j-text-muted)"}20`,
              color: STATUS_COLORS[task.status] ?? "var(--j-text-muted)",
              fontSize: "10px",
              fontWeight: 500,
              textTransform: "uppercase",
            }}
          >
            {task.status}
          </span>
        )}

        {/* Assignee badge */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <span
            style={{
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              background: `${assigneeColor}30`,
              border: `1px solid ${assigneeColor}60`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "8px",
              fontWeight: 700,
              color: assigneeColor,
              flexShrink: 0,
            }}
          >
            {assigneeLabel[0]!.toUpperCase()}
          </span>
          <span
            style={{
              fontSize: "10px",
              color: task.assigned_to ? assigneeColor : "var(--j-text-muted)",
              fontWeight: task.assigned_to ? 500 : 400,
            }}
          >
            {assigneeLabel}
          </span>
        </div>
      </div>

      {/* What */}
      <div style={{ fontSize: "13px", color: "var(--j-text)", lineHeight: "1.4", marginBottom: "6px" }}>
        {task.what}
      </div>

      {/* Due date + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" }}>
        {task.when_due && (
          <span style={{ color: "var(--j-text-muted)" }}>
            Due: {new Date(task.when_due).toLocaleString()}
          </span>
        )}

        {task.created_from && (
          <span style={{ color: "var(--j-text-muted)", fontSize: "10px" }}>
            via {task.created_from}
          </span>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
          {!isDone && onStatusChange && (
            <>
              <SmallButton label={"\u2713"} color="var(--j-success)" onClick={() => onStatusChange("completed")} />
              <SmallButton label={"\u2717"} color="var(--j-error)" onClick={() => onStatusChange("failed")} />
            </>
          )}
          {!kanban && onMove && (
            <>
              <SmallButton label={"\u25B2"} color="var(--j-text-dim)" onClick={() => onMove("up")} />
              <SmallButton label={"\u25BC"} color="var(--j-text-dim)" onClick={() => onMove("down")} />
            </>
          )}
        </div>
      </div>

      {/* Result */}
      {task.result && (
        <div
          style={{
            marginTop: "6px",
            padding: "6px 8px",
            background: "var(--j-bg)",
            borderRadius: "4px",
            fontSize: "11px",
            color: "var(--j-text-dim)",
            maxHeight: "60px",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {task.result}
        </div>
      )}
    </div>
  );
}

function SmallButton({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        padding: "2px 6px",
        borderRadius: "4px",
        border: `1px solid ${color}40`,
        background: "transparent",
        color,
        cursor: "pointer",
        fontSize: "11px",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}
