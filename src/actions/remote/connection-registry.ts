/**
 * Connection Registry — resolves named entries in `JarvisConfig.remote.connections`
 * into fully-formed `RemoteConnection`s with their ProxyJump chains expanded.
 *
 * Only the daemon holds one instance; tools call `resolve()` per invocation
 * (cheap — pure config lookup).
 */

import { homedir } from 'node:os';
import type { JarvisConfig, RemoteConnectionConfig } from '../../config/types.ts';
import type { RemoteConnection, ResolvedJumpHost } from './types.ts';

const MAX_VIA_DEPTH = 8;

export class ConnectionRegistry {
  private connections: Record<string, RemoteConnectionConfig>;

  constructor(config: JarvisConfig) {
    this.connections = config.remote?.connections ?? {};
  }

  /** Names available for tools/error messages. */
  list(): string[] {
    return Object.keys(this.connections);
  }

  /** Resolve a named connection, expanding `via:` into a jump chain. Returns null if unknown. */
  resolve(name: string): RemoteConnection | null {
    const cfg = this.connections[name];
    if (!cfg) return null;

    const jumpChain = this.resolveJumpChain(name);
    if (jumpChain === null) return null;

    // The terminal connection itself must have host+user (jumps can rely on ssh_config).
    if (!cfg.host || !cfg.user) return null;

    return {
      name,
      host: cfg.host,
      user: cfg.user,
      port: cfg.port,
      key: cfg.key ? expandTilde(cfg.key) : undefined,
      jumpChain,
      hypervisor: cfg.hypervisor,
      vm_user: cfg.vm_user,
    };
  }

  /** Walk `via:` chain starting from `name`'s parent (the destination is the head). */
  private resolveJumpChain(name: string): ResolvedJumpHost[] | null {
    const chain: ResolvedJumpHost[] = [];
    const seen = new Set<string>([name]);
    let cursor = this.connections[name]?.via;

    for (let depth = 0; cursor && depth < MAX_VIA_DEPTH; depth++) {
      if (seen.has(cursor)) return null; // cycle
      seen.add(cursor);

      const jump = this.connections[cursor];
      if (!jump || !jump.host || !jump.user) return null;

      chain.unshift({
        name: cursor,
        host: jump.host,
        user: jump.user,
        port: jump.port,
      });
      cursor = jump.via;
    }

    if (cursor) return null; // exceeded MAX_VIA_DEPTH
    return chain;
  }
}

export function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return `${homedir()}/${p.slice(2)}`;
  return p;
}

/** Render the jump chain as the value passed to `ssh -J`. */
export function formatJumpFlag(chain: ResolvedJumpHost[]): string {
  return chain
    .map((j) => {
      const userHost = `${j.user}@${j.host}`;
      return j.port ? `${userHost}:${j.port}` : userHost;
    })
    .join(',');
}
