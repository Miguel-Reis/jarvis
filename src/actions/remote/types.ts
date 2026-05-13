/**
 * Remote shell abstraction — used by `ssh-executor.ts` and consumed by `vm/`.
 *
 * Shape mirrors `CommandResult` from `actions/terminal/executor.ts` so existing
 * tooling that formats command results can be reused.
 */

export type RemoteExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
};

export type RemoteExecOptions = {
  /** Bytes piped to the remote command's stdin. */
  input?: string;
  /** Hard timeout in milliseconds. Default 30_000. */
  timeout?: number;
  /** Cap on captured output (stdout+stderr) in bytes. Default 1_048_576. */
  maxOutputBytes?: number;
};

/** Connection definition resolved from JarvisConfig.remote.connections. */
export type RemoteConnection = {
  name: string;
  host: string;
  user: string;
  port?: number;
  key?: string;
  /** Resolved jump-chain (names → `-J name1,name2`). Empty when no `via:`. */
  jumpChain: ResolvedJumpHost[];
  hypervisor?: 'virtualbox';
  vm_user?: string;
};

export type ResolvedJumpHost = {
  name: string;
  host: string;
  user: string;
  port?: number;
};

export interface RemoteShell {
  /** Execute a single command and return its full result. */
  exec(command: string, opts?: RemoteExecOptions): Promise<RemoteExecResult>;

  /** Stream stdout chunks as they arrive (kill on iterator return/throw). */
  stream(command: string, opts?: Pick<RemoteExecOptions, 'input' | 'timeout'>): AsyncIterable<string>;

  /** Connection this shell binds to. */
  readonly connection: RemoteConnection;
}
