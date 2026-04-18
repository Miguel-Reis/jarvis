import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { ChatMessage } from "../hooks/useWebSocket";
import type { ApprovalRequest } from "../hooks/useWebSocket";
import type { UseVoiceReturn } from "../hooks/useVoice";
import { MessageList, isSystemMessage } from "../components/chat/MessageList";
import { ChatInput } from "../components/chat/ChatInput";
import { ThreadSidebar } from "../components/chat/ThreadSidebar";
import { SystemPanel } from "../components/chat/SystemPanel";
import { ApprovalBanner } from "../components/chat/ApprovalBanner";
import { useApiData } from "../hooks/useApi";
import "../styles/chat.css";

type ActiveProjectResp = { project: { id: string; name: string; color: string } | null };

const SYS_PANEL_KEY = "jarvis-sys-panel-collapsed";

type ChatPageProps = {
  messages: ChatMessage[];
  isConnected: boolean;
  sendMessage: (text: string, options?: { projectId?: string; threadId?: string }) => void;
  voice?: UseVoiceReturn;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  pendingApprovals: ApprovalRequest[];
  onResolveApproval: (id: string) => void;
};

export default function ChatPage({
  messages,
  isConnected,
  sendMessage,
  voice,
  activeThreadId,
  onSelectThread,
  onNewThread,
  pendingApprovals,
  onResolveApproval,
}: ChatPageProps) {
  const { data: activeProjectData } = useApiData<ActiveProjectResp>("/api/projects/active", []);
  const activeProject = activeProjectData?.project ?? null;

  const [disableImages, setDisableImages] = useState(false);
  const [sysPanelCollapsed, setSysPanelCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SYS_PANEL_KEY) === "1"; } catch { return false; }
  });
  const [sysPanelSeenCount, setSysPanelSeenCount] = useState(0);

  useEffect(() => {
    fetch('/api/config/llm')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.primary === 'ollama') setDisableImages(true);
      })
      .catch(() => {});
  }, []);

  const systemMessageCount = useMemo(
    () => messages.filter(isSystemMessage).length,
    [messages]
  );

  // Track unseen system messages when panel is collapsed
  const unseenCount = sysPanelCollapsed ? systemMessageCount - sysPanelSeenCount : 0;

  const handleToggleSysPanel = useCallback(() => {
    setSysPanelCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SYS_PANEL_KEY, next ? "1" : "0"); } catch {}
      if (!next) {
        // Opening — mark all as seen
        setSysPanelSeenCount(systemMessageCount);
      }
      return next;
    });
  }, [systemMessageCount]);

  // When panel is open, keep seen count in sync
  useEffect(() => {
    if (!sysPanelCollapsed) setSysPanelSeenCount(systemMessageCount);
  }, [systemMessageCount, sysPanelCollapsed]);

  const voiceStatus = voice
    ? voice.voiceState === "speaking" || voice.ttsAudioPlaying
      ? "JARVIS is speaking..."
      : voice.voiceState === "processing"
        ? "Transcribing..."
        : voice.voiceState === "recording"
          ? "Listening..."
          : null
    : null;

  return (
    <div className="chat-page-layout">
      {/* Thread history sidebar */}
      <ThreadSidebar
        activeThreadId={activeThreadId}
        onSelectThread={onSelectThread}
        onNewThread={onNewThread}
      />

      {/* Main chat area */}
      <div className="chat-page">
        {/* Atmosphere */}
        <div className="chat-atmos">
          <div className="chat-atmos-aurora" />
          <div className="chat-atmos-constellation">
            <div className="chat-const-node drift" style={{ width: 3, height: 3, background: "rgba(139,92,246,0.15)", top: "12%", left: "18%", "--dur": "12s", "--delay": "0s" } as React.CSSProperties} />
            <div className="chat-const-node drift" style={{ width: 2, height: 2, background: "rgba(96,165,250,0.12)", top: "28%", left: "72%", "--dur": "15s", "--delay": "2s" } as React.CSSProperties} />
            <div className="chat-const-node drift" style={{ width: 2, height: 2, background: "rgba(52,211,153,0.10)", top: "65%", left: "35%", "--dur": "18s", "--delay": "4s" } as React.CSSProperties} />
            <div className="chat-const-node drift" style={{ width: 3, height: 3, background: "rgba(139,92,246,0.12)", top: "80%", left: "82%", "--dur": "14s", "--delay": "1s" } as React.CSSProperties} />
            <div className="chat-const-node" style={{ width: 2, height: 2, background: "rgba(96,165,250,0.08)", top: "45%", left: "55%" }} />
            <svg className="chat-const-svg">
              <line x1="18%" y1="12%" x2="72%" y2="28%" stroke="rgba(139,92,246,0.03)" strokeWidth="1" strokeDasharray="4 8" style={{ animation: "chat-flowPulse 4s linear infinite" }} />
              <line x1="35%" y1="65%" x2="82%" y2="80%" stroke="rgba(52,211,153,0.02)" strokeWidth="1" strokeDasharray="4 8" style={{ animation: "chat-flowPulse 5s linear infinite" }} />
            </svg>
          </div>
          <div className="chat-stream-channel" style={{ left: "22%" }}>
            <div className="chat-stream-particle" style={{ background: "rgba(139,92,246,0.18)", "--dur": "8s", "--delay": "0s" } as React.CSSProperties} />
            <div className="chat-stream-particle" style={{ background: "rgba(139,92,246,0.12)", "--dur": "12s", "--delay": "3s" } as React.CSSProperties} />
          </div>
          <div className="chat-stream-channel" style={{ left: "68%" }}>
            <div className="chat-stream-particle" style={{ background: "rgba(96,165,250,0.14)", "--dur": "10s", "--delay": "1s" } as React.CSSProperties} />
            <div className="chat-stream-particle" style={{ background: "rgba(52,211,153,0.10)", "--dur": "14s", "--delay": "5s" } as React.CSSProperties} />
          </div>
          <div className="chat-stream-channel" style={{ left: "45%" }}>
            <div className="chat-stream-particle" style={{ background: "rgba(139,92,246,0.10)", "--dur": "11s", "--delay": "2s" } as React.CSSProperties} />
          </div>
        </div>

        {/* Connection status bar */}
        {!isConnected && (
          <div className="chat-status-bar chat-status-disconnected">
            <span className="chat-status-dot chat-status-dot-recording" />
            Disconnected from JARVIS. Reconnecting...
          </div>
        )}

        {/* Voice status bar */}
        {voiceStatus && (
          <div className="chat-status-bar chat-status-voice">
            <span className={`chat-status-dot ${voice?.voiceState === "recording" ? "chat-status-dot-recording" : "chat-status-dot-voice"}`} />
            {voiceStatus}
          </div>
        )}

        {/* Active project chip */}
        {activeProject && (
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "4px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)",
            fontSize: "11px", color: "rgba(255,255,255,0.40)",
          }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: activeProject.color, flexShrink: 0 }} />
            <span>Project: <strong style={{ color: "rgba(255,255,255,0.65)" }}>{activeProject.name}</strong></span>
            <a href="#/projects" style={{ marginLeft: "auto", color: "rgba(255,255,255,0.25)", textDecoration: "none", fontSize: "10px" }}>change</a>
          </div>
        )}

        {/* Approval banner — inline above messages */}
        <ApprovalBanner approvals={pendingApprovals} onResolved={onResolveApproval} />

        {/* Messages */}
        <MessageList messages={messages} />

        {/* Input */}
        <ChatInput
          onSend={(text, images) => sendMessage(text, { ...(activeThreadId ? { threadId: activeThreadId } : {}), ...(images ? { images } : {}) })}
          disabled={!isConnected}
          disableImages={disableImages}
          voice={voice ? {
            voiceState: voice.voiceState,
            startRecording: voice.startRecording,
            stopRecording: voice.stopRecording,
            isMicAvailable: voice.isMicAvailable,
            isWakeWordReady: voice.isWakeWordReady,
            ttsAudioPlaying: voice.ttsAudioPlaying,
            cancelTTS: voice.cancelTTS,
          } : undefined}
        />
      </div>

      {/* System panel — collapsible right sidebar */}
      <SystemPanel
        messages={messages}
        collapsed={sysPanelCollapsed}
        onToggle={handleToggleSysPanel}
        unseenCount={Math.max(0, unseenCount)}
      />
    </div>
  );
}
