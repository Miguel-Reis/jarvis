/**
 * Trigger System Tests — Phase 2: Workflow Automation Engine
 *
 * Tests for CronScheduler, WebhookManager, ScreenConditionEvaluator,
 * and TriggerManager basic instantiation.
 */

import { test, expect, describe, beforeEach, afterEach, mock } from 'bun:test';
import { CronScheduler } from './cron.ts';
import { WebhookManager } from './webhook.ts';
import { ScreenConditionEvaluator } from './screen-condition.ts';
import { TriggerManager } from './manager.ts';
import { NodeRegistry } from '../nodes/registry.ts';
import { WorkflowEngine } from '../engine.ts';
import type { WorkflowDefinition } from '../types.ts';
import { DEFAULT_WORKFLOW_SETTINGS } from '../types.ts';
import { initDatabase } from '../../vault/schema.ts';

// ────────────────────────────────────────────────────────────────────────────
// CronScheduler
// ────────────────────────────────────────────────────────────────────────────

describe('CronScheduler — matches()', () => {
  test('every minute: * * * * *', () => {
    const date = new Date('2026-03-02T10:30:00');
    expect(CronScheduler.matches('* * * * *', date)).toBe(true);
  });

  test('specific minute and hour: 30 10 * * *', () => {
    const match = new Date('2026-03-02T10:30:00');
    const noMatch = new Date('2026-03-02T10:31:00');

    expect(CronScheduler.matches('30 10 * * *', match)).toBe(true);
    expect(CronScheduler.matches('30 10 * * *', noMatch)).toBe(false);
  });

  test('specific day of month: 0 9 1 * *', () => {
    const firstOfMonth = new Date('2026-03-01T09:00:00');
    const secondOfMonth = new Date('2026-03-02T09:00:00');

    expect(CronScheduler.matches('0 9 1 * *', firstOfMonth)).toBe(true);
    expect(CronScheduler.matches('0 9 1 * *', secondOfMonth)).toBe(false);
  });

  test('specific month: 0 0 * 6 *', () => {
    const june = new Date('2026-06-15T00:00:00');
    const march = new Date('2026-03-15T00:00:00');

    expect(CronScheduler.matches('0 0 * 6 *', june)).toBe(true);
    expect(CronScheduler.matches('0 0 * 6 *', march)).toBe(false);
  });

  test('day of week (Monday=1): 0 8 * * 1', () => {
    // 2026-03-02 is a Monday
    const monday = new Date('2026-03-02T08:00:00');
    const tuesday = new Date('2026-03-03T08:00:00');

    expect(CronScheduler.matches('0 8 * * 1', monday)).toBe(true);
    expect(CronScheduler.matches('0 8 * * 1', tuesday)).toBe(false);
  });

  test('comma-separated values: 0,30 * * * *', () => {
    const onHour = new Date('2026-03-02T10:00:00');
    const halfPast = new Date('2026-03-02T10:30:00');
    const other = new Date('2026-03-02T10:15:00');

    expect(CronScheduler.matches('0,30 * * * *', onHour)).toBe(true);
    expect(CronScheduler.matches('0,30 * * * *', halfPast)).toBe(true);
    expect(CronScheduler.matches('0,30 * * * *', other)).toBe(false);
  });

  test('step values: */15 * * * *', () => {
    const min0 = new Date('2026-03-02T10:00:00');
    const min15 = new Date('2026-03-02T10:15:00');
    const min30 = new Date('2026-03-02T10:30:00');
    const min45 = new Date('2026-03-02T10:45:00');
    const min10 = new Date('2026-03-02T10:10:00');

    expect(CronScheduler.matches('*/15 * * * *', min0)).toBe(true);
    expect(CronScheduler.matches('*/15 * * * *', min15)).toBe(true);
    expect(CronScheduler.matches('*/15 * * * *', min30)).toBe(true);
    expect(CronScheduler.matches('*/15 * * * *', min45)).toBe(true);
    expect(CronScheduler.matches('*/15 * * * *', min10)).toBe(false);
  });

  test('range: 0 9-17 * * *', () => {
    const at9 = new Date('2026-03-02T09:00:00');
    const at13 = new Date('2026-03-02T13:00:00');
    const at17 = new Date('2026-03-02T17:00:00');
    const at18 = new Date('2026-03-02T18:00:00');

    expect(CronScheduler.matches('0 9-17 * * *', at9)).toBe(true);
    expect(CronScheduler.matches('0 9-17 * * *', at13)).toBe(true);
    expect(CronScheduler.matches('0 9-17 * * *', at17)).toBe(true);
    expect(CronScheduler.matches('0 9-17 * * *', at18)).toBe(false);
  });

  test('invalid expression returns false', () => {
    expect(CronScheduler.matches('bad expression', new Date())).toBe(false);
    expect(CronScheduler.matches('* * *', new Date())).toBe(false);
  });
});

