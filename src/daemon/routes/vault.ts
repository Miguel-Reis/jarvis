/**
 * Vault routes — entities, facts, relationships, unified search.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams, CORS } from './_shared.ts';
import { findEntities, getEntity, searchEntitiesByName, createEntity, deleteEntity } from '../../vault/entities.ts';
import { findFacts, createFact, deleteFact } from '../../vault/facts.ts';
import { findRelationships, getEntityRelationships } from '../../vault/relationships.ts';
import { getDb } from '../../vault/schema.ts';
import type { EntityType } from '../../vault/entities.ts';
import { escapeLike } from 'node:path';

export function registerRoutes(_ctx: ApiContext) {
  return {

    // --- Vault: Entities ---
    '/api/vault/entities': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const type = params.get('type') as EntityType | null;
        const q = params.get('q');
        const query: { type?: EntityType; nameContains?: string } = {};
        if (type) query.type = type;
        if (q) query.nameContains = q;
        return json(findEntities(query));
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as { type: EntityType; name: string; properties?: Record<string, unknown>; source?: string };
          if (!body.type || !body.name?.trim()) return error('type and name are required', 400);
          const entity = createEntity(body.type, body.name.trim(), body.properties, body.source);
          return json(entity, 201);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/vault/entities/:id': {
      GET: (req: Request & { params: { id: string } }) => {
        const entity = getEntity(req.params.id);
        if (!entity) return error('Entity not found', 404);
        return json(entity);
      },
      DELETE: (req: Request & { params: { id: string } }) => {
        const ok = deleteEntity(req.params.id);
        if (!ok) return error('Entity not found', 404);
        return json({ ok: true });
      },
    },

    '/api/vault/entities/:id/facts': {
      GET: (req: Request & { params: { id: string } }) => {
        return json(findFacts({ subject_id: req.params.id }));
      },
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          const body = await req.json() as { predicate: string; object: string; confidence?: number; source?: string };
          if (!body.predicate?.trim() || !body.object?.trim()) return error('predicate and object are required', 400);
          const fact = createFact(req.params.id, body.predicate.trim(), body.object.trim(), { confidence: body.confidence, source: body.source });
          return json(fact, 201);
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/vault/entities/:id/relationships': {
      GET: (req: Request & { params: { id: string } }) => {
        return json(getEntityRelationships(req.params.id));
      },
    },

    // --- Vault: Facts ---
    '/api/vault/facts': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const query: { subject_id?: string; predicate?: string; object?: string } = {};
        const subjectId = params.get('subject_id');
        const predicate = params.get('predicate');
        const object = params.get('object');
        if (subjectId) query.subject_id = subjectId;
        if (predicate) query.predicate = predicate;
        if (object) query.object = object;
        return json(findFacts(query));
      },
    },

    '/api/vault/facts/:id': {
      DELETE: (req: Request & { params: { id: string } }) => {
        const ok = deleteFact(req.params.id);
        if (!ok) return error('Fact not found', 404);
        return json({ ok: true });
      },
    },

    // --- Vault: Relationships ---
    '/api/vault/relationships': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const query: { from_id?: string; to_id?: string; type?: string } = {};
        const fromId = params.get('from_id');
        const toId = params.get('to_id');
        const type = params.get('type');
        if (fromId) query.from_id = fromId;
        if (toId) query.to_id = toId;
        if (type) query.type = type;
        return json(findRelationships(query));
      },
    },

    // --- Vault: Unified Search ---
    '/api/vault/search': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const q = params.get('q')?.trim() || '';
        const type = params.get('type') as EntityType | null;
        const limit = Math.min(parseInt(params.get('limit') ?? '50') || 50, 200);

        const db = getDb();
        const entityIds = new Set<string>();

        if (q) {
          // 1. Search entities by name
          const nameMatches = searchEntitiesByName(q);
          for (const e of nameMatches) entityIds.add(e.id);

          // 2. Search facts by predicate or object
          const safeQ = escapeLike(q);
          const factRows = db.prepare(
            "SELECT DISTINCT subject_id FROM facts WHERE predicate LIKE ? ESCAPE '\\' OR object LIKE ? ESCAPE '\\' LIMIT 200"
          ).all(`%${safeQ}%`, `%${safeQ}%`) as { subject_id: string }[];
          for (const r of factRows) entityIds.add(r.subject_id);

          // 3. Search relationships by type
          const relRows = db.prepare(
            "SELECT from_id, to_id FROM relationships WHERE type LIKE ? ESCAPE '\\' LIMIT 200"
          ).all(`%${safeQ}%`) as { from_id: string; to_id: string }[];
          for (const r of relRows) {
            entityIds.add(r.from_id);
            entityIds.add(r.to_id);
          }
        } else {
          // No query — return all entities
          const allEntities = findEntities(type ? { type } : {});
          for (const e of allEntities) entityIds.add(e.id);
        }

        // Filter by type if specified
        const results: Array<{
          entity: ReturnType<typeof getEntity>;
          facts: ReturnType<typeof findFacts>;
          relationships: Array<{ type: string; target: string; direction: 'from' | 'to' }>;
        }> = [];

        for (const id of entityIds) {
          if (results.length >= limit) break;
          const entity = getEntity(id);
          if (!entity) continue;
          if (type && entity.type !== type) continue;

          const facts = findFacts({ subject_id: id });
          const rels = getEntityRelationships(id);
          const relationships = rels.map(r => ({
            type: r.type,
            target: r.from_id === id ? r.to_entity.name : r.from_entity.name,
            direction: (r.from_id === id ? 'from' : 'to') as 'from' | 'to',
          }));

          results.push({ entity, facts, relationships });
        }

        // Sort by updated_at desc
        results.sort((a, b) => (b.entity!.updated_at) - (a.entity!.updated_at));

        return json(results);
      },
    },

    // --- Vault: Conversations ---
    '/api/vault/conversations': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const channel = params.get('channel');
        const limit = Math.min(parseInt(params.get('limit') ?? '20') || 20, 100);

        const db = getDb();
        let rows;
        if (channel && channel !== 'all') {
          rows = db.prepare(
            'SELECT * FROM conversations WHERE channel = ? ORDER BY last_message_at DESC LIMIT ?'
          ).all(channel, limit);
        } else {
          rows = db.prepare(
            'SELECT * FROM conversations ORDER BY last_message_at DESC LIMIT ?'
          ).all(limit);
        }
        return json(rows);
      },
    },

    '/api/vault/conversations/active': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const channel = params.get('channel') ?? 'websocket';

        if (channel === 'all') {
          // Return the most recent conversation per channel
          const channels = ['websocket', 'telegram', 'discord'];
          const results: Record<string, unknown> = {};
          for (const ch of channels) {
            const { getRecentConversation } = require('../../vault/conversations.ts');
            const result = getRecentConversation(ch);
            if (result) results[ch] = result;
          }
          return json(results);
        }

        const { getRecentConversation } = require('../../vault/conversations.ts');
        const result = getRecentConversation(channel);
        if (!result) return json({ conversation: null, messages: [] });
        return json(result);
      },
    },

    '/api/vault/conversations/:id/messages': {
      GET: (req: Request & { params: { id: string } }) => {
        const params = getSearchParams(req);
        const limit = parseInt(params.get('limit') ?? '100') || 100;
        const { getMessages } = require('../../vault/conversations.ts');
        const messages = getMessages(req.params.id, { limit });
        return json(messages);
      },
    },

    // --- Vault: Threads ---
    '/api/vault/threads': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const limit = Math.min(parseInt(params.get('limit') ?? '100') || 100, 500);
        const { listThreads } = require('../../vault/threads.ts');
        return json(listThreads(limit));
      },
      POST: async (req: Request) => {
        let title: string | undefined;
        try {
          const body = await req.json() as { title?: unknown };
          if (typeof body.title === 'string' && body.title.trim()) {
            title = body.title.trim();
          }
        } catch { /* empty body — title is optional */ }
        const { createThread } = require('../../vault/threads.ts');
        const thread = createThread(title);
        return json(thread, 201);
      },
    },

    '/api/vault/threads/search': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const q = params.get('q')?.trim();
        if (!q) return error('Missing query parameter: q');
        const { searchGlobalMemory } = require('../../vault/threads.ts');
        return json(searchGlobalMemory(q));
      },
    },

    '/api/vault/threads/:id': {
      GET: (req: Request & { params: { id: string } }) => {
        const { getThread } = require('../../vault/threads.ts');
        const thread = getThread(req.params.id);
        if (!thread) return error('Thread not found', 404);
        return json(thread);
      },
      PATCH: async (req: Request & { params: { id: string } }) => {
        let body: { title?: unknown };
        try { body = await req.json() as { title?: unknown }; } catch { return error('Invalid JSON'); }
        if (typeof body.title !== 'string' || !body.title.trim()) return error('title is required');
        const { updateThreadTitle } = require('../../vault/threads.ts');
        updateThreadTitle(req.params.id, body.title.trim());
        return json({ ok: true });
      },
      DELETE: (req: Request & { params: { id: string } }) => {
        const { getThread, deleteThread } = require('../../vault/threads.ts');
        const thread = getThread(req.params.id);
        if (!thread) return error('Thread not found', 404);
        deleteThread(req.params.id);
        return json({ ok: true });
      },
    },

    '/api/vault/threads/:id/messages': {
      GET: (req: Request & { params: { id: string } }) => {
        const params = getSearchParams(req);
        const limit = Math.min(parseInt(params.get('limit') ?? '50') || 50, 200);
        const { getThreadContext } = require('../../vault/threads.ts');
        return json(getThreadContext(req.params.id, limit));
      },
      POST: async (req: Request & { params: { id: string } }) => {
        let body: { role?: unknown; content?: unknown };
        try { body = await req.json() as { role?: unknown; content?: unknown }; } catch { return error('Invalid JSON'); }
        if (!['user', 'assistant', 'system'].includes(body.role as string)) return error('Invalid role');
        if (typeof body.content !== 'string' || !body.content.trim()) return error('content is required');
        const { saveMessage } = require('../../vault/threads.ts');
        const msg = saveMessage(req.params.id, body.role as 'user' | 'assistant' | 'system', body.content.trim());
        return json(msg, 201);
      },
    },

    '/api/vault/threads/:id/export': {
      GET: (req: Request & { params: { id: string } }) => {
        const { getThread, getThreadContext } = require('../../vault/threads.ts');
        const thread = getThread(req.params.id);
        if (!thread) return error('Thread not found', 404);

        const messages = getThreadContext(req.params.id, 500);

        const title = thread.title ?? 'Chat Export';
        const date = new Date(thread.started_at).toISOString().slice(0, 10);

        const roleLabel: Record<string, string> = {
          user: '**You**',
          assistant: '**JARVIS**',
          system: '_[system]_',
        };

        const lines: string[] = [
          `# ${title}`,
          `*Exported on ${new Date().toLocaleDateString()} — ${messages.length} messages*`,
          '',
          '---',
          '',
        ];

        for (const msg of messages) {
          const label = roleLabel[msg.role] ?? `**${msg.role}**`;
          const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          lines.push(`### ${label} _${time}_`);
          lines.push('');
          lines.push(msg.content);
          lines.push('');
          lines.push('---');
          lines.push('');
        }

        const md = lines.join('\n');
        const filename = `jarvis-chat-${date}-${req.params.id.slice(0, 8)}.md`;
        return new Response(md, {
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      },
    },

    // --- Vault: Observations ---
    '/api/vault/observations': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const type = params.get('type');
        const limit = parseInt(params.get('limit') ?? '50') || 50;
        const { getRecentObservations } = require('../../vault/observations.ts');
        return json(getRecentObservations(type as any, limit));
      },
    },

  };
}
