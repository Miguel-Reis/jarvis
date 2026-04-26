import React, { useState } from "react";
import { api } from "../../hooks/useApi";

const CONTENT_TYPES = [
  { value: "youtube", label: "YouTube" },
  { value: "blog", label: "Blog" },
  { value: "twitter", label: "Twitter / X" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "podcast", label: "Podcast" },
  { value: "newsletter", label: "Newsletter" },
  { value: "short_form", label: "Short Form" },
  { value: "other", label: "Other" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function ContentCreateModal({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState("blog");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await api("/api/content", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          content_type: contentType,
          tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
        }),
      });
      setTitle("");
      setContentType("blog");
      setTags("");
      onCreated();
      onClose();
    } catch (err) {
      console.error("Failed to create content:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--j-surface)",
          borderRadius: "12px",
          border: "1px solid var(--j-border)",
          padding: "24px",
          width: "420px",
          maxWidth: "90vw",
        }}
      >
        <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--j-text)", marginBottom: "16px" }}>
          New Content Item
        </h2>

        {/* Title */}
        <div style={{ marginBottom: "12px" }}>
          <label style={{ fontSize: "11px", color: "var(--j-text-muted)", fontWeight: 600, display: "block", marginBottom: "4px" }}>
            TITLE
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="e.g., How to Build an AI Agent"
            autoFocus
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "6px",
              border: "1px solid var(--j-border)",
              background: "var(--j-bg)",
              color: "var(--j-text)",
              fontSize: "13px",
              outline: "none",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--j-accent)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--j-border)"; }}
          />
        </div>

        {/* Content Type */}
        <div style={{ marginBottom: "12px" }}>
          <label style={{ fontSize: "11px", color: "var(--j-text-muted)", fontWeight: 600, display: "block", marginBottom: "4px" }}>
            CONTENT TYPE
          </label>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "6px",
              border: "1px solid var(--j-border)",
              background: "var(--j-bg)",
              color: "var(--j-text)",
              fontSize: "13px",
              outline: "none",
            }}
          >
            {CONTENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Tags */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ fontSize: "11px", color: "var(--j-text-muted)", fontWeight: 600, display: "block", marginBottom: "4px" }}>
            TAGS (comma-separated)
          </label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g., ai, tutorial, beginner"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "6px",
              border: "1px solid var(--j-border)",
              background: "var(--j-bg)",
              color: "var(--j-text)",
              fontSize: "13px",
              outline: "none",
            }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid var(--j-border)",
              background: "transparent",
              color: "var(--j-text-dim)",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background: "var(--j-accent)",
              color: "#000",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              opacity: submitting || !title.trim() ? 0.5 : 1,
            }}
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
