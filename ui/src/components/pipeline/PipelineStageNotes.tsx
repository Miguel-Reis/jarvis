import React, { useState } from "react";
import { api } from "../../hooks/useApi";

type StageNote = {
  id: string;
  content_id: string;
  stage: string;
  note: string;
  author: string;
  created_at: number;
};

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

type Props = {
  contentId: string;
  currentStage: string;
  notes: StageNote[];
  onNoteAdded: () => void;
};

export function PipelineStageNotes({ contentId, currentStage, notes, onNoteAdded }: Props) {
  const [newNote, setNewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setSubmitting(true);
    try {
      await api(`/api/content/${contentId}/notes`, {
        method: "POST",
        body: JSON.stringify({ stage: currentStage, note: newNote.trim(), author: "user" }),
      });
      setNewNote("");
      onNoteAdded();
    } catch (err) {
      console.error("Failed to add note:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Group by stage
  const grouped: Record<string, StageNote[]> = {};
  for (const n of notes) {
    if (!grouped[n.stage]) grouped[n.stage] = [];
    grouped[n.stage]!.push(n);
  }

  const stages = Object.keys(grouped);

  return (
    <div>
      <h3 style={{ fontSize: "13px", fontWeight: 600, color: "var(--j-text)", marginBottom: "10px" }}>
        Notes
      </h3>

      {/* Add note input */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
        <input
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={`Add note for ${currentStage} stage...`}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid var(--j-border)",
            background: "var(--j-bg)",
            color: "var(--j-text)",
            fontSize: "12px",
            outline: "none",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--j-accent)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--j-border)"; }}
        />
        <button
          onClick={handleAdd}
          disabled={submitting || !newNote.trim()}
          style={{
            padding: "8px 12px",
            borderRadius: "6px",
            border: "none",
            background: "var(--j-accent)",
            color: "#000",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            opacity: submitting || !newNote.trim() ? 0.5 : 1,
          }}
        >
          Add
        </button>
      </div>

      {/* Notes grouped by stage */}
      {stages.length === 0 && (
        <div style={{ color: "var(--j-text-muted)", fontSize: "12px", padding: "8px 0" }}>
          No notes yet
        </div>
      )}
      {stages.map((stage) => (
        <div key={stage} style={{ marginBottom: "10px" }}>
          <div style={{
            fontSize: "11px",
            fontWeight: 600,
            color: STAGE_COLORS[stage] || "var(--j-text-dim)",
            marginBottom: "4px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            {stage}
          </div>
          {grouped[stage]!.map((note) => (
            <div key={note.id} style={{
              padding: "8px 10px",
              marginBottom: "4px",
              borderRadius: "6px",
              background: "var(--j-surface-hover)",
              borderLeft: `3px solid ${note.author === "jarvis" ? "var(--j-accent)" : "#a78bfa"}`,
            }}>
              <div style={{ fontSize: "12px", color: "var(--j-text)", lineHeight: "1.4" }}>
                {note.note}
              </div>
              <div style={{
                fontSize: "10px",
                color: "var(--j-text-muted)",
                marginTop: "4px",
                display: "flex",
                gap: "8px",
              }}>
                <span style={{
                  fontWeight: 600,
                  color: note.author === "jarvis" ? "var(--j-accent)" : "#a78bfa",
                }}>
                  {note.author === "jarvis" ? "JARVIS" : "You"}
                </span>
                <span>{new Date(note.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
