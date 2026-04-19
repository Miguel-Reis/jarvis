/**
 * Vault Retrieval — Memory Query Engine
 *
 * Hybrid BM25 + vector retrieval:
 *   1. Entity name search (keyword)
 *   2. Facts FTS5 (BM25 — porter stemmer, ranked by relevance × recency)
 *   3. Conversation messages FTS5 (BM25 — recent relevant chat snippets)
 *   4. Vector cosine similarity (semantic matches across all ref types)
 *
 * Results are merged and de-duplicated before formatting into the system prompt.
 */

import { getDb } from './schema.ts';
import { searchEntitiesByName, getEntity, type Entity } from './entities.ts';
import { findFacts, type Fact } from './facts.ts';
import { getEntityRelationships } from './relationships.ts';
import { USER_PROFILE_VAULT_SOURCE } from './user-profile.ts';
import { findSimilar } from './vectors.ts';
import { getEmbeddingService } from '../llm/embeddings.ts';
import { findGoals, getGoal } from './goals.ts';
import { getActiveProjectId } from './projects.ts';
import type { Goal } from '../goals/types.ts';
import { getCommitment, type Commitment } from './commitments.ts';

// Common stopwords to filter from search queries
const STOPWORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her',
  'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs',
  'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if',
  'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with',
  'about', 'against', 'between', 'through', 'during', 'before', 'after', 'above',
  'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'can', 'will', 'just', 'don', 'should', 'now', 'could', 'would', 'shall',
  'may', 'might', 'must', 'tell', 'know', 'think', 'say', 'said', 'get', 'go',
  'make', 'like', 'also', 'well', 'back', 'way', 'want', 'look', 'first', 'even',
  'give', 'yeah', 'yes', 'please', 'thanks', 'thank', 'hi', 'hello', 'hey',
  'okay', 'ok', 'sure', 'right', 'much', 'many', 'need', 'let', 'remember',
  'recall', 'told', 'mentioned', 'talked', 'work', 'works', 'working',
]);

export type EntityProfile = {
  entity: Entity;
  facts: Fact[];
  relationships: Array<{ type: string; target: string; direction: 'from' | 'to' }>;
};

/**
 * Extract meaningful search terms from a user message.
 * Filters stopwords and short words, deduplicates.
 */
