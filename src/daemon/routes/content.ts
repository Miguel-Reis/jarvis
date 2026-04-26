/**
 * Content pipeline routes — content creation, stage management, attachments.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams } from './_shared.ts';
import { createContent, getContent, findContent, updateContent, deleteContent, advanceStage, regressStage, addStageNote, getStageNotes, addAttachment, getAttachment, getAttachments, deleteAttachment } from '../../vault/content-pipeline.ts';
import type { ContentStage, ContentType } from '../../vault/content-pipeline.ts';
import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

const BLOCKED_MIME_TYPES = new Set([
  'text/html', 'application/xhtml+xml', 'application/javascript', 'text/javascript',
  'image/svg+xml', 'application/x-httpd-php', 'application/x-sh', 'application/x-csh',
]);

function sanitizePathSegment(segment: string): string {
  return path.basename(segment.replace(/\.\./g, ''));
}

function isWithinBase(resolvedPath: string, baseDir: string): boolean {
  const normalizedBase = path.resolve(baseDir) + path.sep;
  const normalizedPath = path.resolve(resolvedPath);
  return normalizedPath.startsWith(normalizedBase) || normalizedPath === path.resolve(baseDir);
}

export function registerRoutes(ctx: ApiContext) {
  return {

    // --- Content Pipeline ---
    '/api/content': {
      GET: (req: Request) => {
        const params = getSearchParams(req);
        const stage = params.get('stage') as ContentStage | null;
        const content_type = params.get('type') as ContentType | null;
        const tag = params.get('tag');
        const query: { stage?: ContentStage; content_type?: ContentType; tag?: string } = {};
        if (stage) query.stage = stage;
        if (content_type) query.content_type = content_type;
        if (tag) query.tag = tag;
        return json(findContent(query));
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json() as {
            title: string;
            body?: string;
            content_type?: ContentType;
            stage?: ContentStage;
            tags?: string[];
            created_by?: string;
          };
          if (!body.title) return error('Missing "title" field');
          const item = createContent(body.title, {
            body: body.body,
            content_type: body.content_type,
            stage: body.stage,
            tags: body.tags,
            created_by: body.created_by,
          });
          ctx.wsService?.broadcastContentUpdate(item, 'created');
          return json(item, 201);
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/content/:id': {
      GET: (req: Request & { params: { id: string } }) => {
        const item = getContent(req.params.id);
        if (!item) return error('Content not found', 404);
        return json(item);
      },
      PATCH: async (req: Request & { params: { id: string } }) => {
        try {
          const body = await req.json() as {
            title?: string;
            body?: string;
            content_type?: ContentType;
            stage?: ContentStage;
            tags?: string[];
            scheduled_at?: number | null;
            published_at?: number | null;
            published_url?: string | null;
            sort_order?: number;
          };
          const updated = updateContent(req.params.id, body);
          if (!updated) return error('Content not found', 404);
          ctx.wsService?.broadcastContentUpdate(updated, 'updated');
          return json(updated);
        } catch (err) {
          return error('Invalid request body');
        }
      },
      DELETE: (req: Request & { params: { id: string } }) => {
        const existing = getContent(req.params.id);
        if (!existing) return error('Content not found', 404);
        deleteContent(req.params.id);
        ctx.wsService?.broadcastContentUpdate(existing, 'deleted');
        return json({ ok: true });
      },
    },

    '/api/content/:id/advance': {
      POST: (req: Request & { params: { id: string } }) => {
        const updated = advanceStage(req.params.id);
        if (!updated) return error('Cannot advance (not found or already at last stage)', 400);
        ctx.wsService?.broadcastContentUpdate(updated, 'updated');
        return json(updated);
      },
    },

    '/api/content/:id/regress': {
      POST: (req: Request & { params: { id: string } }) => {
        const updated = regressStage(req.params.id);
        if (!updated) return error('Cannot regress (not found or already at first stage)', 400);
        ctx.wsService?.broadcastContentUpdate(updated, 'updated');
        return json(updated);
      },
    },

    '/api/content/:id/notes': {
      GET: (req: Request & { params: { id: string } }) => {
        const params = getSearchParams(req);
        const stage = params.get('stage') as ContentStage | null;
        return json(getStageNotes(req.params.id, stage ?? undefined));
      },
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          const body = await req.json() as { stage: ContentStage; note: string; author?: string };
          if (!body.stage || !body.note) return error('Missing "stage" or "note" field');
          const note = addStageNote(req.params.id, body.stage, body.note, body.author);
          const item = getContent(req.params.id);
          if (item) ctx.wsService?.broadcastContentUpdate(item, 'updated');
          return json(note, 201);
        } catch (err) {
          return error('Invalid request body');
        }
      },
    },

    '/api/content/:id/attachments': {
      GET: (req: Request & { params: { id: string } }) => {
        return json(getAttachments(req.params.id));
      },
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          const contentId = req.params.id;
          const item = getContent(contentId);
          if (!item) return error('Content not found', 404);

          const formData = await req.formData();
          const file = formData.get('file') as File | null;
          if (!file) return error('Missing "file" in form data');

          if (file.size > MAX_UPLOAD_SIZE) {
            return error(`File too large. Maximum size is ${MAX_UPLOAD_SIZE / 1024 / 1024}MB`, 413);
          }

          const mimeType = file.type || 'application/octet-stream';
          if (BLOCKED_MIME_TYPES.has(mimeType)) {
            return error(`File type "${mimeType}" is not allowed`, 415);
          }

          const label = (formData.get('label') as string) || null;
          const safeName = path.basename(file.name);
          if (!safeName || safeName === '.' || safeName === '..') {
            return error('Invalid filename', 400);
          }

          const baseDir = path.join(os.homedir(), '.jarvis', 'content', contentId);
          if (!existsSync(baseDir)) {
            mkdirSync(baseDir, { recursive: true });
          }

          const diskPath = path.resolve(baseDir, safeName);
          if (!isWithinBase(diskPath, baseDir)) {
            return error('Invalid filename', 400);
          }

          await Bun.write(diskPath, file);
          const attachment = addAttachment(contentId, safeName, diskPath, mimeType, file.size, label ?? undefined);
          ctx.wsService?.broadcastContentUpdate(item, 'updated');
          return json(attachment, 201);
        } catch (err) {
          return error('File upload failed');
        }
      },
    },

    '/api/content/:id/attachments/:aid': {
      DELETE: (req: Request & { params: { id: string; aid: string } }) => {
        const attachment = getAttachment(req.params.aid);
        if (!attachment || attachment.content_id !== req.params.id) {
          return error('Attachment not found', 404);
        }
        const deleted = deleteAttachment(req.params.aid);
        if (!deleted) return error('Attachment not found', 404);
        const item = getContent(req.params.id);
        if (item) ctx.wsService?.broadcastContentUpdate(item, 'updated');
        return json({ ok: true });
      },
    },

    '/api/content/files/:contentId/:filename': {
      GET: async (req: Request & { params: { contentId: string; filename: string } }) => {
        const safeContentId = sanitizePathSegment(req.params.contentId);
        const safeFilename = sanitizePathSegment(req.params.filename);
        if (!safeContentId || !safeFilename) {
          return error('Invalid path', 400);
        }

        const baseDir = path.join(os.homedir(), '.jarvis', 'content');
        const filePath = path.resolve(baseDir, safeContentId, safeFilename);

        if (!isWithinBase(filePath, baseDir)) {
          return error('Invalid path', 400);
        }

        const file = Bun.file(filePath);
        if (!await file.exists()) {
          return error('File not found', 404);
        }

        return new Response(file, {
          headers: {
            'Content-Disposition': 'attachment',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      },
    },

  };
}
