/**
 * VirtualBox lifecycle operations over SSH.
 *
 * All functions accept a `RemoteShell` (from ssh-executor.ts) and invoke `VBoxManage`
 * on the remote host. The `vm_user` in the connection config determines which user
 * owns the VMs — if set, commands are prefixed with `sudo -u <vm_user>`.
 *
 * Design: functions, not a class. YAGNI until a second hypervisor arrives.
 */

import type { RemoteShell, RemoteExecResult } from '../remote/types.ts';

type SnapshotInfo = {
  name: string;
  uuid: string;
  timestamp?: string;
};

/** Build the sudo prefix if vm_user differs from connection user. */
function sudoPrefix(shell: RemoteShell, vm_user?: string): string {
  const connUser = shell.connection.user;
  if (vm_user && vm_user !== connUser) {
    return `sudo -u ${vm_user} `;
  }
  return '';
}

/** Execute a VBoxManage command and return raw result. */
async function vboxExec(
  shell: RemoteShell,
  subcommand: string,
  args: string[],
): Promise<RemoteExecResult> {
  const prefix = sudoPrefix(shell, shell.connection.vm_user);
  const cmd = `${prefix}VBoxManage ${subcommand} ${args.map(escapeArg).join(' ')}`;
  return shell.exec(cmd);
}

/** Escape a string argument for shell safety (VBoxManage args are simple). */
function escapeArg(arg: string): string {
  if (!arg.includes(' ') && !arg.includes('"') && !arg.includes("'")) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/** Parse `VBoxManage list vms` output into an array of {name, uuid}. */
export async function vmList(shell: RemoteShell): Promise<{ name: string; uuid: string }[]> {
  const result = await vboxExec(shell, 'list', ['vms']);
  if (result.exitCode !== 0) {
    throw new Error(`VBoxManage list vms failed: ${result.stderr || result.stdout}`);
  }

  const vms: { name: string; uuid: string }[] = [];
  const lines = result.stdout.split('\n');

  for (const line of lines) {
    // Format: "vmname" {uuid}
    const match = /^"([^"]+)"\s+\{([a-f0-9-]+)\}/i.exec(line.trim());
    if (match) {
      vms.push({ name: match[1]!, uuid: match[2]! });
    }
  }

  return vms;
}

/** Parse `VBoxManage list runningvms` output. */
export async function vmListRunning(shell: RemoteShell): Promise<{ name: string; uuid: string }[]> {
  const result = await vboxExec(shell, 'list', ['runningvms']);
  if (result.exitCode !== 0) {
    throw new Error(`VBoxManage list runningvms failed: ${result.stderr || result.stdout}`);
  }

  const vms: { name: string; uuid: string }[] = [];
  const lines = result.stdout.split('\n');

  for (const line of lines) {
    const match = /^"([^"]+)"\s+\{([a-f0-9-]+)\}/i.exec(line.trim());
    if (match) {
      vms.push({ name: match[1]!, uuid: match[2]! });
    }
  }

  return vms;
}

/** Get detailed VM info via --machinereadable. */
export async function vmInfo(shell: RemoteShell, vmName: string): Promise<Record<string, string>> {
  const result = await vboxExec(shell, 'showvminfo', [vmName, '--machinereadable']);
  if (result.exitCode !== 0) {
    throw new Error(`VBoxManage showvminfo failed: ${result.stderr || result.stdout}`);
  }

  const info: Record<string, string> = {};
  for (const line of result.stdout.split('\n')) {
    const match = /^(\w+)=("(.*)"|(.*))$/.exec(line.trim());
    if (match) {
      const key = match[1]!;
      const value = match[3] ?? match[4] ?? '';
      info[key] = value;
    }
  }

  return info;
}

/** Start a VM in headless mode. */
export async function vmStart(shell: RemoteShell, vmName: string): Promise<RemoteExecResult> {
  return vboxExec(shell, 'startvm', [vmName, '--type', 'headless']);
}

/** Stop a VM. mode: 'acpipowerbutton' (graceful) | 'poweroff' (hard) | 'savestate'. */
export async function vmStop(
  shell: RemoteShell,
  vmName: string,
  mode: 'acpipowerbutton' | 'poweroff' | 'savestate' = 'acpipowerbutton',
): Promise<RemoteExecResult> {
  return vboxExec(shell, 'controlvm', [vmName, mode]);
}

