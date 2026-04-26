# J.A.R.V.I.S. Workflow Automation Engine

Complete guide to the workflow automation system — visual builder, natural language creation, 50+ nodes, self-healing execution.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Node Library](#node-library)
5. [Trigger System](#trigger-system)
6. [Execution Engine](#execution-engine)
7. [Template Expressions](#template-expressions)
8. [Variables](#variables)
9. [NL Builder](#nl-builder)
10. [Auto-Suggestions](#auto-suggestions)
11. [Dashboard UI](#dashboard-ui)
12. [Chat Integration](#chat-integration)
13. [API Reference](#api-reference)
14. [YAML Export/Import](#yaml-exportimport)
15. [Testing](#testing)

## Overview

The workflow automation engine provides event-driven automations for JARVIS. Workflows are directed graphs of nodes — triggers, actions, logic, transforms, and error handlers — connected by edges. They run in the background, respond to events, and self-heal when things go wrong.

### Key Features

- **50+ built-in nodes** across 5 categories (triggers, actions, logic, transform, error)
- **4 creation methods**: chat, visual builder, AI sidebar, REST API
- **Trigger system**: cron, webhook, file watch, screen events, polling, clipboard, process, git, email, calendar
- **Self-healing execution**: retry → fallback → AI-powered auto-fix
- **Template engine**: `{{$node["id"].data.field}}` expressions for dynamic data flow
- **Version history**: every save creates a new version with diff comparison
- **Real-time monitoring**: WebSocket events for step-by-step execution tracking
- **Auto-suggestions**: JARVIS analyzes your behavior and proposes automations

## Quick Start

### 1. Create via chat (fastest)

Tell JARVIS in the main chat:

```
"Create a workflow that checks my GitHub PRs every morning at 9am
and sends me a Telegram summary"
```

JARVIS calls the `manage_workflow` tool, which:
1. Parses your description via the NL builder
2. Creates a `WorkflowDefinition` with appropriate nodes and edges
3. Persists it in the vault
4. Registers triggers (cron, in this case)

### 2. Create via visual builder

1. Open the dashboard at `http://localhost:3142`
2. Click **Workflows** in the sidebar
3. Click **New Workflow**
4. Drag nodes from the left palette onto the canvas
5. Connect nodes by dragging from output handles to input handles
6. Configure nodes in the right panel (Config tab)
7. Changes auto-save every 2 seconds

### 3. Create via API

```bash
# Create workflow
curl -X POST http://localhost:3142/api/workflows \
  -H "Content-Type: application/json" \
  -d '{"name": "My Workflow"}'

# Create version with definition
curl -X POST http://localhost:3142/api/workflows/{id}/versions \
  -H "Content-Type: application/json" \
  -d '{
    "definition": {
      "nodes": [...],
      "edges": [...],
      "settings": { "maxRetries": 3, "timeoutMs": 300000, "onError": "stop" }
    },
    "changelog": "Initial version"
  }'

# Execute
curl -X POST http://localhost:3142/api/workflows/{id}/execute
```

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                         Daemon (index.ts)                          │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐│
│  │ WorkflowEngine│  │ TriggerManager│  │ manage_workflow (tool)   ││
│  │  .execute()  │  │  .register() │  │  chat → NL builder → vault││
│  └──────┬───────┘  └──────┬───────┘  └───────────────────────────┘│
│         │                 │                                        │
│  ┌──────▼───────┐  ┌──────▼───────────────────────────────────┐   │
│  │  Executor    │  │  Trigger Sources                         │   │
│  │  .runNode()  │  │  CronScheduler | WebhookManager | Poller │   │
│  │  .selfHeal() │  │  ObserverBridge | fs.watch              │   │
│  └──────┬───────┘  └─────────────────────────────────────────┘   │
│         │                                                         │
│  ┌──────▼───────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ NodeRegistry │  │ NLBuilder    │  │ AutoSuggest            │  │
│  │ 50+ nodes    │  │ NL → graph   │  │ patterns → suggestions │  │
│  └──────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Vault (SQLite)                                             │   │
│  │ workflows | workflow_versions | workflow_executions | vars  │   │
│  └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| WorkflowEngine | `src/workflows/engine.ts` | Service interface — load, execute, manage workflows |
| Executor | `src/workflows/executor.ts` | Node-level execution with topo sort, self-heal |
| NodeRegistry | `src/workflows/nodes/registry.ts` | 50+ node implementations registered here |
| TriggerManager | `src/workflows/triggers/manager.ts` | Coordinates all trigger sources |
| CronScheduler | `src/workflows/triggers/cron.ts` | Cron-based scheduling |
| WebhookManager | `src/workflows/triggers/webhook.ts` | Inbound HTTP webhooks |
| PollingEngine | `src/workflows/triggers/poller.ts` | HTTP polling with dedup |
| ObserverBridge | `src/workflows/triggers/observer-bridge.ts` | Screen/clipboard/process triggers |
| ScreenConditionEvaluator | `src/workflows/triggers/screen-condition.ts` | Visual condition checking (text, app, LLM) |
| NLWorkflowBuilder | `src/workflows/nl-builder.ts` | Natural language → WorkflowDefinition |
| WorkflowAutoSuggest | `src/workflows/auto-suggest.ts` | Behavior pattern → workflow suggestions |
| TemplateContext | `src/workflows/template.ts` | `{{...}}` expression resolution |
| VariableScope | `src/workflows/variables.ts` | Execution + persistent variable scoping |
| Vault | `src/vault/workflows.ts` | SQLite CRUD for workflows, versions, executions |

## Node Library

### Triggers (11)

| Node | Config | Description |
|------|--------|-------------|
| `trigger.cron` | `expression` | Cron schedule (e.g., `0 9 * * *`) |
| `trigger.webhook` | `method`, `secret` | Inbound HTTP endpoint, optional HMAC |
| `trigger.poll` | `url`, `interval_ms`, `method` | HTTP polling with deduplication |
| `trigger.manual` | — | Manual execution via dashboard/API |
| `trigger.file_change` | `path`, `events` | File system create/modify/delete |
| `trigger.clipboard` | `pattern` | Clipboard content changes |
| `trigger.process` | `process_name`, `event` | Process start/stop |
| `trigger.email` | `from_filter`, `subject_filter` | Email received |
| `trigger.calendar` | `calendar_id`, `minutes_before` | Calendar event approaching |
| `trigger.screen` | `condition_type`, `text`/`app_name`/`prompt` | Screen condition (text_present, app_active, llm_check) |
| `trigger.git` | `repo_path`, `events` | Git push/commit events |

### Actions (12)

| Node | Config | Description |
|------|--------|-------------|
| `action.send_message` | `channel`, `message` | Send via any channel (chat, Telegram, Discord) |
| `action.run_tool` | `tool_name`, `params` | Execute any registered JARVIS tool |
| `action.agent_task` | `task`, `role` | Spawn a sub-agent for complex reasoning |
| `action.http_request` | `url`, `method`, `headers`, `body` | Full HTTP request |
| `action.file_write` | `path`, `content`, `mode` | Write/append to file |
| `action.notification` | `title`, `message`, `channel` | Desktop/channel notification |
| `action.gmail` | `to`, `subject`, `body` | Send Gmail |
| `action.calendar_action` | `action`, `title`, `start`, `end` | Create/update calendar events |
| `action.telegram` | `chat_id`, `message` | Send Telegram message |
| `action.discord` | `channel_id`, `message` | Send Discord message |
| `action.shell_command` | `command`, `cwd`, `timeout` | Execute shell command |
| `action.code_execution` | `code`, `language` | Run JavaScript code |

### Logic (9)

| Node | Config | Description |
|------|--------|-------------|
| `logic.if_else` | `condition` | Conditional branch (true/false outputs) |
| `logic.switch` | `expression`, `cases` | Multi-way branching |
| `logic.loop` | `items`, `variable` | Iterate over arrays |
| `logic.delay` | `duration_ms` | Wait for a duration |
| `logic.merge` | `strategy` | Combine multiple inputs |
| `logic.race` | — | First-to-complete wins |
| `logic.variable_set` | `name`, `value`, `scope` | Set a variable |
| `logic.variable_get` | `name`, `scope` | Read a variable |
| `logic.template_render` | `template` | Render template string |

### Transform (5)

| Node | Config | Description |
|------|--------|-------------|
| `transform.json_parse` | `path` | Parse JSON, optional JSONPath |
| `transform.csv_parse` | `delimiter`, `has_headers` | Parse CSV data |
| `transform.regex_match` | `pattern`, `flags` | Extract with regex |
| `transform.aggregate` | `operation`, `field` | Sum, average, count, min, max |
| `transform.map_filter` | `map_expression`, `filter_condition` | Map and filter arrays |

### Error Handling (3)

| Node | Config | Description |
|------|--------|-------------|
| `error.error_handler` | — | Catch errors from upstream nodes |
| `error.retry` | `max_retries`, `delay_ms`, `backoff` | Retry with configurable policy |
| `error.fallback` | `fallback_value` | Provide default value on failure |

## Trigger System

### CronScheduler

Parses cron expressions and schedules recurring jobs. Each cron trigger gets a unique job ID (`{workflowId}:{nodeId}`).

```typescript
// Cron expression format: minute hour day month weekday
// Examples:
"0 9 * * *"      // Daily at 9:00 AM
"*/15 * * * *"   // Every 15 minutes
"0 0 * * 1"      // Every Monday at midnight
```

### WebhookManager

Registers HTTP endpoints at `/api/webhooks/{workflowId}`. Supports:
- GET and POST methods
- Optional HMAC-SHA256 signature validation via `secret` config
- Request body + headers passed as trigger data

### PollingEngine

Polls HTTP endpoints at configurable intervals. Features:
- Response hash-based deduplication (only fires when response changes)
- Configurable interval (default: 60 seconds)
- Request method, headers, body configuration

### ObserverBridge

Bridges the Awareness system (M13) to workflow triggers:
- **Screen conditions**: text present/absent, app active, LLM visual check
- **Clipboard**: fires on clipboard content changes
- **Process**: fires on process start/stop events

Screen conditions use the `ScreenConditionEvaluator` which supports:
- `text_present` / `text_absent` — instant OCR text matching
- `app_active` — instant app name matching (partial match supported)
- `visual_match` — LLM-backed visual description matching
- `llm_check` — custom LLM prompt for complex conditions

## Execution Engine

### Topological Sort

The executor builds a dependency graph from the workflow edges and processes nodes in topological order. Nodes at the same depth level can run in parallel (controlled by `parallelism` setting: `"parallel"` or `"sequential"`).

### Step Execution

For each node:
1. Collect output data from all incoming edges
2. Merge into a single input object
3. Resolve `{{...}}` template expressions in the node config
4. Call `node.execute(config, context)` on the node implementation
5. Store output in the execution context
6. Route to downstream nodes based on the node's output handle

### Error Handling Modes

| Mode | Behavior |
|------|----------|
| `stop` | Halt entire workflow on first node failure |
| `continue` | Log the error, skip the node, continue with remaining nodes |
| `self_heal` | After all retries exhausted, send error + config to LLM for auto-fix |

### Self-Heal Flow

```
Node fails → retry (up to maxRetries) → all retries fail →
  LLM analyzes: { error, nodeType, config } →
  LLM returns: { fixedConfig, explanation } →
  Re-execute with fixedConfig →
  If success: persist fixedConfig for future runs
```

### WebSocket Events

During execution, the engine emits real-time events over WebSocket:

```typescript
type WorkflowEvent = {
  workflowId: string;
  executionId: string;
  type: 'started' | 'step_started' | 'step_completed' | 'step_failed' | 'completed' | 'failed';
  nodeId?: string;
  data?: unknown;
  timestamp: number;
};
```

## Template Expressions

Node configs support `{{...}}` template expressions resolved at execution time:

| Expression | Description |
|-----------|-------------|
| `{{myVariable}}` | Read an execution variable |
| `{{$trigger.field}}` | Access trigger output data |
| `{{$node["node-id"].data.field}}` | Access another node's output |
| `{{$env.MY_VAR}}` | Read an environment variable |
| `{{$execution.id}}` | Current execution ID |

Expressions are resolved recursively — nested objects and arrays are traversed.

## Variables

Two scopes:

- **Execution** — in-memory, scoped to a single workflow run. Set via `logic.variable_set` with `scope: "execution"`.
- **Persistent** — stored in SQLite vault, survive across executions. Set via `logic.variable_set` with `scope: "persistent"` or the Variables API.

```bash
# Read persistent variables
curl http://localhost:3142/api/workflows/{id}/variables

# Set persistent variables
curl -X PATCH http://localhost:3142/api/workflows/{id}/variables \
  -H "Content-Type: application/json" \
  -d '{"counter": 42, "lastRun": "2026-03-02"}'
```

## NL Builder

The `NLWorkflowBuilder` parses natural language descriptions into `WorkflowDefinition` objects. It uses a multi-step LLM pipeline:

1. **Parse intent** — extract trigger type, actions, conditions from the description
2. **Map to nodes** — select appropriate node types from the registry
3. **Generate config** — fill in node configs from the description context
4. **Wire graph** — create edges between nodes in logical order
5. **Validate** — ensure the definition is well-formed

The builder is used by:
- The `manage_workflow` tool (chat-driven creation)
- The NL chat sidebar in the canvas editor
- The `/api/workflows/nl-chat` endpoint

## Auto-Suggestions

The `WorkflowAutoSuggest` engine accumulates awareness events and detects patterns:

| Pattern | Detection Method | Example |
|---------|-----------------|---------|
| App switches | Frequency of A→B pairs (5+ times) | "You switch Chrome→VS Code 15 times/day" |
| Recurring errors | Error count by app (3+ errors) | "Docker has 7 errors — auto-restart?" |
| Scheduled behavior | Events clustered by hour (3+ same hour) | "You check Slack at 9am daily — automate?" |
| Complex patterns | LLM analysis of 100+ events | "You research, then code, then test — pipeline?" |

Suggestions include a `previewDefinition` — a ready-to-use workflow definition that can be accepted with one click. The engine has a 5-minute cooldown between analyses and maintains up to 500 events.

## Dashboard UI

### Workflow List

The Workflows page (`/workflows` route) shows:
- All workflows with name, status (active/disabled), execution count, last run time
- Quick actions: Run, Pause/Resume, Delete
- "New Workflow" button

### Canvas Editor

The visual editor uses ReactFlow and has three panels:

**Left: Node Palette** (collapsible)
- Nodes organized by category: Triggers, Actions, Logic, Transform, Error Handling
- Search bar for filtering
- Drag-and-drop onto canvas

**Center: Canvas**
- Visual node graph with color-coded nodes
- Zoom, pan, minimap
- Connect nodes by dragging between handles
- Auto-save every 2 seconds

**Right: Tabbed Panel** (collapsible)
- **Config** — dynamic form generated from node's `configSchema`
- **Executions** — real-time execution monitoring with step status
- **Versions** — version history with inline diffs (nodes added/removed/modified)
- **AI** — NL chat sidebar for conversational workflow editing

## Chat Integration

The `manage_workflow` tool is registered on the primary agent's tool registry. It provides:

```typescript
type WorkflowToolActions = {
  create: { name: string; description: string };  // NL → workflow
  list: {};                                         // List all workflows
  run: { workflow_id: string };                     // Execute manually
  delete: { workflow_id: string };                  // Delete workflow
  enable: { workflow_id: string };                  // Enable + register triggers
  disable: { workflow_id: string };                 // Disable + unregister triggers
  describe: { workflow_id: string };                // Get full description
};
```

Source: `src/actions/tools/workflows.ts`

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workflows` | List all workflows |
| POST | `/api/workflows` | Create workflow |
| GET | `/api/workflows/:id` | Get workflow |
| PATCH | `/api/workflows/:id` | Update workflow |
| DELETE | `/api/workflows/:id` | Delete workflow |
| GET | `/api/workflows/:id/versions` | Version history |
| POST | `/api/workflows/:id/versions` | Create version |
| POST | `/api/workflows/:id/execute` | Run workflow |
| GET | `/api/workflows/:id/executions` | Execution history |
| GET | `/api/workflows/:id/variables` | Read persistent variables |
| PATCH | `/api/workflows/:id/variables` | Set persistent variables |
| GET | `/api/workflows/:id/export` | YAML export |
| POST | `/api/workflows/import` | YAML import |
| GET | `/api/workflows/nodes` | Node catalog (all 50+ nodes) |
| POST | `/api/workflows/nl-chat` | NL builder chat |
| GET | `/api/workflows/suggest` | Auto-suggestions |
| POST | `/api/workflows/suggest/:id/dismiss` | Dismiss a suggestion |
| GET/POST | `/api/webhooks/:id` | Inbound webhooks |

## YAML Export/Import

Workflows can be exported as YAML for version control, sharing, or backup:

```bash
# Export
curl http://localhost:3142/api/workflows/{id}/export

# Import
curl -X POST http://localhost:3142/api/workflows/import \
  -H "Content-Type: application/json" \
  -d '{"yaml": "name: My Workflow\nnodes:\n  ..."}'
```

## Testing

The workflow system has comprehensive tests:

```bash
# Run all workflow tests
bun test src/workflows/

# Run specific test files
bun test src/workflows/workflows.test.ts       # Core engine tests
bun test src/workflows/triggers/triggers.test.ts # Trigger system tests
```

Test coverage includes:
- Node execution (all 50+ node types)
- Template expression resolution
- Variable scoping (execution + persistent)
- Topological sort and parallel execution
- Trigger registration/unregistration
- Cron scheduling and webhook handling
- Error handling modes (stop, continue, self_heal)
- YAML serialization/deserialization
- Version management and diffing

## Source Files

```
src/workflows/
├── types.ts              # Core type definitions
├── engine.ts             # WorkflowEngine service
├── executor.ts           # Node execution + self-heal
├── nl-builder.ts         # Natural language → definition
├── auto-suggest.ts       # Behavior pattern detection
├── template.ts           # Template expression engine
├── variables.ts          # Variable scoping
├── yaml.ts               # YAML export/import
├── events.ts             # WebSocket event types
├── nodes/
│   ├── registry.ts       # Node registry + ExecutionContext
│   ├── builtin.ts        # Registers all built-in nodes
│   ├── triggers/         # 11 trigger node implementations
│   ├── actions/          # 12 action node implementations
│   ├── logic/            # 9 logic node implementations
│   ├── transform/        # 5 transform node implementations
│   └── error/            # 3 error handling node implementations
├── triggers/
│   ├── manager.ts        # TriggerManager (coordinates all sources)
│   ├── cron.ts           # CronScheduler
│   ├── webhook.ts        # WebhookManager
│   ├── poller.ts         # PollingEngine
│   ├── observer-bridge.ts # Awareness integration
│   └── screen-condition.ts # Visual condition evaluator
├── workflows.test.ts     # Core tests
└── triggers/triggers.test.ts # Trigger tests

src/vault/workflows.ts    # SQLite persistence (CRUD)
src/vault/schema.ts       # DB schema (tables)
src/actions/tools/workflows.ts # manage_workflow chat tool
src/daemon/api-routes.ts  # REST API endpoints
src/daemon/index.ts       # Daemon wiring

ui/src/pages/WorkflowsPage.tsx           # Workflow list page
ui/src/components/workflows/
├── WorkflowList.tsx      # Workflow list component
├── WorkflowCanvas.tsx    # ReactFlow canvas editor
├── WorkflowNode.tsx      # Custom node component
├── NodePalette.tsx       # Draggable node sidebar
├── NodeProperties.tsx    # Dynamic config form
├── ExecutionMonitor.tsx  # Real-time execution view
├── VersionHistory.tsx    # Version list with diff
└── NLChatSidebar.tsx     # AI chat panel
```
