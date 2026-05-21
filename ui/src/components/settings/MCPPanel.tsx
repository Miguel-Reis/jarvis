import { useState } from "react";
import { useApiData } from "../../hooks/useApi";

type McpToolEntry = {
  server: string;
  connected: boolean;
  tools: Array<{ name: string; description?: string }>;
  error?: string;
};

type McpServerStatus = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  connected: boolean;
  toolCount: number;
  error: string | null;
};

type EnvPair = { key: string; val: string };

const PRESETS = [
  {
    label: "Filesystem",
    name: "filesystem",
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem /home",
    env: [] as EnvPair[],
    note: "Edit the path in Args",
  },
  {
    label: "GitHub",
    name: "github",
    command: "npx",
    args: "-y @modelcontextprotocol/server-github",
    env: [{ key: "GITHUB_TOKEN", val: "" }],
    note: "",
  },
  {
    label: "PostgreSQL",
    name: "postgres",
    command: "npx",
    args: "-y @modelcontextprotocol/server-postgres",
    env: [{ key: "DATABASE_URL", val: "postgresql://..." }],
    note: "",
  },
  {
    label: "Brave Search",
    name: "brave-search",
    command: "npx",
    args: "-y @modelcontextprotocol/server-brave-search",
    env: [{ key: "BRAVE_API_KEY", val: "" }],
    note: "",
  },
  {
    label: "Puppeteer",
    name: "puppeteer",
    command: "npx",
    args: "-y @modelcontextprotocol/server-puppeteer",
    env: [] as EnvPair[],
    note: "",
  },
  {
    label: "Slack",
    name: "slack",
    command: "npx",
    args: "-y @modelcontextprotocol/server-slack",
    env: [{ key: "SLACK_BOT_TOKEN", val: "" }, { key: "SLACK_TEAM_ID", val: "" }],
    note: "",
  },
  {
    label: "SQLite",
    name: "sqlite",
    command: "npx",
    args: "-y @modelcontextprotocol/server-sqlite /path/to/db.sqlite",
    env: [] as EnvPair[],
    note: "Edit the .sqlite path in Args",
  },
  {
    label: "Notion",
    name: "notion",
    command: "npx",
    args: "-y @notionhq/notion-mcp-server",
    env: [{ key: "NOTION_TOKEN", val: "" }],
    note: "",
  },
];

