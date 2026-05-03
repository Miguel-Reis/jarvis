import React, { useState, useEffect, useRef, useCallback } from "react";

type SearchResult = {
  id: string;
  type: "entity" | "thread" | "goal" | "task" | "action" | "navigation";
  title: string;
  subtitle?: string;
  href?: string;
  action?: () => void;
  shortcut?: string;
};

type CommandAction = {
  id: string;
  title: string;
  subtitle: string;
  shortcut: string;
  category: "navigation" | "action";
  action: () => void;
};

const COMMAND_ACTIONS: CommandAction[] = [
  { id: "new-chat", title: "New Chat", subtitle: "Start a new conversation", shortcut: "⌘N", category: "action", action: () => window.location.hash = "#/chat" },
  { id: "new-goal", title: "New Goal", subtitle: "Create a new goal", shortcut: "⌘G", category: "action", action: () => window.dispatchEvent(new CustomEvent("jarvis:new-goal")) },
  { id: "new-task", title: "New Task", subtitle: "Create a new task", shortcut: "⌘T", category: "action", action: () => window.dispatchEvent(new CustomEvent("jarvis:new-task")) },
  { id: "dashboard", title: "Dashboard", subtitle: "Go to dashboard", shortcut: "⌘D", category: "navigation", action: () => window.location.hash = "#/dashboard" },
  { id: "goals", title: "Goals", subtitle: "View all goals", shortcut: "", category: "navigation", action: () => window.location.hash = "#/goals" },
  { id: "workflows", title: "Workflows", subtitle: "View workflows", shortcut: "", category: "navigation", action: () => window.location.hash = "#/workflows" },
  { id: "projects", title: "Projects", subtitle: "View projects", shortcut: "", category: "navigation", action: () => window.location.hash = "#/projects" },
  { id: "superjarvis", title: "Super Jarvis", subtitle: "Control center", shortcut: "", category: "navigation", action: () => window.location.hash = "#/superjarvis" },
  { id: "progress", title: "Progress", subtitle: "View progress dashboard", shortcut: "", category: "navigation", action: () => window.location.hash = "#/progress" },
  { id: "warroom", title: "War Room", subtitle: "Agent coordination", shortcut: "", category: "navigation", action: () => window.location.hash = "#/warroom" },
  { id: "settings", title: "Settings", subtitle: "Configure Jarvis", shortcut: "", category: "navigation", action: () => window.location.hash = "#/settings" },
];

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
    if (!debouncedQuery.trim()) {
      // Show command actions when query is empty
      const actions: SearchResult[] = COMMAND_ACTIONS.map(a => ({
        id: a.id,
        type: a.category,
        title: a.title,
        subtitle: a.subtitle,
        shortcut: a.shortcut,
        action: a.action,
      }));
      setResults(actions);
      return;
    }

    const q = debouncedQuery.trim().toLowerCase();
    setLoading(true);
    setActiveIdx(0);

    // Filter command actions by query
    const matchedActions: SearchResult[] = COMMAND_ACTIONS
      .filter(a => a.title.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q))
      .map(a => ({
        id: a.id,
        type: a.category as "navigation" | "action",
        title: a.title,
        subtitle: a.subtitle,
        shortcut: a.shortcut,
        action: a.action,
      }));

    Promise.allSettled([
      fetch(`/api/vault/search?q=${encodeURIComponent(q)}&limit=5`).then(r => r.ok ? r.json() : { entities: [], facts: [] }),
      fetch(`/api/vault/threads/search?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/goals?q=${encodeURIComponent(q)}&limit=5`).then(r => r.ok ? r.json() : []),
    ]).then(([entitiesRes, threadsRes, goalsRes]) => {
      const combined: SearchResult[] = [...matchedActions];

      if (entitiesRes.status === "fulfilled") {
        const { entities = [] } = entitiesRes.value as { entities: any[] };
        for (const e of entities.slice(0, 4)) {
          combined.push({ id: `e-${e.id}`, type: "entity", title: e.name, subtitle: e.type, href: "#/memory" });
        }
      } else {
        console.warn("[GlobalSearch] Entities search failed:", entitiesRes.reason);
      }

      if (threadsRes.status === "fulfilled") {
        const threads = threadsRes.value as any[];
        for (const t of threads.slice(0, 4)) {
          combined.push({ id: `t-${t.id ?? t.thread_id}`, type: "thread", title: t.title ?? t.content?.slice(0, 60) ?? "Thread", subtitle: "Chat thread", href: "#/chat" });
        }
      } else {
        console.warn("[GlobalSearch] Threads search failed:", threadsRes.reason);
      }

      if (goalsRes.status === "fulfilled") {
        const goals = goalsRes.value as any[];
        for (const g of goals.slice(0, 4)) {
          combined.push({ id: `g-${g.id}`, type: "goal", title: g.title, subtitle: `${g.status} · ${g.level}`, href: "#/goals" });
        }
      } else {
        console.warn("[GlobalSearch] Goals search failed:", goalsRes.reason);
      }

      setResults(combined);
    }).catch(err => {
      console.error("[GlobalSearch] Search failed:", err);
      setResults(matchedActions); // Fallback to just command actions
    }).finally(() => setLoading(false));
  }, [debouncedQuery]);

  const handleSelect = useCallback((result: SearchResult) => {
    if (result.action) {
      result.action();
    } else if (result.href) {
      window.location.hash = result.href;
    }
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
    action: "#F472B6",
    navigation: "#22D3EE",
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
            placeholder="Type to search or press Cmd+K for commands..."
            data-global-search
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
            {/* Section headers */}
            {results.some(r => r.type === "action") && (
              <div style={{ padding: "8px 16px 4px", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(255,255,255,0.3)" }}>
                Actions
              </div>
            )}
            {results.some(r => r.type === "navigation") && (
              <div style={{ padding: "8px 16px 4px", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(255,255,255,0.3)" }}>
                Navigation
              </div>
            )}
            {results.some(r => ["entity", "thread", "goal", "task"].includes(r.type as string)) && (
              <div style={{ padding: "8px 16px 4px", fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(255,255,255,0.3)" }}>
                Search Results
              </div>
            )}
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
                  color: TYPE_COLORS[r.type] ?? "#A78BFA", width: "60px", flexShrink: 0,
                }}>
                  {r.type}
                </span>
                <span style={{ flex: 1, fontSize: "13px", color: "rgba(255,255,255,0.88)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title}
                </span>
                {r.shortcut && (
                  <kbd style={{ fontSize: "9px", padding: "2px 5px", borderRadius: "3px", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}>
                    {r.shortcut}
                  </kbd>
                )}
                {r.subtitle && !r.shortcut && (
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
            {["⌘N New Chat", "⌘G New Goal", "⌘D Dashboard"].map(hint => (
              <span key={hint} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "5px", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
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
