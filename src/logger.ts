/**
 * Structured logging with per-context verbosity control.
 *
 * Set LOG_LEVEL env var to: debug | info | warn | error (default: info)
 * Set LOG_CONTEXTS to comma-separated list to filter to specific contexts.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const globalLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
const enabledContexts = process.env.LOG_CONTEXTS
  ? new Set(process.env.LOG_CONTEXTS.split(',').map((s) => s.trim()))
  : null;

function createLogger(context: string) {
  function shouldLog(level: LogLevel): boolean {
    if (enabledContexts && !enabledContexts.has(context)) return false;
    return LEVELS[level] >= LEVELS[globalLevel];
  }

  function fmt(level: LogLevel, msg: string, data?: unknown): void {
    if (!shouldLog(level)) return;
    const prefix = `[${context}]`;
    const out = data !== undefined ? [prefix, msg, data] : [prefix, msg];
    if (level === 'error') console.error(...out);
    else if (level === 'warn') console.warn(...out);
    else console.log(...out);
  }

  return {
    debug: (msg: string, data?: unknown) => fmt('debug', msg, data),
    info: (msg: string, data?: unknown) => fmt('info', msg, data),
    warn: (msg: string, data?: unknown) => fmt('warn', msg, data),
    error: (msg: string, data?: unknown) => fmt('error', msg, data),
  };
}

export const logger = {
  daemon: createLogger('daemon'),
  agent: createLogger('agent'),
  bgAgent: createLogger('bgAgent'),
  ws: createLogger('ws'),
  vault: createLogger('vault'),
  authority: createLogger('authority'),
  workflow: createLogger('workflow'),
  comms: createLogger('comms'),
  awareness: createLogger('awareness'),
  goals: createLogger('goals'),
  llm: createLogger('llm'),
  sidecar: createLogger('sidecar'),
  integrations: createLogger('integrations'),
  voice: createLogger('voice'),
  config: createLogger('config'),
  cli: createLogger('cli'),
};
