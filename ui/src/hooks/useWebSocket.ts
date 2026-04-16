import { useState, useEffect, useRef, useCallback } from "react";

export type MessageRole = "user" | "assistant" | "system";

export type ToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type SubAgentEvent = {
  type: "text" | "tool_call" | "done";
  agentName: string;
  agentId: string;
  data: unknown;
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type ImageAttachment = {
  /** data URI: "data:image/png;base64,..." */
  dataUrl: string;
  mediaType: string;
};

export type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  subAgentEvents?: SubAgentEvent[];
  source?: string; // 'heartbeat', 'proactive', 'sub-agent'
  priority?: string;
  isStreaming?: boolean;
  usage?: TokenUsage;
  model?: string;
  cost?: number | null;
  images?: ImageAttachment[];
};

export type TaskEvent = {
  action: "created" | "updated" | "deleted";
  task: {
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
  timestamp: number;
};

export type ContentEvent = {
  action: "created" | "updated" | "deleted";
  item: {
    id: string;
    title: string;
    body: string;
    content_type: string;
    stage: string;
    tags: string[];
    scheduled_at: number | null;
    published_at: number | null;
    published_url: string | null;
    created_by: string;
    sort_order: number;
    created_at: number;
    updated_at: number;
  };
  timestamp: number;
};

type WSMessage = {
  type: string;
  payload: any;
  id?: string;
  priority?: string;
  timestamp: number;
};

export type AgentActivityEvent = {
  id: string;
  agentName: string;
  agentId: string;
  eventType: "text" | "tool_call" | "done";
  data: unknown;
  timestamp: number;
};

export type VoiceCallbacks = {
  onTTSBinary: (data: ArrayBuffer) => void;
  onTTSStart: (requestId: string) => void;
  onTTSEnd: () => void;
  onError: (message?: string) => void;
};

export type WorkflowEvent = {
  type: string;
  workflowId: string;
  executionId?: string;
  nodeId?: string;
  data: Record<string, unknown>;
  timestamp: number;
};

export type GoalEvent = {
  type: string;
  goalId?: string;
  data: Record<string, unknown>;
  timestamp: number;
};

export type SiteEvent = {
  type: string;
  projectId: string;
  data: Record<string, unknown>;
  timestamp: number;
};

export type SystemNotice = {
  id: string;
  title: string;
  text: string;
  level: "warning";
};

type SidecarEventPayload = {
  source?: string;
  event?: {
    type?: string;
    reason?: string;
  };
};

function createSidecarNotice(payload: SidecarEventPayload, timestamp?: number): ChatMessage & { notice?: SystemNotice } {
  const reason = payload.event?.reason?.trim();
  const notice: SystemNotice = {
    id: crypto.randomUUID(),
    title: "Sidecar offline",
    text: reason
      ? `Jarvis sidecar disconnected: ${reason}. Dashboard features may be delayed until it reconnects.`
      : "Jarvis sidecar disconnected. Dashboard features may be delayed until it reconnects.",
    level: "warning",
  };

  return {
    id: crypto.randomUUID(),
    role: "system",
    content: notice.text,
    timestamp: timestamp ?? Date.now(),
    source: "system_notification",
    notice,
  };
}

function extractNestedMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  if (record.error && typeof record.error === "object") {
    return extractNestedMessage(record.error);
  }
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
      } catch {
        // Keep the original string when embedded JSON is malformed.
      }
    }
  }

  const lowered = normalized.toLowerCase();
  if (
    lowered.includes("api key") ||
    lowered.includes("authentication") ||
    lowered.includes("unauthorized") ||
    lowered.includes("invalid_api_key") ||
    lowered.includes("invalid x-api-key") ||
    lowered.includes("incorrect api key") ||
    lowered.includes("401")
  ) {
    return "Couldn't reach your AI provider. Check your API key and model settings.";
  }

  if (
    lowered.includes("timeout") ||
    lowered.includes("temporarily unavailable") ||
    lowered.includes("503") ||
    lowered.includes("429") ||
    lowered.includes("econnrefused") ||
    lowered.includes("enotfound") ||
    lowered.includes("network")
  ) {
    return "Couldn't reach your AI provider right now. Check your connection, provider status, or fallback settings.";
  }

  return fallback;
}

