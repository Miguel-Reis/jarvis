/**
 * Graphify Integration Service
 *
 * Imports knowledge graphs from Graphify into the Jarvis Vault.
 * Enables semantic code search and connection discovery.
 *
 * Features:
 * - Parse graph.json from Graphify output
 * - Import nodes as entities
 * - Import edges as facts (relationships)
 * - Semantic search across codebase
 * - Connection discovery
 */

import { getDb, generateId, withTransaction } from '../vault/schema.ts';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface GraphifyNode {
  id: string;
  name: string;
  type: string;
  file?: string;
  line?: number;
  properties?: Record<string, unknown>;
  summary?: string;
  tags?: string[];
}

export interface GraphifyEdge {
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface GraphifyGraph {
  nodes: GraphifyNode[];
  edges: GraphifyEdge[];
  metadata?: {
    sourceDir: string;
    generatedAt: string;
    version: string;
  };
}

export interface ImportResult {
  nodesImported: number;
  edgesImported: number;
  errors: string[];
}

export interface SearchMatch {
  entityId: string;
  name: string;
  type: string;
  file?: string;
  summary?: string;
  relevance: number;
}

export class GraphifyService {
  /**
   * Import graph from Graphify output
   */
  async importGraph(graphPath: string, projectId?: string): Promise<ImportResult> {
    const result: ImportResult = {
      nodesImported: 0,
      edgesImported: 0,
      errors: [],
    };

    try {
      // Read graph.json
      const graphData = await this.readGraphFile(graphPath);
      if (!graphData) {
        result.errors.push('Failed to read graph.json');
        return result;
      }

      const db = getDb();

      withTransaction(() => {
        // Import nodes as entities
        const nodeStmt = db.prepare(`
          INSERT OR REPLACE INTO entities (id, type, name, properties, source, project_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const now = Date.now();
        for (const node of graphData.nodes) {
          try {
            const entityType = this.mapNodeType(node.type);
            const properties = JSON.stringify({
              ...node.properties,
              file: node.file,
              line: node.line,
              summary: node.summary,
              tags: node.tags,
            });

            nodeStmt.run(
              this.generateEntityId(node.id),
              entityType,
              node.name,
              properties,
              'graphify',
              projectId || null,
              now,
              now
            );
            result.nodesImported++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push(`Node "${node.name}": ${message}`);
          }
        }

        // Import edges as facts
        const edgeStmt = db.prepare(`
          INSERT OR REPLACE INTO facts (id, subject_id, predicate, object, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const edge of graphData.edges) {
          try {
            const subjectId = this.generateEntityId(edge.source);
            const objectId = this.generateEntityId(edge.target);

            edgeStmt.run(
              generateId(),
              subjectId,
              edge.type,
              objectId,
              'graphify',
              now
            );
            result.edgesImported++;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push(`Edge "${edge.source}"->"${edge.target}": ${message}`);
          }
        }
      });

      console.log(`[Graphify] Imported ${result.nodesImported} nodes, ${result.edgesImported} edges`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Import failed: ${message}`);
    }

    return result;
  }

  /**
   * Read graph.json file
   */
  private async readGraphFile(graphPath: string): Promise<GraphifyGraph | null> {
    try {
      let fullPath = graphPath;

      // If directory, look for graph.json inside
      if (!graphPath.endsWith('.json')) {
        fullPath = path.join(graphPath, 'graph.json');
      }

      if (!existsSync(fullPath)) {
        console.error(`[Graphify] File not found: ${fullPath}`);
        return null;
      }

      const content = await readFile(fullPath, 'utf-8');
      return JSON.parse(content) as GraphifyGraph;
    } catch (err) {
      console.error('[Graphify] Failed to read graph file:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /**
   * Map Graphify node types to entity types
   */
  private mapNodeType(type: string): string {
    const typeMap: Record<string, string> = {
      function: 'concept',
      class: 'concept',
      interface: 'concept',
      module: 'tool',
      package: 'tool',
      file: 'place',
      directory: 'place',
      project: 'project',
      person: 'person',
      event: 'event',
    };

    return typeMap[type.toLowerCase()] || 'concept';
  }

  /**
   * Generate unique entity ID from Graphify node ID
   */
  private generateEntityId(nodeId: string): string {
    return `graphify_${nodeId}`;
  }

  /**
   * Search entities by keyword
   */
  search(query: string, limit = 20): SearchMatch[] {
    const db = getDb();
    const lowerQuery = query.toLowerCase();

    try {
      const stmt = db.prepare(`
        SELECT id, type, name, properties, source
        FROM entities
        WHERE (source = 'graphify' OR source IS NULL)
          AND (
            name LIKE ? OR
            properties LIKE ?
          )
        ORDER BY
          CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT ?
      `);

      const searchPattern = `%${lowerQuery}%`;
      const rows = stmt.all(searchPattern, searchPattern, `${lowerQuery}%`, limit) as Array<{
        id: string;
        type: string;
        name: string;
        properties: string;
        source: string;
      }>;

      return rows.map(row => {
        const props = JSON.parse(row.properties || '{}');
        return {
          entityId: row.id,
          name: row.name,
          type: row.type,
          file: props.file,
          summary: props.summary,
          relevance: row.name.toLowerCase().startsWith(lowerQuery) ? 1.0 : 0.5,
        };
      });
    } catch (err) {
      console.error('[Graphify] Search error:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Get connections for an entity
   */
  getConnections(entityId: string): Array<{
    relatedId: string;
    relatedName: string;
    relationship: string;
    direction: 'incoming' | 'outgoing';
  }> {
    const db = getDb();
    const connections: Array<{
      relatedId: string;
      relatedName: string;
      relationship: string;
      direction: 'incoming' | 'outgoing';
    }> = [];

    try {
      // Outgoing connections
      const outgoingStmt = db.prepare(`
        SELECT f.object, f.predicate, e.name
        FROM facts f
        JOIN entities e ON f.object = e.id
        WHERE f.subject_id = ?
      `);

      const outgoing = outgoingStmt.all(this.generateEntityId(entityId)) as Array<{
        object: string;
        predicate: string;
        name: string;
      }>;

      for (const row of outgoing) {
        connections.push({
          relatedId: row.object,
          relatedName: row.name,
          relationship: row.predicate,
          direction: 'outgoing',
        });
      }

      // Incoming connections
      const incomingStmt = db.prepare(`
        SELECT f.subject_id, f.predicate, e.name
        FROM facts f
        JOIN entities e ON f.subject_id = e.id
        WHERE f.object = ?
      `);

      const incoming = incomingStmt.all(this.generateEntityId(entityId)) as Array<{
        subject_id: string;
        predicate: string;
        name: string;
      }>;

      for (const row of incoming) {
        connections.push({
          relatedId: row.subject_id,
          relatedName: row.name,
          relationship: row.predicate,
          direction: 'incoming',
        });
      }
    } catch (err) {
      console.error('[Graphify] Get connections error:', err instanceof Error ? err.message : String(err));
    }

    return connections;
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    totalNodes: number;
    totalEdges: number;
    byType: Record<string, number>;
  } {
    const db = getDb();
    const byType: Record<string, number> = {};

    try {
      // Count nodes
      const nodeStmt = db.prepare(`
        SELECT type, COUNT(*) as count
        FROM entities
        WHERE source = 'graphify'
        GROUP BY type
      `);

      const nodeRows = nodeStmt.all() as Array<{ type: string; count: number }>;
      let totalNodes = 0;
      for (const row of nodeRows) {
        byType[row.type] = row.count;
        totalNodes += row.count;
      }

      // Count edges
      const edgeStmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM facts
        WHERE source = 'graphify'
      `);

      const edgeRow = edgeStmt.get() as { count: number };

      return {
        totalNodes,
        totalEdges: edgeRow.count,
        byType,
      };
    } catch (err) {
      console.error('[Graphify] Stats error:', err instanceof Error ? err.message : String(err));
      return { totalNodes: 0, totalEdges: 0, byType: {} };
    }
  }

  /**
   * Check if graph exists
   */
  hasGraph(): boolean {
    const db = getDb();
    try {
      const stmt = db.prepare(`SELECT COUNT(*) as count FROM entities WHERE source = 'graphify'`);
      const row = stmt.get() as { count: number };
      return row.count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Clear imported graph data
   */
  clearGraph(): void {
    const db = getDb();
    try {
      withTransaction(() => {
        // Delete facts first (foreign key constraint)
        db.run(`DELETE FROM facts WHERE source = 'graphify'`);
        // Delete entities
        db.run(`DELETE FROM entities WHERE source = 'graphify'`);
      });
      console.log('[Graphify] Graph cleared');
    } catch (err) {
      console.error('[Graphify] Clear error:', err instanceof Error ? err.message : String(err));
    }
  }
}

// Singleton
let instance: GraphifyService | null = null;

export function getGraphifyService(): GraphifyService {
  if (!instance) {
    instance = new GraphifyService();
  }
  return instance;
}
