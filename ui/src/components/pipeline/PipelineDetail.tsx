import React, { useState, useEffect, useCallback } from "react";
import { useApiData, api } from "../../hooks/useApi";
import { PipelineBodyEditor } from "./PipelineBodyEditor";
import { PipelineStageNotes } from "./PipelineStageNotes";
import { PipelineAttachments } from "./PipelineAttachments";
import { PipelineActions } from "./PipelineActions";
import type { ContentItem } from "./PipelineItemCard";

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
  itemId: string | null;
  refreshKey: number;
  sendMessage: (text: string) => void;
  onDeleted: () => void;
  onChanged: () => void;
};

export function PipelineDetail({ itemId, refreshKey, sendMessage, onDeleted, onChanged }: Props) {
  const { data: item, refetch: refetchItem } = useApiData<ContentItem>(
    itemId ? `/api/content/${itemId}` : null,
    [itemId, refreshKey]
  );
  const { data: notes, refetch: refetchNotes } = useApiData<any[]>(
    itemId ? `/api/content/${itemId}/notes` : null,
    [itemId, refreshKey]
  );
  const { data: attachments, refetch: refetchAttachments } = useApiData<any[]>(
    itemId ? `/api/content/${itemId}/attachments` : null,
    [itemId, refreshKey]
  );

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [tagsValue, setTagsValue] = useState("");

  useEffect(() => {
    if (item) {
      setTitleValue(item.title);
      setTagsValue(item.tags.join(", "));
    }
  }, [item]);

  const handleBodySave = useCallback(async (body: string) => {
    if (!itemId) return;
    try {
      await api(`/api/content/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
    } catch (err) {
      console.error("Failed to save body:", err);
    }
  }, [itemId]);

  const handleTitleSave = async () => {
    if (!itemId || !titleValue.trim()) return;
    setEditingTitle(false);
    try {
      await api(`/api/content/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: titleValue.trim() }),
      });
      onChanged();
    } catch (err) {
      console.error("Failed to save title:", err);
    }
  };

  const handleTagsSave = async () => {
    if (!itemId) return;
    setEditingTags(false);
    const tags = tagsValue.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      await api(`/api/content/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ tags }),
      });
      onChanged();
    } catch (err) {
      console.error("Failed to save tags:", err);
    }
  };

  const handleAdvance = async () => {
    if (!itemId) return;
    try {
      await api(`/api/content/${itemId}/advance`, { method: "POST" });
      refetchItem();
      onChanged();
    } catch (err) {
      console.error("Failed to advance:", err);
    }
  };

  const handleRegress = async () => {
    if (!itemId) return;
    try {
      await api(`/api/content/${itemId}/regress`, { method: "POST" });
      refetchItem();
      onChanged();
    } catch (err) {
      console.error("Failed to regress:", err);
    }
  };

  const handleDelete = async () => {
    if (!itemId) return;
    try {
      await api(`/api/content/${itemId}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  // Empty state
  if (!itemId) {
    return (
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--j-text-muted)",
        fontSize: "14px",
        flexDirection: "column",
        gap: "8px",
      }}>
        <span style={{ fontSize: "32px", opacity: 0.3 }}>{"\u25B6"}</span>
        <span>Select a content item to edit</span>
      </div>
    );
  }

  if (!item) {
    return (
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--j-text-muted)",
        fontSize: "13px",
      }}>
        Loading...
      </div>
    );
  }

  const stageColor = STAGE_COLORS[item.stage] || "var(--j-text-muted)";

  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--j-border)",
        flexShrink: 0,
      }}>
        {/* Title (click to edit) */}
        {editingTitle ? (
          <input
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => e.key === "Enter" && handleTitleSave()}
            autoFocus
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "var(--j-text)",
              background: "transparent",
              border: "none",
              borderBottom: "2px solid var(--j-accent)",
              outline: "none",
              width: "100%",
              padding: "0 0 4px 0",
            }}
          />
        ) : (
          <h1
            onClick={() => setEditingTitle(true)}
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "var(--j-text)",
              margin: 0,
              cursor: "text",
            }}
          >
            {item.title}
          </h1>
        )}

        {/* Meta row */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginTop: "8px",
          flexWrap: "wrap",
        }}>
          <span style={{
            fontSize: "11px",
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: "4px",
            background: `${stageColor}20`,
            color: stageColor,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}>
            {item.stage}
          </span>
          <span style={{
            fontSize: "11px",
            padding: "3px 8px",
            borderRadius: "4px",
            background: "rgba(124, 58, 237, 0.2)",
            color: "#a78bfa",
            fontWeight: 600,
          }}>
            {item.content_type}
          </span>
          <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
            by {item.created_by}
          </span>
          <span style={{
            fontSize: "11px",
            color: "var(--j-text-muted)",
            marginLeft: "auto",
          }}>
            Updated {new Date(item.updated_at).toLocaleString()}
          </span>
        </div>

        {/* Tags (click to edit) */}
        <div style={{ marginTop: "8px" }}>
          {editingTags ? (
            <input
              value={tagsValue}
              onChange={(e) => setTagsValue(e.target.value)}
              onBlur={handleTagsSave}
              onKeyDown={(e) => e.key === "Enter" && handleTagsSave()}
              autoFocus
              placeholder="tag1, tag2, tag3"
              style={{
                fontSize: "11px",
                color: "var(--j-text)",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--j-accent)",
                outline: "none",
                width: "100%",
                padding: "2px 0",
              }}
            />
          ) : (
            <div
              onClick={() => setEditingTags(true)}
              style={{ display: "flex", gap: "4px", flexWrap: "wrap", cursor: "text", minHeight: "20px" }}
            >
              {item.tags.length > 0 ? (
                item.tags.map((tag) => (
                  <span key={tag} style={{
                    fontSize: "10px",
                    padding: "2px 6px",
                    borderRadius: "3px",
                    background: "var(--j-surface-hover)",
                    color: "var(--j-text-dim)",
                  }}>
                    {tag}
                  </span>
                ))
              ) : (
                <span style={{ fontSize: "10px", color: "var(--j-text-muted)", fontStyle: "italic" }}>
                  Click to add tags
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content area */}
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}>
        {/* Body editor */}
        <PipelineBodyEditor body={item.body} stage={item.stage} onSave={handleBodySave} />

        {/* Actions */}
        <PipelineActions
          contentId={item.id}
          stage={item.stage}
          title={item.title}
          onAdvance={handleAdvance}
          onRegress={handleRegress}
          onDelete={handleDelete}
          sendMessage={sendMessage}
        />

        {/* Notes */}
        <PipelineStageNotes
          contentId={item.id}
          currentStage={item.stage}
          notes={notes ?? []}
          onNoteAdded={refetchNotes}
        />

        {/* Attachments */}
        <PipelineAttachments
          contentId={item.id}
          attachments={attachments ?? []}
          onChanged={refetchAttachments}
        />
      </div>
    </div>
  );
}
