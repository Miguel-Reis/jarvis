import { getDb, generateId } from './schema.ts';

export type Project = {
  id: string;
  name: string;
  description: string;
  path: string;
  color: string;
  created_at: number;
  updated_at: number;
};

export function createProject(name: string, opts?: { description?: string; path?: string; color?: string }): Project {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  db.prepare(
    'INSERT INTO projects (id, name, description, path, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, opts?.description ?? '', opts?.path ?? '', opts?.color ?? '#6b7280', now, now);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | null;
  if (!row) throw new Error(`Failed to persist project '${name}'`);
  return row;
}

export function listProjects(): Project[] {
  return getDb().prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Project[];
}

export function getProject(id: string): Project | null {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | null;
}

export function updateProject(id: string, fields: Partial<Pick<Project, 'name' | 'description' | 'path' | 'color'>>): Project | null {
  const db = getDb();
  const current = getProject(id);
  if (!current) return null;
  const now = Date.now();
  db.prepare('UPDATE projects SET name=?, description=?, path=?, color=?, updated_at=? WHERE id=?').run(
    fields.name ?? current.name,
    fields.description ?? current.description,
    fields.path ?? current.path,
    fields.color ?? current.color,
    now, id,
  );
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const changes = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id) as { changes: number };
  return changes.changes > 0;
}

export function getActiveProjectId(): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'active_project_id'").get() as { value: string } | null;
  return row?.value ?? null;
}

export function setActiveProjectId(id: string | null): void {
  const db = getDb();
  if (id === null) {
    db.prepare("DELETE FROM settings WHERE key = 'active_project_id'").run();
  } else {
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('active_project_id', ?, unixepoch())").run(id);
  }
}
