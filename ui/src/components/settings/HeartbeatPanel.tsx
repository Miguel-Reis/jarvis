import React, { useState, useEffect } from "react";
import { useApiData, api } from "../../hooks/useApi";

type Config = {
  heartbeat: {
    interval_minutes: number;
    active_hours: { start: number; end: number };
    aggressiveness: string;
  };
};

export function HeartbeatPanel() {
  const { data: config, loading, refetch } = useApiData<Config>("/api/config", []);
  const [isEditing, setIsEditing] = useState(false);
  const [interval, setInterval] = useState(15);
  const [activeStart, setActiveStart] = useState(8);
  const [activeEnd, setActiveEnd] = useState(23);
  const [aggressiveness, setAggressiveness] = useState<"passive" | "moderate" | "aggressive">("moderate");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (config?.heartbeat) {
      setInterval(config.heartbeat.interval_minutes);
      setActiveStart(config.heartbeat.active_hours.start);
      setActiveEnd(config.heartbeat.active_hours.end);
      setAggressiveness(config.heartbeat.aggressiveness as any);
    }
  }, [config]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api("/api/config/heartbeat", {
        method: "POST",
        body: JSON.stringify({
          interval_minutes: interval,
          active_hours: { start: activeStart, end: activeEnd },
          aggressiveness,
        }),
      });
      setMsg({ text: "Heartbeat config saved!", type: "success" });
      setIsEditing(false);
      refetch();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to save", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return <div className="sp-card"><span style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px" }}>Loading...</span></div>;
  }

  if (!isEditing) {
    const hb = config.heartbeat;
    return (
      <div className="sp-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 className="sp-card-title">Heartbeat</h3>
          <button className="sp-btn-secondary" onClick={() => setIsEditing(true)} style={{ fontSize: "12px", padding: "4px 10px" }}>
            Edit
          </button>
        </div>
        {msg && (
          <div className={`sp-msg ${msg.type === "error" ? "sp-msg--error" : "sp-msg--success"}`} style={{ marginBottom: "8px" }}>
            {msg.text}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--j-text-dim)" }}>Interval</span>
            <span style={{ color: "var(--j-text)" }}>{hb.interval_minutes} min</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--j-text-dim)" }}>Active Hours</span>
            <span style={{ color: "var(--j-text)" }}>{hb.active_hours.start}:00 - {hb.active_hours.end}:00</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--j-text-dim)" }}>Aggressiveness</span>
            <span
              style={{
                color: hb.aggressiveness === "aggressive"
                  ? "var(--j-warning)"
                  : hb.aggressiveness === "moderate"
                    ? "var(--j-accent)"
                    : "var(--j-text-muted)",
                textTransform: "capitalize",
                fontWeight: 500,
              }}
            >
              {hb.aggressiveness}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sp-card">
      <h3 className="sp-card-title">Heartbeat</h3>
      {msg && (
        <div className={`sp-msg ${msg.type === "error" ? "sp-msg--error" : "sp-msg--success"}`} style={{ marginBottom: "8px" }}>
          {msg.text}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <label className="sp-label">Interval (minutes)</label>
          <p className="sp-hint" style={{ fontSize: "11px", marginTop: "4px" }}>How often Jarvis checks in with you</p>
          <input
            className="sp-input"
            type="number"
            min="1"
            max="120"
            value={interval}
            onChange={e => setInterval(Number(e.target.value))}
          />
        </div>

        <div>
          <label className="sp-label">Active Hours</label>
          <p className="sp-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Jarvis will only send proactive messages during these hours</p>
          <div style={{ display: "flex", gap: "8px" }}>
            <select className="sp-select" value={activeStart} onChange={e => setActiveStart(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{i}:00</option>
              ))}
            </select>
            <span style={{ color: "var(--j-text-dim)", alignSelf: "center" }}>to</span>
            <select className="sp-select" value={activeEnd} onChange={e => setActiveEnd(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{i}:00</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="sp-label">Aggressiveness</label>
          <p className="sp-hint" style={{ fontSize: "11px", marginTop: "4px" }}>How proactive should Jarvis be?</p>
          <select className="sp-select" value={aggressiveness} onChange={e => setAggressiveness(e.target.value as any)}>
            <option value="passive">Passive - Only respond when asked</option>
            <option value="moderate">Moderate - Occasional proactive suggestions</option>
            <option value="aggressive">Aggressive - Frequent check-ins and suggestions</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button className="sp-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button className="sp-btn-secondary" onClick={() => setIsEditing(false)} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

