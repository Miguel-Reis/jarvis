import React from "react";

export type CalendarEvent = {
  id: string;
  type: "commitment" | "content";
  title: string;
  timestamp: number;
  status: string;
  priority?: string;
  content_type?: string;
  stage?: string;
  assigned_to?: string;
  has_due_date?: boolean;
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "var(--j-error)",
  high: "#f472b6",
  normal: "var(--j-accent)",
  low: "var(--j-text-muted)",
};

type Props = {
  event: CalendarEvent;
  compact?: boolean;
};

export function CalendarEventBadge({ event, compact }: Props) {
  const isCommitment = event.type === "commitment";
  const color = isCommitment
    ? PRIORITY_COLORS[event.priority || "normal"] || "var(--j-accent)"
    : "#fbbf24";

  const time = new Date(event.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (compact) {
    return (
      <div
        style={{
          fontSize: "10px",
          padding: "1px 5px",
          borderRadius: "3px",
          background: `${color}20`,
          color,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.5,
          border: `1px solid ${color}40`,
        }}
        title={`${time} — ${event.title}`}
      >
        {event.title}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "10px 14px",
        borderRadius: "8px",
        background: "var(--j-surface)",
        border: `1px solid ${color}40`,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "4px",
          }}
        >
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color,
              background: `${color}18`,
              padding: "2px 6px",
              borderRadius: "4px",
            }}
          >
            {isCommitment ? "Task" : event.content_type || "Content"}
          </span>
          <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
            {event.has_due_date === false ? "no due date" : time}
          </span>
          {isCommitment && event.priority && event.priority !== "normal" && (
            <span
              style={{
                fontSize: "10px",
                color: PRIORITY_COLORS[event.priority] || "var(--j-text-muted)",
                fontWeight: 600,
              }}
            >
              {event.priority}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: "var(--j-text)",
            lineHeight: 1.4,
          }}
        >
          {event.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "4px",
            fontSize: "11px",
            color: "var(--j-text-muted)",
          }}
        >
          <span
            style={{
              padding: "1px 6px",
              borderRadius: "4px",
              background: "var(--j-bg)",
              fontSize: "10px",
            }}
          >
            {event.status}
          </span>
          {event.assigned_to && (
            <span>{event.assigned_to}</span>
          )}
        </div>
      </div>
    </div>
  );
}
