/**
 * Shared API helpers — extracted from api-routes.ts.
 * These are used by all route modules.
 */

import type { HealthMonitor } from '../health.ts';
import type { AgentService } from '../agent-service.ts';
import type { JarvisConfig } from '../../config/types.ts';
import type { WebSocketService } from './ws-service.ts';
import type { ChannelService } from './channel-service.ts';
import type { AuthorityEngine } from '../../authority/engine.ts';
import type { ApprovalManager } from '../../authority/approval.ts';
import type { AuditTrail, AuthorityDecisionType } from '../../authority/audit.ts';
import type { AuthorityLearner } from '../../authority/learning.ts';
import type { EmergencyController } from '../../authority/emergency.ts';
import type { DeferredExecutor } from '../../authority/deferred-executor.ts';
import type { AwarenessService } from '../../awareness/service.ts';
import type { ActionCategory } from '../../roles/authority.ts';

export type { ApiContext } from '../api-routes';

// Re-export CORS so route modules can use it
export let CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'http://localhost:3142',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function setCorsOrigin(port: number, host = 'localhost') {
  CORS = {
    'Access-Control-Allow-Origin': `http://${host}:${port}`,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: CORS });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function getSearchParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

// Re-export the ApiContext type alias for convenience
export type {
  HealthMonitor,
  AgentService,
  JarvisConfig,
  WebSocketService,
  ChannelService,
  AuthorityEngine,
  ApprovalManager,
  AuditTrail,
  AuthorityDecisionType,
  AuthorityLearner,
  EmergencyController,
  DeferredExecutor,
  AwarenessService,
  ActionCategory,
};
