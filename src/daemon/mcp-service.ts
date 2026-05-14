/**
 * MCP Service — Model Context Protocol Server Manager
 *
 * Reads `mcp_servers` from config, spawns each server process,
 * and registers their tools into the agent's ToolRegistry.
 * Servers connect asynchronously — failures don't block startup.
 */

import type { Service, ServiceStatus } from './types.ts';
import type { JarvisConfig } from '../config/types.ts';
import type { ToolRegistry } from '../actions/tools/registry.ts';
import { McpClient, mcpToolsToDefinitions } from '../llm/mcp-client.ts';

type McpServerEntry = {
  name: string;
  client: McpClient;
  toolCount: number;
  error?: string;
};

export class McpService implements Service {
  name = 'mcp';
  private _status: ServiceStatus = 'stopped';
  private entries: McpServerEntry[] = [];
  private config: JarvisConfig;
  private toolRegistry: ToolRegistry | null = null;

  constructor(config: JarvisConfig) {
    this.config = config;
  }

  /** Must be called before start() so tools can be registered. */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  async start(): Promise<void> {
    this._status = 'starting';

    const servers = this.config.mcp_servers ?? [];
    if (servers.length === 0) {
      this._status = 'running';
      console.log('[McpService] No MCP servers configured');
      return;
    }

    const results = await Promise.allSettled(
      servers.map(async (cfg) => {
        const client = new McpClient(cfg);
        await client.connect();

        let toolCount = 0;
        if (this.toolRegistry) {
          const tools = mcpToolsToDefinitions(client);
          for (const tool of tools) {
            try {
              this.toolRegistry.register(tool);
              toolCount++;
            } catch (err) {
              console.warn(`[McpService] Could not register tool '${tool.name}':`, err instanceof Error ? err.message : err);
            }
          }
        }

        this.entries.push({ name: cfg.name, client, toolCount });
        return { name: cfg.name, toolCount };
      })
    );

    let connected = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        connected++;
      } else {
        const err = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`[McpService] Server failed to connect:`, err);
        // Still track as entry so status API can report the error
        const serverIdx = results.indexOf(r);
        const cfg = servers[serverIdx];
        if (cfg) {
          this.entries.push({
            name: cfg.name,
            client: new McpClient(cfg),
            toolCount: 0,
            error: err,
          });
        }
      }
    }

    this._status = 'running';
    console.log(`[McpService] Started: ${connected}/${servers.length} MCP servers connected`);
  }

  async stop(): Promise<void> {
    this._status = 'stopping';
    await Promise.allSettled(this.entries.map(e => e.client.disconnect()));
    this.entries = [];
    this._status = 'stopped';
    console.log('[McpService] Stopped');
  }

  status(): ServiceStatus {
    return this._status;
  }

  /** Get connection status of all configured MCP servers. */
  getServerStatus(): Array<{ name: string; connected: boolean; toolCount: number; error?: string }> {
    return this.entries.map(e => ({
      name: e.name,
      connected: e.client.isReady(),
      toolCount: e.toolCount,
      error: e.error,
    }));
  }

  /** Get detailed tool list per server for the tools browser UI. */
  getToolDetails(): Array<{
    server: string;
    connected: boolean;
    tools: Array<{ name: string; description?: string }>;
    error?: string;
  }> {
    return this.entries.map(e => ({
      server: e.name,
      connected: e.client.isReady(),
      tools: e.client.getTools().map(t => ({ name: t.name, description: t.description })),
      error: e.error,
    }));
  }

  /** Connect a new MCP server at runtime without restarting the daemon. */
  async connectServer(cfg: import('../config/types.ts').McpServerConfig): Promise<void> {
    if (this.entries.find(e => e.name === cfg.name)) {
      throw new Error(`MCP server '${cfg.name}' is already connected`);
    }
    const client = new McpClient(cfg);
    await client.connect();

    let toolCount = 0;
    if (this.toolRegistry) {
      const tools = mcpToolsToDefinitions(client);
      for (const tool of tools) {
        try {
          this.toolRegistry.register(tool);
          toolCount++;
        } catch (err) {
          console.warn(`[McpService] Could not register tool '${tool.name}':`, err instanceof Error ? err.message : err);
        }
      }
    }

    this.entries.push({ name: cfg.name, client, toolCount });
    console.log(`[McpService] Connected server '${cfg.name}' (${toolCount} tools)`);
  }

  /** Disconnect and remove a named MCP server at runtime. */
  async disconnectServer(name: string): Promise<void> {
    const idx = this.entries.findIndex(e => e.name === name);
    if (idx === -1) throw new Error(`MCP server '${name}' not found`);
    const [entry] = this.entries.splice(idx, 1) as [McpServerEntry];
    await entry.client.disconnect();
    console.log(`[McpService] Disconnected server '${name}'`);
  }
}
