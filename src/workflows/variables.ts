/**
 * Variable Scope — execution-scoped + persistent
 *
 * Execution-scoped variables live in memory for the current run.
 * Persistent variables survive across executions (stored in vault).
 */

import * as vault from '../vault/workflows.ts';
import type { VariableScopeInterface } from './nodes/registry.ts';

export class VariableScope implements VariableScopeInterface {
  private executionVars: Map<string, unknown> = new Map();
  private workflowId: string;

  constructor(workflowId: string, initialVars?: Record<string, unknown>) {
    this.workflowId = workflowId;
    if (initialVars) {
      for (const [k, v] of Object.entries(initialVars)) {
        this.executionVars.set(k, v);
      }
    }
  }

  /**
   * Get variable — checks execution scope first, then persistent vault.
   */
  get(key: string): unknown {
    if (this.executionVars.has(key)) {
      return this.executionVars.get(key);
    }
    return vault.getVariable(this.workflowId, key);
  }

  /**
   * Set execution-scoped variable (in-memory only).
   */
  set(key: string, value: unknown): void {
    this.executionVars.set(key, value);
  }

  /**
   * Set persistent variable (survives across executions).
   */
  setPersistent(key: string, value: unknown): void {
    vault.setVariable(this.workflowId, key, value);
    // Also set in execution scope for current run
    this.executionVars.set(key, value);
  }

  /**
   * Get all variables (execution + persistent merged).
   */
  toObject(): Record<string, unknown> {
    const persistent = vault.getVariables(this.workflowId);
    const result: Record<string, unknown> = { ...persistent };
    for (const [k, v] of this.executionVars) {
      result[k] = v;
    }
    return result;
  }

  /**
   * Serialize execution variables for storage.
   */
  serialize(): string {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of this.executionVars) {
      obj[k] = v;
    }
    return JSON.stringify(obj);
  }
}
