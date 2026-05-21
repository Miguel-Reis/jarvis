import { useState, useEffect } from "react";
import { useApiData, api } from "../../hooks/useApi";

type SearchConfigData = {
  provider: string;
  has_brave_key: boolean;
  has_tavily_key: boolean;
  max_results: number;
};

export function SearchProviderPanel() {
  const { data: cfg, refetch } = useApiData<SearchConfigData>("/api/config/search", []);
  const [provider, setProvider] = useState("duckduckgo");
  const [braveKey, setBraveKey] = useState("");
  const [tavilyKey, setTavilyKey] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (cfg) {
      setProvider(cfg.provider || "duckduckgo");
      setMaxResults(cfg.max_results || 10);
    }
  }, [cfg]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { provider, max_results: maxResults };
      if (provider === "brave" && braveKey) body.brave_api_key = braveKey;
      if (provider === "tavily" && tavilyKey) body.tavily_api_key = tavilyKey;

      await api("/api/config/search", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setBraveKey("");
      setTavilyKey("");
      setMsg({ text: "Search config saved!", type: "success" });
      refetch();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed to save", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await api<{ ok: boolean; message: string }>("/api/config/search/test", {
        method: "POST",
        body: JSON.stringify({ provider }),
      });
      setMsg({ text: result.message, type: result.ok ? "success" : "error" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Test failed", type: "error" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="sp-card">
      <h3 className="sp-card-title">Web Search</h3>

      {msg && (
        <div className={`sp-msg ${msg.type === "error" ? "sp-msg--error" : "sp-msg--success"}`} style={{ marginBottom: "8px" }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <label className="sp-label">Search Provider</label>
          <p className="sp-hint" style={{ fontSize: "11px", marginTop: "4px" }}>
            Choose your web search backend. DuckDuckGo is free but limited. Brave and Tavily offer better results.
          </p>
          <select className="sp-select" value={provider} onChange={e => setProvider(e.target.value)}>
            <option value="duckduckgo">DuckDuckGo (Free, No API Key)</option>
            <option value="brave">Brave Search (API Key Required)</option>
            <option value="tavily">Tavily (API Key Required)</option>
          </select>
        </div>

        {provider === "brave" && (
          <>
            <p className="sp-hint">
              Get your API key from <strong>brave.com/search/api</strong>. First 1000 searches/month free.
            </p>
            <input
              className="sp-input"
              type="password"
              placeholder="Brave Search API Key (leave empty to keep existing)"
              value={braveKey}
              onChange={e => setBraveKey(e.target.value)}
            />
            {cfg?.has_brave_key && (
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>API key configured</span>
            )}
          </>
        )}

        {provider === "tavily" && (
          <>
            <p className="sp-hint">
              Get your API key from <strong>tavily.com</strong>. Optimized for AI agents.
            </p>
            <input
              className="sp-input"
              type="password"
              placeholder="Tavily API Key (leave empty to keep existing)"
              value={tavilyKey}
              onChange={e => setTavilyKey(e.target.value)}
            />
            {cfg?.has_tavily_key && (
              <span style={{ fontSize: "11px", color: "var(--j-text-muted)" }}>API key configured</span>
            )}
          </>
        )}

        <div>
          <label className="sp-label">Max Results</label>
          <p className="sp-hint" style={{ fontSize: "11px", marginTop: "4px" }}>Maximum number of search results to return</p>
          <input
            className="sp-input"
            type="number"
            min="1"
            max="50"
            value={maxResults}
            onChange={e => setMaxResults(Number(e.target.value))}
          />
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button className="sp-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Search Config"}
          </button>
          <button className="sp-btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test Search"}
          </button>
        </div>
      </div>
    </div>
  );
}
