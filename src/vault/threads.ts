/**
 * Thread Management — Persistent Threaded Chat
 *
 * Thin helpers over the existing `conversations` and `conversation_messages`
 * tables.  A "thread" is just a conversation with a display title.
 *
 * Functions:
 *   createThread        — start a new chat session
 *   saveMessage         — persist a single message to a thread
 *   getThreadContext    — retrieve the last N messages for LLM context
 *   listThreads         — list all threads newest-first
 *   updateThreadTitle   — set / refresh the display title
 *   deleteThread        — hard-delete thread and all its messages
 *   searchGlobalMemory  — full-text keyword search across all threads
 */

import { getDb, generateId } from './schema.ts';

// ── Types ─────────────────────────────────────────────────────────────

export type ThreadRole = 'user' | 'assistant' | 'system';

export type Thread = {
  id: string;
  title: string | null;
  channel: string | null;
  started_at: number;
  last_message_at: number;
  message_count: number;
};

export type ThreadMessage = {
  id: string;
  thread_id: string;
  role: ThreadRole;
  content: string;
  created_at: number;
};

export type MemorySearchResult = {
  thread_id: string;
  thread_title: string | null;
  message_id: string;
  role: string;
  /** First 300 chars of matching content */
  excerpt: string;
  created_at: number;
};

// ── Raw DB row shapes ─────────────────────────────────────────────────

type ConversationRow = {
  id: string;
  title: string | null;
  channel: string | null;
  started_at: number;
  last_message_at: number;
  message_count: number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: number;
};

type SearchRow = {
  message_id: string;
  thread_id: string;
  thread_title: string | null;
  role: string;
  content: string;
  created_at: number;
};

// ── Helpers ───────────────────────────────────────────────────────────

function rowToThread(row: ConversationRow): Thread {
  return {
    id: row.id,
    title: row.title ?? null,
    channel: row.channel ?? null,
    started_at: row.started_at,
    last_message_at: row.last_message_at,
    message_count: row.message_count,
  };
}

function rowToMessage(row: MessageRow): ThreadMessage {
  return {
    id: row.id,
    thread_id: row.conversation_id,
    role: row.role as ThreadRole,
    content: row.content,
    created_at: row.created_at,
  };
}

/** Escape SQL LIKE wildcard characters in user input. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Create a new chat thread.
 * @param title  Optional display title (auto-set later from first user message).
 * @param channel  Communication channel label (default: 'websocket').
 */
export function createThread(title?: string, channel = 'websocket'): Thread {
  const db = getDb();
  const id = generateId();
  const now = Date.now();

  db.prepare(
    'INSERT INTO conversations (id, channel, title, started_at, last_message_at, message_count) VALUES (?, ?, ?, ?, ?, 0)'
  ).run(id, channel, title ?? null, now, now);

  return { id, title: title ?? null, channel, started_at: now, last_message_at: now, message_count: 0 };
}

/**
 * Persist a message to an existing thread and bump its last_message_at.
 */
export function saveMessage(
  threadId: string,
  role: ThreadRole,
  content: string,
): ThreadMessage {
  const db = getDb();
  const id = generateId();
  const now = Date.now();

  // Both operations must succeed together: if the UPDATE fails the INSERT rolls back too.
  db.transaction(() => {
    db.prepare(
      'INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, threadId, role, content, now);

    db.prepare(
      'UPDATE conversations SET last_message_at = ?, message_count = message_count + 1 WHERE id = ?'
    ).run(now, threadId);
  })();

  return { id, thread_id: threadId, role, content, created_at: now };
}

/**
 * Retrieve the last `limit` messages of a thread in chronological order.
 * Used to build the LLM context window.
 */
export function getThreadContext(threadId: string, limit = 50): ThreadMessage[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM (
       SELECT * FROM conversation_messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ?
     ) ORDER BY created_at ASC`
  ).all(threadId, limit) as MessageRow[];

  return rows.map(rowToMessage);
}

/**
 * List all threads, newest first.
 */
export function listThreads(limit = 100): Thread[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, title, channel, started_at, last_message_at, message_count FROM conversations ORDER BY last_message_at DESC LIMIT ?'
  ).all(limit) as ConversationRow[];

  return rows.map(rowToThread);
}

/**
 * Get a single thread by ID.
 */
export function getThread(threadId: string): Thread | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT id, title, channel, started_at, last_message_at, message_count FROM conversations WHERE id = ?'
  ).get(threadId) as ConversationRow | null;

  return row ? rowToThread(row) : null;
}

/**
 * Update a thread's display title.
 * Called automatically after the first user message to give the thread a meaningful name.
 */
export function updateThreadTitle(threadId: string, title: string): void {
  getDb()
    .prepare('UPDATE conversations SET title = ? WHERE id = ?')
    .run(title.slice(0, 120), threadId); // cap at 120 chars
}

/**
 * Hard-delete a thread and all its messages (via FK CASCADE).
 */
export function deleteThread(threadId: string): void {
  getDb()
    .prepare('DELETE FROM conversations WHERE id = ?')
    .run(threadId);
}

/**
 * Full-text keyword search across all conversation messages.
 * Returns up to 50 results with a short excerpt, newest first.
 */
export function searchGlobalMemory(keyword: string): MemorySearchResult[] {
  const db = getDb();
  const pattern = `%${escapeLike(keyword)}%`;

  const rows = db.prepare(
    `SELECT
       cm.id              AS message_id,
       cm.conversation_id AS thread_id,
       c.title            AS thread_title,
       cm.role,
       cm.content,
       cm.created_at
     FROM conversation_messages cm
     JOIN conversations c ON c.id = cm.conversation_id
     WHERE cm.content LIKE ? ESCAPE '\\'
     ORDER BY cm.created_at DESC
     LIMIT 50`
  ).all(pattern) as SearchRow[];

  return rows.map((r) => ({
    thread_id: r.thread_id,
    thread_title: r.thread_title ?? null,
    message_id: r.message_id,
    role: r.role,
    excerpt: r.content.length > 300 ? r.content.slice(0, 297) + '…' : r.content,
    created_at: r.created_at,
  }));
}
