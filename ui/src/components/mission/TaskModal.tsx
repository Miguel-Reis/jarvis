import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { api } from "../../hooks/useApi";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

type AgentInfo = {
  id: string;
  name: string;
  status: string;
};

export function TaskModal({ open, onClose, onCreated }: Props) {
  const [what, setWhat] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assignedTo, setAssignedTo] = useState("");
  const [context, setContext] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  // Fetch available agents when modal opens
  useEffect(() => {
    if (!open) return;
    api<AgentInfo[]>("/api/agents")
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setWhat("");
    setPriority("normal");
    setAssignedTo("");
    setContext("");
    setDueDate("");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!what.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await api("/api/vault/commitments", {
        method: "POST",
        body: JSON.stringify({
          what: what.trim(),
          priority,
          assigned_to: assignedTo || undefined,
          context: context.trim() || undefined,
          when_due: dueDate ? new Date(dueDate).getTime() : undefined,
        }),
      });
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "480px",
          maxWidth: "90vw",
          background: "var(--j-surface)",
          border: "1px solid var(--j-border)",
          borderRadius: "12px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--j-text)", margin: 0 }}>
            New Task
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--j-text-muted)",
              fontSize: "18px",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            {"\u2715"}
          </button>
        </div>

        {/* Description */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={labelStyle}>Description</label>
          <textarea
            placeholder="What needs to be done..."
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            rows={3}
            style={inputStyle}
            autoFocus
          />
        </div>

        {/* Priority + Assigned to */}
        <div style={{ display: "flex", gap: "12px" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={labelStyle}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={inputStyle}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={labelStyle}>Assign to</label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              style={inputStyle}
            >
              <option value="">Unassigned</option>
              <option value="user">Me</option>
              <option value="jarvis">JARVIS (PA)</option>
              {agents
                .filter((a) => a.name !== "personal-assistant")
                .map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Context */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={labelStyle}>Context (optional)</label>
          <input
            type="text"
            placeholder="Additional context..."
            value={context}
            onChange={(e) => setContext(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Due date */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <label style={labelStyle}>Due date (optional)</label>
          <input
            type="datetime-local"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        {error && <div style={{ color: "var(--j-error)", fontSize: "12px" }}>{error}</div>}

        {/* Actions */}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid var(--j-border)",
              background: "transparent",
              color: "var(--j-text-dim)",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!what.trim() || submitting}
            style={{
              padding: "8px 20px",
              borderRadius: "6px",
              border: "none",
              background: what.trim() && !submitting ? "var(--j-accent)" : "var(--j-border)",
              color: what.trim() && !submitting ? "#000" : "var(--j-text-muted)",
              cursor: what.trim() && !submitting ? "pointer" : "not-allowed",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            {submitting ? "Creating..." : "Create Task"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--j-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "var(--j-bg)",
  border: "1px solid var(--j-border)",
  borderRadius: "6px",
  color: "var(--j-text)",
  fontSize: "13px",
  outline: "none",
  fontFamily: "inherit",
  resize: "none",
};
