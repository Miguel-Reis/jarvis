import React, { useState, useCallback, useEffect, useRef } from "react";
import { useApiData, api } from "../../hooks/useApi";
import { TaskCard } from "./TaskCard";
import type { TaskEvent } from "../../hooks/useWebSocket";

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

const COLUMNS: { status: Status; label: string; color: string }[] = [
  { status: "pending", label: "Pending", color: "var(--j-warning)" },
  { status: "active", label: "Active", color: "var(--j-accent)" },
  { status: "completed", label: "Completed", color: "var(--j-success)" },
  { status: "failed", label: "Failed", color: "var(--j-error)" },
  { status: "escalated", label: "Escalated", color: "#e879f9" },
];

type Props = {
  refreshKey: number;
  taskEvents?: TaskEvent[];
};

export function KanbanBoard({ refreshKey, taskEvents }: Props) {
  const { data: fetchedTasks, loading, refetch } = useApiData<Commitment[]>(
    "/api/vault/commitments",
    [refreshKey]
  );
  const [localTasks, setLocalTasks] = useState<Commitment[]>([]);
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(new Set());
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const lastProcessedRef = useRef(0);

  // Sync fetched tasks into local state
  useEffect(() => {
    if (fetchedTasks) {
      setLocalTasks(fetchedTasks);
    }
  }, [fetchedTasks]);

  // Process real-time task events
  useEffect(() => {
    if (!taskEvents || taskEvents.length === 0) return;

    // Only process new events
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
          if (idx === -1) {
            updated.push(task);
            newUpdatedIds.add(task.id);
          }
        } else if (action === "updated") {
          if (idx !== -1) {
            updated[idx] = task;
          } else {
            updated.push(task);
          }
          newUpdatedIds.add(task.id);
        } else if (action === "deleted") {
          if (idx !== -1) {
            updated.splice(idx, 1);
          }
        }
      }

      // Flash recently updated cards
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

  const grouped = useCallback(() => {
    const map: Record<string, Commitment[]> = {};
    for (const col of COLUMNS) {
      map[col.status] = [];
    }
    for (const t of localTasks) {
      if (map[t.status]) {
        map[t.status]!.push(t);
      } else {
        map["pending"]!.push(t);
      }
    }
    return map;
  }, [localTasks]);

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

    try {
      await api(`/api/vault/commitments/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: toStatus }),
      });
      refetch();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
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

  const g = grouped();

  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        height: "100%",
        overflow: "auto",
        paddingBottom: "8px",
      }}
    >
      {loading && (
        <div style={{ color: "var(--j-text-muted)", fontSize: "13px", padding: "20px" }}>
          Loading tasks...
        </div>
      )}
      {!loading &&
        COLUMNS.map((col) => {
          const items = g[col.status] ?? [];
          const isOver = dragOverCol === col.status;

          return (
            <div
              key={col.status}
              onDragOver={(e) => handleDragOver(e, col.status)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.status)}
              style={{
                flex: 1,
                minWidth: "200px",
                display: "flex",
                flexDirection: "column",
                background: isOver ? "rgba(0, 212, 255, 0.05)" : "transparent",
                border: isOver
                  ? "2px dashed var(--j-accent)"
                  : "2px solid transparent",
                borderRadius: "8px",
                transition: "background 0.15s, border 0.15s",
              }}
            >
              {/* Column header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 10px",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: col.color,
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--j-text)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {col.label}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--j-text-muted)",
                    marginLeft: "auto",
                    background: "var(--j-surface)",
                    padding: "1px 6px",
                    borderRadius: "8px",
                  }}
                >
                  {items.length}
                </span>
              </div>

              {/* Cards */}
              <div
                style={{
                  flex: 1,
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "0 4px",
                }}
              >
                {items.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id, task.status)}
                    style={{ cursor: "grab" }}
                  >
                    <TaskCard
                      task={task}
                      kanban
                      justUpdated={recentlyUpdated.has(task.id)}
                      onStatusChange={(status) => handleStatusChange(task.id, status)}
                    />
                  </div>
                ))}
                {items.length === 0 && (
                  <div
                    style={{
                      padding: "20px",
                      textAlign: "center",
                      color: "var(--j-text-muted)",
                      fontSize: "12px",
                      border: "1px dashed var(--j-border)",
                      borderRadius: "6px",
                    }}
                  >
                    Drop tasks here
                  </div>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}
