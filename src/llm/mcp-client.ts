/**
 * MCP Client — Model Context Protocol
 *
 * Supports two transport mechanisms:
 *   - "stdio": spawns a server process and communicates over stdin/stdout (JSON-RPC)
 *   - "sse":   connects to an HTTP endpoint and receives events via Server-Sent Events,
 *              posting JSON-RPC requests to the same URL
 *
 * JSON-RPC 2.0 over newline-delimited stdin/stdout (stdio) or HTTP POST + SSE (sse).
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { ToolDefinition } from '../actions/tools/registry.ts';
import type { McpServerConfig } from '../config/types.ts';

// --- JSON-RPC types ---

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

// --- MCP schema types ---

type McpPropertySchema = {
  type?: string;
  description?: string;
  items?: McpPropertySchema;
  enum?: unknown[];
  [k: string]: unknown;
};

type McpInputSchema = {
  type?: string;
  properties?: Record<string, McpPropertySchema>;
  required?: string[];
};

type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema?: McpInputSchema;
};

type McpCallResult = {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
};

/** Auto-reconnect configuration for MCP clients */
const MCP_RECONNECT = {
  maxRetries: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  /** Whether to keep trying forever after maxRetries (best-effort recovery) */
  persist: false,
};

type PendingRpc = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

// --- Transport abstraction ---

interface McpTransport {
  readonly serverName: string;
  connect(): Promise<void>;
  disconnect(): void;
  isReady(): boolean;
  send(method: string, params: unknown): Promise<unknown>;
}

class StdioTransport implements McpTransport {
  readonly serverName: string;
  private proc: ChildProcess | null = null;
  private pending = new Map<number, PendingRpc>();
  private nextId = 1;
  private lineBuffer = '';
  private _ready = false;

  constructor(private config: Required<McpServerConfig> & { transport: 'stdio' }) {
    this.serverName = config.name;
  }

  async connect(): Promise<void> {
    const { command, args = [], env = {} } = this.config;
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      shell: false,
    });

    this.proc = proc;

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.lineBuffer += chunk.toString('utf8');
      const lines = this.lineBuffer.split('\n');
      this.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this.handleLine(trimmed);
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) console.warn(`[MCP:${this.serverName}][stderr]`, text);
    });

    proc.on('exit', (code) => {
      this._ready = false;
      for (const [, h] of this.pending) {
        h.reject(new Error(`MCP server '${this.serverName}' exited (code ${code})`));
      }
      this.pending.clear();
    });

    proc.on('error', (err) => {
      this._ready = false;
      for (const [, h] of this.pending) {
        h.reject(err);
      }
      this.pending.clear();
    });

    // Wait for the server to be ready before sending RPC
    await this.waitForReady();
  }

  disconnect(): void {
    this._ready = false;
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  isReady(): boolean {
    return this._ready;
  }

  async send(method: string, params: unknown): Promise<unknown> {
    return this.rpc(method, params);
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      // For stdio transport we assume ready after connect — the MCP initialize
      // response is what signals true readiness, but we handle that via rpc().
      resolve();
    });
  }

  private handleLine(line: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.id === undefined) return;

    const handler = this.pending.get(msg.id);
    if (!handler) return;
    this.pending.delete(msg.id);

    if (msg.error) {
      handler.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      handler.resolve(msg.result);
    }
  }

  private rpc(method: string, params: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP '${this.serverName}' RPC '${method}' timed out`));
      }, 30_000);

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private write(msg: JsonRpcRequest): void {
    if (!this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify(msg) + '\n', 'utf8');
  }
}

class SseTransport implements McpTransport {
  readonly serverName: string;
  private pending = new Map<number, PendingRpc>();
  private nextId = 1;
  private _ready = false;
  private eventSource: EventSource | null = null;
  private baseUrl: string;

  constructor(private config: Required<McpServerConfig> & { transport: 'sse' }) {
    this.serverName = config.name;
    this.baseUrl = config.url.replace(/\/$/, '');
  }

  async connect(): Promise<void> {
    // MCP over SSE: we POST JSON-RPC requests and receive responses via SSE events.
    // Each notification from the server arrives as an SSE event with an "id" field
    // that maps back to the original request id.
    this.eventSource = new EventSource(`${this.baseUrl}/sse`);

    this.eventSource.addEventListener('message', (e: MessageEvent) => {
      if (!e.data || e.data === ': ping') return;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      // Server-initiated notifications have no id
      if (msg.id === undefined) return;
      const handler = this.pending.get(msg.id);
      if (!handler) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        handler.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
      } else {
        handler.resolve(msg.result);
      }
    });

    this.eventSource.addEventListener('error', (e) => {
      console.error(`[MCP:${this.serverName}][SSE] Error:`, e);
    });

    // Wait for SSE connection before sending RPC
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`MCP '${this.serverName}' SSE connection timed out`)), 30_000);
      this.eventSource!.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.eventSource!.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error(`MCP '${this.serverName}' SSE connection failed`));
      }, { once: true });
    });

    this._ready = true;
  }

  disconnect(): void {
    this._ready = false;
    this.eventSource?.close();
    this.eventSource = null;
  }

  isReady(): boolean {
    return this._ready;
  }

  async send(method: string, params: unknown): Promise<unknown> {
    return this.rpc(method, params);
  }

  private rpc(method: string, params: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP '${this.serverName}' RPC '${method}' timed out`));
      }, 30_000);

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

      fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body,
      }).then(async (res) => {
        if (!res.ok) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`MCP '${this.serverName}' HTTP ${res.status}: ${res.statusText}`));
          return;
        }
        // Response may be empty (202 Accepted) — result comes via SSE
        const text = await res.text();
        if (text) {
          // Some MCP servers respond synchronously with the result
          try {
            const msg: JsonRpcResponse = JSON.parse(text);
            if (msg.id !== undefined) {
              this.pending.delete(id);
              clearTimeout(timer);
              if (msg.error) reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
              else resolve(msg.result);
            }
          } catch {
            // Not JSON or no id — ignore
          }
        }
      }).catch((err) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}