describe('CronScheduler — nextRun()', () => {
  test('every minute: next run is 1 minute ahead', () => {
    const from = new Date('2026-03-02T10:30:00');
    const next = CronScheduler.nextRun('* * * * *', from);

    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(31);
    expect(next!.getHours()).toBe(10);
  });

  test('hourly: 0 * * * *', () => {
    const from = new Date('2026-03-02T10:30:00');
    const next = CronScheduler.nextRun('0 * * * *', from);

    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(0);
    expect(next!.getHours()).toBe(11);
  });

  test('next run respects day boundary', () => {
    // Expression: midnight
    const from = new Date('2026-03-02T23:45:00');
    const next = CronScheduler.nextRun('0 0 * * *', from);

    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(3);  // Next day
    expect(next!.getHours()).toBe(0);
    expect(next!.getMinutes()).toBe(0);
  });

  test('next run respects month boundary', () => {
    // Expression: 1st of month at 6am
    const from = new Date('2026-03-15T06:01:00');
    const next = CronScheduler.nextRun('0 6 1 * *', from);

    expect(next).not.toBeNull();
    expect(next!.getMonth()).toBe(3);  // April (0-indexed)
    expect(next!.getDate()).toBe(1);
    expect(next!.getHours()).toBe(6);
  });

  test('specific future minute in same hour', () => {
    const from = new Date('2026-03-02T10:10:00');
    const next = CronScheduler.nextRun('30 10 * * *', from);

    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(10);
    expect(next!.getMinutes()).toBe(30);
    expect(next!.getDate()).toBe(2);
  });
});

