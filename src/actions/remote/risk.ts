/**
 * Classify a remote command into one of three risk tiers:
 *
 *   auto           — read-only, safe to execute without approval
 *   first_contact  — anything not destructive (covered by per-connection approval)
 *   destructive    — must be approved every single time
 */

export type RemoteCommandRisk = 'auto' | 'first_contact' | 'destructive';

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  // rm with a destructive flag (`-r`, `-R`, `-f`, or any combination, or --recursive / --force).
  // The lookahead requires the dash to be preceded by whitespace, so substrings
  // like `some-file` don't trigger.
  /\brm\b(?=[^|\n]*\s-[rRfI]+\b)/,
  /\brm\b(?=[^|\n]*\s--(?:recursive|force|no-preserve-root)\b)/,
  /\bdd\b/,
  /\bmkfs(\.\w+)?\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /\bpoweroff\b/,
  /\bpkg\s+(delete|remove)\b/,
  /\bapt(-get)?\s+(remove|purge|autoremove)\b/,
  /\byum\s+(remove|erase)\b/,
  /\bdnf\s+(remove|erase)\b/,
  /\bsystemctl\s+(stop|disable|mask)\b/,
  /\bservice\s+\S+\s+(stop|disable)\b/,
  /\bkill\s+-9\b/,
  /\bpkill\b/,
  /\bkillall\b/,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  /\bVBoxManage\b\s+controlvm\s+\S+\s+(poweroff|reset)/,
  /\bVBoxManage\b\s+unregistervm\b/,
  /\bVBoxManage\b\s+snapshot\s+\S+\s+delete\b/,
  /\bVBoxManage\b\s+modifyvm\b/,
];

const AUTO_PREFIXES = [
  'ls ', 'ls\n', 'ls\t',
  'cat ',
  'tail ', 'head ',
  'wc ',
  'stat ',
  'file ',
  'pwd',
  'whoami',
  'hostname',
  'uptime',
  'df ', 'df\n', 'df\t',
  'du ',
  'free ', 'free\n', 'free\t',
  'ps ', 'ps\n', 'ps\t',
  'uname',
  'id',
  'env',
  'echo ',
  'date',
  'which ',
  'type ',
  'grep ',
  'find ',
  'ip ',
  'ifconfig',
  'netstat',
  'ss ',
  'lsblk',
  'lscpu',
  'lsmod',
  'mount',
  'sysctl -a',
  'sysctl -n',
];

const AUTO_VBOX_SUBCOMMANDS = ['list', 'showvminfo', 'showhdinfo', 'getextradata'];

/**
 * Classify a command. The classifier is intentionally pessimistic:
 * anything that looks even mildly suspicious falls out of `auto`.
 */
export function classifyCommand(command: string): RemoteCommandRisk {
  const trimmed = command.trim();
  if (!trimmed) return 'first_contact';

  for (const pat of DESTRUCTIVE_PATTERNS) {
    if (pat.test(trimmed)) return 'destructive';
  }

  // sudo elevates ambiguity → never auto.
  if (/(^|\s)sudo(\s|$)/.test(trimmed)) return 'first_contact';

  // Reject anything compound: pipes, command-chaining, redirects, subshells,
  // backticks. Allowing these in `auto` makes the classifier unsound.
  if (/[|;&`$()<>]/.test(trimmed)) return 'first_contact';

  // Single-statement reads.
  for (const prefix of AUTO_PREFIXES) {
    if (trimmed === prefix.trim() || trimmed.startsWith(prefix)) return 'auto';
  }

  // Read-only VBoxManage subcommands.
  const vbox = /^VBoxManage\s+(\w+)/.exec(trimmed);
  if (vbox && AUTO_VBOX_SUBCOMMANDS.includes(vbox[1]!)) return 'auto';

  return 'first_contact';
}
