/**
 * Built-in Node Library — Phase 3
 *
 * Imports all node definitions and registers them into a NodeRegistry instance.
 * Call registerBuiltinNodes(registry) once at startup.
 */

import type { NodeRegistry } from './registry.ts';

// ── Triggers ──────────────────────────────────────────────────────────────────
import { cronTrigger }        from './triggers/cron.ts';
import { webhookTrigger }     from './triggers/webhook.ts';
import { emailTrigger }       from './triggers/email.ts';
import { fileChangeTrigger }  from './triggers/file-change.ts';
import { screenEventTrigger } from './triggers/screen-event.ts';
import { manualTrigger }      from './triggers/manual.ts';
import { gitTrigger }         from './triggers/git.ts';
import { clipboardTrigger }   from './triggers/clipboard.ts';
import { processTrigger }     from './triggers/process.ts';
import { calendarTrigger }    from './triggers/calendar.ts';
import { pollTrigger }        from './triggers/poll.ts';
import { messageTrigger }     from './triggers/message.ts';
import { goalUpdateTrigger }  from './triggers/goal-update.ts';

// ── Actions ───────────────────────────────────────────────────────────────────
import { sendMessageAction }   from './actions/send-message.ts';
import { runToolAction }       from './actions/run-tool.ts';
import { agentTaskAction }     from './actions/agent-task.ts';
import { httpRequestAction }   from './actions/http-request.ts';
import { fileWriteAction }     from './actions/file-write.ts';
import { notificationAction }  from './actions/notification.ts';
import { gmailAction }         from './actions/gmail.ts';
import { calendarActionNode }  from './actions/calendar-action.ts';
import { telegramAction }      from './actions/telegram.ts';
import { discordAction }       from './actions/discord.ts';
import { shellCommandAction }  from './actions/shell-command.ts';
import { codeExecutionAction } from './actions/code-execution.ts';

// ── Logic ─────────────────────────────────────────────────────────────────────
import { ifElseNode }         from './logic/if-else.ts';
import { switchNode }         from './logic/switch.ts';
import { loopNode }           from './logic/loop.ts';
import { delayNode }          from './logic/delay.ts';
import { mergeNode }          from './logic/merge.ts';
import { raceNode }           from './logic/race.ts';
import { variableSetNode }    from './logic/variable-set.ts';
import { variableGetNode }    from './logic/variable-get.ts';
import { templateRenderNode } from './logic/template-render.ts';

// ── Transform ─────────────────────────────────────────────────────────────────
import { jsonParseTransform }  from './transform/json-parse.ts';
import { csvParseTransform }   from './transform/csv-parse.ts';
import { regexMatchTransform } from './transform/regex-match.ts';
import { aggregateTransform }  from './transform/aggregate.ts';
import { mapFilterTransform }  from './transform/map-filter.ts';

// ── Error ─────────────────────────────────────────────────────────────────────
import { errorHandlerNode } from './error/error-handler.ts';
import { retryNode }        from './error/retry.ts';
import { fallbackNode }     from './error/fallback.ts';

/**
 * Register all built-in nodes into the provided NodeRegistry.
 * Throws if any node type is already registered (duplicate detection).
 */
export function registerBuiltinNodes(registry: NodeRegistry): void {
  // Triggers
  registry.register(cronTrigger);
  registry.register(webhookTrigger);
  registry.register(emailTrigger);
  registry.register(fileChangeTrigger);
  registry.register(screenEventTrigger);
  registry.register(manualTrigger);
  registry.register(gitTrigger);
  registry.register(clipboardTrigger);
  registry.register(processTrigger);
  registry.register(calendarTrigger);
  registry.register(pollTrigger);
  registry.register(messageTrigger);
  registry.register(goalUpdateTrigger);

  // Actions
  registry.register(sendMessageAction);
  registry.register(runToolAction);
  registry.register(agentTaskAction);
  registry.register(httpRequestAction);
  registry.register(fileWriteAction);
  registry.register(notificationAction);
  registry.register(gmailAction);
  registry.register(calendarActionNode);
  registry.register(telegramAction);
  registry.register(discordAction);
  registry.register(shellCommandAction);
  registry.register(codeExecutionAction);

  // Logic
  registry.register(ifElseNode);
  registry.register(switchNode);
  registry.register(loopNode);
  registry.register(delayNode);
  registry.register(mergeNode);
  registry.register(raceNode);
  registry.register(variableSetNode);
  registry.register(variableGetNode);
  registry.register(templateRenderNode);

  // Transform
  registry.register(jsonParseTransform);
  registry.register(csvParseTransform);
  registry.register(regexMatchTransform);
  registry.register(aggregateTransform);
  registry.register(mapFilterTransform);

  // Error
  registry.register(errorHandlerNode);
  registry.register(retryNode);
  registry.register(fallbackNode);
}

/**
 * Convenience: total number of built-in nodes across all categories.
 */
export const BUILTIN_NODE_COUNT = 40;
