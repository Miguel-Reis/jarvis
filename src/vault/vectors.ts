import { getDb, generateId } from './schema.ts';
import { getEmbeddingService } from '../llm/embeddings.ts';

export type VectorRecord = {
  id: string;
  ref_type: string;
  ref_id: string;
  embedding: Float32Array;
  model: string;
  created_at: number;
};

type VectorRow = {
  id: string;
  ref_type: string;
  ref_id: string;
  embedding: ArrayBuffer;
  model: string;
  created_at: number;
};

/**
 * Cosine similarity between two equal-length Float32Arrays.
 * Returns a value in [-1, 1] where 1 is identical direction.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Store a vector embedding for a reference entity or fact.
 * If a vector for this ref already exists (same model), it is replaced.
 */
export function storeVector(
  ref_type: string,
  ref_id: string,
  embedding: Float32Array,
  model: string
): VectorRecord {
  const db = getDb();
  const id = generateId();
  const now = Date.now();

  const buffer = Buffer.from(embedding.buffer);

  // Upsert: delete existing vector for this ref+model, then insert fresh
  db.prepare('DELETE FROM vectors WHERE ref_type = ? AND ref_id = ? AND model = ?')
    .run(ref_type, ref_id, model);

  db.prepare(
    'INSERT INTO vectors (id, ref_type, ref_id, embedding, model, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, ref_type, ref_id, buffer, model, now);

  return { id, ref_type, ref_id, embedding, model, created_at: now };
}

/**
 * Find the most similar stored vectors to the given query embedding.
 * Uses pure JS cosine similarity — no native extensions required.
 *
 * Results are filtered to vectors stored with the same model (same dimensions)
 * and ranked by similarity descending.
 */
export function findSimilar(
  queryEmbedding: Float32Array,
  limit: number = 10,
  threshold: number = 0.70
): Array<{ ref_type: string; ref_id: string; similarity: number }> {
  const svc = getEmbeddingService();
  if (!svc || !svc.isAvailable()) return [];

  const model = svc.getModel();

  let rows: VectorRow[];
  try {
    rows = getDb()
      .prepare('SELECT ref_type, ref_id, embedding FROM vectors WHERE model = ?')
      .all(model) as VectorRow[];
  } catch {
    return [];
  }

  if (rows.length === 0) return [];

  const scored = rows
    .map(row => {
      const vec = new Float32Array(row.embedding);
      // Guard: skip rows with mismatched dimensions (leftover from a different model)
      if (vec.length !== queryEmbedding.length) return null;
      return {
        ref_type: row.ref_type,
        ref_id: row.ref_id,
        similarity: cosineSimilarity(queryEmbedding, vec),
      };
    })
    .filter((r): r is { ref_type: string; ref_id: string; similarity: number } =>
      r !== null && r.similarity >= threshold
    );

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

/**
 * Generate an embedding for the given text and store it in the vectors table.
 * Safe to call fire-and-forget — never throws.
 */
export async function embedAndStore(
  ref_type: string,
  ref_id: string,
  text: string
): Promise<void> {
  const svc = getEmbeddingService();
  if (!svc || !svc.isAvailable()) return;

  const trimmed = text.trim();
  if (!trimmed) return;

  try {
    const embedding = await svc.embed(trimmed);
    if (embedding) {
      storeVector(ref_type, ref_id, embedding, svc.getModel());
    }
  } catch (err) {
    console.warn(`[vectors] embedAndStore failed for ${ref_type}:${ref_id}:`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Delete all vectors for a given reference.
 */
export function deleteVectors(ref_type: string, ref_id: string): void {
  getDb().prepare('DELETE FROM vectors WHERE ref_type = ? AND ref_id = ?').run(ref_type, ref_id);
}
