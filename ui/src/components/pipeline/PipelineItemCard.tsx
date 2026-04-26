import React from "react";

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

const TYPE_LABELS: Record<string, string> = {
  youtube: "YT",
  blog: "Blog",
  twitter: "X",
  instagram: "IG",
  tiktok: "TT",
  linkedin: "LI",
  podcast: "Pod",
  newsletter: "NL",
  short_form: "Short",
  other: "Other",
};

export type ContentItem = {
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

type Props = {
  item: ContentItem;
  selected: boolean;
  justUpdated?: boolean;
  onClick: () => void;
};

export function PipelineItemCard({ item, selected, justUpdated, onClick }: Props) {
  const stageColor = STAGE_COLORS[item.stage] || "var(--j-text-muted)";
  const typeLabel = TYPE_LABELS[item.content_type] || item.content_type;
  const timeAgo = formatTimeAgo(item.updated_at);

  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px",
        borderRadius: "8px",
        border: selected ? `1px solid ${stageColor}` : "1px solid var(--j-border)",
        background: selected ? "rgba(0, 212, 255, 0.05)" : "var(--j-surface)",
        cursor: "pointer",
        transition: "all 0.15s ease",
        animation: justUpdated ? "taskPulse 1.5s ease-out" : undefined,
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--j-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--j-surface)";
      }}
    >
      {/* Top row: type badge + stage */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
        <span style={{
          fontSize: "10px",
          fontWeight: 700,
          padding: "2px 6px",
          borderRadius: "4px",
          background: "rgba(124, 58, 237, 0.2)",
          color: "#a78bfa",
          letterSpacing: "0.5px",
        }}>
          {typeLabel}
        </span>
        <span style={{
          fontSize: "10px",
          fontWeight: 600,
          padding: "2px 6px",
          borderRadius: "4px",
          background: `${stageColor}20`,
          color: stageColor,
        }}>
          {item.stage}
        </span>
        <span style={{
          fontSize: "10px",
          color: "var(--j-text-muted)",
          marginLeft: "auto",
        }}>
          {timeAgo}
        </span>
      </div>

      {/* Title */}
      <div style={{
        fontSize: "13px",
        fontWeight: 500,
        color: "var(--j-text)",
        lineHeight: "1.3",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {item.title}
      </div>

      {/* Tags */}
      {item.tags.length > 0 && (
        <div style={{ display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" }}>
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag} style={{
              fontSize: "10px",
              padding: "1px 5px",
              borderRadius: "3px",
              background: "var(--j-surface-hover)",
              color: "var(--j-text-dim)",
            }}>
              {tag}
            </span>
          ))}
          {item.tags.length > 3 && (
            <span style={{ fontSize: "10px", color: "var(--j-text-muted)" }}>
              +{item.tags.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
