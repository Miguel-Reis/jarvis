import React from "react";
import { useApiData } from "../../hooks/useApi";

type Fact = {
  id: string;
  subject_id: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string | null;
  created_at: number;
};

type Props = {
  entityId: string;
};

export function FactList({ entityId }: Props) {
  const { data: facts, loading } = useApiData<Fact[]>(
    `/api/vault/entities/${entityId}/facts`,
    [entityId]
  );

  if (loading) return <div style={loadingStyle}>Loading facts...</div>;
  if (!facts || facts.length === 0) return <div style={emptyStyle}>No facts recorded</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {facts.map((fact) => (
        <div
          key={fact.id}
          style={{
            padding: "8px 12px",
            background: "var(--j-bg)",
            border: "1px solid var(--j-border)",
            borderRadius: "6px",
            fontSize: "13px",
          }}
        >
          <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
            <span style={{ color: "var(--j-accent)", fontWeight: 500, minWidth: "80px" }}>
              {fact.predicate}
            </span>
            <span style={{ color: "var(--j-text)" }}>{fact.object}</span>
          </div>
          <div style={{ display: "flex", gap: "12px", marginTop: "4px", fontSize: "11px", color: "var(--j-text-muted)" }}>
            <span>Confidence: {(fact.confidence * 100).toFixed(0)}%</span>
            {fact.source && <span>Source: {fact.source}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

const loadingStyle: React.CSSProperties = { padding: "12px", color: "var(--j-text-muted)", fontSize: "13px" };
const emptyStyle: React.CSSProperties = { padding: "12px", color: "var(--j-text-muted)", fontSize: "13px" };