// --- McpClient ---

export class McpClient {
  readonly serverName: string;
  private transport: McpTransport;
  private discoveredTools: McpToolSchema[] = [];

  constructor(private config: McpServerConfig) {
    this.serverName = config.name;

    // Normalize config — default to stdio
    const normalized = {
      ...config,
      transport: config.transport ?? 'stdio',
    } as McpServerConfig & { transport: 'stdio' | 'sse' };

    if (normalized.transport === 'sse') {
      if (!normalized.url) throw new Error(`MCP server '${config.name}': 'url' is required for SSE transport`);
      this.transport = new SseTransport(normalized as Required<McpServerConfig> & { transport: 'sse' });
    } else {
      if (!normalized.command) throw new Error(`MCP server '${config.name}': 'command' is required for stdio transport`);
      this.transport = new StdioTransport(normalized as Required<McpServerConfig> & { transport: 'stdio' });
    }
  }

  async connect(): Promise<void> {
    await this.transport.connect();

    // MCP handshake
    await this.transport.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'jarvis', version: '1.0.0' },
    });

    // Notify server we're initialized (fire-and-forget notification)
    this.transport.send('notifications/initialized', {}).catch((err) => {
      console.warn('[MCPClient] Failed to send initialized notification:', err);
    });

    // Discover available tools
    const result = await this.transport.send('tools/list', {}) as { tools?: McpToolSchema[] };
    this.discoveredTools = result.tools ?? [];
    console.log(`[MCP:${this.serverName}] Connected (${this.transport instanceof SseTransport ? 'SSE' : 'stdio'}) — ${this.discoveredTools.length} tool(s) available`);
  }

  async disconnect(): Promise<void> {
    this.transport.disconnect();
  }

  isReady(): boolean {
    return this.transport.isReady();
  }

  getTools(): McpToolSchema[] {
    return this.discoveredTools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.transport.send('tools/call', { name, arguments: args }) as McpCallResult;
    const text = (result.content ?? [])
      .map(c => (c.type === 'text' && c.text ? c.text : JSON.stringify(c)))
      .join('\n');
    if (result.isError) throw new Error(text || `MCP tool '${name}' returned error`);
    return text;
  }

  /**
   * Continuously reconnect with exponential backoff until successfully connected.
   * Runs in a loop, logs each attempt, and gives up after MCP_RECONNECT.maxRetries.
   * Use this for MCP servers that should stay connected permanently.
   *
   * Fire-and-forget: call in a background task.
   * Call reconnect() to manually force a reconnection.
   */
  autoReconnect(): void {
    let attempt = 0;
    const loop = async () => {
      while (true) {
        try {
          await this.connect();
          console.log(`[MCP:${this.serverName}] Connected successfully`);
          attempt = 0;
          // Poll every 5s to detect silent disconnections
          while (this.transport.isReady()) {
            await new Promise(r => setTimeout(r, 5_000));
          }
          console.warn(`[MCP:${this.serverName}] Connection lost, reconnecting...`);
        } catch (err) {
          attempt++;
          const delay = Math.min(MCP_RECONNECT.baseDelayMs * Math.pow(2, Math.min(attempt - 1, 6)), MCP_RECONNECT.maxDelayMs);
          console.warn(`[MCP:${this.serverName}] Connection failed (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}. Retrying in ${delay}ms...`);
          if (attempt >= MCP_RECONNECT.maxRetries) {
            console.error(`[MCP:${this.serverName}] Max reconnection attempts (${MCP_RECONNECT.maxRetries}) reached. Stopping auto-reconnect.`);
            return;
          }
          await new Promise(r => setTimeout(r, delay));
        }
      }
    };
    loop().catch(err => {
      console.error(`[MCP:${this.serverName}] AutoReconnect loop exited unexpectedly:`, err);
    });
  }

  /** Manually trigger a reconnection (disconnect and reconnect once). */
  async reconnect(): Promise<void> {
    console.log(`[MCP:${this.serverName}] Manual reconnect...`);
    this.disconnect();
    await this.connect();
  }
}

/**
 * Convert MCP tool schemas to ToolDefinition entries for the agent's ToolRegistry.
 * Each tool is prefixed: `mcp_{serverName}_{toolName}`.
 */
export function mcpToolsToDefinitions(client: McpClient): ToolDefinition[] {
  return client.getTools().map((schema) => {
    const parameters: ToolDefinition['parameters'] = {};
    const required = new Set(schema.inputSchema?.required ?? []);

    for (const [key, prop] of Object.entries(schema.inputSchema?.properties ?? {})) {
      parameters[key] = {
        type: prop.type ?? 'string',
        description: prop.description ?? key,
        required: required.has(key),
      };
    }

    const toolName = `mcp_${client.serverName}_${schema.name}`;
    return {
      name: toolName,
      description: `[MCP:${client.serverName}] ${schema.description ?? schema.name}`,
      category: 'mcp',
      parameters,
      execute: async (params) => client.callTool(schema.name, params),
    } satisfies ToolDefinition;
  });
}
