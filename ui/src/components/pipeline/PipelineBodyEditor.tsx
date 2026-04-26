import React, { useState, useEffect, useRef, useCallback } from "react";

const STAGE_PLACEHOLDERS: Record<string, string> = {
  idea: "Describe your idea... What's the core concept? Who is it for?",
  research: "Add research notes, references, links, and key findings...",
  outline: "Structure your content: main sections, key points, flow...",
  draft: "Write your full draft here — script, article, post, etc.",
  assets: "List required assets: thumbnails, images, graphics, audio clips...",
  review: "Ready for review. Add final notes before publishing.",
  scheduled: "Content is scheduled. Add last-minute changes if needed.",
  published: "Content is live!",
};

type Props = {
  body: string;
  stage: string;
  onSave: (body: string) => void;
};

export function PipelineBodyEditor({ body, stage, onSave }: Props) {
  const [value, setValue] = useState(body);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<Timer | null>(null);
  const lastSavedRef = useRef(body);

  // Sync when item changes
  useEffect(() => {
    setValue(body);
    lastSavedRef.current = body;
  }, [body]);

  const debouncedSave = useCallback(
    (text: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (text !== lastSavedRef.current) {
          setSaving(true);
          onSave(text);
          lastSavedRef.current = text;
          setTimeout(() => setSaving(false), 500);
        }
      }, 500);
    },
    [onSave]
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);
    debouncedSave(text);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 0",
        gap: "8px",
      }}>
        <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
          {value.length.toLocaleString()} chars
        </span>
        {saving && (
          <span style={{ fontSize: "11px", color: "var(--j-accent)", marginLeft: "auto" }}>
            Saving...
          </span>
        )}
      </div>

      {/* Textarea */}
      <textarea
        value={value}
        onChange={handleChange}
        placeholder={STAGE_PLACEHOLDERS[stage] || "Write content..."}
        style={{
          height: "300px",
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid var(--j-border)",
          background: "var(--j-bg)",
          color: "var(--j-text)",
          fontSize: "13px",
          lineHeight: "1.6",
          fontFamily: "inherit",
          resize: "vertical",
          outline: "none",
          transition: "border-color 0.15s",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--j-accent)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--j-border)"; }}
      />
    </div>
  );
}
