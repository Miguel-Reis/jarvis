/**
 * Workflow Automation Engine — Core Types
 */

// ── Node System ──

export type NodeCategory = 'trigger' | 'action' | 'logic' | 'transform' | 'error';

export type NodeConfigFieldType = 'string' | 'number' | 'boolean' | 'select' | 'code' | 'template' | 'json';

export type NodeConfigField = {
  type: NodeConfigFieldType;
  label: string;
  description?: string;
  required: boolean;
  default?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
};

// ── Workflow Definition (serialized graph) ──

export type WorkflowDefinition = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  settings: WorkflowSettings;
};

export type WorkflowNode = {
  id: string;
  type: string;                          // e.g., 'trigger.cron', 'action.http_request'
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  retryPolicy?: RetryPolicy;
  fallbackNodeId?: string;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;                 // e.g., 'true', 'false', 'default', 'error'
  condition?: string;
  label?: string;
};

export type WorkflowSettings = {
  maxRetries: number;                    // default 3
  retryDelayMs: number;                  // default 5000
  timeoutMs: number;                     // default 300000 (5 min)
  parallelism: 'sequential' | 'parallel';
  onError: 'stop' | 'continue' | 'self_heal';
};

export type RetryPolicy = {
  maxRetries: number;
  delayMs: number;
  backoff: 'fixed' | 'exponential';
};

export const DEFAULT_WORKFLOW_SETTINGS: WorkflowSettings = {
  maxRetries: 3,
  retryDelayMs: 5000,
  timeoutMs: 300_000,
  parallelism: 'parallel',
  onError: 'stop',
};

// ── Execution ──

export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting';

// ── Vault Types ──

export type Workflow = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  authority_level: number;
  authority_approved: boolean;
  approved_at: number | null;
  approved_by: string | null;
  tags: string[];
  current_version: number;
  execution_count: number;
  last_executed_at: number | null;
  last_success_at: number | null;
  last_failure_at: number | null;
  created_at: number;
  updated_at: number;
};

export type WorkflowVersion = {
  id: string;
  workflow_id: string;
  version: number;
  definition: WorkflowDefinition;
  changelog: string | null;
  created_by: string;
  created_at: number;
};

export type WorkflowExecution = {
  id: string;
  workflow_id: string;
  version: number;
  trigger_type: string;
  trigger_data: Record<string, unknown> | null;
  status: ExecutionStatus;
  variables: Record<string, unknown>;
  error_message: string | null;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
};

export type WorkflowStepResult = {
  id: string;
  execution_id: string;
  node_id: string;
  node_type: string;
  status: StepStatus;
  input_data: Record<string, unknown> | null;
  output_data: Record<string, unknown> | null;
  error_message: string | null;
  retry_count: number;
  started_at: number | null;
  completed_at: number | null;
  duration_ms: number | null;
};
