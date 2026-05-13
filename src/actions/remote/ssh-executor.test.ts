import { describe, expect, test } from 'bun:test';
import { SSHExecutor, type SpawnLike, type SpawnedProcess } from './ssh-executor.ts';
import type { RemoteConnection } from './types.ts';

function makeConn(overrides: Partial<RemoteConnection> = {}): RemoteConnection {
  return {
    name: 'homelab',
    host: '1.2.3.4',
    user: 'miguel',
    key: '/home/u/.ssh/id_ed25519',
    jumpChain: [],
    ...overrides,
  };
}

function makeProc(opts: { stdout?: string; stderr?: string; exit?: number } = {}): SpawnedProcess {
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts.stdout) controller.enqueue(new TextEncoder().encode(opts.stdout));
      controller.close();
    },
  });
  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      if (opts.stderr) controller.enqueue(new TextEncoder().encode(opts.stderr));
      controller.close();
    },
  });
  return {
    stdin: { write: () => undefined, end: () => undefined },
    stdout,
    stderr,
    exited: Promise.resolve(opts.exit ?? 0),
    kill: () => undefined,
  };
}

describe('SSHExecutor.buildArgv', () => {
  test('host/user are argv tokens, not shell-interpolated', () => {
    const exec = new SSHExecutor(makeConn(), { ensureControlDir: false });
    const argv = exec.buildArgv('ls /etc');

    expect(argv[0]).toBe('ssh');
    expect(argv).toContain('miguel@1.2.3.4');

    // The command is a SINGLE final argv token (the remote shell parses it).
    expect(argv[argv.length - 1]).toBe('ls /etc');
    expect(argv[argv.length - 2]).toBe('--');
  });

  test('passes ControlMaster / BatchMode flags', () => {
    const exec = new SSHExecutor(makeConn(), { ensureControlDir: false });
    const argv = exec.buildArgv('whoami');
    expect(argv).toContain('BatchMode=yes');
    expect(argv).toContain('ControlMaster=auto');
    expect(argv).toContain('ControlPersist=60s');
    expect(argv.some((a) => a.startsWith('ControlPath='))).toBe(true);
  });

  test('-i / -p / -J appear only when set', () => {
    const conn = makeConn({
      port: 2222,
      key: '/k/id',
      jumpChain: [{ name: 'bastion', host: 'b', user: 'j', port: 22 }],
    });
    const argv = new SSHExecutor(conn, { ensureControlDir: false }).buildArgv('id');
    expect(argv).toContain('-p');
    expect(argv).toContain('2222');
    expect(argv).toContain('-i');
    expect(argv).toContain('/k/id');
    expect(argv).toContain('-J');
    expect(argv).toContain('j@b:22');
  });

  test('a command containing shell metacharacters is NOT split — passed as one token', () => {
    const exec = new SSHExecutor(makeConn(), { ensureControlDir: false });
    const dangerous = "echo 'a; rm -rf /' | wc -l";
    const argv = exec.buildArgv(dangerous);
    // The argv places the command as a single trailing token regardless of content.
    // Local shell can't interpret it because we never go through a local shell.
    expect(argv[argv.length - 1]).toBe(dangerous);
  });
});

describe('SSHExecutor.exec', () => {
  test('captures stdout/stderr/exit and reports duration', async () => {
    let receivedCmd: string[] = [];
    const fakeSpawn: SpawnLike = (opts) => {
      receivedCmd = opts.cmd;
      return makeProc({ stdout: 'hello\n', stderr: '', exit: 0 });
    };
    const exec = new SSHExecutor(makeConn(), { spawn: fakeSpawn, ensureControlDir: false });
    const result = await exec.exec('echo hello');
    expect(result.stdout).toBe('hello\n');
    expect(result.exitCode).toBe(0);
    expect(receivedCmd).toContain('echo hello');
  });

  test('non-zero exit surfaces in the result', async () => {
    const fakeSpawn: SpawnLike = () => makeProc({ stdout: '', stderr: 'no such file\n', exit: 2 });
    const exec = new SSHExecutor(makeConn(), { spawn: fakeSpawn, ensureControlDir: false });
    const result = await exec.exec('ls /nope');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('no such file');
  });

  test('writes stdin when input is provided', async () => {
    let written = '';
    const fakeSpawn: SpawnLike = () => ({
      stdin: {
        write(data: string) {
          written = data;
          return undefined;
        },
        end() {
          return undefined;
        },
      },
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(0),
      kill: () => undefined,
    });
    const exec = new SSHExecutor(makeConn(), { spawn: fakeSpawn, ensureControlDir: false });
    await exec.exec('cat', { input: 'piped-payload' });
    expect(written).toBe('piped-payload');
  });
});
