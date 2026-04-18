import React, { useState, useEffect, useRef, useCallback } from "react";

type SearchResult = {
  id: string;
  type: "entity" | "thread" | "goal" | "task";
  title: string;
  subtitle?: string;
  href: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function GlobalSearch({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 200);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!debouncedQuery.trim()) { setResults([]); return; }
    const q = debouncedQuery.trim();
    setLoading(true);
    setActiveIdx(0);

    Promise.allSettled([
      fetch(`/api/vault/search?q=${encodeURIComponent(q)}&limit=5`).then(r => r.ok ? r.json() : { entities: [], facts: [] }),
      fetch(`/api/vault/threads/search?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/goals?q=${encodeURIComponent(q)}&limit=5`).then(r => r.ok ? r.json() : []),
    ]).then(([entitiesRes, threadsRes, goalsRes]) => {
      const combined: SearchResult[] = [];

      if (entitiesRes.status === "fulfilled") {
        const { entities = [] } = entitiesRes.value as { entities: any[] };
        for (const e of entities.slice(0, 4)) {
          combined.push({ id: `e-${e.id}`, type: "entity", title: e.name, subtitle: e.type, href: "#/memory" });
        }
      }

      if (threadsRes.status === "fulfilled") {
        const threads = threadsRes.value as any[];
        for (const t of threads.slice(0, 4)) {
          combined.push({ id: `t-${t.id ?? t.thread_id}`, type: "thread", title: t.title ?? t.content?.slice(0, 60) ?? "Thread", subtitle: "Chat thread", href: "#/chat" });
        }
      }

      if (goalsRes.status === "fulfilled") {
        const goals = goalsRes.value as any[];
        for (const g of goals.slice(0, 4)) {
          combined.push({ id: `g-${g.id}`, type: "goal", title: g.title, subtitle: `${g.status} · ${g.level}`, href: "#/goals" });
        }
      }

      setResults(combined);
    }).finally(() => setLoading(false));
  }, [debouncedQuery]);

  const handleSelect = useCallback((result: SearchResult) => {
    window.location.hash = result.href;
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[activeIdx]) { handleSelect(results[activeIdx]!); }
  }, [results, activeIdx, handleSelect, onClose]);

  if (!open) return null;

  const TYPE_COLORS: Record<string, string> = {
    entity: "#60A5FA",
    thread: "#A78BFA",
    goal: "#34D399",
    task: "#FBBF24",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.72)", display: "flex",
        alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "560px", maxWidth: "92vw",
          background: "#0E0E18", border: "1px solid rgba(139,92,246,0.35)",
          borderRadius: "14px", boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
          overflow: "hidden",
        }}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "rgba(255,255,255,0.35)" }}>
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search goals, entities, threads..."
            style={{
              flex: 1, marginLeft: "10px", background: "none", border: "none", outline: "none",
              color: "rgba(255,255,255,0.9)", fontSize: "14px",
            }}
          />
          {loading && (
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", border: "1.5px solid rgba(139,92,246,0.5)", borderTopColor: "#A78BFA", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
          )}
          <kbd style={{ marginLeft: "8px", fontSize: "10px", padding: "2px 5px", borderRadius: "4px", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.1)" }}>ESC</kbd>
        </div>

        {/* Results */}
        {results.length > 0 ? (
          <div style={{ maxHeight: "360px", overflowY: "auto" }}>
            {results.map((r, i) => (
              <button
                key={r.id}
                onClick={() => handleSelect(r)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 16px", background: i === activeIdx ? "rgba(139,92,246,0.1)" : "transparent",
                  border: "none", textAlign: "left", cursor: "pointer",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span style={{
                  fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: TYPE_COLORS[r.type] ?? "#A78BFA", width: "46px", flexShrink: 0,
                }}>
                  {r.type}
                </span>
                <span style={{ flex: 1, fontSize: "13px", color: "rgba(255,255,255,0.88)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title}
                </span>
                {r.subtitle && (
                  <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>{r.subtitle}</span>
                )}
              </button>
            ))}
          </div>
        ) : debouncedQuery && !loading ? (
          <div style={{ padding: "24px 16px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>
            No results for "{debouncedQuery}"
          </div>
        ) : !debouncedQuery ? (
          <div style={{ padding: "16px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {["Goals", "Entities", "Threads"].map(hint => (
              <span key={hint} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "5px", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", border: "1px solid rgba(255,255,255,0.06)" }}>
                {hint}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
