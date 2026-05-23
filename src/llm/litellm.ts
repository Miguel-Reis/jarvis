import { OpenAICompatibleProvider } from './openai-compatible.ts';

/**
 * LiteLLM provider — proxies to 100+ LLM backends (OpenAI, Anthropic, Gemini,
 * Bedrock, Azure, Cohere, …) through a single OpenAI-compatible API.
 *
 * Run locally:  pip install litellm && litellm --model ollama/llama3
 * Default URL:  http://localhost:4000
 *
 * Configure via:
 *   llm:
 *     litellm:
 *       base_url: http://localhost:4000
 *       model: gpt-4o          # as LiteLLM knows it
 *       api_key: sk-...        # optional master key
 */
export class LiteLLMProvider extends OpenAICompatibleProvider {
  override name = 'litellm';

  constructor(
    baseUrl = 'http://localhost:4000',
    defaultModel = 'gpt-4o',
    apiKey = '',
  ) {
    super(baseUrl, defaultModel, apiKey, true);
  }
}
