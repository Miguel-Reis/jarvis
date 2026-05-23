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

type OAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
};

type OAIToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type OAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OAIResponse = {
  model: string;
  choices: Array<{
    message: { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number };
};

type OAIStreamChunk = {
  model: string;
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
};

/**
 * Generic OpenAI-compatible provider for local inference servers:
 * llama.cpp, vLLM, LM Studio, Jan, Koboldcpp, etc.
 *
 * Configure via:
 *   llm:
 *     openai_compatible:
 *       base_url: http://localhost:8080  # your server
 *       model: mistral                   # model name the server expects
 *       api_key: sk-...                  # optional, omit for local servers
 */
export class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai_compatible';
  private baseUrl: string;
  private defaultModel: string;
  private apiKey: string;
  private supportsToolChoice: boolean;

  constructor(
    baseUrl: string,
    defaultModel = 'local-model',
    apiKey = '',
    supportsToolChoice = true,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultModel = defaultModel;
    this.apiKey = apiKey;
    this.supportsToolChoice = supportsToolChoice;
  }

  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const { model = this.defaultModel, temperature, max_tokens, tools } = options;
    const budget = calculateHistoryBudget(32000);
    const body: Record<string, unknown> = {
      model,
      messages: this.convertMessages(compactHistory(messages, budget)),
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (max_tokens !== undefined) body.max_tokens = max_tokens;
    if (tools && tools.length > 0) {
      body.tools = this.convertTools(tools);
      if (this.supportsToolChoice) body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible API error (${response.status}): ${await response.text()}`);
    }

    return this.convertResponse(await response.json() as OAIResponse);
  }

  async *stream(messages: LLMMessage[], options: LLMOptions = {}): AsyncIterable<LLMStreamEvent> {
    const { model = this.defaultModel, temperature, max_tokens, tools } = options;
    const budget = calculateHistoryBudget(32000);
    const body: Record<string, unknown> = {
      model,
      messages: this.convertMessages(compactHistory(messages, budget)),
      stream: true,
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (max_tokens !== undefined) body.max_tokens = max_tokens;
    if (tools && tools.length > 0) {
      body.tools = this.convertTools(tools);
      if (this.supportsToolChoice) body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      yield { type: 'error', error: `OpenAI-compatible API error (${response.status}): ${await response.text()}` };
      return;
    }
    if (!response.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    let accumulatedText = '';
    const toolCalls: LLMToolCall[] = [];
    const builders: Map<number, { id: string; name: string; arguments: string }> = new Map();
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
            const chunk = JSON.parse(data) as OAIStreamChunk;
            const choice = chunk.choices[0];
            if (!choice) continue;
            responseModel = chunk.model;
            if (choice.delta.content) {
              accumulatedText += choice.delta.content;
              yield { type: 'text', text: choice.delta.content };
            }
            if (choice.delta.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                let b = builders.get(tc.index);
                if (!b) { b = { id: tc.id || '', name: tc.function?.name || '', arguments: '' }; builders.set(tc.index, b); }
                if (tc.id) b.id = tc.id;
                if (tc.function?.name) b.name = tc.function.name;
                if (tc.function?.arguments) b.arguments += tc.function.arguments;
              }
            }
            if (choice.finish_reason) finishReason = choice.finish_reason;
          } catch { /* skip malformed chunks */ }
        }
      }

      for (const b of builders.values()) {
        try {
          const tc: LLMToolCall = { id: b.id, name: b.name, arguments: JSON.parse(b.arguments) };
          toolCalls.push(tc);
          yield { type: 'tool_call', tool_call: tc };
        } catch (err) {
          yield { type: 'error', error: `Failed to parse tool arguments: ${err}` };
        }
      }

      yield {
        type: 'done',
        response: {
          content: accumulatedText,
          tool_calls: toolCalls,
          usage: { input_tokens: 0, output_tokens: 0 },
          model: responseModel,
          finish_reason: finishReason === 'tool_calls' ? 'tool_use' : finishReason === 'length' ? 'length' : 'stop',
        },
      };
    } catch (err) {
      yield { type: 'error', error: `Stream error: ${err}` };
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers() });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json() as { data: Array<{ id: string }> };
      return data.data.map(m => m.id).sort();
    } catch {
      return [this.defaultModel];
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  private convertMessages(messages: LLMMessage[]): OAIMessage[] {
    return messages.map(m => {
      const text = typeof m.content === 'string'
        ? m.content
        : m.content.map(b => b.type === 'text' ? b.text : '[image]').join('\n');
      const msg: OAIMessage = { role: m.role as OAIMessage['role'], content: text };
      if (m.tool_calls?.length) {
        msg.tool_calls = m.tool_calls.map(tc => ({
          id: tc.id, type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      return msg;
    });
  }

  private convertTools(tools: LLMTool[]): OAIToolDef[] {
    return tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }

  private convertResponse(data: OAIResponse): LLMResponse {
    const choice = data.choices[0]!;
    const tool_calls: LLMToolCall[] = [];
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        try { tool_calls.push({ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments) }); } catch { /* skip */ }
      }
    }
    return {
      content: choice.message.content || '',
      tool_calls,
      usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 },
      model: data.model,
      finish_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason === 'length' ? 'length' : 'stop',
    };
  }
}
