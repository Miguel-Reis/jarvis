# Remote VMs over SSH

Jarvis can drive remote hosts (and VMs running on them) via the system `ssh` binary. Phase 1 ships the foundation: a registry of named connections and an `ssh_run` tool that proxies arbitrary commands.

## Configure a connection

Add an entry under `remote.connections` in `~/.jarvis/config.yaml`:

```yaml
remote:
  connections:
    homelab:
      host: 192.168.1.50
      user: miguel
      key: ~/.ssh/id_ed25519
      hypervisor: virtualbox    # optional — informs future vm_* tools
      vm_user: miguel           # optional — owner of VBoxManage VMs
    freebsd-vm:
      via: homelab              # ProxyJump through homelab
      host: 10.0.0.10
      user: root
```

Each entry maps to one named connection. `via:` chains are followed up to 8 deep; cycles are rejected at resolve time.

Tools see only the **names**, never raw command-line flags. The `ssh` argv built by `SSHExecutor` keeps host/user/key/port as separate argv tokens — they can never be interpolated into the command string.

## Authentication

The native `ssh` binary is invoked with `BatchMode=yes`, so anything that requires an interactive prompt (password, host-key TOFU) will fail fast. Set up keys and `known_hosts` beforehand:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519 miguel@192.168.1.50
ssh -o StrictHostKeyChecking=accept-new miguel@192.168.1.50 true
```

## Connection reuse

ControlMaster is on by default. The first `ssh_run` to a host opens a master connection (`~/.ssh/jarvis-cm-<user>@<host>:<port>`); subsequent calls reuse it for ~60 seconds after the last command finishes. There is no persistent-session class — the OS does the multiplexing.

## Approvals

`ssh_run` is in the default `authority.governed_categories` list (`remote_shell`). Every call surfaces an approval request through the same pipeline that handles `send_email` and `make_payment`.

To loosen this for a specific tool or connection, add a context rule:

```yaml
authority:
  context_rules:
    - id: allow-ssh-to-homelab
      action: remote_shell
      condition: tool_name
      params:
        tool_name: ssh_run     # matches by prefix
      effect: allow
      description: Auto-approve all SSH commands routed via ssh_run
```

A future PR will use `vault.remote_connection_log` and the classifier in `src/actions/remote/risk.ts` to skip approval for read-only commands on already-trusted (connection, role) pairs.

## WSL2 quirk

Inside WSL2, `~/.ssh` is the **WSL home directory**, not the Windows one. Copy or symlink keys there:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cp /mnt/c/Users/<you>/.ssh/id_ed25519 ~/.ssh/
chmod 600 ~/.ssh/id_ed25519
```

## VM control (preview)

Phases 2 and 3 (not yet shipped) will add `vm_list`, `vm_start`, `vm_stop`, `vm_snapshot_*`, and `vm_serial_*` tools that call `VBoxManage` through the same `RemoteShell`. Until then, drive `VBoxManage` directly through `ssh_run`:

```
ssh_run({connection: "homelab", command: "VBoxManage list vms"})
ssh_run({connection: "homelab", command: "VBoxManage startvm freebsd-vm --type headless"})
```

For headless serial console access, configure the VM once:

```
VBoxManage modifyvm <vm> --uart1 0x3F8 4 --uartmode1 server /tmp/<vm>-console.sock
```

…and on the FreeBSD guest, set `console="comconsole"` in `/boot/loader.conf`. Phase 3 will wrap this with `vm_serial_read` / `vm_serial_send`.
