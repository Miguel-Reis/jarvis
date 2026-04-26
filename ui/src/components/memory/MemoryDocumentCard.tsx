import React from "react";

type Entity = {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  source: string | null;
};

type Fact = {
  id: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string | null;
};

type RelationshipEntry = {
  type: string;
  target: string;
  direction: "from" | "to";
};

export type MemoryProfile = {
  entity: Entity;
  facts: Fact[];
  relationships: RelationshipEntry[];
};

const TYPE_COLORS: Record<string, string> = {
  person: "#a78bfa",
  project: "#60a5fa",
  tool: "#34d399",
  place: "#fbbf24",
  concept: "#f472b6",
  event: "#00d4ff",
};

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark
        key={i}
        style={{
          background: "rgba(0, 212, 255, 0.25)",
          color: "inherit",
          borderRadius: "2px",
          padding: "0 1px",
        }}
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

type Props = {
  profile: MemoryProfile;
  searchQuery: string;
};

export function MemoryDocumentCard({ profile, searchQuery }: Props) {
  const { entity, facts, relationships } = profile;
  const typeColor = TYPE_COLORS[entity.type] || "var(--j-text-muted)";

  return (
    <div
      style={{
        background: "var(--j-surface)",
        border: "1px solid var(--j-border)",
        borderRadius: "12px",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        transition: "border-color 0.15s, box-shadow 0.15s",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = typeColor;
        e.currentTarget.style.boxShadow = `0 0 0 1px ${typeColor}33, 0 4px 12px rgba(0,0,0,0.15)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--j-border)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: typeColor,
            background: `${typeColor}18`,
            padding: "3px 8px",
            borderRadius: "4px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {entity.type}
        </span>
        <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--j-text)", lineHeight: 1.3 }}>
          {highlightText(entity.name, searchQuery)}
        </div>
      </div>

      {/* Facts */}
      {facts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {facts.slice(0, 8).map((fact) => (
            <div
              key={fact.id}
              style={{
                display: "flex",
                gap: "8px",
                fontSize: "12px",
                lineHeight: 1.5,
              }}
            >
              <span
                style={{
                  color: "var(--j-text-muted)",
                  minWidth: "fit-content",
                  flexShrink: 0,
                }}
              >
                {highlightText(fact.predicate, searchQuery)}
              </span>
              <span style={{ color: "var(--j-text-dim)" }}>{"\u2192"}</span>
              <span style={{ color: "var(--j-text)" }}>
                {highlightText(fact.object, searchQuery)}
              </span>
            </div>
          ))}
          {facts.length > 8 && (
            <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
              +{facts.length - 8} more facts
            </span>
          )}
        </div>
      )}

      {/* Relationships */}
      {relationships.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {relationships.slice(0, 6).map((rel, i) => (
            <span
              key={i}
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "12px",
                background: "var(--j-bg)",
                border: "1px solid var(--j-border)",
                color: "var(--j-text-dim)",
                whiteSpace: "nowrap",
              }}
            >
              {highlightText(rel.type, searchQuery)} {"\u2192"}{" "}
              <span style={{ color: "var(--j-text)" }}>
                {highlightText(rel.target, searchQuery)}
              </span>
            </span>
          ))}
          {relationships.length > 6 && (
            <span
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                color: "var(--j-text-muted)",
              }}
            >
              +{relationships.length - 6} more
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginTop: "auto",
          paddingTop: "4px",
          borderTop: "1px solid var(--j-border)",
        }}
      >
        {entity.source && (
          <span
            style={{
              fontSize: "10px",
              color: "var(--j-text-muted)",
              background: "var(--j-bg)",
              padding: "2px 6px",
              borderRadius: "4px",
            }}
          >
            {entity.source}
          </span>
        )}
        <span style={{ fontSize: "10px", color: "var(--j-text-muted)", marginLeft: "auto" }}>
          {facts.length} facts {"\u00B7"} {relationships.length} connections {"\u00B7"}{" "}
          {timeAgo(entity.updated_at)}
        </span>
      </div>
    </div>
  );
}
