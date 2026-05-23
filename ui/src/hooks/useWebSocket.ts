/**
 * useWebSocket — main WebSocket hook.
 *
 * Owns the WS connection, messages state, and streaming state.
 * Composes domain sub-hooks:
 *   useAgentEvents, useGoalEvents, useNotices, useThreads.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  MessageRole, ChatMessage, VoiceCallbacks, WSMessage,
  ToolCall, SubAgentEvent, AgentActivityEvent, WorkflowEvent,
} from "./ws-types.ts";
import { useAgentEvents } from "./useAgentEvents.ts";
import { useGoalEvents } from "./useGoalEvents.ts";
import { useNotices } from "./useNotices.ts";
import { useThreads } from "./useThreads.ts";

// Re-export types for backward compatibility
export type {
  MessageRole, ChatMessage, ToolCall, SubAgentEvent, AgentActivityEvent,
  VoiceCallbacks, WorkflowEvent,
} from "./ws-types.ts";
export type { TaskEvent, ContentEvent, SiteEvent } from "./useAgentEvents.ts";
export type { GoalEvent } from "./useGoalEvents.ts";
export type { SystemNotice } from "./useNotices.ts";
export type { Thread } from "./useThreads.ts";

type SidecarEventPayload = {
  source?: string;
  event?: { type?: string; reason?: string };
};

function createSidecarNotice(payload: SidecarEventPayload, timestamp?: number): ChatMessage & { notice?: import("./useNotices.ts").SystemNotice } {
  const reason = payload.event?.reason?.trim();
  const notice: import("./useNotices.ts").SystemNotice = {
    id: crypto.randomUUID(),
    title: "Sidecar offline",
    text: reason
      ? `Jarvis sidecar disconnected: ${reason}. Dashboard features may be delayed until it reconnects.`
      : "Jarvis sidecar disconnected. Dashboard features may be delayed until it reconnects.",
    level: "warning",
  };
  return { id: crypto.randomUUID(), role: "system", content: notice.text, timestamp: timestamp ?? Date.now(), source: "system_notification", notice };
}

function extractNestedMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  if (record.error && typeof record.error === "object") return extractNestedMessage(record.error);
  return null;
}

function formatProviderErrorMessage(raw: string | undefined): string {
  const fallback = "Couldn't reach your AI provider. Check your API key, network connection, or fallback settings.";
  if (!raw) return fallback;

  let normalized = raw.trim();
  try {
    const parsed = JSON.parse(normalized) as unknown;
    normalized = extractNestedMessage(parsed) ?? normalized;
  } catch {
    const jsonMatch = normalized.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as unknown;
        normalized = extractNestedMessage(parsed) ?? normalized;
      } catch { /* keep original */ }
    }
  }

  const lowered = normalized.toLowerCase();
  if (lowered.includes("api key") || lowered.includes("authentication") || lowered.includes("unauthorized") || lowered.includes("invalid_api_key") || lowered.includes("401")) {
    return "Couldn't reach your AI provider. Check your API key and model settings.";
  }
  if (lowered.includes("timeout") || lowered.includes("503") || lowered.includes("429") || lowered.includes("econnrefused") || lowered.includes("network")) {
    return "Couldn't reach your AI provider right now. Check your connection, provider status, or fallback settings.";
  }
  return fallback;
}

