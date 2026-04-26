import React, { useState } from "react";
import { api } from "../../hooks/useApi";

type Props = {
  onCreated: () => void;
};

export function NewTaskForm({ onCreated }: Props) {
  const [what, setWhat] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          assigned_to: assignedTo.trim() || undefined,
          when_due: dueDate ? new Date(dueDate).getTime() : undefined,
        }),
      });
      setWhat("");
      setAssignedTo("");
      setDueDate("");
      setPriority("normal");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        padding: "16px",
        background: "var(--j-surface)",
        border: "1px solid var(--j-border)",
        borderRadius: "8px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <h3
        style={{
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--j-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          margin: 0,
        }}
      >
        New Task
      </h3>

      {/* What */}
      <textarea
        placeholder="Task description..."
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        rows={2}
        style={inputStyle}
      />

      <div style={{ display: "flex", gap: "8px" }}>
        {/* Priority */}
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>

        {/* Assign to */}
        <input
          type="text"
          placeholder="Assign to agent..."
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />

        {/* Due date */}
        <input
          type="datetime-local"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>

      {error && (
        <div style={{ color: "var(--j-error)", fontSize: "12px" }}>{error}</div>
      )}

      <button
        type="submit"
        disabled={!what.trim() || submitting}
        style={{
          padding: "8px 16px",
          borderRadius: "6px",
          border: "none",
          background: what.trim() && !submitting ? "var(--j-accent)" : "var(--j-border)",
          color: what.trim() && !submitting ? "#000" : "var(--j-text-muted)",
          cursor: what.trim() && !submitting ? "pointer" : "not-allowed",
          fontSize: "13px",
          fontWeight: 600,
          alignSelf: "flex-end",
        }}
      >
        {submitting ? "Creating..." : "Create Task"}
      </button>
    </form>
  );
}

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
