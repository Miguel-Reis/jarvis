import type {
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  LLMStreamEvent,
} from './provider.ts';

export class LLMManager {
  private providers: Map<string, LLMProvider> = new Map();
  private primaryProvider = '';
  private fallbackChain: string[] = [];
  private static readonly MAX_RETRIES_PER_PROVIDER = 10;
  private static readonly REQUEST_TIMEOUT_MS = 120000; // 120 second timeout for LLM calls
  private static readonly STREAM_CHUNK_TIMEOUT_MS = 90_000; // 90s between stream chunks
  private static readonly isDebugging = process.env.JARVIS_LOG_LEVEL === 'debug' || process.env.DEBUG_LLM === 'true';
  private _notifyCallback?: (text: string, priority: 'low' | 'normal' | 'high' | 'urgent') => void;

  /** Session-level token usage tracking */
  private sessionTokenCount = 0;
  private sessionTokenWarned80 = false;
  private sessionTokenWarned95 = false;

  /**
   * Estimate token count from text.
   * Uses model-aware approximation: 1 token ≈ 4 chars for English,
   * but adjusts for code and mixed content. Conservative baseline: 3 chars/token.
   * For precise counts, rely on actual token usage from API responses.
   */
  static estimateTokens(text: string, model?: string): number {
    if (!text) return 0;

    // Claude models use ~3 chars/token average, GPT-4 uses ~4
    const charsPerToken = model?.includes('claude') ? 3 : 4;

    // Adjust for code-heavy content (more tokens per char due to syntax)
    const hasCodeMarkers = text.includes('```') || text.includes('<code>');
    const adjustment = hasCodeMarkers ? 0.85 : 1;

    return Math.ceil((text.length / charsPerToken) * adjustment);
  }

  /**
   * Track tokens used in this session and emit warnings at 80% and 95% of
   * the estimated context window for the current model.
   * Call this after each LLM response.
   */
  trackUsage(inputTokens: number, outputTokens: number): void {
    const total = inputTokens + outputTokens;
    this.sessionTokenCount += total;

    // Get current model context window
    const primary = this.providers.get(this.primaryProvider);
    if (!primary) return;

    const modelName = (primary as unknown as { model?: string }).model ?? 'unknown';
    const modelMeta = this._modelMetadata?.get(modelName);
    const contextWindow = modelMeta?.contextWindow ?? 128_000;

    const usage = this.sessionTokenCount / contextWindow;

    if (usage >= 0.95 && !this.sessionTokenWarned95) {
      this.sessionTokenWarned95 = true;
      console.warn(`[LLMManager] ⚠️ Session token budget at 95% (${this.sessionTokenCount.toLocaleString()} tokens, ~${contextWindow.toLocaleString()} window). Consider summarising or clearing context.`);
    } else if (usage >= 0.80 && !this.sessionTokenWarned80) {
      this.sessionTokenWarned80 = true;
      console.warn(`[LLMManager] ℹ️ Session token budget at 80% (${this.sessionTokenCount.toLocaleString()} tokens, ~${contextWindow.toLocaleString()} window). Consider trimming context if response quality degrades.`);
    }
  }

  private _modelMetadata: Map<string, { contextWindow: number }> | null = null;
  setModelMetadata(meta: Map<string, { contextWindow: number }>): void {
    this._modelMetadata = meta;
  }

  getSessionTokenCount(): number {
    return this.sessionTokenCount;
  }

  resetSessionBudget(): void {
    this.sessionTokenCount = 0;
    this.sessionTokenWarned80 = false;
    this.sessionTokenWarned95 = false;
  }

  /** Providers known to reject image content — images stripped on every call. */
  private noVisionProviders = new Set<string>();

