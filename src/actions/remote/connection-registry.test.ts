import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { ConnectionRegistry, expandTilde, formatJumpFlag } from './connection-registry.ts';
import { DEFAULT_CONFIG } from '../../config/types.ts';
import type { JarvisConfig } from '../../config/types.ts';

function withConnections(connections: JarvisConfig['remote']): JarvisConfig {
  return { ...DEFAULT_CONFIG, remote: connections };
}

describe('expandTilde', () => {
  test('expands ~ alone', () => {
    expect(expandTilde('~')).toBe(homedir());
  });

  test('expands ~/path', () => {
    expect(expandTilde('~/foo/bar')).toBe(`${homedir()}/foo/bar`);
  });

  test('leaves other paths untouched', () => {
    expect(expandTilde('/etc/passwd')).toBe('/etc/passwd');
    expect(expandTilde('relative/path')).toBe('relative/path');
  });
});

describe('ConnectionRegistry', () => {
  test('unknown name returns null', () => {
    const reg = new ConnectionRegistry(withConnections({ connections: {} }));
    expect(reg.resolve('nope')).toBeNull();
  });

  test('resolves a simple connection and expands key path', () => {
    const reg = new ConnectionRegistry(
      withConnections({
        connections: {
          homelab: { host: '1.2.3.4', user: 'miguel', key: '~/.ssh/id_ed25519' },
        },
      }),
    );
    const c = reg.resolve('homelab');
    expect(c).not.toBeNull();
    expect(c!.host).toBe('1.2.3.4');
    expect(c!.user).toBe('miguel');
    expect(c!.key).toBe(`${homedir()}/.ssh/id_ed25519`);
    expect(c!.jumpChain).toEqual([]);
  });

  test('resolves via: chain in order (jump first, destination last)', () => {
    const reg = new ConnectionRegistry(
      withConnections({
        connections: {
          bastion: { host: 'b.example', user: 'jump' },
          homelab: { host: '10.0.0.1', user: 'miguel', via: 'bastion' },
          inner: { host: '10.0.0.10', user: 'root', via: 'homelab' },
        },
      }),
    );
    const c = reg.resolve('inner');
    expect(c).not.toBeNull();
    // Chain order: bastion → homelab → (inner is the destination, not in chain)
    expect(c!.jumpChain.map((j) => j.name)).toEqual(['bastion', 'homelab']);
  });

  test('rejects cycles in via:', () => {
    const reg = new ConnectionRegistry(
      withConnections({
        connections: {
          a: { host: 'a', user: 'u', via: 'b' },
          b: { host: 'b', user: 'u', via: 'a' },
        },
      }),
    );
    expect(reg.resolve('a')).toBeNull();
  });

  test('rejects connection missing host or user', () => {
    const reg = new ConnectionRegistry(
      withConnections({
        connections: {
          broken: { user: 'miguel' } as never,
        },
      }),
    );
    expect(reg.resolve('broken')).toBeNull();
  });

  test('list returns configured names', () => {
    const reg = new ConnectionRegistry(
      withConnections({
        connections: {
          a: { host: 'a', user: 'u' },
          b: { host: 'b', user: 'u' },
        },
      }),
    );
    expect(reg.list().sort()).toEqual(['a', 'b']);
  });
});

describe('formatJumpFlag', () => {
  test('joins user@host pairs with commas, encoding port when present', () => {
    const flag = formatJumpFlag([
      { name: 'one', host: 'h1', user: 'u1' },
      { name: 'two', host: 'h2', user: 'u2', port: 2222 },
    ]);
    expect(flag).toBe('u1@h1,u2@h2:2222');
  });
});
