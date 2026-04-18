/**
 * Manage Workflow Tool — Chat-Driven Workflow Automation
 *
 * Allows the primary agent to create, list, run, delete, enable/disable,
 * and describe workflows directly from natural language chat.
 * Uses the NLWorkflowBuilder to parse descriptions into workflow definitions.
 */

import type { ToolDefinition } from './registry.ts';
import type { WorkflowEngine } from '../../workflows/engine.ts';
import type { NLWorkflowBuilder } from '../../workflows/nl-builder.ts';
import type { TriggerManager } from '../../workflows/triggers/manager.ts';
import * as vault from '../../vault/workflows.ts';

export type WorkflowToolDeps = {
  workflowEngine: WorkflowEngine;
  nlBuilder: NLWorkflowBuilder;
  triggerManager: TriggerManager;
};

export function createManageWorkflowTool(deps: WorkflowToolDeps): ToolDefinition {
  return {
    name: 'manage_workflow',
    description: [
      'Create, list, run, delete, enable/disable, and inspect workflow automations.',
      'Workflows are event-driven: "when X happens, do Y". They support triggers (cron, webhook, file changes, screen events),',
      'actions (HTTP requests, send messages, run tools, agent tasks), logic (if/else, loops, delays), and error handling.',
      '',
      'Actions: create, list, run, delete, enable, disable, describe',
    ].join('\n'),
    category: 'automation',
    parameters: {
      action: {
        type: 'string',
        description: 'The action: "create", "list", "run", "delete", "enable", "disable", "describe"',
        required: true,
      },
      name: {
        type: 'string',
        description: 'Workflow name (required for "create")',
        required: false,
      },
      description: {
        type: 'string',
        description: 'Natural language description of what the workflow should do (for "create"). Example: "Every morning at 9am, check my email and send a Telegram summary"',
        required: false,
      },
      workflow_id: {
        type: 'string',
        description: 'Target workflow ID (for "run", "delete", "enable", "disable", "describe")',
        required: false,
      },
    },
    execute: async (params) => {
      const action = String(params.action ?? '').toLowerCase();

      switch (action) {
        case 'create': {
          const name = params.name as string;
          const description = params.description as string;
          if (!description) return 'Error: "description" is required for create. Describe what the workflow should do in natural language.';

          try {
            // Use NL builder to parse description into a workflow definition
            const definition = await deps.nlBuilder.parseDescription(description);

            // Create the workflow in vault
            const workflow = vault.createWorkflow(
              name || 'Untitled Workflow',
              { description },
            );

            // Create first version with the generated definition
            vault.createVersion(workflow.id, definition, 'Created via chat');

            // Register triggers so cron/webhook/poll triggers activate
            try {
              deps.triggerManager.registerWorkflow(workflow.id, definition);
            } catch (triggerErr) {
              console.error('[Workflows] Failed to register triggers for', workflow.id, triggerErr);
            }

            const nodeTypes = definition.nodes.map(n => n.type).join(', ');
            return `Workflow created successfully!\n\n` +
              `- **ID**: ${workflow.id}\n` +
              `- **Name**: ${name || 'Untitled Workflow'}\n` +
              `- **Nodes**: ${definition.nodes.length} (${nodeTypes})\n` +
              `- **Edges**: ${definition.edges.length}\n` +
              `- **Version**: 1\n\n` +
              `The workflow is enabled and its triggers are active. ` +
              `You can view and edit it in the Workflows dashboard, or run it manually.`;
          } catch (err) {
            return `Failed to create workflow: ${err instanceof Error ? err.message : err}`;
          }
        }

        case 'list': {
          const workflows = vault.findWorkflows();
          if (workflows.length === 0) {
            return 'No workflows found. Use action "create" with a description to create one.';
          }

          const lines = workflows.map(wf => {
            const status = wf.enabled ? 'Active' : 'Disabled';
            const lastRun = wf.last_executed_at
              ? new Date(wf.last_executed_at).toLocaleString()
              : 'Never';
            return `- **${wf.name}** (${wf.id})\n  Status: ${status} | v${wf.current_version} | ${wf.execution_count} runs | Last: ${lastRun}`;
          });

          return `Found ${workflows.length} workflow(s):\n\n${lines.join('\n\n')}`;
        }

        case 'run': {
          const id = params.workflow_id as string;
          if (!id) return 'Error: "workflow_id" is required for run.';

          try {
            const execution = await deps.workflowEngine.execute(id, 'manual');
            return `Workflow execution started.\n\n- **Execution ID**: ${execution.id}\n- **Status**: ${execution.status}\n\nThe workflow is running in the background. Check the Workflows dashboard for real-time progress.`;
          } catch (err) {
            return `Failed to run workflow: ${err instanceof Error ? err.message : err}`;
          }
        }

        case 'delete': {
          const id = params.workflow_id as string;
          if (!id) return 'Error: "workflow_id" is required for delete.';

          try {
            const wf = vault.getWorkflow(id);
            if (!wf) return `Workflow "${id}" not found.`;

            deps.triggerManager.unregisterWorkflow(id);
            vault.deleteWorkflow(id);
            return `Workflow "${wf.name}" (${id}) has been deleted.`;
          } catch (err) {
            return `Failed to delete workflow: ${err instanceof Error ? err.message : err}`;
          }
        }

        case 'enable': {
          const id = params.workflow_id as string;
          if (!id) return 'Error: "workflow_id" is required for enable.';

          try {
            vault.updateWorkflow(id, { enabled: true });
            const version = vault.getLatestVersion(id);
            if (version) {
              deps.triggerManager.registerWorkflow(id, version.definition);
            }
            return `Workflow "${id}" is now enabled. Triggers are active.`;
          } catch (err) {
            return `Failed to enable workflow: ${err instanceof Error ? err.message : err}`;
          }
        }

        case 'disable': {
          const id = params.workflow_id as string;
          if (!id) return 'Error: "workflow_id" is required for disable.';

          try {
            vault.updateWorkflow(id, { enabled: false });
            deps.triggerManager.unregisterWorkflow(id);
            return `Workflow "${id}" is now disabled. Triggers are deactivated.`;
          } catch (err) {
            return `Failed to disable workflow: ${err instanceof Error ? err.message : err}`;
          }
        }

        case 'describe': {
          const id = params.workflow_id as string;
          if (!id) return 'Error: "workflow_id" is required for describe.';

          try {
            const wf = vault.getWorkflow(id);
            if (!wf) return `Workflow "${id}" not found.`;

            const version = vault.getLatestVersion(id);
            const def = version?.definition;

            let result = `**${wf.name}** (${wf.id})\n\n`;
            if (wf.description) result += `${wf.description}\n\n`;
            result += `- Status: ${wf.enabled ? 'Active' : 'Disabled'}\n`;
            result += `- Version: ${wf.current_version}\n`;
            result += `- Executions: ${wf.execution_count}\n`;
            if (wf.tags.length > 0) result += `- Tags: ${wf.tags.join(', ')}\n`;

            if (def) {
              result += `\n**Nodes (${def.nodes.length}):**\n`;
              for (const node of def.nodes) {
                result += `  - ${node.label} (${node.type})\n`;
              }
              result += `\n**Connections (${def.edges.length}):**\n`;
              for (const edge of def.edges) {
                const srcNode = def.nodes.find(n => n.id === edge.source);
                const tgtNode = def.nodes.find(n => n.id === edge.target);
                result += `  - ${srcNode?.label ?? edge.source} → ${tgtNode?.label ?? edge.target}`;
                if (edge.sourceHandle) result += ` [${edge.sourceHandle}]`;
                result += '\n';
              }
              result += `\n**Settings:** retries=${def.settings.maxRetries}, timeout=${def.settings.timeoutMs}ms, onError=${def.settings.onError}`;
            }

            return result;
          } catch (err) {
            return `Failed to describe workflow: ${err instanceof Error ? err.message : err}`;
          }
        }

        default:
          return `Unknown action "${action}". Available actions: create, list, run, delete, enable, disable, describe`;
      }
    },
  };
}
