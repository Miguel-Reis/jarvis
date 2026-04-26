/**
 * Workflow Engine — Service that orchestrates workflow execution
 */

import type { Service, ServiceStatus } from '../daemon/services.ts';
import type { NodeRegistry, ExecutionContext, StepLogger, NodeInput } from './nodes/registry.ts';
import type { ToolRegistry } from '../actions/tools/registry.ts';
import type { WorkflowDefinition, WorkflowExecution, ExecutionStatus } from './types.ts';
import type { WorkflowEvent } from './events.ts';
import { VariableScope } from './variables.ts';
import { topologicalSort, getOutgoingEdges, executeNode } from './executor.ts';
import type { TemplateContext } from './template.ts';
import * as vault from '../vault/workflows.ts';

export class WorkflowEngine implements Service {
  name = 'workflow-engine';
  private _status: ServiceStatus = 'stopped';
  private nodeRegistry: NodeRegistry;
  private toolRegistry: ToolRegistry;
  private llmManager: unknown;
  private activeExecutions: Map<string, AbortController> = new Map();
  private eventCallback: ((event: WorkflowEvent) => void) | null = null;

  constructor(
    nodeRegistry: NodeRegistry,
    toolRegistry: ToolRegistry,
    llmManager: unknown,
  ) {
    this.nodeRegistry = nodeRegistry;
    this.toolRegistry = toolRegistry;
    this.llmManager = llmManager;
  }

  async start(): Promise<void> {
    this._status = 'running';
  }

  async stop(): Promise<void> {
    // Cancel all active executions
    for (const [id, controller] of this.activeExecutions) {
      controller.abort();
    }
    this.activeExecutions.clear();
    this._status = 'stopped';
  }

  status(): ServiceStatus {
    return this._status;
  }

  setEventCallback(cb: (event: WorkflowEvent) => void): void {
    this.eventCallback = cb;
  }

  getActiveCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * Execute a workflow by ID.
   */
  async execute(
    workflowId: string,
    triggerType: string,
    triggerData?: Record<string, unknown>,
  ): Promise<WorkflowExecution> {
    const workflow = vault.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow '${workflowId}' not found`);
    if (!workflow.enabled) throw new Error(`Workflow '${workflow.name}' is disabled`);

    const version = vault.getLatestVersion(workflowId);
    if (!version) throw new Error(`No versions found for workflow '${workflow.name}'`);

    const definition = version.definition;

    // Create execution record
    const execution = vault.createExecution(workflowId, version.version, triggerType, triggerData);

    this.emit({
      type: 'execution_started',
      workflowId,
      executionId: execution.id,
      data: { triggerType, triggerData: triggerData ?? {}, workflowName: workflow.name },
      timestamp: Date.now(),
    });

    // Run in background (don't block the caller)
    this.runExecution(execution.id, workflowId, definition, triggerType, triggerData ?? {}).catch(err => {
      console.error(`[WorkflowEngine] Execution ${execution.id} crashed: ${err.message}`);
    });

    return execution;
  }

  /**
   * Cancel a running execution.
   */
  async cancel(executionId: string): Promise<void> {
    const controller = this.activeExecutions.get(executionId);
    if (controller) {
      controller.abort();
      vault.updateExecution(executionId, { status: 'cancelled', completed_at: Date.now() });
      this.activeExecutions.delete(executionId);

      const exec = vault.getExecution(executionId);
      this.emit({
        type: 'execution_cancelled',
        workflowId: exec?.workflow_id ?? '',
        executionId,
        data: {},
        timestamp: Date.now(),
      });
    }
  }

  // ── Internal ──

  private async runExecution(
    executionId: string,
    workflowId: string,
    definition: WorkflowDefinition,
    triggerType: string,
    triggerData: Record<string, unknown>,
  ): Promise<void> {
    const abortController = new AbortController();
    this.activeExecutions.set(executionId, abortController);

    const startedAt = Date.now();
    const variables = new VariableScope(workflowId);
    const nodeMap = new Map(definition.nodes.map(n => [n.id, n]));
    const nodeOutputs = new Map<string, Record<string, unknown>>();

    // Build template context
    const templateCtx: TemplateContext = {
      variables: variables.toObject(),
      nodeOutputs,
      triggerData,
      env: process.env as Record<string, string>,
    };

    try {
      // Run graph execution using BFS with routing
      const levels = topologicalSort(definition);

      // Find trigger node(s) — they already fired, seed their output
      const triggerNodes = definition.nodes.filter(n => n.type.startsWith('trigger.'));
      for (const tn of triggerNodes) {
        nodeOutputs.set(tn.id, { ...triggerData, timestamp: Date.now() });
        // Also store by label for $node["label"] references
        nodeOutputs.set(tn.label, { ...triggerData, timestamp: Date.now() });
      }

      // Track which nodes should be skipped (not on active route)
      const activeNodes = new Set<string>(triggerNodes.map(n => n.id));

      // Seed: all nodes directly connected from trigger nodes are active
      for (const tn of triggerNodes) {
        for (const targetId of getOutgoingEdges(definition, tn.id)) {
          activeNodes.add(targetId);
        }
      }

      for (const level of levels) {
        if (abortController.signal.aborted) break;

        // Filter to only active nodes at this level
        const toExecute = level.filter(id => activeNodes.has(id) && !triggerNodes.some(t => t.id === id));
        if (toExecute.length === 0) continue;

        const settings = definition.settings;
        const isParallel = settings.parallelism === 'parallel';

        if (isParallel) {
          await Promise.all(toExecute.map(nodeId => this.executeStep(
            executionId, workflowId, nodeId, nodeMap, nodeOutputs, variables,
            templateCtx, definition, abortController, activeNodes,
          )));
        } else {
          for (const nodeId of toExecute) {
            if (abortController.signal.aborted) break;
            await this.executeStep(
              executionId, workflowId, nodeId, nodeMap, nodeOutputs, variables,
              templateCtx, definition, abortController, activeNodes,
            );
          }
        }
      }

      // Complete
      const duration = Date.now() - startedAt;
      vault.updateExecution(executionId, {
        status: 'completed',
        completed_at: Date.now(),
        duration_ms: duration,
        variables: variables.toObject(),
      });

      this.emit({
        type: 'execution_completed',
        workflowId,
        executionId,
        data: { duration_ms: duration },
        timestamp: Date.now(),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startedAt;

      vault.updateExecution(executionId, {
        status: 'failed',
        error_message: errMsg,
        completed_at: Date.now(),
        duration_ms: duration,
        variables: variables.toObject(),
      });

      this.emit({
        type: 'execution_failed',
        workflowId,
        executionId,
        data: { error: errMsg, duration_ms: duration },
        timestamp: Date.now(),
      });
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  private async executeStep(
    executionId: string,
    workflowId: string,
    nodeId: string,
    nodeMap: Map<string, import('./types.ts').WorkflowNode>,
    nodeOutputs: Map<string, Record<string, unknown>>,
    variables: VariableScope,
    templateCtx: TemplateContext,
    definition: WorkflowDefinition,
    abortController: AbortController,
    activeNodes: Set<string>,
  ): Promise<void> {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const stepResult = vault.createStepResult(executionId, nodeId, node.type);
    vault.updateStepResult(stepResult.id, { status: 'running', started_at: Date.now() });

    this.emit({
      type: 'step_started',
      workflowId,
      executionId,
      nodeId,
      data: { nodeType: node.type, label: node.label },
      timestamp: Date.now(),
    });

    // Collect input from incoming edges
    const incomingEdges = definition.edges.filter(e => e.target === nodeId);
    const inputData: Record<string, unknown> = {};
    for (const edge of incomingEdges) {
      const sourceOutput = nodeOutputs.get(edge.source);
      if (sourceOutput) Object.assign(inputData, sourceOutput);
    }

    const input: NodeInput = {
      data: inputData,
      variables: variables.toObject(),
      executionId,
    };

    const logger: StepLogger = {
      info: (msg) => console.log(`[Workflow:${nodeId}] ${msg}`),
      warn: (msg) => console.warn(`[Workflow:${nodeId}] ${msg}`),
      error: (msg) => console.error(`[Workflow:${nodeId}] ${msg}`),
    };

    const ctx: ExecutionContext = {
      executionId,
      workflowId,
      toolRegistry: this.toolRegistry,
      llmManager: this.llmManager,
      variables,
      logger,
      abortSignal: abortController.signal,
      nodeRegistry: this.nodeRegistry,
      broadcast: (type, data) => this.emit({
        type: type as any,
        workflowId,
        executionId,
        data,
        timestamp: Date.now(),
      }),
    };

    // Refresh template context
    templateCtx.variables = variables.toObject();

    try {
      const startTime = Date.now();
      const output = await executeNode(node, input, this.nodeRegistry, ctx, templateCtx, definition.settings);
      const duration = Date.now() - startTime;

      // Store output
      nodeOutputs.set(nodeId, output.data);
      nodeOutputs.set(node.label, output.data); // For $node["label"] references

      vault.updateStepResult(stepResult.id, {
        status: 'completed',
        input_data: inputData,
        output_data: output.data,
        completed_at: Date.now(),
        duration_ms: duration,
      });

      this.emit({
        type: 'step_completed',
        workflowId,
        executionId,
        nodeId,
        data: { duration_ms: duration, output: output.data },
        timestamp: Date.now(),
      });

      // Activate downstream nodes based on route
      const targets = getOutgoingEdges(definition, nodeId, output.route);
      for (const t of targets) {
        activeNodes.add(t);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      vault.updateStepResult(stepResult.id, {
        status: 'failed',
        input_data: inputData,
        error_message: errMsg,
        completed_at: Date.now(),
        duration_ms: Date.now() - (stepResult.started_at ?? Date.now()),
      });

      this.emit({
        type: 'step_failed',
        workflowId,
        executionId,
        nodeId,
        data: { error: errMsg, nodeType: node.type },
        timestamp: Date.now(),
      });

      // Check fallback
      if (node.fallbackNodeId && nodeMap.has(node.fallbackNodeId)) {
        logger.info(`Falling back to node: ${node.fallbackNodeId}`);
        activeNodes.add(node.fallbackNodeId);
        return;
      }

      // If onError is 'stop', throw to halt execution
      if (definition.settings.onError === 'stop') {
        throw err;
      }
      // 'continue' — log and move on
    }
  }

  private emit(event: WorkflowEvent): void {
    this.eventCallback?.(event);
  }
}
