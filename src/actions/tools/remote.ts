/**
 * Remote shell tools — execute commands on hosts defined in `remote.connections`.
 *
 * `ssh_run` is gated by ActionCategory `remote_shell`, which is in the default
 * `governed_categories` set → every call surfaces an approval request through
 * the existing ApprovalManager pipeline.
 */

import type { ToolDefinition } from './registry.ts';
import type { ConnectionRegistry } from '../remote/connection-registry.ts';
import { SSHExecutor } from '../remote/ssh-executor.ts';
import { classifyCommand } from '../remote/risk.ts';

let registry: ConnectionRegistry | null = null;

/** Inject the registry at daemon startup. */
export function setRemoteRegistry(reg: ConnectionRegistry): void {
  registry = reg;
}

export function getRemoteRegistry(): ConnectionRegistry | null {
  return registry;
}

export const sshRunTool: ToolDefinition = {
  name: 'ssh_run',
  description:
    'Run a shell command on a remote host over SSH. The "connection" must be a name from config (remote.connections). ' +
    'Pipes/redirects/heredocs are allowed — they are parsed by the remote shell, not the local one. ' +
    'Optional "input" is piped to the remote command\'s stdin.',
  category: 'remote-shell',
  parameters: {
    connection: {
      type: 'string',
      description: 'Name of a connection in config (remote.connections)',
      required: true,
    },
    command: {
      type: 'string',
      description: 'Shell command to run on the remote host',
      required: true,
    },
    input: {
      type: 'string',
      description: 'Optional stdin for the remote command',
      required: false,
    },
    timeout: {
      type: 'number',
      description: 'Timeout in milliseconds (default: 30000)',
      required: false,
    },
  },
  execute: async (params) => {
    if (!registry) {
      return 'Error: Remote connection registry not initialized. Configure remote.connections in config.yaml and restart.';
    }
    const name = params.connection as string;
    const command = params.command as string;
    if (!name || !command) {
      return 'Error: "connection" and "command" are both required.';
    }

    const conn = registry.resolve(name);
    if (!conn) {
      const known = registry.list();
      return `Error: Unknown remote connection '${name}'. Known: ${known.length > 0 ? known.join(', ') : '(none configured)'}.`;
    }

    const exec = new SSHExecutor(conn);
    const result = await exec.exec(command, {
      input: params.input as string | undefined,
      timeout: params.timeout as number | undefined,
    });

    const risk = classifyCommand(command);
    const header = `[${name} • risk:${risk} • exit:${result.exitCode} • ${result.duration}ms]`;

    let body = '';
    if (result.stdout) body += result.stdout;
    if (result.stderr) body += (body ? '\n' : '') + `[stderr] ${result.stderr}`;
    if (!body) body = '[no output]';

    return `${header}\n${body}`;
  },
};

export const listRemoteConnectionsTool: ToolDefinition = {
  name: 'list_remote_connections',
  description: 'List the named remote connections configured under remote.connections in config.yaml.',
  category: 'remote-shell',
  parameters: {},
  execute: async () => {
    if (!registry) return '[remote connections not initialized]';
    const names = registry.list();
    if (names.length === 0) return '[no remote connections configured]';
    const rows = names.map((n) => {
      const c = registry!.resolve(n);
      if (!c) return `  ${n}  (invalid)`;
      const via = c.jumpChain.length > 0 ? `  via=${c.jumpChain.map((j) => j.name).join('→')}` : '';
      const hyp = c.hypervisor ? `  hypervisor=${c.hypervisor}` : '';
      return `  ${n}  ${c.user}@${c.host}${c.port ? `:${c.port}` : ''}${via}${hyp}`;
    });
    return `Configured remote connections:\n${rows.join('\n')}`;
  },
};
