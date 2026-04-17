import React, { useState } from "react";
import { useApiData } from "../../hooks/useApi";
import { SidecarConfigEditor } from "./SidecarConfigEditor";

type UnavailableCapability = {
  name: string;
  reason: string;
};

type SidecarInfo = {
  id: string;
  name: string;
  enrolled_at: string;
  last_seen_at: string | null;
  status: string;
  connected: boolean;
  hostname?: string;
  os?: string;
  platform?: string;
  capabilities?: string[];
  unavailable_capabilities?: UnavailableCapability[];
};

export function SidecarPanel() {
  const { data: sidecars, loading, refetch } = useApiData<SidecarInfo[]>("/api/sidecars", []);
  const [enrollName, setEnrollName] = useState("");
  const [enrollResult, setEnrollResult] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [configTarget, setConfigTarget] = useState<{ id: string; name: string } | null>(null);

  const handleEnroll = async () => {
    if (!enrollName.trim()) return;
    setEnrolling(true);
    setError("");
    setEnrollResult(null);
    try {
      const res = await fetch("/api/sidecars/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: enrollName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Enrollment failed");
      }
      const data = await res.json();
      setEnrollResult({ token: data.token, name: enrollName.trim() });
      setEnrollName("");
      refetch();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEnrolling(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await fetch(`/api/sidecars/${id}`, { method: "DELETE" });
      refetch();
    } catch {}
  };

  const copyToken = () => {
    if (enrollResult) {
      navigator.clipboard.writeText(enrollResult.token);
    }
  };

  return (
    <div className="sp-card">
      <h3 className="sp-card-title">Sidecars</h3>

      {/* Enroll form */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "12px", color: "var(--j-text-muted)", marginBottom: "8px" }}>
          Enroll a new sidecar client to extend JARVIS to other machines.
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            className="sp-input"
            style={{ flex: 1 }}
            placeholder="Sidecar name (e.g. work-laptop)"
            value={enrollName}
            onChange={(e) => setEnrollName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleEnroll()}
          />
          <button onClick={handleEnroll} disabled={enrolling || !enrollName.trim()} className="sp-btn-primary">
            {enrolling ? "..." : "Enroll"}
          </button>
        </div>
        {error && (
          <div style={{ color: "var(--j-error, #f44)", fontSize: "12px", marginTop: "6px" }}>{error}</div>
        )}
      </div>

      {/* Token display */}
      {enrollResult && (
        <div style={tokenBoxStyle}>
          <div style={{ fontSize: "12px", color: "var(--j-accent)", marginBottom: "6px", fontWeight: 500 }}>
            Token for "{enrollResult.name}" — copy and run on the target machine:
          </div>
          <code className="sp-mono" style={{ display: "block", wordBreak: "break-all" }}>jarvis-sidecar --token {enrollResult.token.slice(0, 40)}...</code>
          <button onClick={copyToken} className="sp-btn-secondary" style={{ marginTop: "8px", fontSize: "11px" }}>
            Copy Full Token
          </button>
        </div>
      )}

      {/* Sidecar list */}
      {loading ? (
        <span style={{ color: "var(--j-text-muted)", fontSize: "13px" }}>Loading...</span>
      ) : !sidecars || sidecars.length === 0 ? (
        <div style={{ color: "var(--j-text-muted)", fontSize: "13px" }}>No sidecars enrolled.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {sidecars.map((sc) => (
            <div key={sc.id} style={sidecarRowStyle}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: sc.connected ? "var(--j-success, #4f4)" : "var(--j-text-muted)",
                      display: "inline-block",
                    }}
                  />
                  <span style={{ color: "var(--j-text)", fontSize: "13px", fontWeight: 500 }}>{sc.name}</span>
                  {sc.hostname && (
                    <span style={{ color: "var(--j-text-muted)", fontSize: "11px" }}>({sc.hostname})</span>
                  )}
                </div>
                <div style={{ fontSize: "11px", color: "var(--j-text-dim)", marginTop: "2px", paddingLeft: "16px" }}>
                  {sc.os && sc.platform ? `${sc.os}/${sc.platform}` : ""}
                  {sc.capabilities && sc.capabilities.length > 0 && (
                    <span> · {sc.capabilities.join(", ")}</span>
                  )}
                  {sc.unavailable_capabilities && sc.unavailable_capabilities.length > 0 && (
                    <span>
                      {" · "}
                      {sc.unavailable_capabilities.map((u, i) => (
                        <span key={u.name} title={u.reason} style={{ color: "var(--j-warning, #fa0)", cursor: "help" }}>
                          {i > 0 ? ", " : ""}&#9888; {u.name}
                        </span>
                      ))}
                    </span>
                  )}
                  {sc.last_seen_at && (
                    <span> · Last seen {new Date(sc.last_seen_at).toLocaleString()}</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                {sc.connected && (
                  <button
                    onClick={() => setConfigTarget({ id: sc.id, name: sc.name })}
                    className="sp-btn-secondary"
                    style={{ fontSize: "11px", padding: "4px 10px" }}
                  >
                    Configure
                  </button>
                )}
                <button
                  onClick={() => handleRevoke(sc.id)}
                  className="sp-btn-danger"
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Config editor modal */}
      {configTarget && (
        <SidecarConfigEditor
          sidecarId={configTarget.id}
          sidecarName={configTarget.name}
          unavailableCapabilities={
            sidecars?.find(s => s.id === configTarget.id)?.unavailable_capabilities ?? []
          }
          onClose={() => setConfigTarget(null)}
        />
      )}
    </div>
  );
}

const tokenBoxStyle: React.CSSProperties = {
  padding: "12px",
  background: "rgba(139, 92, 246, 0.06)",
  border: "1px solid rgba(139, 92, 246, 0.25)",
  borderRadius: "8px",
  marginBottom: "16px",
};

const sidecarRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "10px 12px",
  background: "rgba(255, 255, 255, 0.02)",
  border: "1px solid rgba(255, 255, 255, 0.05)",
  borderRadius: "8px",
  gap: "12px",
};
