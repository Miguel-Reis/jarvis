import React from "react";
import { FactList } from "./FactList";
import { RelationshipList } from "./RelationshipList";

type Entity = {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  source: string | null;
};

type Props = {
  entity: Entity;
};

export function EntityDetail({ entity }: Props) {
  return (
    <div style={{ padding: "20px", overflow: "auto", height: "100%" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <h2
          style={{
            fontSize: "20px",
            fontWeight: 600,
            color: "var(--j-text)",
            margin: 0,
          }}
        >
          {entity.name}
        </h2>
        <div style={{ display: "flex", gap: "12px", marginTop: "6px", fontSize: "12px", color: "var(--j-text-muted)" }}>
          <span
            style={{
              textTransform: "capitalize",
              padding: "2px 8px",
              borderRadius: "4px",
              background: "rgba(0, 212, 255, 0.1)",
              border: "1px solid rgba(0, 212, 255, 0.2)",
              color: "var(--j-accent)",
            }}
          >
            {entity.type}
          </span>
          {entity.source && <span>Source: {entity.source}</span>}
          <span>Created: {new Date(entity.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Properties */}
      {entity.properties && Object.keys(entity.properties).length > 0 && (
        <section style={{ marginBottom: "24px" }}>
          <h3 style={sectionHeaderStyle}>Properties</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {Object.entries(entity.properties).map(([key, value]) => (
              <div
                key={key}
                style={{
                  padding: "6px 12px",
                  background: "var(--j-bg)",
                  border: "1px solid var(--j-border)",
                  borderRadius: "4px",
                  fontSize: "13px",
                  display: "flex",
                  gap: "8px",
                }}
              >
                <span style={{ color: "var(--j-text-dim)", minWidth: "80px" }}>{key}</span>
                <span style={{ color: "var(--j-text)" }}>{String(value)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Facts */}
      <section style={{ marginBottom: "24px" }}>
        <h3 style={sectionHeaderStyle}>Facts</h3>
        <FactList entityId={entity.id} />
      </section>

      {/* Relationships */}
      <section>
        <h3 style={sectionHeaderStyle}>Relationships</h3>
        <RelationshipList entityId={entity.id} />
      </section>
    </div>
  );
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--j-text-dim)",
  marginBottom: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};
