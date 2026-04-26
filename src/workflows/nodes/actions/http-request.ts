import type { NodeDefinition } from '../registry.ts';

export const httpRequestAction: NodeDefinition = {
  type: 'action.http_request',
  label: 'HTTP Request',
  description: 'Make an outbound HTTP request and return the response.',
  category: 'action',
  icon: '🌐',
  color: '#3b82f6',
  configSchema: {
    url: {
      type: 'template',
      label: 'URL',
      description: 'Target URL. Supports template expressions.',
      required: true,
      placeholder: 'https://api.example.com/endpoint',
    },
    method: {
      type: 'select',
      label: 'Method',
      description: 'HTTP method.',
      required: true,
      default: 'GET',
      options: [
        { label: 'GET', value: 'GET' },
        { label: 'POST', value: 'POST' },
        { label: 'PUT', value: 'PUT' },
        { label: 'PATCH', value: 'PATCH' },
        { label: 'DELETE', value: 'DELETE' },
      ],
    },
    headers: {
      type: 'json',
      label: 'Headers',
      description: 'JSON object of request headers.',
      required: false,
      default: {},
    },
    body: {
      type: 'template',
      label: 'Body',
      description: 'Request body. Supports template expressions. Leave empty for GET/DELETE.',
      required: false,
      placeholder: '{"key": "{{data.value}}"}',
    },
  },
  inputs: ['default'],
  outputs: ['default'],
  execute: async (input, config, ctx) => {
    const url = String(config.url ?? '');
    if (!url) throw new Error('url is required');

    const method = String(config.method ?? 'GET');
    const body = config.body ? String(config.body) : undefined;

    // Build headers
    let headers: Record<string, string> = {};
    if (config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
      headers = Object.fromEntries(
        Object.entries(config.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)])
      );
    } else if (typeof config.headers === 'string' && config.headers) {
      try {
        const parsed = JSON.parse(config.headers);
        headers = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)])
        );
      } catch {
        ctx.logger.warn('Could not parse headers JSON — using empty headers');
      }
    }

    ctx.logger.info(`HTTP ${method} ${url}`);

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: ctx.abortSignal,
    };

    if (body && !['GET', 'HEAD', 'DELETE'].includes(method)) {
      fetchOptions.body = body;
      if (!headers['Content-Type'] && !headers['content-type']) {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);
    const statusCode = response.status;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });

    const responseText = await response.text();
    let responseBody: unknown = responseText;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      // keep as text
    }

    if (!response.ok) {
      ctx.logger.warn(`HTTP ${method} ${url} returned ${statusCode}`);
    }

    return {
      data: {
        ...input.data,
        status: statusCode,
        ok: response.ok,
        headers: responseHeaders,
        body: responseBody,
        url,
        method,
      },
    };
  },
};
