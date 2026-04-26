import React, { useEffect, useRef, useCallback } from "react";
import type { ChatMessage } from "../../hooks/useWebSocket";
import { MessageBubble } from "./MessageBubble";

// System messages go to the SystemPanel, not the main chat
const SYSTEM_SOURCES = new Set(["heartbeat", "proactive", "workflow", "error"]);

export function isSystemMessage(msg: ChatMessage): boolean {
  return msg.role === "system" && !!msg.source && SYSTEM_SOURCES.has(msg.source);
}

type Props = {
  messages: ChatMessage[];
};

function formatTimeDivider(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (isToday) return `Today  ${time}`;
  if (isYesterday) return `Yesterday  ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}  ${time}`;
}

function shouldShowTimeDivider(current: ChatMessage, previous: ChatMessage | undefined): boolean {
  if (!previous) return true;
  const gap = current.timestamp - previous.timestamp;
  return gap > 10 * 60 * 1000; // 10 minutes
}

export function MessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const lastMessageCountRef = useRef(0);

  // Filter out system messages (they go to SystemPanel)
  const chatMessages = messages.filter((m) => !isSystemMessage(m));

  // Detect when user scrolls away from bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 100;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (userScrolledUpRef.current) return; // User scrolled up — don't jump

    const isNewMessage = chatMessages.length > lastMessageCountRef.current;
    lastMessageCountRef.current = chatMessages.length;

    // Check if last message is streaming (use instant to avoid jump during streaming)
    const lastMsg = chatMessages[chatMessages.length - 1];
    const behavior: ScrollBehavior = isNewMessage && !lastMsg?.isStreaming ? "smooth" : "instant";
    bottomRef.current?.scrollIntoView({ behavior });
  }, [chatMessages]);

  if (chatMessages.length === 0) {
    return (
      <div className="chat-empty">
        <div className="chat-empty-orb" />
        <div className="chat-empty-title">Ready to assist</div>
        <div className="chat-empty-sub">
          Type a message below to start a conversation with JARVIS.
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="chat-messages-scroll">
      <div className="chat-messages-center">
        {chatMessages.map((msg, i) => (
          <React.Fragment key={msg.id}>
            {shouldShowTimeDivider(msg, chatMessages[i - 1]) && (
              <div className="chat-time-divider">
                <span className="chat-time-label">{formatTimeDivider(msg.timestamp)}</span>
              </div>
            )}
            <MessageBubble message={msg} />
          </React.Fragment>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
