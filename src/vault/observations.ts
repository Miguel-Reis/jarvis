import { getDb, generateId } from './schema.ts';

export type ObservationType =
  | 'file_change'
  | 'notification'
  | 'clipboard'
  | 'app_activity'
  | 'calendar'
  | 'email'
  | 'browser'
  | 'process'
  | 'screen_capture';

export type Observation = {
  id: string;
  type: ObservationType;
  data: Record<string, unknown>;
  processed: boolean;
  created_at: number;
};

type ObservationRow = {
  id: string;
  type: ObservationType;
  data: string;
  processed: number;
  created_at: number;
};

/**
 * Parse observation row from database, deserializing JSON fields
 */
function parseObservation(row: ObservationRow): Observation {
  return {
    id: row.id,
    type: row.type,
    data: JSON.parse(row.data),
    processed: row.processed === 1,
    created_at: row.created_at,
  };
}

/**
 * Create a new observation
 */
export function createObservation(
  type: ObservationType,
  data: Record<string, unknown>
): Observation {
  const db = getDb();
  const id = generateId();
  const now = Date.now();

  const stmt = db.prepare(
    'INSERT INTO observations (id, type, data, processed, created_at) VALUES (?, ?, ?, ?, ?)'
  );

  stmt.run(id, type, JSON.stringify(data), 0, now);

  return {
    id,
    type,
    data,
    processed: false,
    created_at: now,
  };
}

/**
 * Get unprocessed observations
 */
export function getUnprocessed(limit: number = 100): Observation[] {
  const db = getDb();
  const stmt = db.prepare(
    'SELECT * FROM observations WHERE processed = 0 ORDER BY created_at ASC LIMIT ?'
  );
  const rows = stmt.all(limit) as ObservationRow[];

  return rows.map(parseObservation);
}

/**
 * Mark an observation as processed
 */
export function markProcessed(id: string): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE observations SET processed = 1 WHERE id = ?');
  stmt.run(id);
}

/**
 * Get recent observations, optionally filtered by type
 */
export function getRecentObservations(
  type?: ObservationType,
  limit: number = 50
): Observation[] {
  const db = getDb();

  let query = 'SELECT * FROM observations';
  const params: unknown[] = [];

  if (type) {
    query += ' WHERE type = ?';
    params.push(type);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = db.prepare(query);
  const rows = stmt.all(...params as any[]) as ObservationRow[];

  return rows.map(parseObservation);
}
