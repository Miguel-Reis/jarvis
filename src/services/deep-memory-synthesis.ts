/**
 * Deep Memory Synthesis Service
 *
 * Learns cross-project patterns and synthesizes knowledge.
 * Connects solutions and patterns across different projects in the Vault.
 *
 * Features:
 * - Pattern detection across projects
 * - Knowledge graph linking
 * - Solution recall by similarity
 * - Architectural rule synthesis
 */

import { getDb, generateId } from '../vault/schema.ts';
import type { Service, ServiceStatus } from '../daemon/services.ts';

export interface SynthesizedPattern {
  id: string;
  category: 'coding' | 'architecture' | 'workflow' | 'communication' | 'debugging';
  name: string;
  description: string;
  sourceProjects: string[];
  occurrenceCount: number;
  successRate: number;  // 0-1
  lastObserved: number;
  relatedConcepts: string[];
  confidence: number;   // 0-1
}

export interface KnowledgeLink {
  fromEntity: string;
  toEntity: string;
  linkType: 'similar_to' | 'depends_on' | 'solves' | 'causes' | 'precedes';
  strength: number;    // 0-1
}

export interface DeepMemoryConfig {
  enabled: boolean;
  minOccurrences: number;      // Min occurrences to synthesize (default: 3)
  confidenceThreshold: number; // Min confidence to store (default: 0.6)
  analysisIntervalMs: number;  // Analysis interval (default: 300000 = 5min)
}

const DEFAULT_CONFIG: DeepMemoryConfig = {
  enabled: true,
  minOccurrences: 3,
  confidenceThreshold: 0.6,
  analysisIntervalMs: 300000,
};

export class DeepMemorySynthesisService implements Service {
  name = 'deep-memory-synthesis';
  private config: DeepMemoryConfig;
  private statusState: ServiceStatus = 'stopped';
  private analysisTimer: Timer | null = null;
  private discoveredPatterns: SynthesizedPattern[] = [];
  private knowledgeLinks: KnowledgeLink[] = [];
  private onPatternDiscovered?: (pattern: SynthesizedPattern) => void;

  constructor(config?: Partial<DeepMemoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    console.log('[DeepMemory] Starting...');
    this.statusState = 'starting';

    try {
      // Run initial synthesis
      await this.runSynthesis();

      // Start periodic analysis
      this.analysisTimer = setInterval(() => {
        this.runSynthesis().catch(err =>
          console.error('[DeepMemory] Synthesis error:', err instanceof Error ? err.message : err)
        );
      }, this.config.analysisIntervalMs);

      this.statusState = 'running';
      console.log(`[DeepMemory] Running (analysis every ${this.config.analysisIntervalMs / 1000}s)`);
    } catch (err) {
      this.statusState = 'error';
      console.error('[DeepMemory] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[DeepMemory] Stopping...');
    this.statusState = 'stopping';

    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }

    this.statusState = 'stopped';
    console.log('[DeepMemory] Stopped');
  }

  /**
   * Get current service status
   */
  status(): ServiceStatus {
    return this.statusState;
  }

  /**
   * Set pattern discovered callback
   */
  setPatternDiscoveredCallback(callback: (pattern: SynthesizedPattern) => void): void {
    this.onPatternDiscovered = callback;
  }

