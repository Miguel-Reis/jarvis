import React from "react";
import { api } from "../../hooks/useApi";

const STAGE_COLORS: Record<string, string> = {
  idea: "#a78bfa",
  research: "#60a5fa",
  outline: "#34d399",
  draft: "var(--j-accent)",
  assets: "#fbbf24",
  review: "#f472b6",
  scheduled: "var(--j-warning)",
  published: "var(--j-success)",
};

const STAGES = ["idea", "research", "outline", "draft", "assets", "review", "scheduled", "published"];

const JARVIS_ACTIONS: Record<string, { label: string; prompt: string }[]> = {
  idea: [
    { label: "Brainstorm variations", prompt: "Use the content_pipeline tool to get this content item, then brainstorm 5 creative variations and angles for it. Add the brainstorm results as a note." },
  ],
  research: [
    { label: "Research this topic", prompt: "Use the content_pipeline tool to get this content item, then research the topic thoroughly using your browser tools. Add your findings as research notes." },
  ],
  outline: [
    { label: "Generate outline", prompt: "Use the content_pipeline tool to get this content item, then create a detailed outline structure. Update the body with the outline." },
  ],
  draft: [
    { label: "Write first draft", prompt: "Use the content_pipeline tool to get this content item and its notes, then write a complete first draft based on the outline and research. Update the body with the draft." },
    { label: "Expand section", prompt: "Use the content_pipeline tool to get this content item, then expand and improve the current draft. Focus on adding depth, examples, and better transitions." },
  ],
  assets: [
    { label: "Suggest thumbnail ideas", prompt: "Use the content_pipeline tool to get this content item, then suggest 3-5 thumbnail/image ideas. Add them as asset notes." },
  ],
  review: [
    { label: "Review and score", prompt: "Use the content_pipeline tool to get this content item, then review it critically. Score it 1-10, identify strengths and weaknesses, and suggest improvements. Add review as a note." },
    { label: "Check grammar", prompt: "Use the content_pipeline tool to get this content item, then check grammar, spelling, and readability. Fix any issues and update the body." },
  ],
  scheduled: [
    { label: "Suggest publish time", prompt: "Use the content_pipeline tool to get this content item. Based on the content type and topic, suggest the best day/time to publish for maximum engagement. Add as a note." },
  ],
};

type Props = {
  contentId: string;
  stage: string;
  title: string;
  onAdvance: () => void;
  onRegress: () => void;
  onDelete: () => void;
  sendMessage: (text: string) => void;
};

export function PipelineActions({ contentId, stage, title, onAdvance, onRegress, onDelete, sendMessage }: Props) {
  const stageIdx = STAGES.indexOf(stage);
  const canAdvance = stageIdx >= 0 && stageIdx < STAGES.length - 1;
  const canRegress = stageIdx > 0;
  const nextStage = canAdvance ? STAGES[stageIdx + 1] : null;
  const prevStage = canRegress ? STAGES[stageIdx - 1] : null;
  const jarvisActions = JARVIS_ACTIONS[stage] || [];

  const handleJarvisAction = (action: { label: string; prompt: string }) => {
    const msg = `For my content item "${title}" (ID: ${contentId}): ${action.prompt}`;
    sendMessage(msg);
  };

  return (
    <div>
      <h3 style={{ fontSize: "13px", fontWeight: 600, color: "var(--j-text)", marginBottom: "10px" }}>
        Actions
      </h3>

      {/* Stage advance/regress */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        {canRegress && (
          <button
            onClick={onRegress}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "1px solid var(--j-border)",
              background: "transparent",
              color: "var(--j-text-dim)",
              fontSize: "12px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span style={{ fontSize: "10px" }}>{"\u25C0"}</span> Back to {prevStage}
          </button>
        )}
        {canAdvance && (
          <button
            onClick={onAdvance}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "none",
              background: STAGE_COLORS[nextStage!] || "var(--j-accent)",
              color: "#000",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            Advance to {nextStage} <span style={{ fontSize: "10px" }}>{"\u25B6"}</span>
          </button>
        )}
      </div>

      {/* JARVIS assist buttons */}
      {jarvisActions.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--j-accent)",
            marginBottom: "6px",
            letterSpacing: "0.5px",
          }}>
            JARVIS ASSIST
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {jarvisActions.map((action) => (
              <button
                key={action.label}
                onClick={() => handleJarvisAction(action)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--j-accent-dim)",
                  background: "rgba(0, 212, 255, 0.08)",
                  color: "var(--j-accent)",
                  fontSize: "11px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Delete */}
      <button
        onClick={onDelete}
        style={{
          padding: "6px 12px",
          borderRadius: "6px",
          border: "1px solid var(--j-error)",
          background: "transparent",
          color: "var(--j-error)",
          fontSize: "11px",
          cursor: "pointer",
          opacity: 0.7,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
      >
        Delete Item
      </button>
    </div>
  );
}
