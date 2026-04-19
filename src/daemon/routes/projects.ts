/**
 * Project routes — project management and sites builder.
 * Extracted from api-routes.ts.
 */

import type { ApiContext } from '../api-routes';
import { json, error, getSearchParams } from './_shared.ts';
import { createProject, listProjects, getProject, updateProject, deleteProject, getActiveProjectId, setActiveProjectId } from '../../vault/projects.ts';

export function registerRoutes(ctx: ApiContext) {
  return {

    // ── Projects ────────────────────────────────────────────────────────
    '/api/projects': {
      GET: () => {
        return json({ projects: listProjects(), activeProjectId: getActiveProjectId() });
      },
      POST: async (req: Request) => {
        const body = await req.json() as { name?: string; description?: string; path?: string; color?: string };
        if (!body.name?.trim()) return error('name is required');
        const project = createProject(body.name.trim(), { description: body.description, path: body.path, color: body.color });
        return json({ ok: true, project });
      },
    },

    '/api/projects/active': {
      GET: () => {
        const id = getActiveProjectId();
        return json({ project: id ? getProject(id) : null });
      },
      PUT: async (req: Request) => {
        const body = await req.json() as { id?: string | null };
        setActiveProjectId(body.id ?? null);
        return json({ ok: true });
      },
    },

    '/api/projects/:id': {
      GET: (req: Request) => {
        const id = decodeURIComponent(new URL(req.url).pathname.split('/').pop()!);
        const project = getProject(id);
        if (!project) return error('Project not found', 404);
        return json(project);
      },
      PUT: async (req: Request) => {
        const id = decodeURIComponent(new URL(req.url).pathname.split('/').pop()!);
        const body = await req.json() as { name?: string; description?: string; path?: string; color?: string };
        const project = updateProject(id, body);
        if (!project) return error('Project not found', 404);
        return json({ ok: true, project });
      },
      DELETE: (req: Request) => {
        const id = decodeURIComponent(new URL(req.url).pathname.split('/').pop()!);
        if (!deleteProject(id)) return error('Project not found', 404);
        if (getActiveProjectId() === id) setActiveProjectId(null);
        return json({ ok: true });
      },
    },

    // ── Documents ───────────────────────────────────────────────────────
    '/api/documents': {
      GET: (req: Request) => {
        try {
          const { findDocuments } = require('../../vault/documents.ts');
          const url = new URL(req.url);
          const format = url.searchParams.get('format') || undefined;
          const tag = url.searchParams.get('tag') || undefined;
          const search = url.searchParams.get('search') || undefined;
          const query = (format || tag || search) ? { format, tag, search } : undefined;
          return json(findDocuments(query));
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/documents/:id': {
      GET: (req: Request) => {
        try {
          const { getDocument } = require('../../vault/documents.ts');
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 1]!;
          const doc = getDocument(id);
          if (!doc) return error('Document not found', 404);
          return json(doc);
        } catch (err) { return error(`${err}`); }
      },
      DELETE: (req: Request) => {
        try {
          const { deleteDocument } = require('../../vault/documents.ts');
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 1]!;
          const deleted = deleteDocument(id);
          if (!deleted) return error('Document not found', 404);
          return json({ ok: true });
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/documents/:id/download': {
      GET: (req: Request) => {
        try {
          const { getDocument } = require('../../vault/documents.ts');
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          const doc = getDocument(id);
          if (!doc) return error('Document not found', 404);

          const ext: Record<string, string> = {
            markdown: '.md', plain: '.txt', html: '.html',
            json: '.json', csv: '.csv', code: '.txt',
          };
          const mime: Record<string, string> = {
            markdown: 'text/markdown', plain: 'text/plain', html: 'text/plain',
            json: 'application/json', csv: 'text/csv', code: 'text/plain',
          };

          const filename = doc.title.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_') + (ext[doc.format] || '.txt');

          return new Response(doc.body, {
            headers: {
              'Content-Type': mime[doc.format] || 'text/plain',
              'Content-Disposition': `attachment; filename="${filename}"`,
              'X-Content-Type-Options': 'nosniff',
            },
          });
        } catch (err) { return error(`${err}`); }
      },
    },

    // ── Sidecars ────────────────────────────────────────────────────────
    '/api/sidecars': {
      GET: () => {
        try {
          if (!ctx.sidecarManager) return error('Sidecar manager not available', 503);
          return json(ctx.sidecarManager.listSidecars());
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/sidecars/enroll': {
      POST: async (req: Request) => {
        try {
          if (!ctx.sidecarManager) return error('Sidecar manager not available', 503);
          const body = await req.json() as { name?: string };
          if (!body.name) return error('Missing "name" field');
          const result = await ctx.sidecarManager.enrollSidecar(body.name);
          return json(result, 201);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('already enrolled') || msg.includes('may only contain')) {
            return error(msg, 409);
          }
          return error(msg);
        }
      },
    },

    '/api/sidecars/.well-known/jwks.json': {
      GET: () => {
        try {
          if (!ctx.sidecarManager) return error('Sidecar manager not available', 503);
          return json(ctx.sidecarManager.getJwks());
        } catch (err) { return error(`${err}`); }
      },
    },

    '/api/sidecars/:id/config': {
      GET: async (req: Request) => {
        try {
          if (!ctx.sidecarManager) return error('Sidecar manager not available', 503);
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          if (!ctx.sidecarManager.isConnected(id)) {
            return error('Sidecar is not connected', 409);
          }
          const result = await ctx.sidecarManager.dispatchRPC(id, 'get_config', {});
          return json(result);
        } catch (err) { return error(`${err}`, 500); }
      },
      PATCH: async (req: Request) => {
        try {
          if (!ctx.sidecarManager) return error('Sidecar manager not available', 503);
          const url = new URL(req.url);
          const parts = url.pathname.split('/');
          const id = parts[parts.length - 2]!;
          if (!ctx.sidecarManager.isConnected(id)) {
            return error('Sidecar is not connected', 409);
          }
          const body = await req.json() as Record<string, unknown>;
          delete body.token;
          const result = await ctx.sidecarManager.dispatchRPC(id, 'update_config', body);
          return json(result);
        } catch (err) { return error(`${err}`, 500); }
      },
    },

    '/api/sidecars/:id': {
      GET: (req: Request) => {
        try {
          if (!ctx.sidecarManager) return error('Sidecar manager not available', 503);
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          const sidecar = ctx.sidecarManager.getSidecar(id);
          if (!sidecar) return error('Sidecar not found', 404);
          return json(sidecar);
        } catch (err) { return error(`${err}`); }
      },
      DELETE: (req: Request) => {
        try {
          if (!ctx.sidecarManager) return error('Sidecar manager not available', 503);
          const url = new URL(req.url);
          const id = url.pathname.split('/').pop()!;
          const revoked = ctx.sidecarManager.revokeSidecar(id);
          if (!revoked) return error('Sidecar not found or already revoked', 404);
          return json({ success: true });
        } catch (err) { return error(`${err}`); }
      },
    },

    // ── Site Builder ───────────────────────────────────────────────────
    '/api/sites/templates': {
      GET: () => {
        const { TEMPLATES } = require('../../sites/templates.ts');
        return json(TEMPLATES);
      },
    },

    '/api/sites/git/check': {
      GET: async () => {
        const { GitManager } = require('../../sites/git-manager.ts');
        const installed = await GitManager.isInstalled();
        if (!installed) return json({ installed: false, authorName: null, authorEmail: null });
        const author = await GitManager.getGlobalAuthor();
        return json({ installed: true, authorName: author.name, authorEmail: author.email });
      },
    },

    '/api/sites/projects': {
      GET: async () => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const projects = await ctx.siteBuilderService.listProjectsWithStatus();
        return json(projects);
      },
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        try {
          const body = await req.json() as { name: string; template: string; gitAuthor?: { name: string; email: string; global: boolean } };
          if (!body.name || !body.template) return error('name and template are required');
          const project = await ctx.siteBuilderService.projectManager.createProject(body.name, body.template, body.gitAuthor);
          return json(project, 201);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id': {
      GET: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const project = await ctx.siteBuilderService.getProjectWithStatus(id);
        if (!project) return error('Project not found', 404);
        return json(project);
      },
      DELETE: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        try {
          await ctx.siteBuilderService.stopProject(id);
          await ctx.siteBuilderService.projectManager.deleteProject(id);
          return json({ ok: true });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/start': {
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        try {
          const project = await ctx.siteBuilderService.startProject(id);
          return json(project);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/stop': {
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        try {
          await ctx.siteBuilderService.stopProject(id);
          return json({ ok: true });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/logs': {
      GET: (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const limit = parseInt(getSearchParams(req).get('limit') ?? '100', 10);
        const logs = ctx.siteBuilderService.devServerManager.getLogs(id, limit);
        return json({ logs });
      },
    },

    '/api/sites/projects/:id/files': {
      GET: (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        try {
          const tree = ctx.siteBuilderService.projectManager.getFileTree(id);
          return json(tree);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/file': {
      GET: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const filePath = getSearchParams(req).get('path');
        if (!filePath) return error('path query parameter is required');
        try {
          const content = await ctx.siteBuilderService.projectManager.readFile(id, filePath);
          return json({ path: filePath, content });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err), 404);
        }
      },
      PUT: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        try {
          const body = await req.json() as { path: string; content: string };
          if (!body.path || body.content === undefined) return error('path and content are required');
          await ctx.siteBuilderService.projectManager.writeFile(id, body.path, body.content);

          const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
          if (projectPath) {
            await ctx.siteBuilderService.gitManager.autoCommit(projectPath, `Update ${body.path}`);
          }

          return json({ ok: true });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    // --- Site Builder: Git ---
    '/api/sites/projects/:id/git/branches': {
      GET: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const branches = await ctx.siteBuilderService.gitManager.getBranches(projectPath);
          return json(branches);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const body = await req.json() as { name: string };
          if (!body.name) return error('name is required');
          await ctx.siteBuilderService.gitManager.createBranch(projectPath, body.name);
          return json({ ok: true, branch: body.name });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/git/branch': {
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const body = await req.json() as { name: string };
          if (!body.name) return error('name is required');
          await ctx.siteBuilderService.gitManager.switchBranch(projectPath, body.name);
          return json({ ok: true, branch: body.name });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/git/log': {
      GET: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        const limit = parseInt(getSearchParams(req).get('limit') ?? '50', 10);
        try {
          const commits = await ctx.siteBuilderService.gitManager.getLog(projectPath, limit);
          return json(commits);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/git/diff': {
      GET: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const diff = await ctx.siteBuilderService.gitManager.getDiff(projectPath);
          return json({ diff });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/git/commit': {
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const body = await req.json() as { message: string };
          if (!body.message) return error('message is required');
          const commit = await ctx.siteBuilderService.gitManager.autoCommit(projectPath, body.message);
          if (!commit) return json({ ok: false, message: 'Nothing to commit' });
          return json({ ok: true, commit });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/git/merge': {
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const body = await req.json() as { branch: string; strategy?: 'merge' | 'rebase' };
          if (!body.branch) return error('branch is required');

          const result = body.strategy === 'rebase'
            ? await ctx.siteBuilderService.gitManager.rebase(projectPath, body.branch)
            : await ctx.siteBuilderService.gitManager.merge(projectPath, body.branch);

          return json(result);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    // --- Site Builder: GitHub Integration ---
    '/api/sites/github/token': {
      GET: async () => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const gh = ctx.siteBuilderService.githubManager;
        if (!gh.hasToken()) return json({ hasToken: false, username: null });
        const { valid, username } = await gh.validateToken();
        return json({ hasToken: valid, username });
      },
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        try {
          const body = await req.json() as { token: string };
          if (!body.token) return error('token is required');
          const gh = ctx.siteBuilderService.githubManager;
          gh.setToken(body.token);
          const { valid, username, scopes } = await gh.validateToken();
          if (!valid) {
            gh.deleteToken();
            return error('Invalid token — could not authenticate with GitHub', 401);
          }
          return json({ ok: true, username, scopes });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
      DELETE: () => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        ctx.siteBuilderService.githubManager.deleteToken();
        return json({ ok: true });
      },
    },

    '/api/sites/github/repos': {
      GET: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        try {
          const page = parseInt(getSearchParams(req).get('page') ?? '1', 10);
          const repos = await ctx.siteBuilderService.githubManager.listUserRepos(page);
          return json(repos);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/github/repo': {
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const body = await req.json() as {
            name?: string; description?: string; private?: boolean;
            existingRepo?: string;
          };
          const gh = ctx.siteBuilderService.githubManager;
          let owner: string, repo: string, cloneUrl: string, htmlUrl: string;

          if (body.existingRepo) {
            const [o, r] = body.existingRepo.split('/');
            if (!o || !r) return error('existingRepo must be in "owner/repo" format');
            const info = await gh.getRepo(o, r);
            owner = info.owner; repo = info.repo; cloneUrl = info.cloneUrl; htmlUrl = info.htmlUrl;
          } else {
            if (!body.name) return error('name is required (or provide existingRepo)');
            const info = await gh.createRepo({
              name: body.name,
              description: body.description,
              private: body.private ?? true,
            });
            owner = info.owner; repo = info.repo; cloneUrl = info.cloneUrl; htmlUrl = info.htmlUrl;
          }

          await gh.addRemote(projectPath, cloneUrl);

          await ctx.siteBuilderService.projectManager.updateGitHubMeta(id, {
            owner, repo, remoteUrl: cloneUrl, lastPushedAt: null,
          });

          const project = await ctx.siteBuilderService.getProjectWithStatus(id);
          return json(project, 201);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
      DELETE: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          await ctx.siteBuilderService.githubManager.removeRemote(projectPath);
          await ctx.siteBuilderService.projectManager.updateGitHubMeta(id, null);
          return json({ ok: true });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/github/push': {
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const body = await req.json().catch(() => ({})) as { force?: boolean };
          const result = await ctx.siteBuilderService.githubManager.push(projectPath, undefined, body.force);
          if (!result.success) return error(result.error ?? 'Push failed');

          const project = ctx.siteBuilderService.projectManager.getProject(id);
          if (project?.githubUrl) {
            const { readFileSync } = require('node:fs');
            const { join } = require('node:path');
            const meta = readFileSync(join(projectPath, '.jarvis-project.json'), 'utf-8');
            const parsed = JSON.parse(meta);
            if (parsed.github) {
              parsed.github.lastPushedAt = Date.now();
              const { Bun } = require('bun');
              await Bun.write(join(projectPath, '.jarvis-project.json'), JSON.stringify(parsed, null, 2));
            }
          }

          return json({ ok: true });
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/github/pull': {
      POST: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const result = await ctx.siteBuilderService.githubManager.pull(projectPath);
          return json(result);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

    '/api/sites/projects/:id/github/status': {
      GET: async (req: Request) => {
        if (!ctx.siteBuilderService) return error('Site builder not available', 503);
        const id = new URL(req.url).pathname.split('/')[4]!;
        const projectPath = ctx.siteBuilderService.projectManager.getProjectPath(id);
        if (!projectPath) return error('Project not found', 404);
        try {
          const status = await ctx.siteBuilderService.githubManager.getRemoteStatus(projectPath);
          return json(status);
        } catch (err) {
          return error(err instanceof Error ? err.message : String(err));
        }
      },
    },

  };
}
