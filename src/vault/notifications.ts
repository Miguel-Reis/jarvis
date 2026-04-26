import { randomUUID } from 'crypto';
import { getDb } from './schema.ts';

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'approval' | 'emergency';
export type NotificationPriority = 'urgent' | 'normal' | 'low';

export type Notification = {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  source: string;
  priority: NotificationPriority;
  read: boolean;
  created_at: number;
};

type Row = Omit<Notification, 'read'> & { read: number };

function parse(row: Row): Notification {
  return { ...row, read: row.read === 1 };
}

export function saveNotification(
  title: string,
  body: string,
  opts: { type?: NotificationType; source?: string; priority?: NotificationPriority } = {}
): Notification {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  const type = opts.type ?? 'info';
  const source = opts.source ?? 'system';
  const priority = opts.priority ?? 'normal';

  db.prepare(
    `INSERT INTO notifications (id, title, body, type, source, priority, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(id, title, body, type, source, priority, now);

  // Keep last 500 notifications
  db.prepare(
    `DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT 500)`
  ).run();

  return { id, title, body, type, source, priority, read: false, created_at: now };
}

export function listNotifications(opts: { limit?: number; unreadOnly?: boolean } = {}): Notification[] {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 200);
  const rows = opts.unreadOnly
    ? db.prepare('SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]
    : db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit) as Row[];
  return rows.map(parse);
}

export function countUnread(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE read = 0').get() as { n: number };
  return row.n;
}

export function markRead(id: string): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  return result.changes > 0;
}

export function markAllRead(): void {
  const db = getDb();
  db.prepare('UPDATE notifications SET read = 1').run();
}
