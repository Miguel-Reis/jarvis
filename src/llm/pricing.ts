/**
 * LLM Pricing — cost estimates per model.
 *
 * Prices in USD per 1M tokens (input / output).
 * Updated: 2026-04. These are approximate — check provider pages for exact values.
 */

type ModelPricing = {
  inputPer1M: number;  // USD
  outputPer1M: number; // USD
};

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-6':             { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-sonnet-4-6':           { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-sonnet-4-5-20250929':  { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-haiku-4-5-20251001':   { inputPer1M: 0.80,  outputPer1M: 4.00  },
  'claude-3-5-sonnet-20241022':  { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-3-opus-20240229':      { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-3-haiku-20240307':     { inputPer1M: 0.25,  outputPer1M: 1.25  },
  // OpenAI
  'gpt-4o':                      { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'gpt-4o-mini':                 { inputPer1M: 0.15,  outputPer1M: 0.60  },
  'gpt-4-turbo':                 { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-3.5-turbo':               { inputPer1M: 0.50,  outputPer1M: 1.50  },
  'o1':                          { inputPer1M: 15.00, outputPer1M: 60.00 },
  'o1-mini':                     { inputPer1M: 3.00,  outputPer1M: 12.00 },
  'o3-mini':                     { inputPer1M: 1.10,  outputPer1M: 4.40  },
  // Groq (hosted Llama/Mistral — approximate)
  'llama-3.3-70b-versatile':     { inputPer1M: 0.59,  outputPer1M: 0.79  },
  'llama-3.1-8b-instant':        { inputPer1M: 0.05,  outputPer1M: 0.08  },
  'mixtral-8x7b-32768':          { inputPer1M: 0.24,  outputPer1M: 0.24  },
  // Google Gemini
  'gemini-3-flash-preview':      { inputPer1M: 0.15,  outputPer1M: 0.60  },
  'gemini-2.0-flash':            { inputPer1M: 0.10,  outputPer1M: 0.40  },
  'gemini-1.5-pro':              { inputPer1M: 1.25,  outputPer1M: 5.00  },
  'gemini-1.5-flash':            { inputPer1M: 0.075, outputPer1M: 0.30  },
};

/**
 * Estimate cost for a single LLM call.
 * Returns null if the model is unknown (e.g. Ollama local).
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  // Normalise: strip date suffixes to find base model
  const normalised = model.toLowerCase().replace(/-\d{8}$/, '');
  const pricing = PRICING[model] ?? PRICING[normalised];

  if (!pricing) return null;

  return (inputTokens / 1_000_000) * pricing.inputPer1M
       + (outputTokens / 1_000_000) * pricing.outputPer1M;
}

/**
 * Format token count for compact display: "1.2k", "3.4M", etc.
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Format cost for display: "$0.001", "$1.23", etc.
 * Returns empty string for null (unknown model).
 */
export function formatCost(cost: number | null): string {
  if (cost === null) return '';
  if (cost < 0.001) return '<$0.001';
  if (cost < 0.01)  return `$${cost.toFixed(4)}`;
  if (cost < 1)     return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
