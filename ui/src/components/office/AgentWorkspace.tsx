import React from "react";

export type AgentRoster = {
  roleId: string;
  name: string;
  emoji: string;
  alwaysActive?: boolean;
};

export type LiveAgent = {
  id: string;
  role: { id: string; name: string };
  status: "active" | "idle" | "terminated";
  current_task: string | null;
  created_at: number;
};

type Props = {
  roster: AgentRoster;
  liveAgent: LiveAgent | null;
};

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

export function AgentWorkspace({ roster, liveAgent }: Props) {
  const isWorking =
    roster.alwaysActive || (liveAgent?.status === "active");
  const currentTask = liveAgent?.current_task || null;

  return (
    <div
      style={{
        background: "var(--j-surface)",
        border: isWorking
          ? "1px solid var(--j-accent)"
          : "1px solid var(--j-border)",
        borderRadius: "12px",
        padding: "20px 16px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "12px",
        position: "relative",
        transition: "border-color 0.3s, box-shadow 0.3s",
        boxShadow: isWorking
          ? "0 0 12px rgba(0, 212, 255, 0.15), 0 0 24px rgba(0, 212, 255, 0.05)"
          : "none",
      }}
    >
      {/* Desk area */}
      <div
        style={{
          width: "100%",
          background: isWorking
            ? "rgba(0, 212, 255, 0.05)"
            : "var(--j-bg)",
          borderRadius: "8px",
          padding: "16px 12px 12px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px",
          position: "relative",
        }}
      >
        {/* Monitor */}
        <div
          style={{
            width: "48px",
            height: "32px",
            borderRadius: "4px",
            background: isWorking
              ? "rgba(0, 212, 255, 0.15)"
              : "var(--j-surface)",
            border: isWorking
              ? "1px solid var(--j-accent)"
              : "1px solid var(--j-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {isWorking && (
            <div
              style={{
                width: "4px",
                height: "4px",
                borderRadius: "50%",
                background: "var(--j-accent)",
                animation: "pulse-dot 1.5s ease-in-out infinite",
              }}
            />
          )}
        </div>
        {/* Monitor stand */}
        <div
          style={{
            width: "8px",
            height: "4px",
            background: isWorking
              ? "var(--j-accent)"
              : "var(--j-border)",
            borderRadius: "0 0 2px 2px",
            opacity: 0.5,
          }}
        />

        {/* Avatar */}
        <div
          style={{
            fontSize: "32px",
            lineHeight: 1,
            filter: isWorking ? "none" : "grayscale(0.6) opacity(0.5)",
            transition: "filter 0.3s",
          }}
        >
          {roster.emoji}
        </div>
      </div>

      {/* Name + role */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: isWorking ? "var(--j-text)" : "var(--j-text-dim)",
          }}
        >
          {roster.name}
        </div>
      </div>

      {/* Status badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "11px",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: isWorking ? "var(--j-accent)" : "var(--j-text-muted)",
            display: "inline-block",
            animation: isWorking ? "pulse-dot 1.5s ease-in-out infinite" : "none",
          }}
        />
        <span
          style={{
            color: isWorking ? "var(--j-accent)" : "var(--j-text-muted)",
            fontWeight: isWorking ? 500 : 400,
          }}
        >
          {isWorking ? "Working" : "Available"}
        </span>
        {liveAgent && isWorking && !roster.alwaysActive && (
          <span style={{ color: "var(--j-text-muted)", fontSize: "10px" }}>
            {timeAgo(liveAgent.created_at)}
          </span>
        )}
      </div>

      {/* Task info */}
      <div
        style={{
          width: "100%",
          minHeight: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isWorking && currentTask ? (
          <div
            style={{
              fontSize: "11px",
              color: "var(--j-text-dim)",
              textAlign: "center",
              lineHeight: 1.4,
              padding: "6px 8px",
              background: "var(--j-bg)",
              borderRadius: "6px",
              width: "100%",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {currentTask}
          </div>
        ) : isWorking && roster.alwaysActive ? (
          <div
            style={{
              fontSize: "11px",
              color: "var(--j-text-muted)",
              textAlign: "center",
              fontStyle: "italic",
            }}
          >
            Managing the team
          </div>
        ) : (
          <div
            style={{
              fontSize: "11px",
              color: "var(--j-text-muted)",
              textAlign: "center",
            }}
          >
            Ready to assist
          </div>
        )}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
