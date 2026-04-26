import React, { useState } from "react";
import { useApiData } from "../../hooks/useApi";

type Entity = {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  source: string | null;
};

const ENTITY_TYPES = ["all", "person", "project", "tool", "place", "concept", "event"] as const;

type Props = {
  onSelect: (entity: Entity) => void;
  selectedId?: string;
};

export function EntityList({ onSelect, selectedId }: Props) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const queryParams = new URLSearchParams();
  if (typeFilter !== "all") queryParams.set("type", typeFilter);
  if (search) queryParams.set("q", search);
  const queryStr = queryParams.toString();

  const { data: entities, loading } = useApiData<Entity[]>(
    `/api/vault/entities${queryStr ? `?${queryStr}` : ""}`,
    [typeFilter, search]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Search */}
      <div style={{ padding: "12px", borderBottom: "1px solid var(--j-border)" }}>
        <input
          type="text"
          placeholder="Search entities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            background: "var(--j-bg)",
            border: "1px solid var(--j-border)",
            borderRadius: "6px",
            color: "var(--j-text)",
            fontSize: "13px",
            outline: "none",
          }}
        />
      </div>

      {/* Type filters */}
      <div
        style={{
          display: "flex",
          gap: "4px",
          padding: "8px 12px",
          borderBottom: "1px solid var(--j-border)",
          overflowX: "auto",
          flexWrap: "wrap",
        }}
      >
        {ENTITY_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            style={{
              padding: "4px 10px",
              borderRadius: "12px",
              border: "1px solid",
              borderColor: typeFilter === t ? "var(--j-accent)" : "var(--j-border)",
              background: typeFilter === t ? "rgba(0, 212, 255, 0.1)" : "transparent",
              color: typeFilter === t ? "var(--j-accent)" : "var(--j-text-dim)",
              fontSize: "11px",
              cursor: "pointer",
              textTransform: "capitalize",
              whiteSpace: "nowrap",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Entity list */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {loading && (
          <div style={{ padding: "20px", color: "var(--j-text-muted)", fontSize: "13px", textAlign: "center" }}>
            Loading...
          </div>
        )}
        {!loading && entities && entities.length === 0 && (
          <div style={{ padding: "20px", color: "var(--j-text-muted)", fontSize: "13px", textAlign: "center" }}>
            No entities found
          </div>
        )}
        {entities?.map((entity) => (
          <button
            key={entity.id}
            onClick={() => onSelect(entity)}
            style={{
              display: "block",
              width: "100%",
              padding: "10px 16px",
              background: selectedId === entity.id ? "var(--j-surface-hover)" : "transparent",
              border: "none",
              borderLeft: selectedId === entity.id ? "2px solid var(--j-accent)" : "2px solid transparent",
              color: "var(--j-text)",
              textAlign: "left",
              cursor: "pointer",
              fontSize: "13px",
              transition: "background 0.1s",
            }}
          >
            <div style={{ fontWeight: 500 }}>{entity.name}</div>
            <div style={{ fontSize: "11px", color: "var(--j-text-muted)", marginTop: "2px", textTransform: "capitalize" }}>
              {entity.type}
              {entity.source && ` / ${entity.source}`}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
