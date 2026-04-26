import React from "react";
import { useApiData } from "../../hooks/useApi";

type RelWithEntities = {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  properties: Record<string, unknown> | null;
  created_at: number;
  from_entity: { id: string; name: string; type: string };
  to_entity: { id: string; name: string; type: string };
};

type Props = {
  entityId: string;
};

export function RelationshipList({ entityId }: Props) {
  const { data: rels, loading } = useApiData<RelWithEntities[]>(
    `/api/vault/entities/${entityId}/relationships`,
    [entityId]
  );

  if (loading) return <div style={loadingStyle}>Loading relationships...</div>;
  if (!rels || rels.length === 0) return <div style={emptyStyle}>No relationships found</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {rels.map((rel) => {
        const isFrom = rel.from_id === entityId;
        const otherEntity = isFrom ? rel.to_entity : rel.from_entity;
        const direction = isFrom ? "\u2192" : "\u2190";

        return (
          <div
            key={rel.id}
            style={{
              padding: "8px 12px",
              background: "var(--j-bg)",
              border: "1px solid var(--j-border)",
              borderRadius: "6px",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ color: "var(--j-accent2)", fontWeight: 500 }}>{rel.type}</span>
            <span style={{ color: "var(--j-text-muted)" }}>{direction}</span>
            <span style={{ color: "var(--j-text)" }}>{otherEntity.name}</span>
            <span
              style={{
                fontSize: "10px",
                color: "var(--j-text-muted)",
                textTransform: "capitalize",
                marginLeft: "auto",
              }}
            >
              {otherEntity.type}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const loadingStyle: React.CSSProperties = { padding: "12px", color: "var(--j-text-muted)", fontSize: "13px" };
const emptyStyle: React.CSSProperties = { padding: "12px", color: "var(--j-text-muted)", fontSize: "13px" };