export function MCPPanel() {
  const { data: servers, refetch } = useApiData<McpServerStatus[]>("/api/mcp/servers", []);
  const { data: toolData } = useApiData<McpToolEntry[]>("/api/mcp/tools", []);

  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envPairs, setEnvPairs] = useState<EnvPair[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 3500);
  };

  const applyPreset = (p: typeof PRESETS[number]) => {
    setName(p.name);
    setCommand(p.command);
    setArgs(p.args);
    setEnvPairs(p.env.map(e => ({ ...e })));
    if (p.note) flash(p.note);
  };

  const handleAdd = async () => {
    if (!name.trim() || !command.trim()) return;
    setSaving(true);
    try {
      const argsArr = args.trim() ? args.trim().split(/\s+/) : [];
      const env: Record<string, string> = {};
      for (const { key, val } of envPairs) {
        if (key.trim()) env[key.trim()] = val;
      }
      const res = await fetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), command: command.trim(), args: argsArr, env }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (res.ok && data.ok) {
        flash(data.message ?? "Server added and connecting…");
        setName(""); setCommand(""); setArgs(""); setEnvPairs([]);
        refetch();
        setTimeout(() => refetch(), 2500);
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

  const handleReconnect = async (serverName: string) => {
    setReconnecting(serverName);
    try {
      const res = await fetch(`/api/mcp/servers/${encodeURIComponent(serverName)}/reconnect`, {
        method: "POST",
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      flash(data.message ?? data.error ?? "Reconnect attempted");
      refetch();
      setTimeout(() => refetch(), 2500);
    } catch (e) {
      flash(String(e));
    } finally {
      setReconnecting(null);
    }
  };

  const list = servers ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Popular Servers Catalog */}
      <div className="sp-card">
        <h3 className="sp-card-title">Popular Servers</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {PRESETS.map(p => (
            <button
              key={p.name}
              className="sp-btn-secondary"
              style={{ padding: "6px 14px", fontSize: "12px" }}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--j-text-dim)" }}>
          Click a preset to auto-fill the form below. Edit values as needed before adding.
        </div>
      </div>

      {/* Connected Servers */}
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
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
                  background: s.error ? "#ef4444" : s.connected ? "#22c55e" : "#6b7280",
                }} />
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
                      <span style={{ marginLeft: "8px", color: "#6b7280" }}>not connected</span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {(s.error || !s.connected) && (
                    <button
                      className="sp-btn-secondary"
                      style={{ padding: "5px 12px", fontSize: "12px" }}
                      disabled={reconnecting === s.name}
                      onClick={() => handleReconnect(s.name)}
                    >
                      {reconnecting === s.name ? "…" : "Reconnect"}
                    </button>
                  )}
                  <button
                    className="sp-btn-danger"
                    style={{ padding: "5px 12px", fontSize: "12px" }}
                    disabled={removing === s.name}
                    onClick={() => handleRemove(s.name)}
                  >
                    {removing === s.name ? "…" : "Remove"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Server Form */}
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

        <div className="sp-field" style={{ marginBottom: "12px" }}>
          <span className="sp-field-label">Arguments (space-separated, optional)</span>
          <input
            className="sp-input"
            placeholder="e.g. -y --port 3000"
            value={args}
            onChange={e => setArgs(e.target.value)}
          />
        </div>

        {/* Env vars */}
        <div className="sp-field" style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
            <span className="sp-field-label" style={{ marginBottom: 0 }}>Environment Variables</span>
            <button
              className="sp-btn-secondary"
              style={{ padding: "2px 10px", fontSize: "11px" }}
              onClick={() => setEnvPairs(p => [...p, { key: "", val: "" }])}
            >
              + Add
            </button>
          </div>
          {envPairs.length === 0 && (
            <div style={{ fontSize: "11px", color: "var(--j-text-dim)" }}>No env vars — click + Add to set API keys or config</div>
          )}
          {envPairs.map((pair, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "6px", alignItems: "center" }}>
              <input
                className="sp-input"
                style={{ flex: "0 0 160px", fontFamily: "monospace", fontSize: "12px" }}
                placeholder="KEY"
                value={pair.key}
                onChange={e => setEnvPairs(p => p.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
              />
              <input
                className="sp-input"
                style={{ flex: 1, fontFamily: "monospace", fontSize: "12px" }}
                placeholder="value"
                value={pair.val}
                onChange={e => setEnvPairs(p => p.map((x, j) => j === i ? { ...x, val: e.target.value } : x))}
              />
              <button
                className="sp-btn-danger"
                style={{ padding: "4px 8px", fontSize: "12px", flexShrink: 0 }}
                onClick={() => setEnvPairs(p => p.filter((_, j) => j !== i))}
              >×</button>
            </div>
          ))}
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
          See <span style={{ color: "var(--j-accent)" }}>modelcontextprotocol.io</span> for available servers.
        </div>
      </div>

      {/* Tools Browser */}
      {toolData && toolData.some(s => s.tools.length > 0) && (
        <div className="sp-card">
          <h3 className="sp-card-title">Available Tools</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {toolData.filter(s => s.tools.length > 0).map(s => (
              <div key={s.server}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--j-text)", letterSpacing: "0.02em" }}>{s.server}</span>
                  <span style={{
                    fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "4px",
                    background: "rgba(139,92,246,0.15)", color: "#A78BFA", border: "1px solid rgba(139,92,246,0.25)",
                  }}>{s.tools.length} tools</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {s.tools.map(t => (
                    <div key={t.name} style={{
                      padding: "7px 10px", borderRadius: "6px",
                      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.82)", fontFamily: "monospace" }}>
                        {t.name}
                      </div>
                      {t.description && (
                        <div style={{ fontSize: "11px", color: "var(--j-text-muted)", marginTop: "2px", lineHeight: 1.4 }}>
                          {t.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
