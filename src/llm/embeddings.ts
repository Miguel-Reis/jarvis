/**
 * Embedding Service
 *
 * Generates vector embeddings for semantic search.
 * Supports OpenAI (text-embedding-3-small) and Ollama (nomic-embed-text).
 * Falls back gracefully when no embedding-capable provider is configured.
 */

import type { JarvisConfig } from '../config/types.ts';

type EmbeddingBackend = 'openai' | 'ollama' | 'none';

export class EmbeddingService {
  private backend: EmbeddingBackend;
  private apiKey: string | null;
  private baseUrl: string;
  private model: string;
  private warnedOnce = false;

  constructor(backend: EmbeddingBackend, opts: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  } = {}) {
    this.backend = backend;
    this.apiKey = opts.apiKey ?? null;
    this.baseUrl = opts.baseUrl ?? 'http://localhost:11434';
    this.model = opts.model ?? (backend === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text');
  }

  /**
   * Generate an embedding for the given text.
   * Returns null if the service is not available or the call fails.
   */
  async embed(text: string): Promise<Float32Array | null> {
    if (this.backend === 'none') {
      if (!this.warnedOnce) {
        console.warn('[EmbeddingService] No embedding provider configured — semantic search disabled. Configure OpenAI or Ollama to enable it.');
        this.warnedOnce = true;
      }
      return null;
    }

    // Truncate very long text to avoid token limits (8192 tokens ≈ ~32K chars)
    const input = text.slice(0, 32_000);

    try {
      if (this.backend === 'openai') {
        return await this._embedOpenAI(input);
      } else {
        return await this._embedOllama(input);
      }
    } catch (err) {
      console.warn('[EmbeddingService] Embedding call failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private async _embedOpenAI(text: string): Promise<Float32Array | null> {
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: text }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      throw new Error(`OpenAI embeddings API returned ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json() as {
      data: Array<{ embedding: number[] }>;
    };

    const values = data.data[0]?.embedding;
    if (!values) throw new Error('OpenAI embeddings response missing data[0].embedding');
    return new Float32Array(values);
  }

  private async _embedOllama(text: string): Promise<Float32Array | null> {
    const resp = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      throw new Error(`Ollama embeddings API returned ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json() as { embedding: number[] };
    if (!data.embedding) throw new Error('Ollama embeddings response missing embedding field');
    return new Float32Array(data.embedding);
  }

  isAvailable(): boolean {
    return this.backend !== 'none';
  }

  getModel(): string {
    return this.model;
  }

  getBackend(): EmbeddingBackend {
    return this.backend;
  }
}

// --- Singleton ---

let _instance: EmbeddingService | null = null;

/**
 * Initialize the embedding service from JARVIS config.
 * Priority: OpenAI (if api_key set) → Ollama (if configured) → none.
 */
export function initEmbeddingService(config: JarvisConfig): void {
  const { llm } = config;

  if (llm.openai?.api_key && llm.openai.api_key.length > 10) {
    _instance = new EmbeddingService('openai', {
      apiKey: llm.openai.api_key,
      model: 'text-embedding-3-small', // always use the embedding model, not the chat model
    });
    console.log(`[EmbeddingService] Initialized with OpenAI model text-embedding-3-small`);
    return;
  }

  if (llm.ollama) {
    _instance = new EmbeddingService('ollama', {
      baseUrl: llm.ollama.base_url ?? 'http://localhost:11434',
      model: 'nomic-embed-text',
    });
    console.log(`[EmbeddingService] Initialized with Ollama model nomic-embed-text`);
    return;
  }

  _instance = new EmbeddingService('none');
  console.warn('[EmbeddingService] No embedding-capable provider found. Semantic search will be disabled.');
}

/**
 * Get the global embedding service instance.
 * Returns null if initEmbeddingService() has not been called yet.
 */
export function getEmbeddingService(): EmbeddingService | null {
  return _instance;
}
