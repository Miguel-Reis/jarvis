/**
 * Structured Logger
 *
 * Centralized logging utility with consistent formatting,
 * log levels, and context prefixes.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private context: string;
  private debugEnabled: boolean;

  constructor(context: string, debugEnabled = false) {
    this.context = context;
    this.debugEnabled = debugEnabled;
  }

  private log(level: LogLevel, msg: string, ...args: unknown[]): void {
    // Skip debug if not enabled
    if (level === 'debug' && !this.debugEnabled) return;

    const prefix = `[${this.context}:${level.toUpperCase()}]`;
    console[level](`${prefix} ${msg}`, ...args);
  }

  debug(msg: string, ...args: unknown[]): void {
    this.log('debug', msg, ...args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.log('info', msg, ...args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.log('warn', msg, ...args);
  }

  error(msg: string, err?: Error | unknown, ...args: unknown[]): void {
    if (err instanceof Error) {
      this.log('error', `${msg}: ${err.message}`, ...args);
      console.debug(`[${this.context}:DEBUG] Stack:`, err.stack);
    } else {
      this.log('error', msg, err, ...args);
    }
  }

  /**
   * Enable debug logging for this logger instance
   */
  enableDebug(): void {
    this.debugEnabled = true;
  }
}

// Pre-configured loggers for each module
export const logger = {
  daemon: new Logger('DAEMON'),
  agent: new Logger('AGENT'),
  bgAgent: new Logger('BGAGENT'),
  ws: new Logger('WS'),
  observer: new Logger('OBSERVER'),
  channel: new Logger('CHANNEL'),
  sidecar: new Logger('SIDECAR'),
  health: new Logger('HEALTH'),
  llm: new Logger('LLM'),
  tool: new Logger('TOOL'),
  vault: new Logger('VAULT'),
  personality: new Logger('PERSONALITY'),
  awareness: new Logger('AWARENESS'),
  authority: new Logger('AUTHORITY'),
  workflow: new Logger('WORKFLOW'),
  mcp: new Logger('MCP'),
  research: new Logger('RESEARCH'),
};

/**
 * Create a custom logger for a specific context
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}

/**
 * Enable debug logging for specific contexts
 * Usage: enableDebugFor('AGENT', 'WS')
 */
export function enableDebugFor(...contexts: string[]): void {
  for (const ctx of contexts) {
    const key = ctx.toLowerCase() as keyof typeof logger;
    if (key in logger) {
      (logger[key] as Logger).enableDebug();
    }
  }
}
