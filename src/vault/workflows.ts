/**
 * Workflow Vault — CRUD operations for workflow automation engine
 */

import { getDb, generateId } from './schema.ts';
import type {
  Workflow, WorkflowVersion, WorkflowExecution, WorkflowStepResult,
  WorkflowDefinition, ExecutionStatus, StepStatus,
} from '../workflows/types.ts';

// ── Row types (raw DB) ──

type WorkflowRow = Omit<Workflow, 'enabled' | 'authority_approved' | 'tags'> & {
  enabled: number;
  authority_approved: number;
  tags: string | null;
};

type VersionRow = Omit<WorkflowVersion, 'definition'> & { definition: string };
type ExecutionRow = Omit<WorkflowExecution, 'trigger_data' | 'variables'> & {
  trigger_data: string | null;
  variables: string | null;
};
type StepRow = Omit<WorkflowStepResult, 'input_data' | 'output_data'> & {
  input_data: string | null;
  output_data: string | null;
};

// ── Parsers ──

function parseWorkflow(row: WorkflowRow): Workflow {
  return {
    ...row,
    enabled: row.enabled === 1,
    authority_approved: row.authority_approved === 1,
    tags: row.tags ? JSON.parse(row.tags) : [],
  };
}

function parseVersion(row: VersionRow): WorkflowVersion {
  return { ...row, definition: JSON.parse(row.definition) };
}

function parseExecution(row: ExecutionRow): WorkflowExecution {
  return {
    ...row,
    trigger_data: row.trigger_data ? JSON.parse(row.trigger_data) : null,
    variables: row.variables ? JSON.parse(row.variables) : {},
  };
}

function parseStep(row: StepRow): WorkflowStepResult {
  return {
    ...row,
    input_data: row.input_data ? JSON.parse(row.input_data) : null,
    output_data: row.output_data ? JSON.parse(row.output_data) : null,
  };
}

// ── Workflows ──

