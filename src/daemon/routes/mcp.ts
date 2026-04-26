/**
 * MCP server routes — server management and tool inspection.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error } from './_shared.ts';

export function registerRoutes(ctx: ApiContext) {
  return {

    // ── MCP Servers ────────────────────────────────────────────────────
    '/api/mcp/servers': {
      GET: (_req: Request) => {
        const servers = ctx.config.mcp_servers ?? [];
        const statuses = ctx.mcpService?.getServerStatus() ?? [];
        const statusMap = new Map(statuses.map(s => [s.name, s]));
        return json(servers.map(s => ({
          name: s.name,
          command: s.command,
          args: s.args ?? [],
          env: s.env ?? {},
          connected: statusMap.get(s.name)?.connected ?? false,
          toolCount: statusMap.get(s.name)?.toolCount ?? 0,
          error: statusMap.get(s.name)?.error ?? null,
        })));
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { name?: string; command?: string; args?: string[]; env?: Record<string, string> };
          if (!body.name || !body.command) return error('name and command are required');
          if (!/^[a-zA-Z0-9_-]+$/.test(body.name)) return error('name must be alphanumeric (a-z, 0-9, _, -)');

          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const fresh = await loadConfig();
          if (!fresh.mcp_servers) fresh.mcp_servers = [];
          if (fresh.mcp_servers.some(s => s.name === body.name)) return error(`Server '${body.name}' already exists`);

          const serverCfg = { name: body.name!, command: body.command!, args: body.args, env: body.env };
          fresh.mcp_servers.push(serverCfg);
          await saveConfig(fresh);

          try {
            await ctx.mcpService?.connectServer(serverCfg);
            return json({ ok: true, message: `Server '${body.name}' added and connected.` });
          } catch (connErr) {
            return json({ ok: true, message: `Server '${body.name}' saved but failed to connect: ${connErr instanceof Error ? connErr.message : connErr}` });
          }
        } catch (err) { return error(err instanceof Error ? err.message : String(err)); }
      },
    },

    '/api/mcp/servers/:name': {
      DELETE: async (req: Request) => {
        try {
          const name = new URL(req.url).pathname.split('/').pop()!;
          const { loadConfig, saveConfig } = await import('../../config/loader.ts');
          const fresh = await loadConfig();
          const before = (fresh.mcp_servers ?? []).length;
          fresh.mcp_servers = (fresh.mcp_servers ?? []).filter(s => s.name !== name);
          if (fresh.mcp_servers.length === before) return error(`Server '${name}' not found`, 404);
          await saveConfig(fresh);

          try {
            await ctx.mcpService?.disconnectServer(name);
          } catch { /* already gone */ }
          return json({ ok: true, message: `Server '${name}' removed and disconnected.` });
        } catch (err) { return error(err instanceof Error ? err.message : String(err)); }
      },
    },

    '/api/mcp/servers/:name/reconnect': {
      POST: async (req: Request) => {
        try {
          const parts = new URL(req.url).pathname.split('/');
          const name = decodeURIComponent(parts[parts.length - 2]!);
          const { loadConfig } = await import('../../config/loader.ts');
          const fresh = await loadConfig();
          const cfg = (fresh.mcp_servers ?? []).find(s => s.name === name);
          if (!cfg) return error(`Server '${name}' not found`, 404);
          try { await ctx.mcpService?.disconnectServer(name); } catch { /* already gone */ }
          try {
            await ctx.mcpService?.connectServer(cfg);
            return json({ ok: true, message: `Server '${name}' reconnected.` });
          } catch (connErr) {
            return json({ ok: false, error: `Failed to reconnect: ${connErr instanceof Error ? connErr.message : connErr}` });
          }
        } catch (err) { return error(err instanceof Error ? err.message : String(err)); }
      },
    },

    '/api/mcp/tools': {
      GET: (_req: Request) => {
        return json(ctx.mcpService?.getToolDetails() ?? []);
      },
    },

  };
}
