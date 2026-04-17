import React, { useState } from "react";
import { useApiData } from "../../hooks/useApi";

type McpServerStatus = {
  name: string;
  command: string;
  args: string[];
  connected: boolean;
  toolCount: number;
  error: string | null;
};


export function MCPPanel() {
  const { data: servers, refetch } = useApiData<McpServerStatus[]>("/api/mcp/servers", []);

  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 3500);
  };

  const handleAdd = async () => {
    if (!name.trim() || !command.trim()) return;
    setSaving(true);
    try {
      const argsArr = args.trim() ? args.trim().split(/\s+/) : [];
      const res = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), command: command.trim(), args: argsArr }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (res.ok && data.ok) {
        flash(data.message ?? "Server added — restart daemon to connect");
        setName(""); setCommand(""); setArgs("");
        refetch();
      } else {
        flash(data.error ?? "Failed to add server");
      }
    } catch (e) {
      flash(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (serverName: string) => {
    setRemoving(serverName);
    try {
      const res = await fetch(`/api/mcp/servers/${encodeURIComponent(serverName)}`, {
        method: "DELETE",
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (res.ok && data.ok) {
        flash(data.message ?? `Removed '${serverName}'`);
        refetch();
      } else {
        flash(data.error ?? "Failed to remove");
      }
    } catch (e) {
      flash(String(e));
    } finally {
      setRemoving(null);
    }
  };

  const list = servers ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Status */}
      <div className="sp-card">
        <h3 className="sp-card-title">Connected MCP Servers</h3>

        {list.length === 0 ? (
          <div style={{ fontSize: "13px", color: "var(--j-text-muted)" }}>
            No MCP servers configured yet. Add one below to expose external tools to JARVIS.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {list.map((s) => (
              <div key={s.name} style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 14px",
                background: "var(--j-bg)",
                border: "1px solid var(--j-border)",
                borderRadius: "8px",
              }}>
                {/* Status dot */}
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
                  background: s.error ? "#ef4444" : s.connected ? "#22c55e" : "#6b7280",
                }} />

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--j-text)" }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--j-text-muted)", marginTop: "2px" }}>
                    {s.command} {s.args.join(" ")}
                    {s.connected && (
                      <span style={{ marginLeft: "8px", color: "#22c55e" }}>
                        {s.toolCount} tool{s.toolCount !== 1 ? "s" : ""} registered
                      </span>
                    )}
                    {s.error && (
                      <span style={{ marginLeft: "8px", color: "#ef4444" }}>{s.error}</span>
                    )}
                    {!s.connected && !s.error && (
                      <span style={{ marginLeft: "8px", color: "#6b7280" }}>not connected (restart daemon)</span>
                    )}
                  </div>
                </div>

                {/* Remove */}
                <button
                  className="sp-btn-danger"
                  style={{ padding: "5px 12px", fontSize: "12px" }}
                  disabled={removing === s.name}
                  onClick={() => handleRemove(s.name)}
                >
                  {removing === s.name ? "…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add server */}
      <div className="sp-card">
        <h3 className="sp-card-title">Add MCP Server</h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px", marginBottom: "12px" }}>
          <div className="sp-field">
            <span className="sp-field-label">Server Name</span>
            <input
              className="sp-input"
              placeholder="e.g. notion"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="sp-field">
            <span className="sp-field-label">Command</span>
            <input
              className="sp-input"
              placeholder="e.g. npx @notionhq/notion-mcp-server"
              value={command}
              onChange={e => setCommand(e.target.value)}
            />
          </div>
        </div>

        <div className="sp-field" style={{ marginBottom: "16px" }}>
          <span className="sp-field-label">Arguments (space-separated, optional)</span>
          <input
            className="sp-input"
            placeholder="e.g. --api-key sk-..."
            value={args}
            onChange={e => setArgs(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            className="sp-btn-primary"
            onClick={handleAdd}
            disabled={saving || !name.trim() || !command.trim()}
          >
            {saving ? "Adding…" : "Add Server"}
          </button>
          {msg && (
            <span style={{ fontSize: "13px", color: "var(--j-text-muted)" }}>{msg}</span>
          )}
        </div>

        <div style={{ marginTop: "16px", fontSize: "12px", color: "var(--j-text-dim)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--j-text-muted)" }}>What is MCP?</strong>{" "}
          Model Context Protocol lets JARVIS connect to external tool servers (Notion, GitHub, Postgres, Stripe, etc.)
          without custom code. Tools auto-register as <code style={{ fontSize: "11px" }}>mcp_{"<name>"}_{"<tool>"}</code> in the agent.
          After adding a server, restart the daemon to connect. See{" "}
          <span style={{ color: "var(--j-accent)" }}>modelcontextprotocol.io</span> for available servers.
        </div>
      </div>

    </div>
  );
}