export function extractSearchTerms(message: string): string[] {
  const words = message
    .toLowerCase()
    .split(/[^a-zA-Z0-9']+/)
    .map(w => w.replace(/^'+|'+$/g, '')) // trim quotes
    .filter(w => w.length > 1 && !STOPWORDS.has(w));

  return [...new Set(words)];
}

/**
 * Search the vault for entities, commitments, and goals matching the given message.
 * Returns the full context bundle used by getKnowledgeForMessage.
 */
async function retrieveContextForMessage(message: string): Promise<{
  profiles: EntityProfile[];
  commitments: Commitment[];
  goals: Goal[];
  recentConversationSnippets: string[];
}> {
  const terms = extractSearchTerms(message);
  const entityMap = new Map<string, Entity>();
  const activeProject = getActiveProjectId();
  const projectFilter = activeProject ? `project_id = '${activeProject.replace(/'/g, "''")}'` : null;

  if (looksLikeSelfQuery(message)) {
    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT * FROM entities WHERE source = ? ORDER BY updated_at DESC LIMIT 1'
      ).get(USER_PROFILE_VAULT_SOURCE) as {
        id: string;
        type: Entity['type'];
        name: string;
        properties: string | null;
        created_at: number;
        updated_at: number;
        source: string | null;
        project_id: string | null;
      } | null;

      if (row) {
        entityMap.set(row.id, {
          ...row,
          properties: row.properties ? JSON.parse(row.properties) : null,
        });
      }
    } catch (err) {
      // DB not available — skip self-profile bootstrap
      console.warn('[retrieval] self-profile bootstrap failed:', err);
    }
  }

  if (terms.length === 0 && entityMap.size === 0 && !getEmbeddingService()?.isAvailable())
    return { profiles: [], commitments: [], goals: [], recentConversationSnippets: [] };

  const recentConversationSnippets: string[] = [];

  // 1. Search entity names (scoped to active project)
  for (const term of terms) {
    const matches = searchEntitiesByName(term, activeProject);
    for (const entity of matches) {
      entityMap.set(entity.id, entity);
    }
  }

  // 2a. Facts FTS5 (BM25) — ranked by relevance then recency
  try {
    const db = getDb();
    if (terms.length > 0) {
      // Try FTS5 first; fall back to LIKE if unavailable
      const ftsQuery = terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' OR ');
      try {
        const projectClause = projectFilter ? ` AND e.${projectFilter}` : '';
        const rows = db.prepare(`
          SELECT DISTINCT e.id, e.type, e.name, e.properties, e.project_id, e.created_at, e.updated_at, e.source
          FROM entities e
          JOIN facts f ON e.id = f.subject_id
          JOIN facts_fts fts ON fts.rowid = f.rowid
          WHERE facts_fts MATCH ?${projectClause}
          ORDER BY rank
          LIMIT 15
        `).all(ftsQuery) as any[];
        for (const row of rows) {
          if (!entityMap.has(row.id)) {
            entityMap.set(row.id, {
              ...row,
              properties: row.properties ? JSON.parse(row.properties) : null,
            });
          }
        }
      } catch (err) {
        // FTS5 not available — fallback to LIKE
        console.warn('[retrieval] FTS5 unavailable, using LIKE fallback:', err);
        const projectClause = projectFilter ? ` AND e.${projectFilter}` : '';
        for (const term of terms) {
          const rows = db.prepare(`
            SELECT DISTINCT e.id, e.type, e.name, e.properties, e.project_id, e.created_at, e.updated_at, e.source
            FROM entities e
            JOIN facts f ON e.id = f.subject_id
            WHERE (f.object LIKE ? OR f.predicate LIKE ?)${projectClause}
            LIMIT 10
          `).all(`%${term}%`, `%${term}%`) as any[];
          for (const row of rows) {
            if (!entityMap.has(row.id)) {
              entityMap.set(row.id, {
                ...row,
                properties: row.properties ? JSON.parse(row.properties) : null,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    // DB not available — return what we have from entity search
    console.warn('[retrieval] entity search failed:', err);
  }

  // 2b. Conversation messages FTS5 (BM25) — find recent snippets matching the query
  if (terms.length > 0) {
    try {
      const db = getDb();
      const now = Date.now();
      const ftsQuery = terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' OR ');

      // Temporal decay: score = bm25_rank * recency_factor
      // recency_factor = 1 / (1 + days_old) — recent messages score higher
      let rows: Array<{ content: string; created_at: number; role: string }> = [];

      try {
        const projectJoin = projectFilter
          ? `JOIN conversations c ON cm.conversation_id = c.id AND c.${projectFilter}`
          : '';
        rows = db.prepare(`
          SELECT cm.content, cm.created_at, cm.role
          FROM conversation_messages cm
          ${projectJoin}
          JOIN conv_messages_fts fts ON fts.rowid = cm.rowid
          WHERE conv_messages_fts MATCH ?
            AND cm.role IN ('user', 'assistant')
          ORDER BY rank * (1.0 / (1.0 + (? - cm.created_at) / 86400000.0))
          LIMIT 8
        `).all(ftsQuery, now) as any[];
      } catch (err) {
        // FTS5 unavailable — LIKE fallback
        console.warn('[retrieval] conv_messages FTS5 unavailable, using LIKE fallback:', err);
        const projectClause = projectFilter ? ` AND cm.conversation_id IN (SELECT id FROM conversations WHERE ${projectFilter})` : '';
        const pattern = `%${terms[0]}%`;
        rows = db.prepare(`
          SELECT content, created_at, role
          FROM conversation_messages
          WHERE content LIKE ?
            AND role IN ('user', 'assistant')
            ${projectClause}
          ORDER BY created_at DESC
          LIMIT 8
        `).all(pattern) as any[];
      }

      for (const row of rows) {
        const excerpt = row.content.length > 200
          ? row.content.slice(0, 197) + '…'
          : row.content;
        const daysAgo = Math.round((now - row.created_at) / 86400000);
        const timeLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;
        recentConversationSnippets.push(`[${row.role}, ${timeLabel}] ${excerpt}`);
      }
    } catch {
      // Best-effort — never block
    }
  }

  // 3. Vector search — enrich with semantically similar entities, commitments, and goals
  const matchedCommitments = new Map<string, Commitment>();
  const matchedGoals = new Map<string, Goal>();

  try {
    const svc = getEmbeddingService();
    if (svc?.isAvailable()) {
      const queryVec = await svc.embed(message);
      if (queryVec) {
        const similar = findSimilar(queryVec, 12); // fetch extra to account for project filtering
        for (const { ref_type, ref_id } of similar) {
          if (ref_type === 'entity' && !entityMap.has(ref_id)) {
            const entity = getEntity(ref_id);
            // Skip entities from other projects
            if (entity && !(activeProject && entity.project_id && entity.project_id !== activeProject)) {
              entityMap.set(entity.id, entity);
            }
          } else if (ref_type === 'commitment' && !matchedCommitments.has(ref_id)) {
            const c = getCommitment(ref_id);
            // Skip commitments from other projects
            if (c && !(activeProject && c.project_id && c.project_id !== activeProject)
              && c.status !== 'completed' && c.status !== 'failed') {
              matchedCommitments.set(ref_id, c);
            }
          } else if (ref_type === 'goal' && !matchedGoals.has(ref_id)) {
            const g = getGoal(ref_id);
            // Skip goals from other projects
            if (g && !(activeProject && g.project_id && g.project_id !== activeProject)) {
              matchedGoals.set(ref_id, g);
            }
          }
        }
        if (similar.length > 0) {
          console.log(`[retrieval] vector search found ${similar.length} result(s)`);
        }
      }
    }
  } catch (err) {
    // Vector search is best-effort — never block keyword results
    console.warn('[retrieval] vector search failed:', err);
  }

  // 4. Build full profiles for matched entities (cap at 10)
  const entities = [...entityMap.values()].slice(0, 10);
  const profiles: EntityProfile[] = [];

  for (const entity of entities) {
    const facts = findFacts({ subject_id: entity.id });

    let relationships: EntityProfile['relationships'] = [];
    try {
      const rels = getEntityRelationships(entity.id);
      relationships = rels.map(r => ({
        type: r.type,
        target: r.from_id === entity.id ? r.to_entity.name : r.from_entity.name,
        direction: (r.from_id === entity.id ? 'from' : 'to') as 'from' | 'to',
      }));
    } catch {
      // Relationship query failed — skip
    }

    profiles.push({ entity, facts, relationships });
  }

  return { profiles, commitments: [...matchedCommitments.values()], goals: [...matchedGoals.values()], recentConversationSnippets };
}

/**
 * Public wrapper — returns entity profiles only (backward-compatible).
 */
export async function retrieveForMessage(message: string): Promise<EntityProfile[]> {
  return (await retrieveContextForMessage(message)).profiles;
}

function looksLikeSelfQuery(message: string): boolean {
  return /\b(i|me|my|mine|myself)\b/i.test(message);
}

/**
 * Format entity profiles into readable text for the system prompt.
 */
export function formatKnowledgeContext(profiles: EntityProfile[]): string {
  if (profiles.length === 0) return '';

  const sections: string[] = [];

  for (const { entity, facts, relationships } of profiles) {
    const lines: string[] = [];

    lines.push(`**${entity.name}** (${entity.type})`);

    for (const fact of facts) {
      lines.push(`  - ${fact.predicate}: ${fact.object}`);
    }

    for (const rel of relationships) {
      if (rel.direction === 'from') {
        lines.push(`  - ${rel.type} -> ${rel.target}`);
      } else {
        lines.push(`  - ${rel.target} -> ${rel.type} -> ${entity.name}`);
      }
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Format a list of semantically matched commitments into readable text.
 */
function formatCommitmentsContext(commitments: Commitment[]): string {
  if (commitments.length === 0) return '';
  const lines = commitments.map(c => {
    const dueStr = c.when_due ? ` (due: ${new Date(c.when_due).toLocaleDateString()})` : '';
    return `  - [${c.priority}] ${c.what}${dueStr} — ${c.status}`;
  });
  return `**Related Commitments**\n${lines.join('\n')}`;
}

/**
 * Format a list of semantically matched goals into readable text.
 */
function formatGoalsContext(goals: Goal[]): string {
  if (goals.length === 0) return '';
  const lines = goals.map(g => {
    const deadlineStr = g.deadline ? ` (deadline: ${new Date(g.deadline).toLocaleDateString()})` : '';
    return `  - [${g.level}] ${g.title} — score ${g.score.toFixed(1)}/1.0${deadlineStr}`;
  });
  return `**Related Goals**\n${lines.join('\n')}`;
}

/**
 * Main entry point: get formatted knowledge context for a user message.
 * Returns empty string if no relevant knowledge found.
 */
export async function getKnowledgeForMessage(message: string): Promise<string> {
  try {
    const { profiles, commitments, goals, recentConversationSnippets } = await retrieveContextForMessage(message);
    const parts: string[] = [];

    const entityContext = formatKnowledgeContext(profiles);
    if (entityContext) parts.push(entityContext);

    const commitmentContext = formatCommitmentsContext(commitments);
    if (commitmentContext) parts.push(commitmentContext);

    const goalContext = formatGoalsContext(goals);
    if (goalContext) parts.push(goalContext);

    if (recentConversationSnippets.length > 0) {
      parts.push(`**Related Conversation History**\n${recentConversationSnippets.join('\n')}`);
    }

    return parts.join('\n\n');
  } catch (err) {
    console.error('[Retrieval] Error querying vault:', err);
    return '';
  }
}

/**
 * Get a summary of active goals for system prompt injection.
 * Returns formatted text showing goal hierarchy with scores, or empty string.
 */
export function getActiveGoalsSummary(): string {
  try {
    const activeGoals = findGoals({ status: 'active' });

    if (activeGoals.length === 0) return '';
    const levelOrder: Record<string, number> = {
      objective: 0,
      key_result: 1,
      milestone: 2,
      task: 3,
      daily_action: 4,
    };

    activeGoals.sort((a, b) => {
      const la = levelOrder[a.level] ?? 5;
      const lb = levelOrder[b.level] ?? 5;
      if (la !== lb) return la - lb;
      return a.title.localeCompare(b.title);
    });
    const topGoals = activeGoals.slice(0, 15);
    const lines: string[] = [];
    for (const goal of topGoals) {
      const indent = '  '.repeat(levelOrder[goal.level] ?? 0);
      const healthIcon = goal.health === 'on_track' ? '+' :
        goal.health === 'at_risk' ? '~' :
        goal.health === 'behind' ? '-' : '!';
      const deadlineStr = goal.deadline
        ? ` (due: ${new Date(goal.deadline).toLocaleDateString()})`
        : '';
      lines.push(`${indent}[${healthIcon}] ${goal.title} — ${goal.score.toFixed(1)}/1.0${deadlineStr}`);
    }

    if (activeGoals.length > 15) {
      lines.push(`  ... and ${activeGoals.length - 15} more active goals`);
    }

    return lines.join('\n');
  } catch (err) {
    console.warn('[retrieval] getActiveGoalsSummary failed:', err);
    return '';
  }
}
