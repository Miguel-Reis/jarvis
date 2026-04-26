/**
 * Commitment routes — tasks and commitments management.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams } from './_shared.ts';
import { findCommitments, getUpcoming, createCommitment, getCommitment, updateCommitmentStatus, updateCommitmentFields, reorderCommitments } from '../../vault/commitments.ts';
import type { CommitmentPriority, CommitmentStatus } from '../../vault/commitments.ts';

export function registerRoutes(ctx: ApiContext) {
  return {

    // --- Vault: Commitments ---
    '/api/vault/commitments': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const status = params.get('status') as CommitmentStatus | null;
        const priority = params.get('priority') as CommitmentPriority | null;
        const assignedTo = params.get('assigned_to');
        const overdue = params.get('overdue');
        const upcoming = params.get('upcoming');

        if (upcoming) {
          return json(getUpcoming(parseInt(upcoming) || 10));
        }

        const query: {
          status?: CommitmentStatus;
          priority?: CommitmentPriority;
          assigned_to?: string;
          overdue?: boolean;
        } = {};
        if (status) query.status = status;
        if (priority) query.priority = priority;
        if (assignedTo) query.assigned_to = assignedTo;
        if (overdue === 'true') query.overdue = true;
        return json(findCommitments(query));
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as {
            what: string;
            when_due?: number;
            context?: string;
            priority?: CommitmentPriority;
            assigned_to?: string;
          };
          if (!body.what) return error('Missing "what" field');
          const commitment = createCommitment(body.what, {
            when_due: body.when_due,
            context: body.context,
            priority: body.priority,
            assigned_to: body.assigned_to,
          });
          ctx.wsService?.broadcastTaskUpdate(commitment, 'created');
          return json(commitment, 201);
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/vault/commitments/reorder': {
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { items: { id: string; sort_order: number }[] };
          if (!body.items || !Array.isArray(body.items)) return error('Missing "items" array');
          reorderCommitments(body.items);
          return json({ ok: true });
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/vault/commitments/:id': {
      GET: (req: Request & { params: { id: string } }) => {
        const commitment = getCommitment(req.params.id);
        if (!commitment) return error('Commitment not found', 404);
        return json(commitment);
      },
      PATCH: async (req: Request & { params: { id: string } }) => {
        try {
          const body = await req.json() as { status?: CommitmentStatus; result?: string; priority?: string; context?: string | null; what?: string };
          const id = req.params.id;

          // Field-only update (priority / context / what)
          if (!body.status && (body.priority !== undefined || 'context' in body || body.what !== undefined)) {
            const validPriorities = ['low', 'normal', 'high', 'critical'];
            if (body.priority && !validPriorities.includes(body.priority)) {
              return error(`Invalid priority. Must be one of: ${validPriorities.join(', ')}`);
            }
            const updated = updateCommitmentFields(id, {
              ...(body.what !== undefined ? { what: body.what } : {}),
              ...('context' in body ? { context: body.context } : {}),
              ...(body.priority !== undefined ? { priority: body.priority as CommitmentPriority } : {}),
            });
            if (!updated) return error('Commitment not found', 404);
            ctx.wsService?.broadcastTaskUpdate(updated, 'updated');
            return json(updated);
          }

          if (!body.status) return error('Missing "status" field');

          const validStatuses: CommitmentStatus[] = ['pending', 'active', 'completed', 'failed', 'escalated'];
          if (!validStatuses.includes(body.status)) {
            return error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
          }

          const updated = updateCommitmentStatus(id, body.status, body.result);
          if (!updated) return error('Commitment not found', 404);
          ctx.wsService?.broadcastTaskUpdate(updated, 'updated');
          return json(updated);
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

  };
}