  /**
   * Run pattern synthesis across all projects
   */
  async runSynthesis(): Promise<void> {
    console.log('[DeepMemory] Running cross-project synthesis...');

    try {
      // Synthesize coding patterns
      await this.synthesizeCodingPatterns();

      // Synthesize workflow patterns
      await this.synthesizeWorkflowPatterns();

      // Synthesize architectural patterns
      await this.synthesizeArchitecturalPatterns();

      // Build knowledge links
      await this.buildKnowledgeLinks();

      console.log(`[DeepMemory] Synthesis complete: ${this.discoveredPatterns.length} patterns, ${this.knowledgeLinks.length} links`);
    } catch (err) {
      console.error('[DeepMemory] Synthesis failed:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Synthesize coding patterns from task history
   */
  private async synthesizeCodingPatterns(): Promise<void> {
    const db = getDb();

    // Find recurring coding activities
    const stmt = db.prepare(`
      SELECT
        id,
        project_id,
        title,
        status,
        actual_duration_ms,
        created_at
      FROM task_history
      WHERE status IN ('completed', 'failed')
      ORDER BY created_at DESC
      LIMIT 1000
    `);

    const tasks = stmt.all() as Array<{
      id: string;
      project_id: string;
      title: string;
      status: string;
      actual_duration_ms: number;
      created_at: number;
    }>;

    // Group by title similarity (simple keyword matching)
    const taskGroups = new Map<string, typeof tasks>();

    for (const task of tasks) {
      // Extract keywords from title
      const keywords = task.title
        .toLowerCase()
        .split(/[\s_-]+/)
        .filter(w => w.length > 3 && !['the', 'and', 'for', 'with', 'from', 'that', 'this'].includes(w))
        .slice(0, 3)
        .join('-');

      const existing = taskGroups.get(keywords) || [];
      existing.push(task);
      taskGroups.set(keywords, existing);
    }

    // Synthesize patterns from groups with enough occurrences
    for (const [keywords, group] of taskGroups.entries()) {
      if (group.length >= this.config.minOccurrences) {
        const successCount = group.filter(t => t.status === 'completed').length;
        const avgDuration = group.reduce((a, b) => a + b.actual_duration_ms, 0) / group.length;
        const projects = [...new Set(group.map(t => t.project_id))];

        const pattern: SynthesizedPattern = {
          id: generateId(),
          category: 'coding',
          name: `Pattern: ${keywords.replace(/-/g, ' ')}`,
          description: `Recurring task pattern observed ${group.length} times across ${projects.length} project(s). Avg duration: ${(avgDuration / 1000).toFixed(0)}s`,
          sourceProjects: projects,
          occurrenceCount: group.length,
          successRate: successCount / group.length,
          lastObserved: Math.max(...group.map(t => t.created_at)),
          relatedConcepts: keywords.split('-'),
          confidence: this.calculateConfidence(group.length, successCount / group.length),
        };

        if (pattern.confidence >= this.config.confidenceThreshold) {
          this.discoveredPatterns.push(pattern);
          this.persistPattern(pattern);

          if (this.onPatternDiscovered) {
            this.onPatternDiscovered(pattern);
          }
        }
      }
    }
  }

  /**
   * Synthesize workflow patterns from agent coordination
   */
  private async synthesizeWorkflowPatterns(): Promise<void> {
    const db = getDb();

    // Analyze agent message patterns
    const stmt = db.prepare(`
      SELECT type, COUNT(*) as count, MAX(created_at) as last_seen
      FROM agent_messages
      GROUP BY type
      HAVING count >= ?
    `);

    const results = stmt.all(this.config.minOccurrences * 10) as Array<{
      type: string;
      count: number;
      last_seen: number;
    }>;

    for (const result of results) {
      const pattern: SynthesizedPattern = {
        id: generateId(),
        category: 'workflow',
        name: `Workflow: ${result.type}`,
        description: `Agent coordination pattern: ${result.count} occurrences`,
        sourceProjects: [],
        occurrenceCount: result.count,
        successRate: 1.0,
        lastObserved: result.last_seen,
        relatedConcepts: ['agent', 'coordination', result.type],
        confidence: Math.min(1, result.count / 100),
      };

      if (pattern.confidence >= this.config.confidenceThreshold) {
        this.discoveredPatterns.push(pattern);
        this.persistPattern(pattern);
      }
    }
  }

  /**
   * Synthesize architectural patterns from entities
   */
  private async synthesizeArchitecturalPatterns(): Promise<void> {
    const db = getDb();

    // Find recurring architectural concepts
    const stmt = db.prepare(`
      SELECT name, properties, project_id, COUNT(*) as occurrences
      FROM entities
      WHERE type = 'concept'
      GROUP BY name, project_id
      HAVING occurrences >= ?
    `);

    const results = stmt.all(this.config.minOccurrences) as Array<{
      name: string;
      properties: string;
      project_id: string;
      occurrences: number;
    }>;

    // Group concepts across projects
    const conceptMap = new Map<string, { projects: string[]; count: number; properties: string }>();

    for (const result of results) {
      const existing = conceptMap.get(result.name) || { projects: [], count: 0, properties: result.properties };
      existing.projects.push(result.project_id);
      existing.count += result.occurrences;
      conceptMap.set(result.name, existing);
    }

    for (const [conceptName, data] of conceptMap.entries()) {
      if (data.projects.length >= 2) {
        const pattern: SynthesizedPattern = {
          id: generateId(),
          category: 'architecture',
          name: `Architecture: ${conceptName}`,
          description: `Cross-project architectural concept: ${data.count} occurrences across ${data.projects.length} projects`,
          sourceProjects: data.projects,
          occurrenceCount: data.count,
          successRate: 1.0,
          lastObserved: Date.now(),
          relatedConcepts: [],
          confidence: Math.min(1, data.count / 50),
        };

        if (pattern.confidence >= this.config.confidenceThreshold) {
          this.discoveredPatterns.push(pattern);
          this.persistPattern(pattern);
        }
      }
    }
  }

  /**
   * Build knowledge links between entities
   */
  private async buildKnowledgeLinks(): Promise<void> {
    const db = getDb();

    // Find entities with similar tags or relationships
    const stmt = db.prepare(`
      SELECT id, type, name, properties, project_id
      FROM entities
      WHERE type IN ('concept', 'tool', 'place')
      ORDER BY created_at DESC
      LIMIT 500
    `);

    const entities = stmt.all() as Array<{
      id: string;
      type: string;
      name: string;
      properties: string;
      project_id: string;
    }>;

    // Build links based on tag similarity
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const e1 = entities[i]!;
        const e2 = entities[j]!;

        const tags1 = (e1.tags || '').split(',').map(t => t.trim()).filter(Boolean);
        const tags2 = (e2.tags || '').split(',').map(t => t.trim()).filter(Boolean);

        const commonTags = tags1.filter(t => tags2.includes(t));
        if (commonTags.length >= 2) {
          const strength = Math.min(1, commonTags.length / 5);

          if (strength >= 0.3) {
            this.knowledgeLinks.push({
              fromEntity: e1.id,
              toEntity: e2.id,
              linkType: 'similar_to',
              strength,
            });
          }
        }
      }
    }

    // Persist links
    this.persistKnowledgeLinks();
  }

  /**
   * Calculate confidence score for a pattern
   */
  private calculateConfidence(occurrences: number, successRate: number): number {
    // Confidence increases with occurrences and success rate
    const occurrenceFactor = Math.min(1, occurrences / 10);
    const successFactor = successRate;
    return (occurrenceFactor * 0.6 + successFactor * 0.4);
  }

  /**
   * Persist pattern to database
   */
  private persistPattern(pattern: SynthesizedPattern): void {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO synthesized_patterns (
          id, category, name, description, source_projects, occurrence_count,
          success_rate, last_observed, related_concepts, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        pattern.id,
        pattern.category,
        pattern.name,
        pattern.description,
        JSON.stringify(pattern.sourceProjects),
        pattern.occurrenceCount,
        pattern.successRate,
        pattern.lastObserved,
        JSON.stringify(pattern.relatedConcepts),
        pattern.confidence,
        Date.now(),
      );
    } catch (err) {
      console.error('[DeepMemory] Pattern persist error:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Persist knowledge links to database
   */
  private persistKnowledgeLinks(): void {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO knowledge_links (from_entity, to_entity, link_type, strength, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const link of this.knowledgeLinks) {
        stmt.run(link.fromEntity, link.toEntity, link.linkType, link.strength, Date.now());
      }
    } catch (err) {
      console.error('[DeepMemory] Links persist error:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Get discovered patterns
   */
  getPatterns(limit = 20): SynthesizedPattern[] {
    return this.discoveredPatterns.slice(-limit);
  }

  /**
   * Get knowledge links
   */
  getKnowledgeLinks(): KnowledgeLink[] {
    return this.knowledgeLinks;
  }

  /**
   * Query patterns by category
   */
  queryPatternsByCategory(category: string): SynthesizedPattern[] {
    return this.discoveredPatterns.filter(p => p.category === category);
  }

  /**
   * Find similar patterns by keywords
   */
  findSimilarPatterns(keywords: string[]): SynthesizedPattern[] {
    return this.discoveredPatterns.filter(p =>
      keywords.some(k =>
        p.name.toLowerCase().includes(k.toLowerCase()) ||
        p.description.toLowerCase().includes(k.toLowerCase()) ||
        p.relatedConcepts.some(c => c.toLowerCase().includes(k.toLowerCase()))
      )
    );
  }

  /**
   * Get synthesis stats
   */
  getStats(): {
    patternsDiscovered: number;
    linksCreated: number;
    byCategory: Record<string, number>;
  } {
    const byCategory: Record<string, number> = {};
    for (const pattern of this.discoveredPatterns) {
      byCategory[pattern.category] = (byCategory[pattern.category] || 0) + 1;
    }

    return {
      patternsDiscovered: this.discoveredPatterns.length,
      linksCreated: this.knowledgeLinks.length,
      byCategory,
    };
  }
}

// Singleton
let instance: DeepMemorySynthesisService | null = null;

export function getDeepMemorySynthesisService(): DeepMemorySynthesisService {
  if (!instance) {
    instance = new DeepMemorySynthesisService();
  }
  return instance;
}
