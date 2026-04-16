/**
 * MCP Client — Model Context Protocol (stdio transport)
 *
 * Spawns an MCP server process, performs the initialization handshake,
 * discovers tools via tools/list, and executes tools via tools/call.
 * JSON-RPC 2.0 over newline-delimited stdin/stdout.
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

type PendingRpc = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

export class McpClient {
  readonly serverName: string;

  private proc: ChildProcess | null = null;
  private pending = new Map<number, PendingRpc>();
  private nextId = 1;
  private lineBuffer = '';
  private _ready = false;
  private discoveredTools: McpToolSchema[] = [];

  constructor(private config: McpServerConfig) {
    this.serverName = config.name;
  }

  async connect(): Promise<void> {
    const proc = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.config.env ?? {}) },
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
      if (text) console.warn(`[MCP:${this.serverName}]`, text);
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

    // MCP handshake
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'jarvis', version: '1.0.0' },
    });

    // Notify server we're initialized (fire-and-forget notification)
    this.write({ jsonrpc: '2.0', method: 'notifications/initialized' });

    this._ready = true;

    // Discover available tools
    const result = await this.rpc('tools/list', {}) as { tools?: McpToolSchema[] };
    this.discoveredTools = result.tools ?? [];
    console.log(`[MCP:${this.serverName}] Connected — ${this.discoveredTools.length} tool(s) available`);
  }

  async disconnect(): Promise<void> {
    this._ready = false;
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  isReady(): boolean {
    return this._ready;
  }

  getTools(): McpToolSchema[] {
    return this.discoveredTools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.rpc('tools/call', { name, arguments: args }) as McpCallResult;
    const text = (result.content ?? [])
      .map(c => (c.type === 'text' && c.text ? c.text : JSON.stringify(c)))
      .join('\n');
    if (result.isError) throw new Error(text || `MCP tool '${name}' returned error`);
    return text;
  }

  private handleLine(line: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // Notifications (no id) — ignore
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
