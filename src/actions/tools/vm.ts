/**
 * VM control tools — VirtualBox lifecycle over SSH.
 *
 * All tools are gated by ActionCategory `vm_control`, which is in the default
 * `governed_categories` set → destructive operations surface approval requests.
 */

import type { ToolDefinition } from './registry.ts';
import { getRemoteRegistry } from './remote.ts';
import { SSHExecutor } from '../remote/ssh-executor.ts';
import { classifyCommand } from '../remote/risk.ts';
import * as vbox from '../vm/virtualbox.ts';

/** Helper to resolve connection and return SSHExecutor. */
function getShell(connectionName: string): { shell: SSHExecutor; error?: string } {
  const registry = getRemoteRegistry();
  if (!registry) {
    return { shell: null as unknown as SSHExecutor, error: 'Remote connection registry not initialized' };
  }
  const conn = registry.resolve(connectionName);
  if (!conn) {
    const known = registry.list();
    return {
      shell: null as unknown as SSHExecutor,
      error: `Unknown remote connection '${connectionName}'. Known: ${known.length > 0 ? known.join(', ') : '(none)'}.`,
    };
  }
  return { shell: new SSHExecutor(conn) };
}

/** Format a result with risk + exit header. */
function formatResult(name: string, result: { stdout: string; stderr: string; exitCode: number; duration: number }, risk?: string): string {
  const riskLabel = risk ? ` • risk:${risk}` : '';
  const header = `[${name} • exit:${result.exitCode} • ${result.duration}ms${riskLabel}]`;
  let body = '';
  if (result.stdout) body += result.stdout;
  if (result.stderr) body += (body ? '\n' : '') + `[stderr] ${result.stderr}`;
  if (!body) body = '[no output]';
  return `${header}\n${body}`;
}

export const vmListTool: ToolDefinition = {
  name: 'vm_list',
  description: 'List all VMs on a remote VirtualBox host. Returns name + UUID for each VM.',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    running: {
      type: 'boolean',
      description: 'If true, list only running VMs',
      required: false,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const vms = params.running === true
      ? await vbox.vmListRunning(shell)
      : await vbox.vmList(shell);

    if (vms.length === 0) return 'No VMs found.';
    return vms.map((v) => `  ${v.name}  {${v.uuid}}`).join('\n');
  },
};

export const vmInfoTool: ToolDefinition = {
  name: 'vm_info',
  description: 'Get detailed information about a specific VM (state, memory, CPUs, etc.).',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    vm: {
      type: 'string',
      description: 'Name or UUID of the VM',
      required: true,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const info = await vbox.vmInfo(shell, params.vm as string);
    const lines = Object.entries(info).map(([k, v]) => `  ${k}: ${v}`);
    return lines.join('\n');
  },
};

export const vmStartTool: ToolDefinition = {
  name: 'vm_start',
  description: 'Start a VM in headless mode. Requires approval (destructive).',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    vm: {
      type: 'string',
      description: 'Name or UUID of the VM',
      required: true,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const result = await vbox.vmStart(shell, params.vm as string);
    return formatResult('vm_start', result, 'destructive');
  },
};

export const vmStopTool: ToolDefinition = {
  name: 'vm_stop',
  description: 'Stop a VM. mode: acpipowerbutton (graceful), poweroff (hard), or savestate.',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    vm: {
      type: 'string',
      description: 'Name or UUID of the VM',
      required: true,
    },
    mode: {
      type: 'string',
      description: 'Stop mode: acpipowerbutton, poweroff, or savestate',
      required: false,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const mode = (params.mode as 'acpipowerbutton' | 'poweroff' | 'savestate') || 'acpipowerbutton';
    const result = await vbox.vmStop(shell, params.vm as string, mode);
    return formatResult('vm_stop', result, 'destructive');
  },
};

