import React, { useState, useEffect, useRef } from "react";
import type { ChatMessage } from "../../hooks/useWebSocket";
import { isSystemMessage } from "./MessageList";
import "../../styles/chat.css";

type Props = {
  messages: ChatMessage[];
  collapsed: boolean;
  onToggle: () => void;
  unseenCount: number;
};

const SOURCE_LABELS: Record<string, string> = {
  heartbeat: "Heartbeat",
  proactive: "Proactive",
  workflow: "Workflow",
  error: "Error",
};

const SOURCE_COLORS: Record<string, string> = {
  heartbeat: "#60A5FA",
  proactive: "#A78BFA",
  workflow: "#34D399",
  error: "#FB7185",
};

export function SystemPanel({ messages, collapsed, onToggle, unseenCount }: Props) {
  const systemMessages = messages.filter(isSystemMessage).slice(-100);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [systemMessages.length, collapsed]);

  return (
    <div className={`sys-panel${collapsed ? " sys-panel--collapsed" : ""}`}>
      {/* Toggle button */}
      <button className="sys-panel-toggle" onClick={onToggle} title={collapsed ? "Expand system panel" : "Collapse system panel"}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          {collapsed
            ? <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            : <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          }
        </svg>
        {collapsed && (
          <span className="sys-panel-toggle-label">
            System
            {unseenCount > 0 && <span className="sys-panel-badge">{unseenCount}</span>}
          </span>
        )}
      </button>

      {!collapsed && (
        <>
          <div className="sys-panel-header">
            <span className="sys-panel-title">System</span>
            {systemMessages.length > 0 && (
              <span className="sys-panel-count">{systemMessages.length}</span>
            )}
          </div>
          <div className="sys-panel-body">
            {systemMessages.length === 0 ? (
              <div className="sys-panel-empty">No system messages yet</div>
            ) : (
              systemMessages.map((msg) => {
                const color = SOURCE_COLORS[msg.source ?? ""] ?? "rgba(255,255,255,0.4)";
                const label = SOURCE_LABELS[msg.source ?? ""] ?? msg.source ?? "System";
                return (
                  <div key={msg.id} className={`sys-msg${msg.source === "error" ? " sys-msg--error" : ""}`}>
                    <div className="sys-msg-header">
                      <span className="sys-msg-badge" style={{ background: `${color}20`, color }}>
                        {label}
                      </span>
                      <span className="sys-msg-time">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="sys-msg-body">{msg.content}</div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
        </>
      )}
    </div>
  );
}
