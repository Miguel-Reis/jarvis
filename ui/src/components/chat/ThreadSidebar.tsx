import React, { useState, useEffect, useCallback } from "react";
import type { Thread } from "../../hooks/useWebSocket";

type Props = {
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
};

/** Format a Unix-ms timestamp into a human-readable label relative to now. */
function formatRelativeTime(ms: number): string {
  const date = new Date(ms);
  const now = Date.now();
  const diffMs = now - ms;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ThreadSidebar({ activeThreadId, onSelectThread, onNewThread }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const resp = await fetch("/api/vault/threads?limit=100");
      if (resp.ok) {
        const data = await resp.json() as Thread[];
        setThreads(data);
      }
    } catch {
      // ignore transient errors — will retry on next interval
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
    const interval = setInterval(loadThreads, 30_000);
    return () => clearInterval(interval);
  }, [loadThreads]);

  const handleDelete = useCallback(async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this chat? This cannot be undone.")) return;
    setDeletingId(threadId);
    try {
      await fetch(`/api/vault/threads/${threadId}`, { method: "DELETE" });
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThreadId === threadId) {
        onNewThread();
      }
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  }, [activeThreadId, onNewThread]);

  return (
    <aside className="thread-sidebar" aria-label="Chat history">
      {/* Header */}
      <div className="thread-sidebar-header">
        <span className="thread-sidebar-title">Chats</span>
        <button
          className="thread-new-btn"
          onClick={onNewThread}
          title="Start a new chat"
          aria-label="New chat"
        >
          ＋
        </button>
      </div>

      {/* Thread list */}
      <div className="thread-sidebar-list" role="list">
        {loading ? (
          <div className="thread-sidebar-empty">Loading…</div>
        ) : threads.length === 0 ? (
          <div className="thread-sidebar-empty">No chats yet</div>
        ) : (
          threads.map((thread) => (
            <div
              key={thread.id}
              className={`thread-item${thread.id === activeThreadId ? " active" : ""}`}
              role="listitem"
            >
              <button
                className="thread-item-btn"
                onClick={() => onSelectThread(thread.id)}
                title={thread.title ?? "New chat"}
              >
                <span className="thread-item-title">
                  {thread.title ?? <em>New chat</em>}
                </span>
                <span className="thread-item-meta">
                  <span className="thread-item-time">
                    {formatRelativeTime(thread.last_message_at)}
                  </span>
                  {thread.message_count > 0 && (
                    <span className="thread-item-count">
                      {thread.message_count}
                    </span>
                  )}
                </span>
              </button>
              <button
                className="thread-delete-btn"
                onClick={(e) => handleDelete(e, thread.id)}
                disabled={deletingId === thread.id}
                title="Delete chat"
                aria-label="Delete chat"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