export const vmSnapshotTakeTool: ToolDefinition = {
  name: 'vm_snapshot_take',
  description: 'Take a snapshot of a VM. Requires approval.',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    vm: {
      type: 'string',
      description: 'Name or UUID of the VM',
      required: true,
    },
    name: {
      type: 'string',
      description: 'Snapshot name',
      required: true,
    },
    description: {
      type: 'string',
      description: 'Optional snapshot description',
      required: false,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const result = await vbox.vmSnapshotTake(
      shell,
      params.vm as string,
      params.name as string,
      params.description as string | undefined,
    );
    return formatResult('vm_snapshot_take', result, 'destructive');
  },
};

export const vmSnapshotListTool: ToolDefinition = {
  name: 'vm_snapshot_list',
  description: 'List snapshots for a VM.',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    vm: {
      type: 'string',
      description: 'Name or UUID of the VM',
      required: true,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const snapshots = await vbox.vmSnapshotList(shell, params.vm as string);
    if (snapshots.length === 0) return 'No snapshots found.';
    return snapshots
      .map((s) => `  ${s.name}  {${s.uuid}}${s.timestamp ? `  (${s.timestamp})` : ''}`)
      .join('\n');
  },
};

export const vmSnapshotRestoreTool: ToolDefinition = {
  name: 'vm_snapshot_restore',
  description: 'Restore a VM to a snapshot. Requires approval (data loss potential).',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    vm: {
      type: 'string',
      description: 'Name or UUID of the VM',
      required: true,
    },
    snapshot: {
      type: 'string',
      description: 'Snapshot name to restore',
      required: true,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const result = await vbox.vmSnapshotRestore(shell, params.vm as string, params.snapshot as string);
    return formatResult('vm_snapshot_restore', result, 'destructive');
  },
};

export const vmSnapshotDeleteTool: ToolDefinition = {
  name: 'vm_snapshot_delete',
  description: 'Delete a snapshot. Requires approval (destructive).',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    vm: {
      type: 'string',
      description: 'Name or UUID of the VM',
      required: true,
    },
    snapshot: {
      type: 'string',
      description: 'Snapshot name to delete',
      required: true,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const result = await vbox.vmSnapshotDelete(shell, params.vm as string, params.snapshot as string);
    return formatResult('vm_snapshot_delete', result, 'destructive');
  },
};

export const vmGetStateTool: ToolDefinition = {
  name: 'vm_get_state',
  description: 'Get the current state of a VM (running, powered off, saved, etc.).',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    vm: {
      type: 'string',
      description: 'Name or UUID of the VM',
      required: true,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const state = await vbox.vmGetState(shell, params.vm as string);
    return `VM state: ${state}`;
  },
};

export const vmSerialReadTool: ToolDefinition = {
  name: 'vm_serial_read',
  description:
    'Read the last N lines from a VM serial console socket. Requires the VM to have UART1 configured with --uartmode1 server. Text sent here could be interpreted by a shell running on the VM — approval required if text contains newlines.',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    socketPath: {
      type: 'string',
      description: 'Path to the serial console socket on the remote host (e.g., /tmp/freebsd-vm-console.sock)',
      required: true,
    },
    lines: {
      type: 'number',
      description: 'Number of lines to read (default: 50)',
      required: false,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const lines = (params.lines as number) || 50;
    const output = await vbox.vmSerialRead(shell, params.socketPath as string, lines);
    return output || '[no output]';
  },
};

export const vmSerialSendTool: ToolDefinition = {
  name: 'vm_serial_send',
  description:
    'Send text to a VM serial console socket. WARNING: If the VM has a shell listening on the serial port, this text will be executed. Approval required for any text containing newlines.',
  category: 'vm-control',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    socketPath: {
      type: 'string',
      description: 'Path to the serial console socket on the remote host',
      required: true,
    },
    text: {
      type: 'string',
      description: 'Text to send to the serial console',
      required: true,
    },
  },
  execute: async (params) => {
    const { shell, error } = getShell(params.connection as string);
    if (error) return `Error: ${error}`;

    const text = params.text as string;
    const result = await vbox.vmSerialSend(shell, params.socketPath as string, text);
    return formatResult('vm_serial_send', result, text.includes('\n') ? 'destructive' : 'first_contact');
  },
};
