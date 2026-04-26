import React from "react";
import { MemoryDocumentCard } from "./MemoryDocumentCard";
import type { MemoryProfile } from "./MemoryDocumentCard";

type Props = {
  profiles: MemoryProfile[];
  searchQuery: string;
  loading: boolean;
};

export function MemoryGrid({ profiles, searchQuery, loading }: Props) {
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 20px",
          color: "var(--j-text-muted)",
          fontSize: "13px",
        }}
      >
        <span
          style={{
            display: "inline-block",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        >
          Searching memories...
        </span>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 20px",
          color: "var(--j-text-muted)",
          gap: "8px",
        }}
      >
        <span style={{ fontSize: "32px", opacity: 0.3 }}>{"\u25C6"}</span>
        <span style={{ fontSize: "14px" }}>
          {searchQuery
            ? "No memories match your search"
            : "JARVIS hasn't learned anything yet"}
        </span>
        {!searchQuery && (
          <span style={{ fontSize: "12px", color: "var(--j-text-muted)" }}>
            Start a conversation and memories will appear here
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
        gap: "16px",
      }}
    >
      {profiles.map((profile) => (
        <MemoryDocumentCard
          key={profile.entity.id}
          profile={profile}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  );
}
