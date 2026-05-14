/**
 * Tool Result Store — paginated storage for large tool outputs.
 *
 * Stores full tool results in-memory keyed by a short chunk_id. The LLM only
 * sees the first slice plus a pagination header; it can fetch later slices via
 * the get_tool_result_chunk tool. Prevents single oversized outputs from
 * blowing the context window, without silently losing data the way naïve
 * truncation does.
 */

const CHUNK_TTL_MS = 30 * 60_000;  // 30 minutes — long enough for a turn, short enough to bound memory
const MAX_STORED = 200;            // cap total stored chunks (LRU eviction)

type StoredResult = {
  fullText: string;
  toolName: string;
  storedAt: number;
};

const store = new Map<string, StoredResult>();

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function pruneOldEntries(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.storedAt > CHUNK_TTL_MS) {
      store.delete(id);
    }
  }
  // LRU-ish cap: drop oldest if still over
  while (store.size > MAX_STORED) {
    const firstKey = store.keys().next().value;
    if (!firstKey) break;
    store.delete(firstKey);
  }
}

export function storeResult(toolName: string, fullText: string): string {
  pruneOldEntries();
  const id = shortId();
  store.set(id, { fullText, toolName, storedAt: Date.now() });
  return id;
}

export function getChunk(id: string, offset: number, length: number): { content: string; nextOffset: number | null; total: number; toolName: string } | null {
  const entry = store.get(id);
  if (!entry) return null;
  const total = entry.fullText.length;
  if (offset < 0 || offset >= total) {
    return { content: '', nextOffset: null, total, toolName: entry.toolName };
  }
  const end = Math.min(offset + length, total);
  return {
    content: entry.fullText.slice(offset, end),
    nextOffset: end < total ? end : null,
    total,
    toolName: entry.toolName,
  };
}

export function listChunks(): Array<{ id: string; toolName: string; total: number; ageMs: number }> {
  const now = Date.now();
  return Array.from(store.entries()).map(([id, e]) => ({
    id,
    toolName: e.toolName,
    total: e.fullText.length,
    ageMs: now - e.storedAt,
  }));
}
