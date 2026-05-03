/**
 * Project Contexts — Scoped context management for multi-project workflows
 *
 * Each project has its own:
 * - Architecture patterns and constraints
 * - Tech stack and dependencies
 * - Current goal focus
 * - Session history
 *
 * Contexts are auto-loaded based on current working directory (git root detection).
 */

import { getDb, generateId } from './schema.ts';
import type { SQLQueryBindings } from 'bun:sqlite';

export type ProjectContext = {
  id: string;
  name: string;
  rootPath: string;
  description?: string;
  architecture: {
    patterns: string[];
    techStack: string[];
    constraints: string[];
  };
  dependencies: Record<string, string>;
  currentGoal?: string;
  lastActiveAt: number;
  created_at: number;
  updated_at: number;
};

type ProjectContextRow = {
  id: string;
  name: string;
  rootPath: string;
  description: string | null;
  architecture: string;  // JSON
  dependencies: string;  // JSON
  currentGoal: string | null;
  lastActiveAt: number;
  created_at: number;
  updated_at: number;
};

function parseProjectContext(row: ProjectContextRow): ProjectContext {
  return {
    ...row,
    description: row.description ?? undefined,
    currentGoal: row.currentGoal ?? undefined,
    architecture: JSON.parse(row.architecture),
    dependencies: JSON.parse(row.dependencies),
  };
}

/**
 * Initialize project_contexts table
 */
export function initializeProjectContexts(): void {
  const db = getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS project_contexts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rootPath TEXT NOT NULL UNIQUE,
      description TEXT,
      architecture TEXT NOT NULL,
      dependencies TEXT NOT NULL,
      currentGoal TEXT,
      lastActiveAt INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);
  console.log('[ProjectContexts] Table initialized');
}

/**
 * Create or update a project context
 */
export function upsertProjectContext(
  name: string,
  rootPath: string,
  architecture: {
    patterns: string[];
    techStack: string[];
    constraints: string[];
  },
  dependencies?: Record<string, string>,
  description?: string
): ProjectContext {
  const db = getDb();
  const now = Date.now();
  const id = generateId();

  // Check if project exists by rootPath
  const existing = db.prepare(`
    SELECT * FROM project_contexts WHERE rootPath = ?
  `).get(rootPath) as ProjectContextRow | undefined;

  if (existing) {
    // Update existing
    const parsedExisting = parseProjectContext(existing);
    const updated: ProjectContext = {
      ...parsedExisting,
      name,
      architecture,
      dependencies: dependencies ?? parsedExisting.dependencies,
      description,
      updated_at: now,
    };

    db.prepare(`
      UPDATE project_contexts SET
        name = ?,
        architecture = ?,
        dependencies = ?,
        description = ?,
        updated_at = ?
      WHERE rootPath = ?
    `).run(
      name,
      JSON.stringify(architecture),
      JSON.stringify(updated.dependencies),
      description ?? null,
      now,
      rootPath
    );

    console.log(`[ProjectContexts] Updated: ${name} (${rootPath})`);
    return updated;
  } else {
    // Create new
    const newContext: ProjectContext = {
      id,
      name,
      rootPath,
      description,
      architecture,
      dependencies: dependencies ?? {},
      lastActiveAt: now,
      created_at: now,
      updated_at: now,
    };

    db.prepare(`
      INSERT INTO project_contexts (
        id, name, rootPath, description, architecture, dependencies,
        lastActiveAt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      rootPath,
      description ?? null,
      JSON.stringify(architecture),
      JSON.stringify(newContext.dependencies),
      now,
      now,
      now
    );

    console.log(`[ProjectContexts] Created: ${name} (${rootPath})`);
    return newContext;
  }
}

/**
 * Get project context by root path
 */
export function getProjectContextByPath(rootPath: string): ProjectContext | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM project_contexts WHERE rootPath = ?
  `).get(rootPath) as ProjectContextRow | undefined;

  if (!row) return null;
  return parseProjectContext(row);
}

/**
 * Get project context by ID
 */
export function getProjectContextById(id: string): ProjectContext | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM project_contexts WHERE id = ?
  `).get(id) as ProjectContextRow | undefined;

  if (!row) return null;
  return parseProjectContext(row);
}

/**
 * Update last active timestamp
 */
export function touchProjectContext(rootPath: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE project_contexts SET
      lastActiveAt = ?,
      updated_at = ?
    WHERE rootPath = ?
  `).run(Date.now(), Date.now(), rootPath);
}

/**
 * Get all projects ordered by last active
 */
export function getAllProjects(): ProjectContext[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM project_contexts
    ORDER BY lastActiveAt DESC
  `).all() as ProjectContextRow[];

  return rows.map(parseProjectContext);
}

/**
 * Set current goal for a project
 */
export function setProjectCurrentGoal(rootPath: string, goal: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE project_contexts SET
      currentGoal = ?,
      updated_at = ?
    WHERE rootPath = ?
  `).run(goal, Date.now(), rootPath);
}

/**
 * Delete a project context
 */
export function deleteProjectContext(rootPath: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM project_contexts WHERE rootPath = ?
  `).run(rootPath);

  return result.changes > 0;
}

/**
 * Format project context for system prompt injection
 */
export function getProjectContextForPrompt(project: ProjectContext): string {
  const lines: string[] = ['## 📁 CURRENT PROJECT'];
  lines.push(`**Project**: ${project.name}`);
  lines.push(`**Root**: ${project.rootPath}`);

  if (project.description) {
    lines.push(`**Description**: ${project.description}`);
  }

  if (project.architecture.patterns.length > 0) {
    lines.push('');
    lines.push('### Architecture Patterns');
    for (const pattern of project.architecture.patterns) {
      lines.push(`- ${pattern}`);
    }
  }

  if (project.architecture.techStack.length > 0) {
    lines.push('');
    lines.push('### Tech Stack');
    for (const tech of project.architecture.techStack) {
      lines.push(`- ${tech}`);
    }
  }

  if (project.architecture.constraints.length > 0) {
    lines.push('');
    lines.push('### Constraints & Rules');
    for (const constraint of project.architecture.constraints) {
      lines.push(`- ${constraint}`);
    }
  }

  if (project.currentGoal) {
    lines.push('');
    lines.push('### Current Focus');
    lines.push(project.currentGoal);
  }

  return lines.join('\n');
}

/**
 * Detect git root for a given path
 */
export function findGitRoot(startPath: string): string | null {
  const { dirname } = require('node:path');
  const { statSync, existsSync } = require('node:fs');

  let current = startPath;

  while (current !== '/' && current !== '.') {
    const gitDir = `${current}/.git`;
    if (existsSync(gitDir)) {
      try {
        const stats = statSync(gitDir);
        if (stats.isDirectory()) {
          return current;
        }
      } catch {
        // Ignore
      }
    }
    current = dirname(current);
  }

  return null;
}

/**
 * Get or create project context for current working directory
 */
export function getOrCreateCurrentProjectContext(cwd: string = process.cwd()): ProjectContext | null {
  const gitRoot = findGitRoot(cwd);

  if (!gitRoot) {
    console.log('[ProjectContexts] Not in a git repository, using global context');
    return null;
  }

  const existing = getProjectContextByPath(gitRoot);

  if (existing) {
    touchProjectContext(gitRoot);
    return existing;
  }

  // Auto-detect project info
  const projectName = gitRoot.split('/').pop() ?? 'Unknown Project';

  return upsertProjectContext(
    projectName,
    gitRoot,
    {
      patterns: [],
      techStack: [],
      constraints: [],
    }
  );
}
