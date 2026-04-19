/**
 * Known LLM Models — canonical model registry with metadata
 *
 * Used for: model picker UI, cost display, context window validation.
 * Model IDs here must match actual provider model strings.
 */

export type ModelTier = 'fast' | 'balanced' | 'power';

export type KnownModel = {
  /** Display name shown in the UI model picker */
  displayName: string;
  /** Approximate context window in tokens */
  contextWindow: number;
  /** Whether the model supports vision/image input */
  vision: boolean;
  /** Speed tier for UI sorting */
  tier: ModelTier;
};

export const KNOWN_MODELS: Record<string, KnownModel> = {
  // Anthropic
  'claude-sonnet-4-6': {
    displayName: 'Claude Sonnet 4',
    contextWindow: 200_000,
    vision: true,
    tier: 'balanced',
  },
  'claude-opus-4-0': {
    displayName: 'Claude Opus 4',
    contextWindow: 200_000,
    vision: true,
    tier: 'power',
  },
  'claude-3-5-sonnet-latest': {
    displayName: 'Claude 3.5 Sonnet',
    contextWindow: 200_000,
    vision: true,
    tier: 'balanced',
  },
  'claude-3-5-haiku-latest': {
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200_000,
    vision: true,
    tier: 'fast',
  },

  // OpenAI
  'gpt-4o': {
    displayName: 'GPT-4o',
    contextWindow: 128_000,
    vision: true,
    tier: 'power',
  },
  'gpt-4o-mini': {
    displayName: 'GPT-4o Mini',
    contextWindow: 128_000,
    vision: true,
    tier: 'fast',
  },
  'chatgpt-4o-latest': {
    displayName: 'ChatGPT-4o',
    contextWindow: 128_000,
    vision: true,
    tier: 'balanced',
  },

  // Google
  'gemini-2.5-pro-preview': {
    displayName: 'Gemini 2.5 Pro',
    contextWindow: 1_000_000,
    vision: true,
    tier: 'power',
  },
  'gemini-2.5-flash-preview': {
    displayName: 'Gemini 2.5 Flash',
    contextWindow: 1_000_000,
    vision: true,
    tier: 'fast',
  },
  'gemini-1.5-pro': {
    displayName: 'Gemini 1.5 Pro',
    contextWindow: 2_000_000,
    vision: true,
    tier: 'power',
  },
  'gemini-1.5-flash': {
    displayName: 'Gemini 1.5 Flash',
    contextWindow: 1_000_000,
    vision: true,
    tier: 'fast',
  },

  // Groq
  'llama-3.3-70b-versatile': {
    displayName: 'Llama 3.3 70B',
    contextWindow: 128_000,
    vision: false,
    tier: 'fast',
  },
  'llama-3.1-8b-instant': {
    displayName: 'Llama 3.1 8B',
    contextWindow: 128_000,
    vision: false,
    tier: 'fast',
  },

  // Ollama (local)
  'llama3': {
    displayName: 'Llama 3',
    contextWindow: 128_000,
    vision: false,
    tier: 'balanced',
  },
  'llama3.1': {
    displayName: 'Llama 3.1',
    contextWindow: 128_000,
    vision: false,
    tier: 'balanced',
  },
  'mistral': {
    displayName: 'Mistral',
    contextWindow: 128_000,
    vision: false,
    tier: 'balanced',
  },
  'mixtral': {
    displayName: 'Mixtral',
    contextWindow: 128_000,
    vision: false,
    tier: 'balanced',
  },
  'codellama': {
    displayName: 'Code Llama',
    contextWindow: 128_000,
    vision: false,
    tier: 'balanced',
  },

  // OpenRouter (use OpenRouter model IDs)
  'anthropic/claude-sonnet-4': {
    displayName: 'Claude Sonnet 4 (OR)',
    contextWindow: 200_000,
    vision: true,
    tier: 'balanced',
  },
  'openai/gpt-4o': {
    displayName: 'GPT-4o (OR)',
    contextWindow: 128_000,
    vision: true,
    tier: 'power',
  },
  'google/gemini-2.0-flash-exp': {
    displayName: 'Gemini 2.0 Flash (OR)',
    contextWindow: 1_000_000,
    vision: true,
    tier: 'fast',
  },

  // LiteLLM (generic — user configures the proxy, these are common defaults)
  'gpt-4o-mini': {
    displayName: 'GPT-4o Mini (LiteLLM)',
    contextWindow: 128_000,
    vision: true,
    tier: 'fast',
  },
  'claude-sonnet-4-6': {
    displayName: 'Claude Sonnet 4 (LiteLLM)',
    contextWindow: 200_000,
    vision: true,
    tier: 'balanced',
  },
};

/**
 * Get metadata for a model ID. Returns undefined for unknown models.
 */
export function getModelMeta(modelId: string): KnownModel | undefined {
  return KNOWN_MODELS[modelId];
}

/**
 * List all known model IDs for a provider prefix.
 * Useful to populate a model picker dropdown.
 */
export function listKnownModels(): Array<{ id: string; meta: KnownModel }> {
  return Object.entries(KNOWN_MODELS).map(([id, meta]) => ({ id, meta }));
}
