import React, { useState } from "react";
import { PipelineItemCard, type ContentItem } from "./PipelineItemCard";

const STAGES = [
  { value: "", label: "All" },
  { value: "idea", label: "Idea", color: "#a78bfa" },
  { value: "research", label: "Research", color: "#60a5fa" },
  { value: "outline", label: "Outline", color: "#34d399" },
  { value: "draft", label: "Draft", color: "var(--j-accent)" },
  { value: "assets", label: "Assets", color: "#fbbf24" },
  { value: "review", label: "Review", color: "#f472b6" },
  { value: "scheduled", label: "Sched", color: "var(--j-warning)" },
  { value: "published", label: "Pub", color: "var(--j-success)" },
];

type Props = {
  items: ContentItem[];
  selectedId: string | null;
  recentlyUpdated: Set<string>;
  onSelect: (id: string) => void;
  onCreate: () => void;
};

export function PipelineList({ items, selectedId, recentlyUpdated, onSelect, onCreate }: Props) {
  const [stageFilter, setStageFilter] = useState("");

  const filtered = stageFilter
    ? items.filter((i) => i.stage === stageFilter)
    : items;

  return (
    <div style={{
      width: "320px",
      minWidth: "320px",
      borderRight: "1px solid var(--j-border)",
      display: "flex",
      flexDirection: "column",
      height: "100%",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px",
        borderBottom: "1px solid var(--j-border)",
        display: "flex",
        alignItems: "center",
      }}>
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--j-text)", margin: 0 }}>
          Content ({filtered.length})
        </h2>
        <button
          onClick={onCreate}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            borderRadius: "6px",
            border: "none",
            background: "var(--j-accent)",
            color: "#000",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          + New
        </button>
      </div>

      {/* Stage filter chips */}
      <div style={{
        padding: "8px 12px",
        display: "flex",
        gap: "4px",
        flexWrap: "wrap",
        borderBottom: "1px solid var(--j-border)",
      }}>
        {STAGES.map((s) => {
          const isActive = stageFilter === s.value;
          const count = s.value ? items.filter((i) => i.stage === s.value).length : items.length;
          return (
            <button
              key={s.value}
              onClick={() => setStageFilter(s.value)}
              style={{
                padding: "3px 8px",
                borderRadius: "10px",
                border: "none",
                fontSize: "10px",
                fontWeight: 600,
                cursor: "pointer",
                background: isActive
                  ? (s.color ? `${s.color}30` : "rgba(0, 212, 255, 0.15)")
                  : "var(--j-surface-hover)",
                color: isActive
                  ? (s.color || "var(--j-accent)")
                  : "var(--j-text-muted)",
                transition: "all 0.15s",
              }}
            >
              {s.label} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Item list */}
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "8px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}>
        {filtered.length === 0 && (
          <div style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "var(--j-text-muted)",
            fontSize: "13px",
          }}>
            {stageFilter ? `No ${stageFilter} items` : "No content yet. Create your first item!"}
          </div>
        )}
        {filtered.map((item) => (
          <PipelineItemCard
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            justUpdated={recentlyUpdated.has(item.id)}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </div>
    </div>
  );
}
