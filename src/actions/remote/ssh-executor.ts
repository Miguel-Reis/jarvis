/**
 * SSHExecutor — runs commands on a `RemoteConnection` over the system `ssh` binary.
 *
 * Why the system binary (not `ssh2`):
 *   • inherits ~/.ssh/config, ssh-agent, known_hosts, ProxyJump
 *   • ControlMaster gives free connection reuse — eliminates "persistent session" class
 *   • zero new dependencies
 *
 * Argv safety: host, user, key, and -o flags are passed as **separate argv tokens**.
 * They cannot be shell-interpolated. The remote command (last argv) is a single
 * string the *remote* shell parses — pipes/redirects/heredocs work as expected.
 */

import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { formatJumpFlag } from './connection-registry.ts';
import type {
  RemoteConnection,
  RemoteExecOptions,
  RemoteExecResult,
  RemoteShell,
} from './types.ts';

const CONTROL_DIR = `${homedir()}/.ssh`;
const CONTROL_PATH = `${CONTROL_DIR}/jarvis-cm-%r@%h:%p`;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT_CAP = 1_048_576; // 1 MiB

/** Subset of `Bun.spawn` we use — exported so tests can inject a fake. */
export type SpawnLike = (opts: {
  cmd: string[];
  stdin?: 'pipe' | 'inherit' | 'ignore' | ArrayBufferView | Blob | Request | Response | null;
  stdout?: 'pipe' | 'inherit' | 'ignore';
  stderr?: 'pipe' | 'inherit' | 'ignore';
}) => SpawnedProcess;

export type SpawnedProcess = {
  stdin?: { write(data: string): unknown; end(): unknown } | null;
  stdout?: ReadableStream<Uint8Array> | null;
  stderr?: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(): void;
};

export type SSHExecutorOptions = {
  /** Override Bun.spawn (tests only). */
  spawn?: SpawnLike;
  /** Skip auto-creating ~/.ssh (tests only). */
  ensureControlDir?: boolean;
};

export class SSHExecutor implements RemoteShell {
  readonly connection: RemoteConnection;
  private spawn: SpawnLike;

  constructor(connection: RemoteConnection, opts: SSHExecutorOptions = {}) {
    this.connection = connection;
    this.spawn = opts.spawn ?? (Bun.spawn as unknown as SpawnLike);
    if (opts.ensureControlDir !== false) ensureControlDir();
  }

  /** Build the full argv for `ssh`. Visible for tests. */
  buildArgv(command: string): string[] {
    const { host, user, port, key, jumpChain } = this.connection;
    const argv: string[] = [
      'ssh',
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${CONTROL_PATH}`,
      '-o', 'ControlPersist=60s',
    ];
    if (port) {
      argv.push('-p', String(port));
    }
    if (key) {
      argv.push('-i', key, '-o', 'IdentitiesOnly=yes');
    }
    if (jumpChain.length > 0) {
      argv.push('-J', formatJumpFlag(jumpChain));
    }
    argv.push(`${user}@${host}`, '--', command);
    return argv;
  }

  async exec(command: string, opts: RemoteExecOptions = {}): Promise<RemoteExecResult> {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
    const cap = opts.maxOutputBytes ?? DEFAULT_OUTPUT_CAP;
    const argv = this.buildArgv(command);
    const start = Date.now();

    const proc = this.spawn({
      cmd: argv,
      stdin: opts.input !== undefined ? 'pipe' : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (opts.input !== undefined && proc.stdin) {
      proc.stdin.write(opts.input);
      proc.stdin.end();
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    try {
      const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
        readCapped(proc.stdout, cap),
        readCapped(proc.stderr, cap),
        proc.exited,
      ]);

      const duration = Date.now() - start;
      const stdout = decode(stdoutBytes);
      let stderr = decode(stderrBytes);
      if (timedOut) {
        stderr += (stderr ? '\n' : '') + `[ssh timeout: killed after ${timeout}ms]`;
      }
      return {
        stdout,
        stderr,
        exitCode: exitCode ?? -1,
        duration,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async *stream(
    command: string,
    opts: Pick<RemoteExecOptions, 'input' | 'timeout'> = {},
  ): AsyncIterable<string> {
    const argv = this.buildArgv(command);
    const proc = this.spawn({
      cmd: argv,
      stdin: opts.input !== undefined ? 'pipe' : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (opts.input !== undefined && proc.stdin) {
      proc.stdin.write(opts.input);
      proc.stdin.end();
    }

    const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => proc.kill(), timeout);

    if (!proc.stdout) {
      clearTimeout(timer);
      throw new Error('ssh stream: no stdout');
    }

    const decoder = new TextDecoder();
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield decoder.decode(value, { stream: true });
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
      proc.kill();
    }
  }
}

function ensureControlDir(): void {
  try {
    if (!existsSync(CONTROL_DIR)) mkdirSync(CONTROL_DIR, { recursive: true, mode: 0o700 });
  } catch {
    // Non-fatal: ssh will surface a clearer error if it can't write.
  }
}

async function readCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.length > maxBytes) {
        const room = Math.max(0, maxBytes - total);
        if (room > 0) {
          chunks.push(value.subarray(0, room));
          total += room;
        }
        truncated = true;
        // Continue draining so the process can exit cleanly.
        continue;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total + (truncated ? TRUNC_NOTE.length : 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  if (truncated) out.set(new TextEncoder().encode(TRUNC_NOTE), off);
  return out;
}

const TRUNC_NOTE = '\n[output truncated]';

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
