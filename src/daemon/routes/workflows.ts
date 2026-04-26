/**
 * Workflow routes — CRUD, execution, nodes, webhooks, NL chat.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams } from './_shared.ts';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- .]/g, '');
}

export function registerRoutes(ctx: ApiContext) {
  return {

    // --- Workflows ---
    '/api/workflows': {
      GET: (req: Request) => {
        try {
          const { findWorkflows } = require('../../vault/workflows.ts');
          const params = getSearchParams(req);
          const query: any = {};
          if (params.has('enabled')) query.enabled = params.get('enabled') === 'true';
          if (params.has('tag')) query.tag = params.get('tag');
          if (params.has('limit')) query.limit = parseInt(params.get('limit')!);
          return json(findWorkflows(query));
        } catch (err) { return error(`${err}`); }
      },
      POST: async (req: Request) => {
        try {
          const { createWorkflow, createVersion } = require('../../vault/workflows.ts');
          const body = await req.json() as any;
          if (!body.name) return error('name is required');
          const wf = createWorkflow(body.name, {
            description: body.description,
            authority_level: body.authority_level,
            tags: body.tags,
          });
          if (body.definition) {
            createVersion(wf.id, body.definition, body.changelog ?? 'Initial version');
          }
          return json(wf, 201);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/nodes': {
      GET: () => {
        if (!ctx.nodeRegistry) return error('Node registry not available', 503);
        return json(ctx.nodeRegistry.list().map((n: any) => ({
          type: n.type, label: n.label, description: n.description,
          category: n.category, icon: n.icon, color: n.color,
          configSchema: n.configSchema, inputs: n.inputs, outputs: n.outputs,
        })));
      },
    },

    '/api/workflows/import': {
      POST: async (req: Request) => {
        try {
          const { importWorkflowYaml } = require('../../workflows/yaml.ts');
          const { createWorkflow, createVersion, setVariable } = require('../../vault/workflows.ts');
          const yamlText = await req.text();
          const imported = importWorkflowYaml(yamlText);
          const wf = createWorkflow(imported.name, {
            description: imported.description,
            authority_level: imported.authority_level,
            tags: imported.tags,
          });
          createVersion(wf.id, imported.definition, 'Imported');
          for (const [k, v] of Object.entries(imported.variables)) {
            setVariable(wf.id, k, v);
          }
          return json(wf, 201);
        } catch (err) { return error(`YAML import failed: ${err}`); }
      },
    },

    '/api/workflows/:id': {
      GET: (req: Request) => {
        try {
          const { getWorkflow } = require('../../vault/workflows.ts');
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          const wf = getWorkflow(id);
          if (!wf) return error('Workflow not found', 404);
          return json(wf);
        } catch (err) { return error(`${err}`); }
      },
      PATCH: async (req: Request) => {
        try {
          const { updateWorkflow } = require('../../vault/workflows.ts');
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          const body = await req.json() as any;
          const updated = updateWorkflow(id, body);
          if (!updated) return error('Workflow not found', 404);
          return json(updated);
        } catch (err) { return error(`${err}`); }
      },
      DELETE: (req: Request) => {
        try {
          const { deleteWorkflow } = require('../../vault/workflows.ts');
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          ctx.triggerManager?.unregisterWorkflow(id);
          deleteWorkflow(id);
          return json({ ok: true });
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/:id/versions': {
      GET: (req: Request) => {
        try {
          const { getVersionHistory } = require('../../vault/workflows.ts');
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2];
          return json(getVersionHistory(id));
        } catch (err) { return error(`${err}`); }
      },
      POST: async (req: Request) => {
        try {
          const { createVersion } = require('../../vault/workflows.ts');
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2];
          const body = await req.json() as any;
          if (!body.definition) return error('definition is required');
          const version = createVersion(id, body.definition, body.changelog);
          return json(version, 201);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/:id/execute': {
      POST: async (req: Request) => {
        if (!ctx.workflowEngine) return error('Workflow engine not available', 503);
        try {
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2];
          let triggerData: Record<string, unknown> = {};
          try { triggerData = await req.json() as any; } catch (err) {
            console.warn('[api] failed to parse trigger data JSON:', err);
          }
          const execution = await ctx.workflowEngine.execute(id!, 'manual', triggerData);
          return json(execution, 201);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/:id/executions': {
      GET: (req: Request) => {
        try {
          const { findExecutions } = require('../../vault/workflows.ts');
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2];
          return json(findExecutions({ workflow_id: id }));
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/:id/variables': {
      GET: (req: Request) => {
        try {
          const { getVariables } = require('../../vault/workflows.ts');
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2];
          return json(getVariables(id));
        } catch (err) { return error(`${err}`); }
      },
      PATCH: async (req: Request) => {
        try {
          const { setVariable, getVariables } = require('../../vault/workflows.ts');
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2];
          const body = await req.json() as Record<string, unknown>;
          for (const [key, value] of Object.entries(body)) {
            setVariable(id, key, value);
          }
          return json(getVariables(id));
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/:id/export': {
      GET: (req: Request) => {
        try {
          const { getWorkflow, getLatestVersion, getVariables } = require('../../vault/workflows.ts');
          const { exportWorkflowYaml } = require('../../workflows/yaml.ts');
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2];
          const wf = getWorkflow(id);
          if (!wf) return error('Workflow not found', 404);
          const version = getLatestVersion(id);
          if (!version) return error('No version found', 404);
          const vars = getVariables(id);
          const yaml = exportWorkflowYaml(wf, version, vars);
          return new Response(yaml, {
            headers: {
              'Content-Type': 'text/yaml',
              'Content-Disposition': `attachment; filename="${sanitizeFilename(wf.name)}.yaml"`,
            },
          });
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/executions/:executionId': {
      GET: (req: Request) => {
        try {
          const { getExecution, getStepResults } = require('../../vault/workflows.ts');
          const url = new URL(req.url);
          const executionId = url.pathname.split('/').pop()!;
          const exec = getExecution(executionId);
          if (!exec) return error('Execution not found', 404);
          const steps = getStepResults(executionId);
          return json({ ...exec, steps });
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/executions/:executionId/cancel': {
      POST: async (req: Request) => {
        if (!ctx.workflowEngine) return error('Workflow engine not available', 503);
        try {
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const executionId = parts[parts.length - 2];
          await ctx.workflowEngine.cancel(executionId!);
          return json({ ok: true });
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/nl-chat': {
      POST: async (req: Request) => {
        if (!ctx.nlBuilder) return error('NL builder not available', 503);
        try {
          const body = await req.json() as { workflowId: string; message: string; history?: Array<{ role: string; content: string }> };
          const result = await ctx.nlBuilder.chat(
            body.workflowId,
            body.message,
            (body.history ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>,
          );
          return json(result);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/suggest': {
      GET: async () => {
        if (!ctx.autoSuggest) return error('Auto-suggest not available', 503);
        try {
          const suggestions = await ctx.autoSuggest.generateSuggestions();
          return json(suggestions);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/workflows/suggest/:id/dismiss': {
      POST: async (req: Request) => {
        if (!ctx.autoSuggest) return error('Auto-suggest not available', 503);
        try {
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop() === 'dismiss'
            ? url.pathname.split('/').slice(-2, -1)[0]
            : url.pathname.split('/').pop()!;
          ctx.autoSuggest.dismiss(id!);
          return json({ ok: true });
        } catch (err) { return error(`${err}`); }
      },
    },

    // --- Webhooks ---
    '/api/webhooks/:id': {
      POST: async (req: Request) => {
        if (!ctx.webhookManager) return error('Webhook manager not available', 503);
        try {
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          return ctx.webhookManager.handleRequest(id, req);
        } catch (err) { return error(`${err}`); }
      },
      GET: async (req: Request) => {
        if (!ctx.webhookManager) return error('Webhook manager not available', 503);
        try {
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          return ctx.webhookManager.handleRequest(id, req);
        } catch (err) { return error(`${err}`); }
      },
    },

  };
}
