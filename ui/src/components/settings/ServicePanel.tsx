import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, useApiData } from "../../hooks/useApi";

type AutostartStatus = {
  platform: string;
  manager: string;
  installed: boolean;
  keepalive_supported: boolean;
  restart_supported: boolean;
};

export function ServicePanel() {
  const { data, loading, error, refetch } = useApiData<AutostartStatus>("/api/system/autostart", []);
  const [phase, setPhase] = useState<"idle" | "restarting">("idle");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const restartService = async () => {
    setPhase("restarting");
    setMessage(null);
    try {
      const res = await api<{ ok: boolean; message: string }>("/api/system/autostart/restart", {
        method: "POST",
      });
      setMessage({ text: res.message, type: "success" });
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(async () => {
        await refetch();
        setPhase("idle");
        refreshTimerRef.current = null;
      }, 2500);
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Failed to restart service.",
        type: "error",
      });
      setPhase("idle");
    }
  };

  if (loading) {
    return <div className="sp-card"><span style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>Loading service controls...</span></div>;
  }

  if (error && !data) {
    return (
      <div className="sp-card">
        <div className="sp-msg sp-msg--error" style={{ marginBottom: 0 }}>
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="sp-card"><span style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>Service controls unavailable.</span></div>;
  }

  return (
    <div className="sp-card">
      <div style={headerRowStyle}>
        <div>
          <h3 className="sp-card-title" style={{ margin: 0 }}>24/7 Service</h3>
          <div style={subtleStyle}>
            Manage the keepalive service that keeps JARVIS running after the terminal closes.
          </div>
        </div>
        <span
          style={{
            ...statusBadgeStyle,
            color: data.installed ? "var(--j-success)" : "var(--j-text-muted)",
            borderColor: data.installed ? "rgba(52, 211, 153, 0.25)" : "var(--j-border)",
            background: data.installed ? "rgba(52, 211, 153, 0.10)" : "rgba(255,255,255,0.03)",
          }}
        >
          {data.installed ? "Installed" : "Not Installed"}
        </span>
      </div>

      <div style={infoGridStyle}>
        <InfoRow label="Manager" value={data.manager} />
        <InfoRow label="Platform" value={data.platform} />
        <InfoRow
          label="Restart"
          value={data.restart_supported ? "Available" : data.keepalive_supported ? "Install keepalive first" : "Not supported"}
        />
      </div>

      {message && (
        <div className={`sp-msg ${message.type === "success" ? "sp-msg--success" : "sp-msg--error"}`}>
          {message.text}
        </div>
      )}

      {error && !message && (
        <div className="sp-msg sp-msg--error">
          {error}
        </div>
      )}

      <div className="sp-actions">
        <button
          type="button"
          className="sp-btn-primary"
          onClick={restartService}
          disabled={!data.restart_supported || phase === "restarting"}
        >
          {phase === "restarting" ? "Restarting..." : "Restart 24/7 JARVIS"}
        </button>
        <button type="button" className="sp-btn-secondary" onClick={refetch}>
          Refresh Status
        </button>
      </div>
    </div>
  );
}

/* ── Auto-Update Panel ── */

type UpdateStatus = {
  branch: string;
  local_sha: string;
  remote_sha: string;
  up_to_date: boolean;
  auto_update_enabled: boolean;
};

export function UpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setMsg(null);
    try {
      const data = await api<UpdateStatus>("/api/system/update");
      setStatus(data);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to check", type: "error" });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  const applyUpdate = async () => {
    setUpdating(true);
    setMsg(null);
    try {
      const res = await api<{ ok: boolean; message: string; updated: boolean }>("/api/system/update", { method: "POST" });
      setMsg({ text: res.message, type: "success" });
      if (res.updated) setTimeout(check, 4000);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Update failed", type: "error" });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="sp-card" style={{ marginTop: "16px" }}>
      <div style={headerRowStyle}>
        <div>
          <h3 className="sp-card-title" style={{ margin: 0 }}>Auto-Update</h3>
          <div style={subtleStyle}>
            Pull the latest code from the remote branch and restart JARVIS.
          </div>
        </div>
        {status && (
          <span style={{
            ...statusBadgeStyle,
            color: status.up_to_date ? "var(--j-success)" : "#FBBF24",
            borderColor: status.up_to_date ? "rgba(52,211,153,0.25)" : "rgba(251,191,36,0.25)",
            background: status.up_to_date ? "rgba(52,211,153,0.10)" : "rgba(251,191,36,0.08)",
          }}>
            {status.up_to_date ? "Up to date" : "Update available"}
          </span>
        )}
      </div>

      {status && (
        <div style={infoGridStyle}>
          <InfoRow label="Branch" value={status.branch} />
          <InfoRow label="Local" value={status.local_sha} />
          <InfoRow label="Remote" value={status.remote_sha} />
          <InfoRow label="Auto-update" value={status.auto_update_enabled ? "Enabled (JARVIS_AUTO_UPDATE=true)" : "Disabled — set JARVIS_AUTO_UPDATE=true to enable"} />
        </div>
      )}

      {msg && (
        <div className={`sp-msg ${msg.type === "success" ? "sp-msg--success" : "sp-msg--error"}`}>
          {msg.text}
        </div>
      )}

      <div className="sp-actions">
        <button className="sp-btn-primary" onClick={applyUpdate} disabled={updating || checking || status?.up_to_date}>
          {updating ? "Updating..." : "Pull & Restart"}
        </button>
        <button className="sp-btn-secondary" onClick={check} disabled={checking}>
          {checking ? "Checking..." : "Check for Updates"}
        </button>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={infoRowStyle}>
      <span style={infoLabelStyle}>{label}</span>
      <span style={infoValueStyle}>{value}</span>
    </div>
  );
}

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "flex-start",
  marginBottom: "16px",
  flexWrap: "wrap",
};

const subtleStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.5,
  color: "var(--j-text-muted)",
  marginTop: "6px",
  maxWidth: "560px",
};

const statusBadgeStyle: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: "999px",
  border: "1px solid var(--j-border)",
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const infoGridStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  marginBottom: "16px",
};

const infoRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  fontSize: "13px",
};

const infoLabelStyle: React.CSSProperties = {
  color: "var(--j-text-dim)",
};

const infoValueStyle: React.CSSProperties = {
  color: "var(--j-text)",
  textTransform: "capitalize",
};

