import React, { useState } from "react";
import { useApiData } from "../../hooks/useApi";

type CaptureRow = {
  id: string;
  timestamp: number;
  app_name: string | null;
  window_title: string | null;
  ocr_text: string | null;
  pixel_change_pct: number;
  image_path: string | null;
  thumbnail_path: string | null;
  retention_tier: string;
};

export function ActivityTimeline() {
  const [limit, setLimit] = useState(50);
  const [appFilter, setAppFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const path = `/api/awareness/captures?limit=${limit}${appFilter ? `&app=${encodeURIComponent(appFilter)}` : ""}`;
  const { data, loading } = useApiData<CaptureRow[]>(path, [limit, appFilter]);

  const captures = data ?? [];

  // Get unique apps for filter
  const apps = [...new Set(captures.map(c => c.app_name).filter(Boolean))];

  return (
    <div style={cardStyle}>
      <div style={{ ...headerStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Activity Timeline</span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {apps.length > 0 && (
            <select
              value={appFilter}
              onChange={e => setAppFilter(e.target.value)}
              style={selectStyle}
            >
              <option value="">All apps</option>
              {apps.map(app => <option key={app!} value={app!}>{app}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ padding: "16px", color: "var(--j-text-muted)", fontSize: "13px" }}>Loading captures...</div>
      )}

      <div style={{ maxHeight: "600px", overflow: "auto" }}>
        {captures.map((c, i) => {
          const time = new Date(c.timestamp);
          const isExpanded = expandedId === c.id;
          const showAppChange = i > 0 && captures[i]!.app_name !== captures[i - 1]!.app_name;

          return (
            <React.Fragment key={c.id}>
              {showAppChange && (
                <div style={{
                  padding: "4px 16px",
                  fontSize: "11px",
                  color: "var(--j-accent)",
                  background: "rgba(0, 212, 255, 0.05)",
                  borderBottom: "1px solid var(--j-border)",
                }}>
                  Switched to {c.app_name}
                </div>
              )}
              <div
                onClick={() => setExpandedId(isExpanded ? null : c.id)}
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--j-border)",
                  cursor: "pointer",
                  background: isExpanded ? "rgba(0, 212, 255, 0.03)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {(c.thumbnail_path || c.image_path) && (
                    <img
                      src={`/api/awareness/captures/${c.id}/thumbnail`}
                      alt=""
                      style={{ width: "48px", height: "32px", objectFit: "cover", borderRadius: "3px", flexShrink: 0 }}
                      loading="lazy"
                    />
                  )}
                  <span style={{ fontSize: "12px", color: "var(--j-text-muted)", minWidth: "55px" }}>
                    {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span style={pillStyle}>{c.app_name || "Unknown"}</span>
                  {c.retention_tier === "key_moment" && (
                    <span style={{ ...pillStyle, background: "rgba(255,170,0,0.15)", color: "#ffa500" }}>key</span>
                  )}
                  <span style={{ fontSize: "12px", color: "var(--j-text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.window_title || ""}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>
                    {Math.round(c.pixel_change_pct * 100)}%
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: "8px" }}>
                    {c.image_path && (
                      <img
                        src={`/api/awareness/captures/${c.id}/image`}
                        alt="Screen capture"
                        style={{ width: "100%", maxHeight: "300px", objectFit: "contain", borderRadius: "4px", marginBottom: "8px" }}
                      />
                    )}
                    {c.ocr_text && (
                      <div style={{
                        fontSize: "11px",
                        color: "var(--j-text-dim)",
                        background: "var(--j-bg)",
                        padding: "8px",
                        borderRadius: "4px",
                        maxHeight: "150px",
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                        fontFamily: "monospace",
                      }}>
                        {c.ocr_text.slice(0, 1000)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {captures.length >= limit && (
        <div
          onClick={() => setLimit(l => l + 50)}
          style={{
            padding: "10px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--j-accent)",
            cursor: "pointer",
            borderTop: "1px solid var(--j-border)",
          }}
        >
          Load more
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--j-surface)",
  border: "1px solid var(--j-border)",
  borderRadius: "8px",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--j-text)",
  borderBottom: "1px solid var(--j-border)",
};

const pillStyle: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: "10px",
  background: "rgba(0, 212, 255, 0.1)",
  color: "var(--j-accent)",
  fontSize: "11px",
  fontWeight: 500,
};

const selectStyle: React.CSSProperties = {
  background: "var(--j-bg)",
  border: "1px solid var(--j-border)",
  borderRadius: "4px",
  color: "var(--j-text)",
  fontSize: "12px",
  padding: "4px 8px",
};