/** Take a snapshot. */
export async function vmSnapshotTake(
  shell: RemoteShell,
  vmName: string,
  snapshotName: string,
  description?: string,
): Promise<RemoteExecResult> {
  const args = [vmName, snapshotName];
  if (description) {
    args.push(description);
  }
  return vboxExec(shell, 'snapshot', args);
}

/** List snapshots for a VM. */
export async function vmSnapshotList(
  shell: RemoteShell,
  vmName: string,
): Promise<SnapshotInfo[]> {
  const result = await vboxExec(shell, 'snapshot', [vmName, 'list', '--machinereadable']);
  if (result.exitCode !== 0) {
    throw new Error(`VBoxManage snapshot list failed: ${result.stderr || result.stdout}`);
  }

  const snapshots: SnapshotInfo[] = [];
  const lines = result.stdout.split('\n');
  let current: Partial<SnapshotInfo> = {};

  for (const line of lines) {
    const match = /^(\w+)=("(.*)"|(.*))$/.exec(line.trim());
    if (match) {
      const key = match[1]!;
      const value = match[3] ?? match[4] ?? '';
      if (key === 'SnapshotName') {
        if (current.name) snapshots.push(current as SnapshotInfo);
        current = { name: value };
      } else if (key === 'SnapshotUuid' || key === 'SnapshotUUID') {
        current.uuid = value;
      } else if (key === 'SnapshotTimestamp') {
        current.timestamp = value;
      }
    }
  }

  if (current.name) {
    snapshots.push(current as SnapshotInfo);
  }

  return snapshots;
}

/** Restore a snapshot. */
export async function vmSnapshotRestore(
  shell: RemoteShell,
  vmName: string,
  snapshotName: string,
): Promise<RemoteExecResult> {
  return vboxExec(shell, 'snapshot', [vmName, 'restore', snapshotName]);
}

/** Delete a snapshot. */
export async function vmSnapshotDelete(
  shell: RemoteShell,
  vmName: string,
  snapshotName: string,
): Promise<RemoteExecResult> {
  return vboxExec(shell, 'snapshot', [vmName, 'delete', snapshotName]);
}

/** Get VM state (running, powered off, saved, etc.). */
export async function vmGetState(shell: RemoteShell, vmName: string): Promise<string> {
  const info = await vmInfo(shell, vmName);
  return info['VMState'] ?? 'unknown';
}

/**
 * Serial console access via socat over SSH.
 *
 * Prerequisites (run once on the remote host):
 *   VBoxManage modifyvm <vm> --uart1 0x3F8 4 --uartmode1 server /tmp/<vm>-console.sock
 *
 * On the guest (FreeBSD): set `console="comconsole"` in /boot/loader.conf.
 */

/** Read the last N lines from the serial console socket. */
export async function vmSerialRead(
  shell: RemoteShell,
  socketPath: string,
  lines: number = 50,
): Promise<string> {
  const prefix = sudoPrefix(shell, shell.connection.vm_user);
  // Use socat to read from the unix socket, then tail the output.
  // We read for a short timeout and grab the last N lines.
  const cmd = `${prefix}timeout 2 socat -u UNIX-CONNECT:${socketPath} - 2>/dev/null | tail -n ${lines}`;
  const result = await shell.exec(cmd);
  return result.stdout;
}

/** Send text to the serial console socket. */
export async function vmSerialSend(
  shell: RemoteShell,
  socketPath: string,
  text: string,
): Promise<RemoteExecResult> {
  const prefix = sudoPrefix(shell, shell.connection.vm_user);
  // socat writes to the unix socket. Text is echoed to the VM's serial port.
  const cmd = `echo ${JSON.stringify(text)} | ${prefix}socat - UNIX-CONNECT:${socketPath}`;
  return shell.exec(cmd);
}

/** Stream serial console output in real-time (for interactive sessions). */
export async function* vmSerialReadStream(
  shell: RemoteShell,
  socketPath: string,
  timeoutMs: number = 10000,
): AsyncIterable<string> {
  const prefix = sudoPrefix(shell, shell.connection.vm_user);
  const cmd = `${prefix}timeout ${timeoutMs / 1000} socat UNIX-CONNECT:${socketPath} -`;

  for await (const chunk of shell.stream(cmd)) {
    yield chunk;
  }
}