describe('CronScheduler — schedule() / cancel()', () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    scheduler = new CronScheduler();
  });

  afterEach(() => {
    scheduler.cancelAll();
  });

  test('getJobs() returns registered jobs', () => {
    scheduler.schedule('job1', '* * * * *', () => {});
    scheduler.schedule('job2', '0 * * * *', () => {});

    const jobs = scheduler.getJobs();
    expect(jobs).toHaveLength(2);

    const ids = jobs.map(j => j.id);
    expect(ids).toContain('job1');
    expect(ids).toContain('job2');
  });

  test('cancel() removes a specific job', () => {
    scheduler.schedule('job1', '* * * * *', () => {});
    scheduler.schedule('job2', '* * * * *', () => {});

    scheduler.cancel('job1');

    const jobs = scheduler.getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe('job2');
  });

  test('cancelAll() removes all jobs', () => {
    scheduler.schedule('j1', '* * * * *', () => {});
    scheduler.schedule('j2', '* * * * *', () => {});

    scheduler.cancelAll();

    expect(scheduler.getJobs()).toHaveLength(0);
  });

  test('re-scheduling same id cancels the previous job', () => {
    let count = 0;
    scheduler.schedule('dup', '* * * * *', () => { count++; });
    scheduler.schedule('dup', '0 * * * *', () => {});  // Replaces previous

    const jobs = scheduler.getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.expression).toBe('0 * * * *');
  });

  test('invalid expression throws', () => {
    expect(() => scheduler.schedule('bad', 'not valid', () => {})).toThrow();
  });

  test('job info has nextRun set', () => {
    scheduler.schedule('timed', '0 12 * * *', () => {});
    const jobs = scheduler.getJobs();
    expect(jobs[0]!.nextRun).toBeGreaterThan(Date.now() - 1000);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// WebhookManager
// ────────────────────────────────────────────────────────────────────────────

describe('WebhookManager — register()', () => {
  let manager: WebhookManager;

  beforeEach(() => {
    manager = new WebhookManager();
  });

  test('returns expected path', () => {
    const path = manager.register('wf_123');
    expect(path).toBe('/webhooks/wf_123');
  });

  test('getRoutes() returns registered routes', () => {
    manager.register('wf_abc');
    manager.register('wf_def');

    const routes = manager.getRoutes();
    expect(routes.size).toBe(2);
    expect(routes.has('wf_abc')).toBe(true);
    expect(routes.has('wf_def')).toBe(true);
  });

  test('unregister() removes route', () => {
    manager.register('wf_to_remove');
    manager.unregister('wf_to_remove');

    expect(manager.getRoutes().size).toBe(0);
  });

  test('route has correct metadata', () => {
    const before = Date.now();
    manager.register('wf_meta', 'my-secret');
    const after = Date.now();

    const route = manager.getRoutes().get('wf_meta')!;
    expect(route.workflowId).toBe('wf_meta');
    expect(route.path).toBe('/webhooks/wf_meta');
    expect(route.secret).toBe('my-secret');
    expect(route.registeredAt).toBeGreaterThanOrEqual(before);
    expect(route.registeredAt).toBeLessThanOrEqual(after);
  });
});

describe('WebhookManager — handleRequest()', () => {
  let manager: WebhookManager;

  beforeEach(() => {
    manager = new WebhookManager();
  });

  test('404 for unregistered workflow', async () => {
    const req = new Request('http://localhost/webhooks/unknown', { method: 'POST', body: '{}' });
    const res = await manager.handleRequest('unknown', req);

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  test('fires callback with parsed JSON body', async () => {
    manager.register('wf_cb');

    let receivedWorkflowId = '';
    let receivedData: Record<string, unknown> = {};

    manager.setTriggerCallback((wfId, data) => {
      receivedWorkflowId = wfId;
      receivedData = data;
    });

    const req = new Request('http://localhost/webhooks/wf_cb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test', value: 42 }),
    });

    const res = await manager.handleRequest('wf_cb', req);

    expect(res.status).toBe(200);
    expect(receivedWorkflowId).toBe('wf_cb');
    expect(receivedData.event).toBe('test');
    expect(receivedData.value).toBe(42);
  });

  test('200 on valid request without secret', async () => {
    manager.register('wf_nosecret');

    const req = new Request('http://localhost/webhooks/wf_nosecret', {
      method: 'POST',
      body: '{"hello":"world"}',
    });

    const res = await manager.handleRequest('wf_nosecret', req);
    expect(res.status).toBe(200);
  });

  test('401 when secret required but header missing', async () => {
    manager.register('wf_protected', 'my-secret');

    const req = new Request('http://localhost/webhooks/wf_protected', {
      method: 'POST',
      body: '{"test":true}',
    });

    const res = await manager.handleRequest('wf_protected', req);
    expect(res.status).toBe(401);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/missing signature/i);
  });

  test('401 when secret is wrong', async () => {
    manager.register('wf_wrong_sig', 'correct-secret');

    const req = new Request('http://localhost/webhooks/wf_wrong_sig', {
      method: 'POST',
      headers: { 'x-jarvis-signature': 'deadbeefdeadbeef' },
      body: '{"test":true}',
    });

    const res = await manager.handleRequest('wf_wrong_sig', req);
    expect(res.status).toBe(401);

    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid signature/i);
  });

  test('200 when HMAC signature is valid', async () => {
    const secret = 'super-secret';
    manager.register('wf_signed', secret);

    const bodyStr = JSON.stringify({ event: 'push' });

    // Compute the expected HMAC manually
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(bodyStr));
    const hexSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    const req = new Request('http://localhost/webhooks/wf_signed', {
      method: 'POST',
      headers: { 'x-jarvis-signature': hexSig },
      body: bodyStr,
    });

    const res = await manager.handleRequest('wf_signed', req);
    expect(res.status).toBe(200);
  });

  test('response contains ok:true and workflowId', async () => {
    manager.register('wf_response_check');

    const req = new Request('http://localhost/webhooks/wf_response_check', {
      method: 'POST',
      body: '',
    });

    const res = await manager.handleRequest('wf_response_check', req);
    const body = await res.json() as { ok: boolean; workflowId: string };

    expect(body.ok).toBe(true);
    expect(body.workflowId).toBe('wf_response_check');
  });

  test('non-JSON body is wrapped as string', async () => {
    manager.register('wf_rawbody');

    let receivedData: Record<string, unknown> = {};
    manager.setTriggerCallback((_, data) => { receivedData = data; });

    const req = new Request('http://localhost/webhooks/wf_rawbody', {
      method: 'POST',
      body: 'plain text payload',
    });

    await manager.handleRequest('wf_rawbody', req);
    expect(receivedData.body).toBe('plain text payload');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ScreenConditionEvaluator
// ────────────────────────────────────────────────────────────────────────────

describe('ScreenConditionEvaluator', () => {
  let evaluator: ScreenConditionEvaluator;

  beforeEach(() => {
    evaluator = new ScreenConditionEvaluator(null);
  });

  // ── text_present ──

  test('text_present: matches when text is in OCR output', async () => {
    const result = await evaluator.evaluate(
      { type: 'text_present', text: 'Welcome' },
      'Welcome to JARVIS',
    );
    expect(result).toBe(true);
  });

  test('text_present: false when text is absent', async () => {
    const result = await evaluator.evaluate(
      { type: 'text_present', text: 'Login' },
      'Welcome to JARVIS',
    );
    expect(result).toBe(false);
  });

  test('text_present: case-insensitive by default', async () => {
    const result = await evaluator.evaluate(
      { type: 'text_present', text: 'WELCOME' },
      'welcome to jarvis',
    );
    expect(result).toBe(true);
  });

  test('text_present: case-sensitive when configured', async () => {
    const result = await evaluator.evaluate(
      { type: 'text_present', text: 'WELCOME', caseSensitive: true },
      'welcome to jarvis',
    );
    expect(result).toBe(false);
  });

  test('text_present: false when ocrText is empty', async () => {
    const result = await evaluator.evaluate(
      { type: 'text_present', text: 'anything' },
      '',
    );
    expect(result).toBe(false);
  });

  test('text_present: false when text field is missing', async () => {
    const result = await evaluator.evaluate(
      { type: 'text_present' },
      'some OCR text',
    );
    expect(result).toBe(false);
  });

  // ── text_absent ──

  test('text_absent: true when text is not in OCR output', async () => {
    const result = await evaluator.evaluate(
      { type: 'text_absent', text: 'Error' },
      'Everything is fine',
    );
    expect(result).toBe(true);
  });

  test('text_absent: false when text IS present', async () => {
    const result = await evaluator.evaluate(
      { type: 'text_absent', text: 'Error' },
      'An Error occurred',
    );
    expect(result).toBe(false);
  });

  test('text_absent: true when ocrText is empty', async () => {
    const result = await evaluator.evaluate(
      { type: 'text_absent', text: 'Error' },
      '',
    );
    expect(result).toBe(true);
  });

  // ── app_active ──

  test('app_active: true when app name matches exactly', async () => {
    const result = await evaluator.evaluate(
      { type: 'app_active', appName: 'Chrome' },
      undefined,
      'Chrome',
    );
    expect(result).toBe(true);
  });

  test('app_active: true when app name is a substring', async () => {
    const result = await evaluator.evaluate(
      { type: 'app_active', appName: 'Chrome' },
      undefined,
      'Google Chrome',
    );
    expect(result).toBe(true);
  });

  test('app_active: false when wrong app is active', async () => {
    const result = await evaluator.evaluate(
      { type: 'app_active', appName: 'Firefox' },
      undefined,
      'Google Chrome',
    );
    expect(result).toBe(false);
  });

  test('app_active: case-insensitive by default', async () => {
    const result = await evaluator.evaluate(
      { type: 'app_active', appName: 'chrome' },
      undefined,
      'Google Chrome',
    );
    expect(result).toBe(true);
  });

  test('app_active: false when appName field is missing', async () => {
    const result = await evaluator.evaluate(
      { type: 'app_active' },
      undefined,
      'Chrome',
    );
    expect(result).toBe(false);
  });

  test('app_active: false when no active app provided', async () => {
    const result = await evaluator.evaluate(
      { type: 'app_active', appName: 'Chrome' },
    );
    expect(result).toBe(false);
  });

  // ── llm_check / visual_match without LLM ──

  test('visual_match: false when no LLM manager', async () => {
    const result = await evaluator.evaluate(
      { type: 'visual_match', description: 'Login form is visible' },
      'some OCR text',
    );
    expect(result).toBe(false);
  });

  test('llm_check: false when no LLM manager', async () => {
    const result = await evaluator.evaluate(
      { type: 'llm_check', prompt: 'Is a modal dialog open?' },
      'some OCR text',
    );
    expect(result).toBe(false);
  });

  test('llm_check with mock LLM returning "yes"', async () => {
    const mockLlm = {
      complete: mock(async (_prompt: string) => ({ text: 'yes' })),
    };

    const evalWithLlm = new ScreenConditionEvaluator(mockLlm);
    const result = await evalWithLlm.evaluate(
      { type: 'llm_check', prompt: 'Is there a login form?' },
      'Username: [____] Password: [____] [Login]',
      'Chrome',
    );

    expect(result).toBe(true);
    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
  });

  test('llm_check with mock LLM returning "no"', async () => {
    const mockLlm = {
      complete: mock(async (_prompt: string) => ({ text: 'no' })),
    };

    const evalWithLlm = new ScreenConditionEvaluator(mockLlm);
    const result = await evalWithLlm.evaluate(
      { type: 'llm_check', prompt: 'Is there a login form?' },
      'Welcome to JARVIS dashboard',
      'Chrome',
    );

    expect(result).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TriggerManager — basic instantiation
// ────────────────────────────────────────────────────────────────────────────

describe('TriggerManager', () => {
  beforeEach(() => initDatabase(':memory:'));

  function makeEngine(): WorkflowEngine {
    const nodeRegistry = new NodeRegistry();
    // toolRegistry minimal stub
    const toolRegistry = {} as import('../nodes/registry.ts').ExecutionContext['toolRegistry'];
    return new WorkflowEngine(nodeRegistry, toolRegistry, null);
  }

  test('instantiates without error', () => {
    const engine = makeEngine();
    const manager = new TriggerManager(engine);
    expect(manager).toBeTruthy();
    expect(manager.name).toBe('trigger-manager');
  });

  test('initial status is stopped', () => {
    const engine = makeEngine();
    const manager = new TriggerManager(engine);
    expect(manager.status()).toBe('stopped');
  });

  test('getCronScheduler() returns CronScheduler instance', () => {
    const engine = makeEngine();
    const manager = new TriggerManager(engine);
    expect(manager.getCronScheduler()).toBeDefined();
    expect(typeof manager.getCronScheduler().schedule).toBe('function');
  });

  test('getWebhookManager() returns WebhookManager instance', () => {
    const engine = makeEngine();
    const manager = new TriggerManager(engine);
    expect(manager.getWebhookManager()).toBeDefined();
    expect(typeof manager.getWebhookManager().register).toBe('function');
  });

  test('start() transitions to running after reloadAll()', async () => {
    const engine = makeEngine();
    await engine.start();

    const manager = new TriggerManager(engine);
    await manager.start();

    expect(manager.status()).toBe('running');
    await manager.stop();
  });

  test('stop() transitions to stopped', async () => {
    const engine = makeEngine();
    await engine.start();

    const manager = new TriggerManager(engine);
    await manager.start();
    await manager.stop();

    expect(manager.status()).toBe('stopped');
  });

  test('registerWorkflow() registers cron trigger', () => {
    const engine = makeEngine();
    const manager = new TriggerManager(engine);

    const definition: WorkflowDefinition = {
      nodes: [
        {
          id: 'n1',
          type: 'trigger.cron',
          label: 'Every Hour',
          position: { x: 0, y: 0 },
          config: { expression: '0 * * * *' },
        },
      ],
      edges: [],
      settings: DEFAULT_WORKFLOW_SETTINGS,
    };

    manager.registerWorkflow('wf_cron_test', definition);

    const jobs = manager.getCronScheduler().getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.expression).toBe('0 * * * *');

    manager.getCronScheduler().cancelAll();
  });

  test('registerWorkflow() registers webhook trigger', () => {
    const engine = makeEngine();
    const manager = new TriggerManager(engine);

    const definition: WorkflowDefinition = {
      nodes: [
        {
          id: 'n1',
          type: 'trigger.webhook',
          label: 'Inbound Hook',
          position: { x: 0, y: 0 },
          config: { secret: 'test-secret' },
        },
      ],
      edges: [],
      settings: DEFAULT_WORKFLOW_SETTINGS,
    };

    manager.registerWorkflow('wf_webhook_test', definition);

    const routes = manager.getWebhookManager().getRoutes();
    expect(routes.has('wf_webhook_test')).toBe(true);
    expect(routes.get('wf_webhook_test')!.secret).toBe('test-secret');
  });

  test('unregisterWorkflow() cleans up cron jobs', () => {
    const engine = makeEngine();
    const manager = new TriggerManager(engine);

    const definition: WorkflowDefinition = {
      nodes: [
        {
          id: 'n1',
          type: 'trigger.cron',
          label: 'Every Minute',
          position: { x: 0, y: 0 },
          config: { expression: '* * * * *' },
        },
      ],
      edges: [],
      settings: DEFAULT_WORKFLOW_SETTINGS,
    };

    manager.registerWorkflow('wf_cleanup', definition);
    expect(manager.getCronScheduler().getJobs()).toHaveLength(1);

    manager.unregisterWorkflow('wf_cleanup');
    expect(manager.getCronScheduler().getJobs()).toHaveLength(0);
  });
});
