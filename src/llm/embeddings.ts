/**
 * Embedding Service
 *
 * Generates vector embeddings for semantic search.
 * Supports OpenAI (text-embedding-3-small) and Ollama (nomic-embed-text).
 * Falls back gracefully when no embedding-capable provider is configured.
 */

import type { JarvisConfig } from '../config/types.ts';

type EmbeddingBackend = 'openai' | 'ollama' | 'gemini' | 'none';

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
    if (backend === 'openai') {
      this.model = opts.model ?? 'text-embedding-3-small';
    } else if (backend === 'gemini') {
      this.model = opts.model ?? 'models/text-embedding-004';
    } else {
      this.model = opts.model ?? 'nomic-embed-text';
    }
  }

  /**
   * Generate an embedding for the given text.
   * Returns null if the service is not available or the call fails.
   */
  async embed(text: string): Promise<Float32Array | null> {
    if (this.backend === 'none') {
      if (!this.warnedOnce) {
        console.warn('[EmbeddingService] No embedding provider configured — semantic search disabled.');
        this.warnedOnce = true;
      }
      return null;
    }

    // Truncate very long text to avoid token limits (8192 tokens ≈ ~32K chars)
    const input = text.slice(0, 32_000);

    try {
      if (this.backend === 'openai') {
        return await this._embedOpenAI(input);
      } else if (this.backend === 'gemini') {
        return await this._embedGemini(input);
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
    const resp = await fetch(`${this.baseUrl}/api/embed`, {
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

  private async _embedGemini(text: string): Promise<Float32Array | null> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const modelName = this.model.replace(/^models\//, '');
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${modelName}`,
          content: { parts: [{ text }] },
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!resp.ok) {
      throw new Error(`Gemini embeddings API returned ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json() as { embedding: { values: number[] } };
    if (!data.embedding?.values) throw new Error('Gemini embeddings response missing embedding.values');
    return new Float32Array(data.embedding.values);
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
 * Uses llm.embedding config if specified, otherwise auto-detects from available providers.
 */
export function initEmbeddingService(config: JarvisConfig): void {
  const { llm } = config;
  const embeddingConfig = llm.embedding;

  // Check for explicit embedding provider config
  if (embeddingConfig?.provider) {
    const provider = embeddingConfig.provider;
    const model = embeddingConfig.model;

    if (provider === 'gemini' && llm.gemini?.api_key) {
      _instance = new EmbeddingService('gemini', {
        apiKey: llm.gemini.api_key,
        model: model ?? 'models/gemini-embedding-2',
      });
      console.log(`[EmbeddingService] Initialized with Gemini model ${model ?? 'models/gemini-embedding-2'}`);
      return;
    }

    if (provider === 'openai' && llm.openai?.api_key) {
      _instance = new EmbeddingService('openai', {
        apiKey: llm.openai.api_key,
        model: model ?? 'text-embedding-3-small',
      });
      console.log(`[EmbeddingService] Initialized with OpenAI model ${model ?? 'text-embedding-3-small'}`);
      return;
    }

    if (provider === 'ollama' && llm.ollama?.base_url) {
      _instance = new EmbeddingService('ollama', {
        baseUrl: llm.ollama.base_url,
        model: model ?? 'nomic-embed-text',
      });
      console.log(`[EmbeddingService] Initialized with Ollama model ${model ?? 'nomic-embed-text'}`);
      return;
    }
  }

  // Auto-detect: Try Gemini first
  if (llm.gemini?.api_key && llm.gemini.api_key.length > 10) {
    _instance = new EmbeddingService('gemini', {
      apiKey: llm.gemini.api_key,
      model: 'models/gemini-embedding-2',
    });
    console.log(`[EmbeddingService] Initialized with Gemini model models/gemini-embedding-2 (auto-detected)`);
    return;
  }

  // Fallback to OpenAI
  if (llm.openai?.api_key && llm.openai.api_key.length > 10) {
    _instance = new EmbeddingService('openai', {
      apiKey: llm.openai.api_key,
      model: 'text-embedding-3-small',
    });
    console.log(`[EmbeddingService] Initialized with OpenAI model text-embedding-3-small (auto-detected)`);
    return;
  }

  // Fallback to Ollama
  if (llm.ollama?.base_url && llm.ollama.base_url.trim().length > 0) {
    _instance = new EmbeddingService('ollama', {
      baseUrl: llm.ollama.base_url,
      model: 'nomic-embed-text',
    });
    console.log(`[EmbeddingService] Initialized with Ollama model nomic-embed-text (auto-detected)`);
    return;
  }

  _instance = new EmbeddingService('none');
  console.warn('[EmbeddingService] No embedding provider configured. Semantic search will be disabled.');
}

/**
 * Get the global embedding service instance.
 * Returns null if initEmbeddingService() has not been called yet.
 */
export function getEmbeddingService(): EmbeddingService | null {
  return _instance;
}
