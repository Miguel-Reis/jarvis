/**
 * Workflow Event Types — for real-time WebSocket broadcasting
 */

export type WorkflowEventType =
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'execution_cancelled'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'variable_changed'
  | 'workflow_enabled'
  | 'workflow_disabled';

export type WorkflowEvent = {
  type: WorkflowEventType;
  workflowId: string;
  executionId?: string;
  nodeId?: string;
  data: Record<string, unknown>;
  timestamp: number;
};