export function createWorkflow(
  name: string,
  opts?: {
    description?: string;
    authority_level?: number;
    tags?: string[];
    enabled?: boolean;
  }
): Workflow {
  const db = getDb();
  const id = generateId();
  const now = Date.now();

  db.prepare(
    `INSERT INTO workflows (id, name, description, enabled, authority_level, authority_approved, tags, current_version, execution_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, 1, 0, ?, ?)`
  ).run(
    id, name,
    opts?.description ?? '',
    opts?.enabled !== false ? 1 : 0,
    opts?.authority_level ?? 3,
    opts?.tags ? JSON.stringify(opts.tags) : null,
    now, now,
  );

  return {
    id, name,
    description: opts?.description ?? '',
    enabled: opts?.enabled !== false,
    authority_level: opts?.authority_level ?? 3,
    authority_approved: false,
    approved_at: null,
    approved_by: null,
    tags: opts?.tags ?? [],
    current_version: 1,
    execution_count: 0,
    last_executed_at: null,
    last_success_at: null,
    last_failure_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function getWorkflow(id: string): Workflow | null {
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | null;
  return row ? parseWorkflow(row) : null;
}

export function findWorkflows(query?: {
  enabled?: boolean;
  tag?: string;
  limit?: number;
}): Workflow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query?.enabled !== undefined) {
    conditions.push('enabled = ?');
    params.push(query.enabled ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitVal = query?.limit ? Math.max(1, Math.min(parseInt(String(query.limit), 10) || 100, 1000)) : null;
  const limitClause = limitVal ? 'LIMIT ?' : '';
  if (limitVal) params.push(limitVal);
  const rows = getDb().prepare(`SELECT * FROM workflows ${where} ORDER BY updated_at DESC ${limitClause}`).all(...params as any[]) as WorkflowRow[];

  let result = rows.map(parseWorkflow);
  if (query?.tag) {
    result = result.filter(w => w.tags.includes(query.tag!));
  }
  return result;
}

export function updateWorkflow(
  id: string,
  updates: Partial<Pick<Workflow, 'name' | 'description' | 'enabled' | 'authority_level' | 'authority_approved' | 'approved_at' | 'approved_by' | 'tags' | 'current_version' | 'execution_count' | 'last_executed_at' | 'last_success_at' | 'last_failure_at'>>
): Workflow | null {
  const existing = getWorkflow(id);
  if (!existing) return null;

  const db = getDb();
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [Date.now()];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
  if (updates.authority_level !== undefined) { sets.push('authority_level = ?'); params.push(updates.authority_level); }
  if (updates.authority_approved !== undefined) { sets.push('authority_approved = ?'); params.push(updates.authority_approved ? 1 : 0); }
  if (updates.approved_at !== undefined) { sets.push('approved_at = ?'); params.push(updates.approved_at); }
  if (updates.approved_by !== undefined) { sets.push('approved_by = ?'); params.push(updates.approved_by); }
  if (updates.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
  if (updates.current_version !== undefined) { sets.push('current_version = ?'); params.push(updates.current_version); }
  if (updates.execution_count !== undefined) { sets.push('execution_count = ?'); params.push(updates.execution_count); }
  if (updates.last_executed_at !== undefined) { sets.push('last_executed_at = ?'); params.push(updates.last_executed_at); }
  if (updates.last_success_at !== undefined) { sets.push('last_success_at = ?'); params.push(updates.last_success_at); }
  if (updates.last_failure_at !== undefined) { sets.push('last_failure_at = ?'); params.push(updates.last_failure_at); }

  params.push(id);
  db.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`).run(...params as any[]);
  return getWorkflow(id);
}

export function deleteWorkflow(id: string): boolean {
  const result = getDb().prepare('DELETE FROM workflows WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Versions ──

export function createVersion(
  workflowId: string,
  definition: WorkflowDefinition,
  changelog?: string,
  createdBy?: string,
): WorkflowVersion {
  const db = getDb();
  const id = generateId();
  const now = Date.now();

  // Get next version number
  const latest = db.prepare(
    'SELECT MAX(version) as max_v FROM workflow_versions WHERE workflow_id = ?'
  ).get(workflowId) as { max_v: number | null } | null;
  const version = (latest?.max_v ?? 0) + 1;

  db.prepare(
    `INSERT INTO workflow_versions (id, workflow_id, version, definition, changelog, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, workflowId, version, JSON.stringify(definition), changelog ?? null, createdBy ?? 'user', now);

  // Update current_version on workflow
  db.prepare('UPDATE workflows SET current_version = ?, updated_at = ? WHERE id = ?').run(version, now, workflowId);

  return { id, workflow_id: workflowId, version, definition, changelog: changelog ?? null, created_by: createdBy ?? 'user', created_at: now };
}

export function getVersion(workflowId: string, version: number): WorkflowVersion | null {
  const row = getDb().prepare(
    'SELECT * FROM workflow_versions WHERE workflow_id = ? AND version = ?'
  ).get(workflowId, version) as VersionRow | null;
  return row ? parseVersion(row) : null;
}

export function getLatestVersion(workflowId: string): WorkflowVersion | null {
  const row = getDb().prepare(
    'SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC LIMIT 1'
  ).get(workflowId) as VersionRow | null;
  return row ? parseVersion(row) : null;
}

export function getVersionHistory(workflowId: string): WorkflowVersion[] {
  const rows = getDb().prepare(
    'SELECT * FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC'
  ).all(workflowId) as VersionRow[];
  return rows.map(parseVersion);
}

// ── Executions ──

export function createExecution(
  workflowId: string,
  version: number,
  triggerType: string,
  triggerData?: Record<string, unknown>,
): WorkflowExecution {
  const db = getDb();
  const id = generateId();
  const now = Date.now();

  db.prepare(
    `INSERT INTO workflow_executions (id, workflow_id, version, trigger_type, trigger_data, status, variables, started_at)
     VALUES (?, ?, ?, ?, ?, 'running', '{}', ?)`
  ).run(id, workflowId, version, triggerType, triggerData ? JSON.stringify(triggerData) : null, now);

  // Bump execution count
  db.prepare(
    'UPDATE workflows SET execution_count = execution_count + 1, last_executed_at = ?, updated_at = ? WHERE id = ?'
  ).run(now, now, workflowId);

  return {
    id, workflow_id: workflowId, version, trigger_type: triggerType,
    trigger_data: triggerData ?? null, status: 'running', variables: {},
    error_message: null, started_at: now, completed_at: null, duration_ms: null,
  };
}

export function getExecution(id: string): WorkflowExecution | null {
  const row = getDb().prepare('SELECT * FROM workflow_executions WHERE id = ?').get(id) as ExecutionRow | null;
  return row ? parseExecution(row) : null;
}

export function updateExecution(
  id: string,
  updates: Partial<Pick<WorkflowExecution, 'status' | 'variables' | 'error_message' | 'completed_at' | 'duration_ms'>>
): WorkflowExecution | null {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.variables !== undefined) { sets.push('variables = ?'); params.push(JSON.stringify(updates.variables)); }
  if (updates.error_message !== undefined) { sets.push('error_message = ?'); params.push(updates.error_message); }
  if (updates.completed_at !== undefined) { sets.push('completed_at = ?'); params.push(updates.completed_at); }
  if (updates.duration_ms !== undefined) { sets.push('duration_ms = ?'); params.push(updates.duration_ms); }

  if (sets.length === 0) return getExecution(id);

  params.push(id);
  db.prepare(`UPDATE workflow_executions SET ${sets.join(', ')} WHERE id = ?`).run(...params as any[]);

  // Update workflow success/failure timestamps
  if (updates.status === 'completed' || updates.status === 'failed') {
    const exec = getExecution(id);
    if (exec) {
      const field = updates.status === 'completed' ? 'last_success_at' : 'last_failure_at';
      db.prepare(`UPDATE workflows SET ${field} = ?, updated_at = ? WHERE id = ?`).run(Date.now(), Date.now(), exec.workflow_id);
    }
  }

  return getExecution(id);
}

export function findExecutions(query: {
  workflow_id?: string;
  status?: ExecutionStatus;
  limit?: number;
}): WorkflowExecution[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.workflow_id) { conditions.push('workflow_id = ?'); params.push(query.workflow_id); }
  if (query.status) { conditions.push('status = ?'); params.push(query.status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitVal = Math.max(1, Math.min(parseInt(String(query.limit ?? 100), 10) || 100, 1000));
  params.push(limitVal);
  const rows = getDb().prepare(`SELECT * FROM workflow_executions ${where} ORDER BY started_at DESC LIMIT ?`).all(...params as any[]) as ExecutionRow[];
  return rows.map(parseExecution);
}

// ── Step Results ──

export function createStepResult(
  executionId: string,
  nodeId: string,
  nodeType: string,
): WorkflowStepResult {
  const db = getDb();
  const id = generateId();

  db.prepare(
    `INSERT INTO workflow_step_results (id, execution_id, node_id, node_type, status, retry_count)
     VALUES (?, ?, ?, ?, 'pending', 0)`
  ).run(id, executionId, nodeId, nodeType);

  return {
    id, execution_id: executionId, node_id: nodeId, node_type: nodeType,
    status: 'pending', input_data: null, output_data: null, error_message: null,
    retry_count: 0, started_at: null, completed_at: null, duration_ms: null,
  };
}

export function updateStepResult(
  id: string,
  updates: Partial<Pick<WorkflowStepResult, 'status' | 'input_data' | 'output_data' | 'error_message' | 'retry_count' | 'started_at' | 'completed_at' | 'duration_ms'>>
): WorkflowStepResult | null {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.input_data !== undefined) { sets.push('input_data = ?'); params.push(JSON.stringify(updates.input_data)); }
  if (updates.output_data !== undefined) { sets.push('output_data = ?'); params.push(JSON.stringify(updates.output_data)); }
  if (updates.error_message !== undefined) { sets.push('error_message = ?'); params.push(updates.error_message); }
  if (updates.retry_count !== undefined) { sets.push('retry_count = ?'); params.push(updates.retry_count); }
  if (updates.started_at !== undefined) { sets.push('started_at = ?'); params.push(updates.started_at); }
  if (updates.completed_at !== undefined) { sets.push('completed_at = ?'); params.push(updates.completed_at); }
  if (updates.duration_ms !== undefined) { sets.push('duration_ms = ?'); params.push(updates.duration_ms); }

  if (sets.length === 0) return null;

  params.push(id);
  db.prepare(`UPDATE workflow_step_results SET ${sets.join(', ')} WHERE id = ?`).run(...params as any[]);

  const row = db.prepare('SELECT * FROM workflow_step_results WHERE id = ?').get(id) as StepRow | null;
  return row ? parseStep(row) : null;
}

export function getStepResults(executionId: string): WorkflowStepResult[] {
  const rows = getDb().prepare(
    'SELECT * FROM workflow_step_results WHERE execution_id = ? ORDER BY started_at ASC'
  ).all(executionId) as StepRow[];
  return rows.map(parseStep);
}

// ── Persistent Variables ──

export function getVariable(workflowId: string, key: string): unknown | null {
  const row = getDb().prepare(
    'SELECT value FROM workflow_variables WHERE workflow_id = ? AND key = ?'
  ).get(workflowId, key) as { value: string } | null;
  return row ? JSON.parse(row.value) : null;
}

export function setVariable(workflowId: string, key: string, value: unknown): void {
  const db = getDb();
  const now = Date.now();
  const existing = db.prepare(
    'SELECT id FROM workflow_variables WHERE workflow_id = ? AND key = ?'
  ).get(workflowId, key) as { id: string } | null;

  if (existing) {
    db.prepare('UPDATE workflow_variables SET value = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(value), now, existing.id);
  } else {
    db.prepare(
      'INSERT INTO workflow_variables (id, workflow_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(generateId(), workflowId, key, JSON.stringify(value), now);
  }
}

export function getVariables(workflowId: string): Record<string, unknown> {
  const rows = getDb().prepare(
    'SELECT key, value FROM workflow_variables WHERE workflow_id = ?'
  ).all(workflowId) as { key: string; value: string }[];

  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = JSON.parse(row.value);
  }
  return result;
}

export function deleteVariable(workflowId: string, key: string): boolean {
  const result = getDb().prepare(
    'DELETE FROM workflow_variables WHERE workflow_id = ? AND key = ?'
  ).run(workflowId, key);
  return result.changes > 0;
}
