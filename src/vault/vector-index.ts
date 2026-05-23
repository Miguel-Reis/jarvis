/**
 * Vector Index Service — HNSW-powered semantic search
 *
 * Uses ruvector VectorDb for fast approximate nearest neighbor search.
 * Embeddings generated via existing EmbeddingService (OpenAI or Ollama).
 */

import { getDb } from './schema.ts';
import { VectorDb } from 'ruvector';
import { getEmbeddingService } from '../llm/embeddings.ts';

export interface VectorIndexStats {
  totalVectors: number;
  dimensions: number;
  indexSize: number;
}

export interface SearchMatch {
  entityId: string;
  name: string;
  type: string;
  content: string;
  score: number;
}

export class VectorIndexService {
  private db: InstanceType<typeof VectorDb> | null = null;
  private dimensions = 768; // Default to Ollama nomic-embed-text

  /**
   * Initialize or load the HNSW index
   */
  async initialize(): Promise<void> {
    const embeddingService = getEmbeddingService();
    if (!embeddingService || !embeddingService.isAvailable()) {
      console.warn('[VectorIndex] No embedding provider available — vector search disabled');
      return;
    }

    // Detect dimensions from provider
    const backend = embeddingService.getBackend();
    this.dimensions = backend === 'openai' ? 1536 : 768; // OpenAI vs Ollama

    // Test embedding to verify provider works
    const testEmbed = await this.embed('test');
    if (!testEmbed || testEmbed.length === 0) {
      console.warn('[VectorIndex] Embedding provider not working — vector search disabled');
      return;
    }

    // Update dimensions based on actual embedding size
    this.dimensions = testEmbed.length;

    try {
      // Use in-memory database to avoid file lock issues
      try {
        this.db = new VectorDb({ dimensions: this.dimensions });
      } catch (err) {
        console.error('[VectorIndex] Failed to create VectorDb:', err instanceof Error ? err.message : String(err));
        this.db = null;
        return;
      }
      console.log(`[VectorIndex] HNSW index initialized (${this.dimensions}d, ${backend})`);
    } catch (err) {
      console.error('[VectorIndex] Failed to initialize:', err instanceof Error ? err.message : String(err));
      this.db = null;
    }
  }

  /**
   * Generate embedding for text using the configured embedding service
   */
  private async embed(text: string): Promise<Float32Array | null> {
    const embeddingService = getEmbeddingService();
    if (!embeddingService) return null;
    return await embeddingService.embed(text);
  }

  /**
   * Add entity to vector index
   */
  async addEntity(entityId: string, content: string): Promise<void> {
    if (!this.db) return;

    try {
      const embedding = await this.embed(content);
      if (!embedding) return;

      (this.db as any).insert(entityId, embedding, { content });
    } catch (err) {
      console.error('[VectorIndex] Failed to add entity:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Remove entity from vector index
   */
  async removeEntity(entityId: string): Promise<void> {
    if (!this.db) return;

    try {
      this.db.delete(entityId);
    } catch (err) {
      console.error('[VectorIndex] Failed to remove entity:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Search for similar entities
   */
  async search(query: string, limit = 20): Promise<SearchMatch[]> {
    if (!this.db) {
      console.warn('[VectorIndex] Index not available, returning empty results');
      return [];
    }

    try {
      const queryEmbedding = await this.embed(query);
      if (!queryEmbedding) return [];

      const results = await (this.db as any).search(queryEmbedding, limit);

      if (!results || results.length === 0) {
        return [];
      }

      const db = getDb();
      const stmt = db.prepare(`
        SELECT id, type, name, properties
        FROM entities
        WHERE id = ?
      `);

      return results.map((result: { id: string; score: number; metadata?: Record<string, unknown> }) => {
        const row = stmt.get(result.id) as { id: string; type: string; name: string; properties: string } | undefined;
        if (!row) {
          return {
            entityId: result.id,
            name: result.id,
            type: 'unknown',
            content: (result.metadata?.content as string) || '',
            score: result.score,
          };
        }

        const props = JSON.parse(row.properties || '{}');
        const content = props.summary || row.name;

        return {
          entityId: row.id,
          name: row.name,
          type: row.type,
          content,
          score: result.score,
        };
      });
    } catch (err) {
      console.error('[VectorIndex] Search error:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Rebuild index from existing entities
   */
  async rebuildIndex(): Promise<{ indexed: number; errors: string[] }> {
    const result = { indexed: 0, errors: [] as string[] };

    if (!this.db) {
      result.errors.push('Index not initialized');
      return result;
    }

    try {
      const db = getDb();
      const stmt = db.prepare(`
        SELECT id, name, properties
        FROM entities
        WHERE source != 'graphify'
      `);

      const rows = stmt.all() as Array<{ id: string; name: string; properties: string }>;

      for (const row of rows) {
        try {
          const props = JSON.parse(row.properties || '{}');
          const content = [
            row.name,
            props.summary,
            props.file,
            props.tags?.join(' '),
          ]
            .filter(Boolean)
            .join(' ');

          if (content.trim()) {
            await this.addEntity(row.id, content);
            result.indexed++;
          }
        } catch (err) {
          result.errors.push(`Entity ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      console.log(`[VectorIndex] Rebuilt index with ${result.indexed} entities`);
    } catch (err) {
      result.errors.push(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return result;
  }

  /**
   * Get index statistics
   */
  async getStats(): Promise<VectorIndexStats> {
    if (!this.db) {
      return { totalVectors: 0, dimensions: 0, indexSize: 0 };
    }

    const len = await (this.db as any).len() as number;
    return {
      totalVectors: len,
      dimensions: this.dimensions,
      indexSize: len,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    if (!this.db) return;

    try {
      // VectorDb doesn't have a clear method, we'd need to track all IDs
      // For now, just recreate the db
      this.db = new VectorDb({ dimensions: this.dimensions });
      console.log('[VectorIndex] Index cleared');
    } catch (err) {
      console.error('[VectorIndex] Clear error:', err instanceof Error ? err.message : String(err));
    }
  }
}

// Singleton
let instance: VectorIndexService | null = null;

export function getVectorIndex(): VectorIndexService {
  if (!instance) {
    instance = new VectorIndexService();
  }
  return instance;
}