export function useWebSocket() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // Streaming refs
  const wsRef = useRef<WebSocket | null>(null);
  const streamBufferRef = useRef<string>("");
  const streamIdRef = useRef<string | null>(null);
  const toolCallsRef = useRef<ToolCall[]>([]);
  const subAgentEventsRef = useRef<SubAgentEvent[]>([]);
  const voiceCallbacksRef = useRef<VoiceCallbacks | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Domain sub-hooks
  const agentEvents = useAgentEvents();
  const { goalEvents, handleGoalEvent } = useGoalEvents();
  const { notices, addNotice, dismissNotice } = useNotices();
  const { activeThreadId, activeThreadIdRef, selectThread, startNewThread } = useThreads(setMessages);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.binaryType = "arraybuffer";

    ws.onopen = async () => {
      setIsConnected(true);
      try {
        const resp = await fetch("/api/vault/conversations/active?channel=websocket");
        if (resp.ok) {
          const data = await resp.json();
          if (data.messages && data.messages.length > 0) {
            const restored: ChatMessage[] = data.messages.map((m: any) => ({
              id: m.id, role: m.role as MessageRole, content: m.content,
              timestamp: m.created_at, toolCalls: m.tool_calls ?? undefined,
            }));
            setMessages((prev) => prev.length === 0 ? restored : prev);
          }
        }
      } catch (err) {
        console.warn("[WS] Failed to load history:", err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      reconnectTimerRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => { setIsConnected(false); };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        voiceCallbacksRef.current?.onTTSBinary(event.data);
        return;
      }
      try {
        const msg: WSMessage = JSON.parse(event.data);
        if (msg.type === "tts_start") { voiceCallbacksRef.current?.onTTSStart(msg.payload?.requestId); return; }
        if (msg.type === "tts_end") { voiceCallbacksRef.current?.onTTSEnd(); return; }
        if (msg.type === "chat" && msg.payload?.source === "voice_transcript") {
          setMessages((prev) => [...prev, { id: msg.id ?? crypto.randomUUID(), role: "user" as MessageRole, content: msg.payload.text, timestamp: msg.timestamp, source: "voice" }]);
          return;
        }
        handleMessage(msg);
      } catch (err) {
        console.error("[WS] Parse error:", err);
      }
    };

    wsRef.current = ws;
  }, []);

  const handleMessage = useCallback((msg: WSMessage) => {
    // Proactive chat (heartbeat / reactor)
    if (msg.type === "chat" && msg.payload?.source) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "system" as MessageRole, content: msg.payload.text, timestamp: msg.timestamp, source: msg.payload.source, priority: msg.priority }]);
      return;
    }

    // Streaming
    if (msg.type === "stream") {
      if (msg.payload?.source === "sub-agent") {
        const event: SubAgentEvent = { type: msg.payload.type, agentName: msg.payload.agentName, agentId: msg.payload.agentId, data: msg.payload.data };
        subAgentEventsRef.current = [...subAgentEventsRef.current, event];
        agentEvents.addAgentActivity({ id: crypto.randomUUID(), agentName: msg.payload.agentName, agentId: msg.payload.agentId, eventType: msg.payload.type, data: msg.payload.data, timestamp: msg.timestamp || Date.now() } as AgentActivityEvent);
        if (streamIdRef.current) {
          setMessages((prev) => prev.map((m) => m.id === streamIdRef.current ? { ...m, subAgentEvents: [...subAgentEventsRef.current] } : m));
        }
      } else if (msg.payload?.tool_call) {
        const tc: ToolCall = { name: msg.payload.tool_call.name, arguments: msg.payload.tool_call.arguments };
        toolCallsRef.current = [...toolCallsRef.current, tc];
        if (streamIdRef.current) {
          setMessages((prev) => prev.map((m) => m.id === streamIdRef.current ? { ...m, toolCalls: [...toolCallsRef.current] } : m));
        }
      } else if (msg.payload?.text) {
        streamBufferRef.current += msg.payload.text;
        if (!streamIdRef.current) {
          const id = crypto.randomUUID();
          streamIdRef.current = id;
          setMessages((prev) => [...prev, { id, role: "assistant", content: streamBufferRef.current, timestamp: Date.now(), isStreaming: true }]);
        } else {
          const currentContent = streamBufferRef.current;
          const currentId = streamIdRef.current;
          setMessages((prev) => prev.map((m) => m.id === currentId ? { ...m, content: currentContent } : m));
        }
      }
      return;
    }

    // Stream complete
    if (msg.type === "status" && msg.payload?.status === "done") {
      if (streamIdRef.current) {
        const finalId = streamIdRef.current;
        const finalToolCalls = toolCallsRef.current;
        const finalSubAgentEvents = subAgentEventsRef.current;
        setMessages((prev) => prev.map((m) => m.id === finalId ? { ...m, isStreaming: false, toolCalls: finalToolCalls.length > 0 ? finalToolCalls : m.toolCalls, subAgentEvents: finalSubAgentEvents.length > 0 ? finalSubAgentEvents : m.subAgentEvents } : m));
      }
      streamBufferRef.current = ""; streamIdRef.current = null; toolCallsRef.current = []; subAgentEventsRef.current = [];
      return;
    }

    // Domain events
    if (msg.type === "goal_event") { handleGoalEvent(msg.payload as import("./ws-types.ts").GoalEvent); return; }

    if (msg.type === "workflow_event") {
      const wfEvent = msg.payload as WorkflowEvent;
      agentEvents.handleWorkflowEvent(wfEvent);
      if (wfEvent.type === "workflow_message" && wfEvent.data?.message) {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "system" as MessageRole, content: String(wfEvent.data.message), timestamp: wfEvent.timestamp, source: "workflow" }]);
      }
      return;
    }

    if (msg.type === "site_event") { agentEvents.handleSiteEvent(msg.payload as import("./ws-types.ts").SiteEvent); return; }

    if (msg.type === "notification") {
      const payload = msg.payload as any;
      agentEvents.handleTaskUpdate(msg, payload);
      if (payload.source === "sidecar_event" && payload.event?.type === "sidecar_disconnect") {
        const noticeMessage = createSidecarNotice(payload, msg.timestamp);
        if (noticeMessage.notice) addNotice(noticeMessage.notice);
        setMessages((prev) => [...prev, noticeMessage]);
      } else if (payload.source === "assistant_message" && payload.text) {
        setMessages((prev) => [...prev, { id: msg.id ?? crypto.randomUUID(), role: "assistant", content: String(payload.text), timestamp: msg.timestamp }]);
      }
      return;
    }

    if (msg.type === "error") {
      voiceCallbacksRef.current?.onError(msg.payload?.message);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "system", content: formatProviderErrorMessage(msg.payload?.message), timestamp: msg.timestamp, source: "error" }]);
      streamBufferRef.current = ""; streamIdRef.current = null; toolCallsRef.current = []; subAgentEventsRef.current = [];
    }
  }, [agentEvents, handleGoalEvent, addNotice]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback(
    (text: string, options?: { projectId?: string; threadId?: string }) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const id = crypto.randomUUID();
      const threadId = options?.threadId ?? activeThreadIdRef.current;
      setMessages((prev) => [...prev, { id, role: "user", content: text, timestamp: Date.now(), source: options?.projectId ? `site:${options.projectId}` : undefined }]);
      wsRef.current.send(JSON.stringify({ type: "chat", payload: { text, ...(options?.projectId ? { projectId: options.projectId } : {}), ...(threadId ? { thread_id: threadId } : {}) }, id, timestamp: Date.now() }));
    },
    [activeThreadIdRef],
  );

  return {
    messages, isConnected, sendMessage,
    taskEvents: agentEvents.taskEvents,
    contentEvents: agentEvents.contentEvents,
    agentActivity: agentEvents.agentActivity,
    workflowEvents: agentEvents.workflowEvents,
    goalEvents,
    siteEvents: agentEvents.siteEvents,
    notices, dismissNotice,
    activeThreadId, selectThread, startNewThread,
    wsRef, voiceCallbacksRef,
  };
}