export type Thread = {
  id: string;
  title: string | null;
  channel: string | null;
  started_at: number;
  last_message_at: number;
  message_count: number;
};

export function useWebSocket() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [contentEvents, setContentEvents] = useState<ContentEvent[]>([]);
  const [agentActivity, setAgentActivity] = useState<AgentActivityEvent[]>([]);
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEvent[]>([]);
  const [goalEvents, setGoalEvents] = useState<GoalEvent[]>([]);
  const [siteEvents, setSiteEvents] = useState<SiteEvent[]>([]);
  const [notices, setNotices] = useState<SystemNotice[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamBufferRef = useRef<string>("");
  const streamIdRef = useRef<string | null>(null);
  const toolCallsRef = useRef<ToolCall[]>([]);
  const subAgentEventsRef = useRef<SubAgentEvent[]>([]);
  const voiceCallbacksRef = useRef<VoiceCallbacks | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.binaryType = "arraybuffer";

    ws.onopen = async () => {
      setIsConnected(true);
      console.log("[WS] Connected");
      // Load chat history from backend on connect
      try {
        type RawMessageDTO = {
          id: string;
          role: MessageRole;
          content: string;
          created_at: number;
          tool_calls?: ToolCall[] | null;
        };
        const resp = await fetch("/api/vault/conversations/active?channel=websocket");
        if (resp.ok) {
          const data = await resp.json() as { messages?: RawMessageDTO[] };
          if (data.messages && data.messages.length > 0) {
            const restored: ChatMessage[] = data.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: m.created_at,
              toolCalls: m.tool_calls ?? undefined,
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
      console.log("[WS] Disconnected, reconnecting in 2s...");
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    ws.onmessage = (event) => {
      // Binary frame = TTS audio chunk from server
      if (event.data instanceof ArrayBuffer) {
        voiceCallbacksRef.current?.onTTSBinary(event.data);
        return;
      }

      try {
        const msg: WSMessage = JSON.parse(event.data);

        // Voice signal messages → route to voice hook
        if (msg.type === "tts_start") {
          voiceCallbacksRef.current?.onTTSStart(msg.payload?.requestId);
          return;
        }
        if (msg.type === "tts_end") {
          voiceCallbacksRef.current?.onTTSEnd();
          return;
        }

        // Voice transcript → show as user message
        if (msg.type === "chat" && msg.payload?.source === "voice_transcript") {
          setMessages((prev) => [
            ...prev,
            {
              id: msg.id ?? crypto.randomUUID(),
              role: "user" as MessageRole,
              content: msg.payload.text,
              timestamp: msg.timestamp,
              source: "voice",
            },
          ]);
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
    if (msg.type === "chat" && msg.payload?.source) {
      // Proactive message (heartbeat or reactor notification)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system" as MessageRole,
          content: msg.payload.text,
          timestamp: msg.timestamp,
          source: msg.payload.source,
          priority: msg.priority,
        },
      ]);
    } else if (msg.type === "stream") {
      if (msg.payload?.source === "sub-agent") {
        // Sub-agent progress event
        const event: SubAgentEvent = {
          type: msg.payload.type,
          agentName: msg.payload.agentName,
          agentId: msg.payload.agentId,
          data: msg.payload.data,
        };
        subAgentEventsRef.current = [...subAgentEventsRef.current, event];

        // Add to agent activity feed
        const activityEvent: AgentActivityEvent = {
          id: crypto.randomUUID(),
          agentName: msg.payload.agentName,
          agentId: msg.payload.agentId,
          eventType: msg.payload.type,
          data: msg.payload.data,
          timestamp: msg.timestamp || Date.now(),
        };
        setAgentActivity((prev) => [activityEvent, ...prev].slice(0, 50));

        // Update the current streaming message with sub-agent events
        if (streamIdRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamIdRef.current
                ? { ...m, subAgentEvents: [...subAgentEventsRef.current] }
                : m
            )
          );
        }
      } else if (msg.payload?.tool_call) {
        // Tool call event
        const tc: ToolCall = {
          name: msg.payload.tool_call.name,
          arguments: msg.payload.tool_call.arguments,
        };
        toolCallsRef.current = [...toolCallsRef.current, tc];

        // Update the current streaming message
        if (streamIdRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamIdRef.current
                ? { ...m, toolCalls: [...toolCallsRef.current] }
                : m
            )
          );
        }
      } else if (msg.payload?.text) {
        // Text chunk
        streamBufferRef.current += msg.payload.text;

        if (!streamIdRef.current) {
          // Start a new assistant message
          const id = crypto.randomUUID();
          streamIdRef.current = id;
          setMessages((prev) => [
            ...prev,
            {
              id,
              role: "assistant",
              content: streamBufferRef.current,
              timestamp: Date.now(),
              isStreaming: true,
            },
          ]);
        } else {
          // Update existing streaming message
          const currentContent = streamBufferRef.current;
          const currentId = streamIdRef.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentId ? { ...m, content: currentContent } : m
            )
          );
        }
      }
    } else if (msg.type === "status" && msg.payload?.status === "done") {
      // Stream complete
      if (streamIdRef.current) {
        const finalId = streamIdRef.current;
        const finalToolCalls = toolCallsRef.current;
        const finalSubAgentEvents = subAgentEventsRef.current;
        const usage: TokenUsage | undefined = msg.payload?.usage;
        const model: string | undefined = msg.payload?.model;
        const cost: number | null | undefined = msg.payload?.cost;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === finalId
              ? {
                  ...m,
                  isStreaming: false,
                  toolCalls:
                    finalToolCalls.length > 0 ? finalToolCalls : m.toolCalls,
                  subAgentEvents:
                    finalSubAgentEvents.length > 0
                      ? finalSubAgentEvents
                      : m.subAgentEvents,
                  usage,
                  model,
                  cost,
                }
              : m
          )
        );
      }
      // Reset stream state
      streamBufferRef.current = "";
      streamIdRef.current = null;
      toolCallsRef.current = [];
      subAgentEventsRef.current = [];
    } else if (msg.type === "goal_event") {
      const goalEvent = msg.payload as GoalEvent;
      setGoalEvents((prev) => [...prev.slice(-100), goalEvent]);
    } else if (msg.type === "workflow_event") {
      const wfEvent = msg.payload as WorkflowEvent;
      setWorkflowEvents((prev) => [...prev.slice(-100), wfEvent]);

      // If it's a workflow_message, show it in the chat
      if (wfEvent.type === "workflow_message" && wfEvent.data?.message) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system" as MessageRole,
            content: String(wfEvent.data.message),
            timestamp: wfEvent.timestamp,
            source: "workflow",
          },
        ]);
      }
    } else if (msg.type === "site_event") {
      const siteEvent = msg.payload as SiteEvent;
      setSiteEvents((prev) => [...prev.slice(-100), siteEvent]);
    } else if (msg.type === "notification") {
      const payload = msg.payload as {
        source?: string;
        action?: string;
        task?: TaskEvent["task"];
        item?: ContentEvent["item"];
        event?: any;
        text?: string;
      };
      if (payload.source === "task_update" && payload.task && payload.action) {
        const event: TaskEvent = {
          action: payload.action as TaskEvent["action"],
          task: payload.task,
          timestamp: msg.timestamp,
        };
        setTaskEvents((prev) => [...prev, event]);
      } else if (payload.source === "content_update" && payload.item && payload.action) {
        const event: ContentEvent = {
          action: payload.action as ContentEvent["action"],
          item: payload.item,
          timestamp: msg.timestamp,
        };
        setContentEvents((prev) => [...prev, event]);
      } else if (payload.source === "awareness_event") {
        // Awareness events (context changes, suggestions, etc.)
        const awarenessEvent = payload.event as { type: string; data: Record<string, unknown> };
        if (awarenessEvent?.type === "suggestion_ready") {
          // Suggestion events also arrive via broadcastNotification as chat messages,
          // so no need to duplicate here — just log for debugging
          console.log("[WS] Awareness suggestion:", awarenessEvent.data.title);
        }
      } else if (payload.source === "sidecar_event" && payload.event?.type === "sidecar_disconnect") {
        const noticeMessage = createSidecarNotice(payload, msg.timestamp);
        if (noticeMessage.notice) {
          setNotices((prev) => [noticeMessage.notice!, ...prev.filter((item) => item.text !== noticeMessage.notice!.text)].slice(0, 3));
        }
        setMessages((prev) => [...prev, noticeMessage]);
      } else if (payload.source === "assistant_message" && payload.text) {
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id ?? crypto.randomUUID(),
            role: "assistant",
            content: String(payload.text),
            timestamp: msg.timestamp,
          },
        ]);
      }
    } else if (msg.type === "error") {
      voiceCallbacksRef.current?.onError(msg.payload?.message);
      const friendlyMessage = formatProviderErrorMessage(msg.payload?.message);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: friendlyMessage,
          timestamp: msg.timestamp,
          source: "error",
        },
      ]);
      // Reset stream state on error
      streamBufferRef.current = "";
      streamIdRef.current = null;
      toolCallsRef.current = [];
      subAgentEventsRef.current = [];
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback(
    (text: string, options?: { projectId?: string; threadId?: string; images?: ImageAttachment[] }) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const id = crypto.randomUUID();
      const threadId = options?.threadId ?? activeThreadIdRef.current;
      const images = options?.images;

      // Add user message to local state
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: "user",
          content: text,
          timestamp: Date.now(),
          source: options?.projectId ? `site:${options.projectId}` : undefined,
          images,
        },
      ]);

      // Build payload — include content array if images are attached
      let payload: Record<string, unknown>;
      if (images && images.length > 0) {
        const contentBlocks: unknown[] = images.map((img) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType,
            data: img.dataUrl.replace(/^data:[^;]+;base64,/, ""),
          },
        }));
        if (text.trim()) {
          contentBlocks.push({ type: "text", text });
        }
        payload = {
          content: contentBlocks,
          ...(text.trim() ? { text } : {}),
          ...(options?.projectId ? { projectId: options.projectId } : {}),
          ...(threadId ? { thread_id: threadId } : {}),
        };
      } else {
        payload = {
          text,
          ...(options?.projectId ? { projectId: options.projectId } : {}),
          ...(threadId ? { thread_id: threadId } : {}),
        };
      }

      // Send to server
      const msg: WSMessage = {
        type: "chat",
        payload,
        id,
        timestamp: Date.now(),
      };
      wsRef.current.send(JSON.stringify(msg));
    },
    []
  );

  /**
   * Switch the active thread: load its messages from the API and replace
   * the in-memory message list so the chat view shows the right history.
   */
  const selectThread = useCallback(async (threadId: string) => {
    setActiveThreadId(threadId);
    activeThreadIdRef.current = threadId;
    try {
      const resp = await fetch(`/api/vault/threads/${threadId}/messages?limit=100`);
      if (resp.ok) {
        const data = await resp.json() as Array<{
          id: string; role: MessageRole; content: string; created_at: number;
        }>;
        const restored: ChatMessage[] = data.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.created_at,
        }));
        setMessages(restored);
      }
    } catch (err) {
      console.warn("[WS] Failed to load thread:", err);
    }
  }, []);

  /**
   * Start a fresh thread: clear in-memory messages and create a new thread on the server.
   * Returns the new thread's ID so the caller can track it.
   */
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
    // Fallback: just clear messages without a server thread
    setActiveThreadId(null);
    activeThreadIdRef.current = null;
    setMessages([]);
    return null;
  }, []);

  const dismissNotice = useCallback((noticeId: string) => {
    setNotices((prev) => prev.filter((notice) => notice.id !== noticeId));
  }, []);

  return {
    messages, isConnected, sendMessage, taskEvents, contentEvents, agentActivity, workflowEvents, goalEvents, siteEvents, notices, dismissNotice,
    activeThreadId, selectThread, startNewThread,
    wsRef,
    voiceCallbacksRef,
  };
}
