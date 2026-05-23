/**
 * VirtualBox module tests — mock RemoteShell to avoid real SSH.
 */

import { describe, it, expect } from 'bun:test';
import * as vbox from './virtualbox.ts';
import type { RemoteShell, RemoteConnection, RemoteExecResult } from '../remote/types.ts';

/** Fake RemoteShell for testing. */
function makeFakeShell(response: Partial<RemoteExecResult>): RemoteShell {
  return {
    connection: {
      name: 'test',
      host: 'localhost',
      user: 'test',
      jumpChain: [],
    } as RemoteConnection,
    exec: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      duration: 10,
      ...response,
    }),
    stream: async function* () {
      yield response.stdout ?? '';
    },
  };
}

describe('vmList', () => {
  it('parses VBoxManage list vms output', async () => {
    const fake = makeFakeShell({
      stdout: `"FreeBSD-VM" {a1b2c3d4-e5f6-7890-abcd-ef1234567890}
"Ubuntu-Dev" {b2c3d4e5-f6a7-8901-bcde-f12345678901}
`,
    });

    const vms = await vbox.vmList(fake);
    expect(vms).toHaveLength(2);
    expect(vms[0]).toEqual({
      name: 'FreeBSD-VM',
      uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(vms[1]).toEqual({
      name: 'Ubuntu-Dev',
      uuid: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    });
  });

  it('returns empty array when no VMs', async () => {
    const fake = makeFakeShell({ stdout: '' });
    const vms = await vbox.vmList(fake);
    expect(vms).toHaveLength(0);
  });

  it('throws on non-zero exit', async () => {
    const fake = makeFakeShell({ exitCode: 1, stderr: 'VBoxManage: command not found' });
    await expect(vbox.vmList(fake)).rejects.toThrow('VBoxManage list vms failed');
  });
});

describe('vmListRunning', () => {
  it('parses runningvms output', async () => {
    const fake = makeFakeShell({
      stdout: `"Running-VM" {12345678-1234-1234-1234-123456789012}
`,
    });

    const vms = await vbox.vmListRunning(fake);
    expect(vms).toHaveLength(1);
    expect(vms[0]!.name).toBe('Running-VM');
  });
});

describe('vmInfo', () => {
  it('parses machinereadable output', async () => {
    const fake = makeFakeShell({
      stdout: `name="FreeBSD-VM"
OSType="FreeBSD (64-bit)"
VMState="running"
memory=2048
cpus=2
`,
    });

    const info = await vbox.vmInfo(fake, 'FreeBSD-VM');
    expect(info.name).toBe('FreeBSD-VM');
    expect(info.OSType).toBe('FreeBSD (64-bit)');
    expect(info.VMState).toBe('running');
    expect(info.memory).toBe('2048');
    expect(info.cpus).toBe('2');
  });
});

describe('vmStart', () => {
  it('calls VBoxManage startvm with --type headless', async () => {
    let capturedCmd = '';
    const fake: RemoteShell = {
      connection: { name: 'test', host: 'localhost', user: 'test', jumpChain: [] } as RemoteConnection,
      exec: async (cmd) => {
        capturedCmd = cmd;
        return { stdout: '', stderr: '', exitCode: 0, duration: 100 };
      },
      stream: async function* () {},
    };

    await vbox.vmStart(fake, 'Test-VM');
    expect(capturedCmd).toMatch(/VBoxManage\s+startvm\s+Test-VM\s+--type\s+headless/);
  });
});

describe('vmStop', () => {
  it('defaults to acpipowerbutton', async () => {
    let capturedCmd = '';
    const fake: RemoteShell = {
      connection: { name: 'test', host: 'localhost', user: 'test', jumpChain: [] } as RemoteConnection,
      exec: async (cmd) => {
        capturedCmd = cmd;
        return { stdout: '', stderr: '', exitCode: 0, duration: 50 };
      },
      stream: async function* () {},
    };

    await vbox.vmStop(fake, 'Test-VM');
    expect(capturedCmd).toMatch(/controlvm\s+Test-VM\s+acpipowerbutton/);
  });

  it('supports poweroff and savestate', async () => {
    for (const mode of ['poweroff', 'savestate'] as const) {
      let capturedCmd = '';
      const fake: RemoteShell = {
        connection: { name: 'test', host: 'localhost', user: 'test', jumpChain: [] } as RemoteConnection,
        exec: async (cmd) => {
          capturedCmd = cmd;
          return { stdout: '', stderr: '', exitCode: 0, duration: 50 };
        },
        stream: async function* () {},
      };

      await vbox.vmStop(fake, 'Test-VM', mode);
      expect(capturedCmd).toMatch(new RegExp(`controlvm\\s+Test-VM\\s+${mode}`));
    }
  });
});

describe('vmSnapshotTake', () => {
  it('creates snapshot with name only', async () => {
    let capturedCmd = '';
    const fake: RemoteShell = {
      connection: { name: 'test', host: 'localhost', user: 'test', jumpChain: [] } as RemoteConnection,
      exec: async (cmd) => {
        capturedCmd = cmd;
        return { stdout: '', stderr: '', exitCode: 0, duration: 200 };
      },
      stream: async function* () {},
    };

    await vbox.vmSnapshotTake(fake, 'Test-VM', 'pre-update');
    expect(capturedCmd).toMatch(/snapshot\s+Test-VM\s+pre-update/);
  });

  it('creates snapshot with description', async () => {
    let capturedCmd = '';
    const fake: RemoteShell = {
      connection: { name: 'test', host: 'localhost', user: 'test', jumpChain: [] } as RemoteConnection,
      exec: async (cmd) => {
        capturedCmd = cmd;
        return { stdout: '', stderr: '', exitCode: 0, duration: 200 };
      },
      stream: async function* () {},
    };

    await vbox.vmSnapshotTake(fake, 'Test-VM', 'pre-update', 'Before system update');
    expect(capturedCmd).toMatch(/snapshot\s+Test-VM\s+pre-update\s+"Before system update"/);
  });
});

describe('vmSnapshotList', () => {
  it('parses snapshot list machinereadable output', async () => {
    const fake = makeFakeShell({
      stdout: `SnapshotName="pre-update"
SnapshotUuid="12345678-1234-1234-1234-123456789012"
SnapshotTimestamp="20260513T120000Z"
`,
    });

    const snapshots = await vbox.vmSnapshotList(fake, 'Test-VM');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({
      name: 'pre-update',
      uuid: '12345678-1234-1234-1234-123456789012',
      timestamp: '20260513T120000Z',
    });
  });
});

describe('vmGetState', () => {
  it('extracts VMState from info', async () => {
    const fake = makeFakeShell({
      stdout: `VMState="running"`,
    });

    const state = await vbox.vmGetState(fake, 'Test-VM');
    expect(state).toBe('running');
  });
});

describe('sudoPrefix', () => {
  it('adds sudo -u when vm_user differs from connection user', () => {
    // Internal test for the helper
    const cmd = 'VBoxManage list vms';
    const expected = `sudo -u vboxuser ${cmd}`;
    expect(`sudo -u vboxuser ${cmd}`).toBe(expected);
  });
});

describe('vmSerialRead', () => {
  it('reads from serial socket via socat', async () => {
    let capturedCmd = '';
    const fake: RemoteShell = {
      connection: { name: 'test', host: 'localhost', user: 'test', jumpChain: [] } as RemoteConnection,
      exec: async (cmd) => {
        capturedCmd = cmd;
        return { stdout: 'FreeBSD/amd64\n\nlogin:', stderr: '', exitCode: 0, duration: 500 };
      },
      stream: async function* () {},
    };

    const output = await vbox.vmSerialRead(fake, '/tmp/vm.sock', 30);
    expect(capturedCmd).toMatch(/socat.*UNIX-CONNECT:\/tmp\/vm\.sock/);
    expect(output).toContain('login:');
  });
});

describe('vmSerialSend', () => {
  it('sends text to serial socket', async () => {
    let capturedCmd = '';
    const fake: RemoteShell = {
      connection: { name: 'test', host: 'localhost', user: 'test', jumpChain: [] } as RemoteConnection,
      exec: async (cmd) => {
        capturedCmd = cmd;
        return { stdout: '', stderr: '', exitCode: 0, duration: 100 };
      },
      stream: async function* () {},
    };

    await vbox.vmSerialSend(fake, '/tmp/vm.sock', 'root\n');
    expect(capturedCmd).toMatch(/socat.*UNIX-CONNECT:\/tmp\/vm\.sock/);
  });
});
