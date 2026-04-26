import type { NodeDefinition } from '../registry.ts';

export const pollTrigger: NodeDefinition = {
  type: 'trigger.poll',
  label: 'Poll Trigger',
  description: 'Periodically poll a URL and fire when the response changes.',
  category: 'trigger',
  icon: '🔄',
  color: '#8b5cf6',
  configSchema: {
    url: {
      type: 'template',
      label: 'URL',
      description: 'URL to poll. Supports template expressions.',
      required: true,
      placeholder: 'https://api.example.com/status',
    },
    interval_ms: {
      type: 'number',
      label: 'Interval (ms)',
      description: 'Polling interval in milliseconds.',
      required: true,
      default: 60000,
    },
    method: {
      type: 'select',
      label: 'HTTP Method',
      description: 'HTTP method to use when polling.',
      required: true,
      default: 'GET',
      options: [
        { label: 'GET', value: 'GET' },
        { label: 'POST', value: 'POST' },
      ],
    },
    dedup_field: {
      type: 'string',
      label: 'Dedup Field',
      description: 'Optional dot-path into the response body to use for deduplication.',
      required: false,
      placeholder: 'data.id',
    },
  },
  inputs: [],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const url = String(config.url ?? '');
    const method = String(config.method ?? 'GET');
    ctx.logger.info(`Poll trigger fired — url: ${url}, method: ${method}`);

    let responseData: unknown = null;
    let responseStatus = 0;

    try {
      const response = await fetch(url, { method, signal: ctx.abortSignal });
      responseStatus = response.status;
      const text = await response.text();
      try {
        responseData = JSON.parse(text);
      } catch {
        responseData = text;
      }
    } catch (err) {
      ctx.logger.warn(`Poll fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      data: {
        triggerType: 'poll',
        url,
        method,
        interval_ms: config.interval_ms,
        dedup_field: config.dedup_field ?? null,
        status: responseStatus,
        response: responseData,
        firedAt: Date.now(),
        ...input.data,
      },
    };
  },
};
