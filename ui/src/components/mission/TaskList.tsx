import React, { useState } from "react";
import { useApiData, api } from "../../hooks/useApi";
import { TaskCard } from "./TaskCard";

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

type FilterStatus = "all" | "pending" | "active" | "completed" | "failed";

export function TaskList() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const queryStr = statusFilter !== "all" ? `?status=${statusFilter}` : "";
  const { data: tasks, loading, refetch } = useApiData<Commitment[]>(
    `/api/vault/commitments${queryStr}`,
    [statusFilter]
  );

  const handleStatusChange = async (id: string, status: "completed" | "failed") => {
    try {
      await api(`/api/vault/commitments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      refetch();
    } catch (err) {
      console.error("Failed to update task:", err);
    }
  };

  const filters: FilterStatus[] = ["all", "pending", "active", "completed", "failed"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "12px", flexWrap: "wrap" }}>
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            style={{
              padding: "4px 10px",
              borderRadius: "12px",
              border: "1px solid",
              borderColor: statusFilter === f ? "var(--j-accent)" : "var(--j-border)",
              background: statusFilter === f ? "rgba(0, 212, 255, 0.1)" : "transparent",
              color: statusFilter === f ? "var(--j-accent)" : "var(--j-text-dim)",
              fontSize: "11px",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
        {loading && (
          <div style={{ color: "var(--j-text-muted)", fontSize: "13px" }}>Loading tasks...</div>
        )}
        {!loading && (!tasks || tasks.length === 0) && (
          <div style={{ color: "var(--j-text-muted)", fontSize: "13px", padding: "20px", textAlign: "center" }}>
            No tasks found
          </div>
        )}
        {tasks?.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onStatusChange={(status) => handleStatusChange(task.id, status as "completed" | "failed")}
          />
        ))}
      </div>
    </div>
  );
}
