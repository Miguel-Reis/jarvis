import type {
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  LLMStreamEvent,
  LLMTool,
  LLMToolCall,
} from './provider.ts';
import { compactHistory, calculateHistoryBudget } from './history.ts';

type LiteLLMMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: LiteLLMToolCall[];
  tool_call_id?: string;
};

type LiteLLMToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type LiteLLMToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type LiteLLMResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: LiteLLMToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type LiteLLMStreamChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
};

/**
 * LiteLLM Provider — OpenAI-compatible proxy server.
 *
 * Works with any LiteLLM server (https://docs.litellm.ai/).
 * Supports 100+ models via a single local or remote proxy endpoint.
 */
export class LiteLLMProvider implements LLMProvider {
  name = 'litellm';
  private baseUrl: string;
  private defaultModel: string;
  private apiKey: string | undefined;
  private rateLimitConfig: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };

  constructor(
    baseUrl = 'http://localhost:4000',
    defaultModel = 'gpt-4o',
    apiKey?: string,
    rateLimitConfig = { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 16000 },
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultModel = defaultModel;
    this.apiKey = apiKey || undefined;
    this.rateLimitConfig = rateLimitConfig;
  }

  private get authHeaders(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const { model = this.defaultModel, temperature, max_tokens, tools, tool_choice } = options;

    const budget = calculateHistoryBudget(128000);
    const compactedMessages = compactHistory(messages, budget);

    const body: Record<string, unknown> = {
      model,
      messages: this.convertMessages(compactedMessages),
    };

    if (temperature !== undefined) body.temperature = temperature;
    if (max_tokens !== undefined) body.max_tokens = max_tokens;
    if (tools && tools.length > 0) {
      body.tools = this.convertTools(tools);
      body.tool_choice = tool_choice || 'auto';
    }

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.rateLimitConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(
          this.rateLimitConfig.initialDelayMs * 2 ** (attempt - 1),
          this.rateLimitConfig.maxDelayMs,
        );
        console.warn(`[litellm] rate limit hit, retrying in ${delay}ms (attempt ${attempt}/${this.rateLimitConfig.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders,
        },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const data = await response.json() as LiteLLMResponse;
        return this.convertResponse(data);
      }

      if (response.status === 429) {
        lastErr = new Error(`LiteLLM rate limited (429)`);
        continue;
      }

      const errorText = await response.text();
      throw new Error(`LiteLLM API error (${response.status}): ${errorText}`);
    }

    throw lastErr ?? new Error('LiteLLM rate limit: max retries exceeded');
  }

  async *stream(messages: LLMMessage[], options: LLMOptions = {}): AsyncIterable<LLMStreamEvent> {
    const { model = this.defaultModel, temperature, max_tokens, tools, tool_choice } = options;

    const budget = calculateHistoryBudget(128000);
    const compactedMessages = compactHistory(messages, budget);

    const body: Record<string, unknown> = {
      model,
      messages: this.convertMessages(compactedMessages),
      stream: true,
    };

    if (temperature !== undefined) body.temperature = temperature;
    if (max_tokens !== undefined) body.max_tokens = max_tokens;
    if (tools && tools.length > 0) {
      body.tools = this.convertTools(tools);
      body.tool_choice = tool_choice || 'auto';
    }

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.rateLimitConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(
          this.rateLimitConfig.initialDelayMs * 2 ** (attempt - 1),
          this.rateLimitConfig.maxDelayMs,
        );
        console.warn(`[litellm] stream rate limit hit, retrying in ${delay}ms (attempt ${attempt}/${this.rateLimitConfig.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        if (response.status === 429) {
          lastErr = new Error(`LiteLLM rate limited (429)`);
          continue;
        }
        const errorText = await response.text();
        yield { type: 'error', error: `LiteLLM API error (${response.status}): ${errorText}` };
        return;
      }

    if (!response.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    let accumulatedText = '';
    const toolCalls: LLMToolCall[] = [];
    const toolCallBuilders: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let finishReason: string | null = null;
    let responseModel = model;

    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data) as LiteLLMStreamChunk;
            if (chunk.choices && chunk.choices.length > 0) {
              const choice = chunk.choices[0]!;
              responseModel = chunk.model;

              if (choice.delta.content) {
                accumulatedText += choice.delta.content;
                yield { type: 'text', text: choice.delta.content };
              }

              if (choice.delta.tool_calls) {
                for (const toolCallDelta of choice.delta.tool_calls) {
                  const index = toolCallDelta.index;
                  let builder = toolCallBuilders.get(index);

                  if (!builder) {
                    builder = { id: toolCallDelta.id || '', name: toolCallDelta.function?.name || '', arguments: '' };
                    toolCallBuilders.set(index, builder);
                  }

                  if (toolCallDelta.id) builder.id = toolCallDelta.id;
                  if (toolCallDelta.function?.name) builder.name = toolCallDelta.function.name;
                  if (toolCallDelta.function?.arguments) builder.arguments += toolCallDelta.function.arguments;
                }
              }

              if (choice.finish_reason) finishReason = choice.finish_reason;
            }
          } catch (err) {
            console.error('Failed to parse LiteLLM SSE chunk:', err);
          }
        }
      }

      for (const builder of toolCallBuilders.values()) {
        try {
          const toolCall: LLMToolCall = {
            id: builder.id,
            name: builder.name,
            arguments: JSON.parse(builder.arguments),
          };
          toolCalls.push(toolCall);
          yield { type: 'tool_call', tool_call: toolCall };
        } catch (err) {
          yield { type: 'error', error: `Failed to parse tool call arguments: ${err}` };
        }
      }

      yield {
        type: 'done',
        response: {
          content: accumulatedText,
          tool_calls: toolCalls,
          usage: { input_tokens: 0, output_tokens: 0 },
          model: responseModel,
          finish_reason: this.mapFinishReason(finishReason),
        },
      };
    } catch (err) {
      yield { type: 'error', error: `Stream error: ${err}` };
    }
  }

  async supportsVision(): Promise<boolean> {
    // LiteLLM is a proxy — it passes images through to the underlying model.
    // We can't know at this level, so assume true and let the underlying model reject if needed.
    return true;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.authHeaders,
      });

      if (!response.ok) throw new Error(`Failed to list models: ${response.status}`);

      const data = await response.json() as { data: Array<{ id: string }> };
      return data.data.map((m) => m.id).sort();
    } catch {
      return ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-6', 'gemini/gemini-2.5-pro', 'ollama/llama3'];
    }
  }

  private convertMessages(messages: LLMMessage[]): LiteLLMMessage[] {
    return messages.map((m) => {
      const text =
        typeof m.content === 'string'
          ? m.content
          : m.content.map((b) => (b.type === 'text' ? b.text : '[image]')).join('\n');

      const msg: LiteLLMMessage = {
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.tool_calls && m.tool_calls.length > 0 ? '' : text,
      };

      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }

      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      return msg;
    });
  }

  private convertTools(tools: LLMTool[]): LiteLLMToolDef[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private convertResponse(response: LiteLLMResponse): LLMResponse {
    const choice = response.choices[0]!;
    const message = choice.message;
    const content = message.content || '';
    const tool_calls: LLMToolCall[] = [];

    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        try {
          tool_calls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments),
          });
        } catch (err) {
          console.error('Failed to parse tool call arguments:', err);
        }
      }
    }

    return {
      content,
      tool_calls,
      usage: {
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
      },
      model: response.model,
      finish_reason: this.mapFinishReason(choice.finish_reason),
    };
  }

  private mapFinishReason(finishReason: string | null): 'stop' | 'tool_use' | 'length' | 'error' {
    switch (finishReason) {
      case 'stop': return 'stop';
      case 'tool_calls': return 'tool_use';
      case 'length': return 'length';
      case 'content_filter': return 'error';
      default: return 'stop';
    }
  }
}
