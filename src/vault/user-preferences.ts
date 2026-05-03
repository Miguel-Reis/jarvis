/**
 * User Preferences — Knowledge layer for learning user habits and preferences
 *
 * Stores observed patterns, learned preferences, and explicit user settings.
 * Used by PromptBuilder to inject personalized context into agent interactions.
 */

import { getDb, generateId } from './schema.ts';
import type { SQLQueryBindings } from 'bun:sqlite';

export type PreferenceCategory = 'coding' | 'communication' | 'workflow' | 'testing' | 'documentation';

export type PreferenceSource = 'observed' | 'explicit' | 'inferred';

export type UserPreference = {
  id: string;
  category: PreferenceCategory;
  name: string;
  value: unknown;
  confidence: number;        // 0.0-1.0
  source: PreferenceSource;
  observed_count: number;
  last_observed_at: number;
  created_at: number;
  updated_at: number;
};

type PreferenceRow = {
  id: string;
  category: string;
  name: string;
  value: string;
  confidence: number;
  source: string;
  observed_count: number;
  last_observed_at: number;
  created_at: number;
  updated_at: number;
};

function parsePreference(row: PreferenceRow): UserPreference {
  return {
    ...row,
    category: row.category as PreferenceCategory,
    source: row.source as PreferenceSource,
    value: JSON.parse(row.value),
  };
}

/**
 * Initialize user_preferences table
 */
export function initializePreferences(): void {
  const db = getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      source TEXT DEFAULT 'observed',
      observed_count INTEGER DEFAULT 1,
      last_observed_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);
  console.log('[UserPreferences] Table initialized');
}

/**
 * Create or update a preference based on observation
 */
export function observePreference(
  category: PreferenceCategory,
  name: string,
  value: unknown,
  source: PreferenceSource = 'observed'
): UserPreference {
  const db = getDb();
  const now = Date.now();
  const id = generateId();

  // Check if preference already exists
  const existing = db.prepare(`
    SELECT * FROM user_preferences
    WHERE category = ? AND name = ?
  `).get(category, name) as PreferenceRow | undefined;

  if (existing) {
    // Update existing preference
    const newValue = JSON.stringify(value);
    const newConfidence = Math.min(1.0, existing.confidence + 0.1);
    const newCount = existing.observed_count + 1;

    db.prepare(`
      UPDATE user_preferences SET
        value = ?,
        confidence = ?,
        observed_count = ?,
        last_observed_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(newValue, newConfidence, newCount, now, now, existing.id);

    console.log(`[UserPreferences] Updated: ${category}.${name} (confidence: ${newConfidence.toFixed(2)})`);

    return parsePreference({
      ...existing,
      value: newValue,
      confidence: newConfidence,
      observed_count: newCount,
      last_observed_at: now,
      updated_at: now,
    });
  } else {
    // Create new preference
    db.prepare(`
      INSERT INTO user_preferences (
        id, category, name, value, confidence, source,
        observed_count, last_observed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(id, category, name, JSON.stringify(value), 0.5, source, now, now, now);

    console.log(`[UserPreferences] Created: ${category}.${name}`);

    return {
      id,
      category,
      name,
      value,
      confidence: 0.5,
      source,
      observed_count: 1,
      last_observed_at: now,
      created_at: now,
      updated_at: now,
    };
  }
}

/**
 * Get all preferences for a category
 */
export function getPreferencesByCategory(category: PreferenceCategory): UserPreference[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM user_preferences
    WHERE category = ?
    ORDER BY confidence DESC, last_observed_at DESC
  `).all(category) as PreferenceRow[];

  return rows.map(parsePreference);
}

/**
 * Get a specific preference by name
 */
export function getPreference(category: PreferenceCategory, name: string): UserPreference | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM user_preferences
    WHERE category = ? AND name = ?
  `).get(category, name) as PreferenceRow | undefined;

  if (!row) return null;
  return parsePreference(row);
}

/**
 * Get all preferences with confidence above threshold
 */
export function getHighConfidencePreferences(threshold: number = 0.7): UserPreference[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM user_preferences
    WHERE confidence >= ?
    ORDER BY category, confidence DESC
  `).all(threshold) as PreferenceRow[];

  return rows.map(parsePreference);
}

/**
 * Update preference confidence manually (for user feedback)
 */
export function updatePreferenceConfidence(
  category: PreferenceCategory,
  name: string,
  confidence: number
): UserPreference | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM user_preferences
    WHERE category = ? AND name = ?
  `).get(category, name) as PreferenceRow | undefined;

  if (!row) return null;

  const clampedConfidence = Math.max(0, Math.min(1, confidence));

  db.prepare(`
    UPDATE user_preferences SET
      confidence = ?,
      updated_at = ?
    WHERE id = ?
  `).run(clampedConfidence, Date.now(), row.id);

  console.log(`[UserPreferences] Confidence updated: ${category}.${name} → ${clampedConfidence.toFixed(2)}`);

  return parsePreference({
    ...row,
    confidence: clampedConfidence,
    updated_at: Date.now(),
  });
}

/**
 * Delete a preference (user correction)
 */
export function deletePreference(category: PreferenceCategory, name: string): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM user_preferences
    WHERE category = ? AND name = ?
  `).run(category, name);

  if (result.changes > 0) {
    console.log(`[UserPreferences] Deleted: ${category}.${name}`);
    return true;
  }
  return false;
}

/**
 * Get preferences formatted for system prompt injection
 */
export function getPreferencesForPrompt(): string {
  const preferences = getHighConfidencePreferences(0.6);

  if (preferences.length === 0) {
    return '';
  }

  const byCategory = preferences.reduce((acc, pref) => {
    if (!acc[pref.category]) acc[pref.category] = [];
    acc[pref.category].push(pref);
    return acc;
  }, {} as Record<PreferenceCategory, UserPreference[]>);

  const lines: string[] = ['## 🎯 USER PREFERENCES'];

  for (const [category, prefs] of Object.entries(byCategory)) {
    lines.push(`\n### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    for (const pref of prefs) {
      const valueStr = typeof pref.value === 'boolean'
        ? (pref.value ? '✅ Yes' : '❌ No')
        : String(pref.value);
      lines.push(`- **${pref.name}**: ${valueStr} (confidence: ${(pref.confidence * 100).toFixed(0)}%)`);
    }
  }

  return lines.join('\n');
}

/**
 * Export all preferences for backup/migration
 */
export function exportAllPreferences(): UserPreference[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM user_preferences ORDER BY category, name`).all() as PreferenceRow[];
  return rows.map(parsePreference);
}

/**
 * Import preferences from backup (merge with existing)
 */
export function importPreferences(preferences: Partial<UserPreference>[]): number {
  let imported = 0;
  for (const pref of preferences) {
    if (!pref.category || !pref.name || pref.value === undefined) continue;

    observePreference(
      pref.category as PreferenceCategory,
      pref.name,
      pref.value,
      pref.source || 'explicit'
    );

    if (pref.confidence !== undefined) {
      updatePreferenceConfidence(
        pref.category as PreferenceCategory,
        pref.name,
        pref.confidence
      );
    }

    imported++;
  }
  return imported;
}