  constructor() {}

  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);

    // Set as primary if it's the first provider
    if (!this.primaryProvider) {
      this.primaryProvider = provider.name;
    }
  }

  setPrimary(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider '${name}' not registered`);
    }
    this.primaryProvider = name;
  }

  setFallbackChain(names: string[]): void {
    for (const name of names) {
      if (!this.providers.has(name)) {
        throw new Error(`Provider '${name}' not registered`);
      }
    }
    this.fallbackChain = names;
  }

  getProvider(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  getPrimary(): string {
    return this.primaryProvider;
  }

  getFallbackChain(): string[] {
    return [...this.fallbackChain];
  }

  getProviderNames(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Returns true if the primary provider's active model supports image content blocks.
   * Result is cached after the first call.
   */
  private _visionCache: boolean | null = null;
  async supportsVision(): Promise<boolean> {
    if (this._visionCache !== null) return this._visionCache;
    const primary = this.providers.get(this.primaryProvider);
    if (!primary) { this._visionCache = false; return false; }
    this._visionCache = await primary.supportsVision();
    return this._visionCache;
  }

  /** Clear cached vision support (call after provider/model change). */
  clearVisionCache(): void {
    this._visionCache = null;
  }

  private getProviderSequence(primaryOverride?: string | null): string[] {
    const primary = primaryOverride && this.providers.has(primaryOverride) ? primaryOverride : this.primaryProvider;
    return [primary, ...this.fallbackChain.filter((name) => name !== primary)];
  }

  private formatFailure(providerName: string, errors: string[]): string {
    const n = errors.length;
    return `Provider '${providerName}' failed after ${n} attempt${n === 1 ? '' : 's'}:\n${errors.map((error) => `  ${error}`).join('\n')}`;
  }

  /**
   * Atomically replace all providers. Safe for in-flight requests because
   * JS is single-threaded and the map assignment is atomic.
   */
  replaceProviders(providers: LLMProvider[], primary: string, fallback: string[]): void {
    const newMap = new Map<string, LLMProvider>();
    for (const p of providers) {
      newMap.set(p.name, p);
    }
    this.providers = newMap;
    this.primaryProvider = newMap.has(primary) ? primary : (providers[0]?.name ?? '');
    this.fallbackChain = fallback.filter(n => newMap.has(n));
  }

  /**
   * Wrap an async iterable stream with a per-chunk timeout.
   * Throws if no chunk arrives within timeoutMs — catches stalled TCP connections.
   * timeoutMs is parameterised so tests can use small values.
   */
  private async *streamWithChunkTimeout(
    source: AsyncIterable<LLMStreamEvent>,
    providerName: string,
    timeoutMs = LLMManager.STREAM_CHUNK_TIMEOUT_MS,
  ): AsyncGenerator<LLMStreamEvent> {
    const iter = source[Symbol.asyncIterator]();
    try {
      while (true) {
        let timeoutId!: ReturnType<typeof setTimeout>;
        const timedOut = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`LLM stream from ${providerName} stalled after ${timeoutMs}ms`)),
            timeoutMs,
          );
        });
        const result = await Promise.race([iter.next(), timedOut]);
        clearTimeout(timeoutId);
        if (result.done) break;
        yield result.value;
      }
    } finally {
      // Signal upstream to close the HTTP connection
      iter.return?.();
    }
  }

  /**
   * Add request timeout with AbortController so the underlying fetch is cancelled.
   * Returns [result, controller] — caller should abort the controller on error.
   */
  private withTimeoutSignal(provider: string): { signal: AbortSignal; cancel: (reason?: string) => void; timeoutId: ReturnType<typeof setTimeout> } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(`LLM request to ${provider} timed out after ${LLMManager.REQUEST_TIMEOUT_MS}ms`);
    }, LLMManager.REQUEST_TIMEOUT_MS);
    return {
      signal: controller.signal,
      cancel: (reason?: string) => { clearTimeout(timeoutId); controller.abort(reason); },
      timeoutId,
    };
  }

  private static isVisionError(error: unknown): boolean {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return msg.includes('does not support image input') ||
      msg.includes('image input') ||
      (msg.includes('image') && (msg.includes('400') || msg.includes('unsupported')));
  }

  private static stripImages(messages: LLMMessage[]): LLMMessage[] {
    return messages.map(m => {
      if (!Array.isArray(m.content)) return m;
      const textOnly = m.content.filter(b => b.type !== 'image');
      return { ...m, content: textOnly.length > 0 ? textOnly : [{ type: 'text' as const, text: '' }] };
    });
  }

  /**
   * Set callback to notify user on chat when retries happen
   */
  setNotifyCallback(fn: (text: string, priority: 'low' | 'normal' | 'high' | 'urgent') => void): void {
    this._notifyCallback = fn;
  }

  private notifyRetry(provider: string, attempt: number, maxRetries: number, error: string): void {
    if (!this._notifyCallback) return;

    const text = `🔄 **LLM Retry**: ${provider} (attempt ${attempt}/${maxRetries})\n\`${error.slice(0, 100)}${error.length > 100 ? '...' : ''}\``;
    this._notifyCallback(text, 'high');
  }

  /**
   * Classify error for better retry logic
   */
  private shouldRetry(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const msg = error.message.toLowerCase();
    // Retry on network/timeout/abort errors, not on auth/validation errors
    return msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('aborted') ||
      msg.includes('abort') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('network') ||
      msg.includes('temporarily unavailable') ||
      msg.includes('429') ||  // rate limit
      msg.includes('503');    // service unavailable
  }

  /**
   * Temporarily override the primary provider for a single call.
   * Used for per-message LLM selection from chat dashboard.
   */
  async chatWithOverride(
    messages: LLMMessage[],
    overridePrimary: string | null,
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const failures: string[] = [];

    for (const providerName of this.getProviderSequence(overridePrimary)) {
      const provider = this.providers.get(providerName);
      if (!provider) {
        failures.push(`Provider '${providerName}' not registered`);
        continue;
      }

      const errors: string[] = [];
      // Strip images upfront if this provider is known to reject them
      let effectiveMessages = this.noVisionProviders.has(providerName)
        ? LLMManager.stripImages(messages)
        : messages;

      for (let attempt = 1; attempt <= LLMManager.MAX_RETRIES_PER_PROVIDER; attempt++) {
        const { signal, cancel, timeoutId } = this.withTimeoutSignal(providerName);
        try {
          const result = await provider.chat(effectiveMessages, { ...options, signal });
          clearTimeout(timeoutId);
          if (LLMManager.isDebugging && attempt > 1) {
            console.log(`[DEBUG] LLM ${providerName} succeeded on retry attempt ${attempt}`);
          }
          return result;
        } catch (err) {
          cancel();
          const errorMsg = err instanceof Error ? err.message : String(err);

          if (LLMManager.isVisionError(err) && !this.noVisionProviders.has(providerName)) {
            this.noVisionProviders.add(providerName);
            this._visionCache = false;
            console.warn(`[LLM] ${providerName} rejected image input — disabling vision for this provider`);
            effectiveMessages = LLMManager.stripImages(messages);
            // Retry immediately without counting as a new attempt
            continue;
          }

          errors.push(`attempt ${attempt}: ${errorMsg}`);

          const shouldRetry = this.shouldRetry(err);
          console.error(
            `[LLM] Provider ${providerName} failed (attempt ${attempt}/${LLMManager.MAX_RETRIES_PER_PROVIDER})${!shouldRetry ? ' [no retry]' : ''}: ${errorMsg}`
          );

          if (!shouldRetry || attempt === LLMManager.MAX_RETRIES_PER_PROVIDER) break;

          // Notify user on chat about retry
          this.notifyRetry(providerName, attempt + 1, LLMManager.MAX_RETRIES_PER_PROVIDER, errorMsg);

          // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s (capped at 30s)
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }

      failures.push(this.formatFailure(providerName, errors));
    }

    throw new Error(failures.join('\n\n'));
  }

  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const result = await this.chatWithOverride(messages, null, options);
    const inputTokens = LLMManager.estimateTokens(messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')).join(''));
    const outputTokens = LLMManager.estimateTokens(result.content);
    this.trackUsage(inputTokens, outputTokens);
    return result;
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamEvent> {
    const failures: string[] = [];

    for (const providerName of this.getProviderSequence()) {
      const provider = this.providers.get(providerName);
      if (!provider) {
        failures.push(`Provider '${providerName}' not registered`);
        continue;
      }

      const errors: string[] = [];
      let effectiveMessages = this.noVisionProviders.has(providerName)
        ? LLMManager.stripImages(messages)
        : messages;

      for (let attempt = 1; attempt <= LLMManager.MAX_RETRIES_PER_PROVIDER; attempt++) {
        let emittedContent = false;
        try {
          let hasError = false;
          for await (const event of this.streamWithChunkTimeout(provider.stream(effectiveMessages, options), providerName)) {
            if (event.type === 'error') {
              hasError = true;

              if (LLMManager.isVisionError(event.error) && !this.noVisionProviders.has(providerName)) {
                this.noVisionProviders.add(providerName);
                this._visionCache = false;
                console.warn(`[LLM] ${providerName} rejected image input — disabling vision for this provider`);
                effectiveMessages = LLMManager.stripImages(messages);
                break; // retry without counting as error
              }

              errors.push(`attempt ${attempt}: ${event.error}`);
              console.error(
                `[LLM] Provider ${providerName} stream error (attempt ${attempt}/${LLMManager.MAX_RETRIES_PER_PROVIDER}): ${event.error}`
              );
              if (emittedContent) {
                yield { type: 'error', error: this.formatFailure(providerName, errors) };
                return;
              }
              break;
            }
            if (event.type === 'text' || event.type === 'tool_call') {
              emittedContent = true;
            }
            yield event;
          }

          if (!hasError) {
            return;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);

          if (LLMManager.isVisionError(err) && !this.noVisionProviders.has(providerName)) {
            this.noVisionProviders.add(providerName);
            this._visionCache = false;
            console.warn(`[LLM] ${providerName} rejected image input — disabling vision for this provider`);
            effectiveMessages = LLMManager.stripImages(messages);
            continue;
          }

          errors.push(`attempt ${attempt}: ${errorMsg}`);

          const shouldRetry = this.shouldRetry(err);
          console.error(
            `[LLM] Provider ${providerName} stream failed (attempt ${attempt}/${LLMManager.MAX_RETRIES_PER_PROVIDER})${!shouldRetry ? ' [no retry]' : ''}: ${errorMsg}`
          );

          if (emittedContent) {
            yield { type: 'error', error: this.formatFailure(providerName, errors) };
            return;
          }

          if (!shouldRetry) break;
        }
      }

      failures.push(this.formatFailure(providerName, errors));
    }

    yield {
      type: 'error',
      error: failures.join('\n\n'),
    };
  }
}
