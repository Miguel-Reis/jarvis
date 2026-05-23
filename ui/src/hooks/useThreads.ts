/**
 * useThreads — active thread selection and creation.
 */

import { useState, useRef, useCallback } from "react";
import type { ChatMessage, MessageRole, Thread } from "./ws-types.ts";

export type { Thread };

export function useThreads(setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);

  const selectThread = useCallback(async (threadId: string) => {
    setActiveThreadId(threadId);
    activeThreadIdRef.current = threadId;
    try {
      const resp = await fetch(`/api/vault/threads/${threadId}/messages?limit=100`);
      if (resp.ok) {
        const data = await resp.json() as Array<{
          id: string; role: MessageRole; content: string; created_at: number;
        }>;
        setMessages(data.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.created_at,
        })));
      }
    } catch (err) {
      console.warn("[WS] Failed to load thread:", err);
    }
  }, [setMessages]);

  const startNewThread = useCallback(async (): Promise<string | null> => {
    try {
      const resp = await fetch("/api/vault/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (resp.ok) {
        const thread = await resp.json() as Thread;
        setActiveThreadId(thread.id);
        activeThreadIdRef.current = thread.id;
        setMessages([]);
        return thread.id;
      }
    } catch (err) {
      console.warn("[WS] Failed to create thread:", err);
    }
    setActiveThreadId(null);
    activeThreadIdRef.current = null;
    setMessages([]);
    return null;
  }, [setMessages]);

  return { activeThreadId, activeThreadIdRef, selectThread, startNewThread };
}
