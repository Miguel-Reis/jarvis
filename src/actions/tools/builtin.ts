/**
 * Built-in Tools — The Hands
 *
 * Concrete tool implementations that the agent can call:
 * run_command, read_file, write_file, list_directory
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, normalize } from 'node:path';
import { homedir } from 'node:os';

/**
 * Validate that a resolved path doesn't escape the allowed base directory.
 * Prevents path traversal attacks via ../../../etc/passwd style inputs AND symlink escapes.
 */
export function validatePath(rawPath: string, baseDir: string): { valid: true; resolved: string } | { valid: false; error: string } {
  const resolved = resolve(baseDir, rawPath);
  const normalizedBase = normalize(baseDir + '/');

  // Check for path traversal attempts via ../ or absolute path
  if (!resolved.startsWith(normalizedBase) && resolved !== normalizedBase.slice(0, -1)) {
    return { valid: false, error: `Path traversal detected: ${rawPath} resolves outside allowed directory` };
  }

  // Check for symlink escape attacks — resolve symlinks and verify target is still within baseDir.
  // Only check if the file/directory exists. For new files, the resolved path check above is sufficient.
  if (existsSync(resolved)) {
    try {
      const realPath = realpathSync(resolved);
      // Also resolve the base to handle symlinks in the base path itself (e.g., /tmp -> /private/tmp on macOS)
      let realBase: string;
      try {
        realBase = realpathSync(baseDir);
      } catch {
        realBase = baseDir;
      }
      const normalizedRealBase = normalize(realBase + '/');

      // Check if realPath is within realBase (handle both file and exact directory match)
      if (!realPath.startsWith(normalizedRealBase) && realPath !== normalizedRealBase.slice(0, -1)) {
        return { valid: false, error: `Symlink escape detected: ${rawPath} resolves to ${realPath} outside allowed directory` };
      }
    } catch {
      // File exists but can't be resolved — allow it
    }
  }

  return { valid: true, resolved };
}
import { execSync } from 'node:child_process';
import { hostname, platform, arch, cpus, version, tmpdir } from 'node:os';
import { TerminalExecutor } from '../terminal/executor.ts';
import { eventBus, DaemonEvents } from '../../events/bus.ts';
import { BrowserController, type PageSnapshot } from '../browser/session.ts';
import type { ToolDefinition, ToolResult } from './registry.ts';
import type { LLMTool } from '../../llm/provider.ts';
import { routeToSidecar } from './sidecar-route.ts';
import { listSidecarsTool } from './sidecar-list.ts';
import { DESKTOP_TOOLS } from './desktop.ts';
import { sshRunTool, listRemoteConnectionsTool } from './remote.ts';
import { vmListTool, vmInfoTool, vmStartTool, vmStopTool, vmSnapshotTakeTool, vmSnapshotListTool, vmSnapshotRestoreTool, vmSnapshotDeleteTool, vmGetStateTool, vmSerialReadTool, vmSerialSendTool } from './vm.ts';

// Per-tool timeout configuration (ms)
export const TOOL_TIMEOUTS: Record<string, number> = {
  run_command: 30000,
  browser_navigate: 60000,
  browser_snapshot: 15000,
  browser_click: 10000,
  browser_type: 10000,
  browser_scroll: 10000,
  browser_evaluate: 15000,
  browser_screenshot: 20000,
  browser_upload_file: 30000,
  web_search: 45000,
  read_file: 10000,
  write_file: 10000,
  list_directory: 10000,
  get_clipboard: 5000,
  set_clipboard: 5000,
  capture_screen: 15000,
  get_system_info: 5000,
};

const DEFAULT_TOOL_TIMEOUT = 30000;

const terminal = new TerminalExecutor({ timeout: DEFAULT_TOOL_TIMEOUT });

// Shared browser controller (lazy-connected on first browser tool use)
export const browser = new BrowserController();

import { isNoLocalTools, LOCAL_DISABLED_MSG, getDefaultCwd } from './local-tools-guard.ts';
// Re-export for convenience
export { setNoLocalTools, isNoLocalTools, setDefaultCwd } from './local-tools-guard.ts';

// Safe mode configuration - blocks dangerous commands when enabled
let safeModeEnabled = false;

const DANGEROUS_COMMANDS = [
  'rm ', 'rm\t',
  'sudo ', 'sudo\t',
  'chmod ', 'chmod\t',
  'chown ', 'chown\t',
  'dd ', 'dd\t',
  'mkfs', 'mke2fs',
  '>: ', '> ', '>>',  // Redirection
  '|', '&&', '||',   // Command chaining
  '$(', '`',          // Command substitution
  'eval ', 'eval\t',
  'exec ', 'exec\t',
  'curl ', 'curl\t', 'wget ', 'wget\t',  // Download tools
  'nc ', 'nc\t', 'netcat', 'ncat',       // Network tools
];

const SAFE_MODE_BLOCKED_MSG = 'Command blocked: This command is potentially dangerous and is blocked in safe mode. Disable safe mode if you need to run this command.';

/**
 * Enable or disable safe mode for command execution.
 * When enabled, dangerous commands are blocked.
 */
export function setSafeMode(enabled: boolean): void {
  safeModeEnabled = enabled;
  console.log(`[run_command] Safe mode ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Check if safe mode is currently enabled.
 */
export function isSafeModeEnabled(): boolean {
  return safeModeEnabled;
}

/**
 * Check if a command matches dangerous patterns.
 * Returns the matched pattern if dangerous, null if safe.
 */
function isDangerousCommand(command: string): string | null {
  const lowerCmd = command.toLowerCase().trim();

  for (const pattern of DANGEROUS_COMMANDS) {
    if (lowerCmd.startsWith(pattern.toLowerCase()) || lowerCmd.includes(pattern)) {
      return pattern.trim();
    }
  }

  return null;
}


/**
 * Convert a ToolDefinition's parameters to JSON Schema for LLM tool use.
 */
export function toolDefToLLMTool(tool: ToolDefinition): LLMTool {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, param] of Object.entries(tool.parameters)) {
    properties[name] = {
      type: param.type,
      description: param.description,
    };
    if (param.required) {
      required.push(name);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties,
      required,
    },
  };
}

// --- Tool Implementations ---

export const runCommandTool: ToolDefinition = {
  name: 'run_command',
  description: 'Execute a shell command and return the output. Use this to run terminal commands, scripts, or system utilities. Optionally specify a "target" sidecar name/ID to run the command on a remote machine instead of locally.',
  category: 'terminal',
  parameters: {
    command: {
      type: 'string',
      description: 'The shell command to execute',
      required: true,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID to run on a remote machine (omit for local execution)',
      required: false,
    },
    cwd: {
      type: 'string',
      description: 'Working directory for the command (optional, defaults to home directory)',
      required: false,
    },
    timeout: {
      type: 'number',
      description: 'Timeout in milliseconds (optional, defaults to 30000)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'run_command', {
        command: params.command,
        cwd: params.cwd,
        timeout: params.timeout,
      }, 'terminal');
    }

    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;

    const command = params.command as string;

    // Check safe mode - block dangerous commands
    if (safeModeEnabled) {
      const dangerousPattern = isDangerousCommand(command);
      if (dangerousPattern) {
        console.warn(`[run_command] Blocked dangerous command in safe mode: "${command.slice(0, 50)}${command.length > 50 ? '...' : ''}" (matched: ${dangerousPattern})`);
        return SAFE_MODE_BLOCKED_MSG;
      }
    }

    const explicitCwd = params.cwd as string | undefined;
    const cwd = explicitCwd || getDefaultCwd() || homedir();

    // Stream output in real-time via event bus
    let output = '';
    try {
      for await (const chunk of terminal.stream(command, { cwd })) {
        output += chunk;
        // Emit to event bus for WebSocket broadcast
        eventBus.emit(DaemonEvents.OBSERVER_EVENT, {
          event_type: 'command_output',
          data: { chunk, command: command.slice(0, 100) },
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      output += `\n[error] ${errorMsg}`;
    }

    // Truncate very large outputs
    if (output.length > 10000) {
      output = output.slice(0, 10000) + '\n... [truncated, output was ' + output.length + ' chars]';
    }

    return output || '[no output]';
  },
};

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file from disk. Returns the file content as text. Optionally specify a "target" sidecar to read from a remote machine.',
  category: 'file-ops',
  parameters: {
    path: {
      type: 'string',
      description: 'The absolute or relative path to the file to read',
      required: true,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID to read from a remote machine (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'read_file', { path: params.path }, 'filesystem');
    }

    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;

    const rawPath = params.path as string;
    const baseCwd = getDefaultCwd() || homedir();
    const pathValidation = validatePath(rawPath, baseCwd);
    if (!pathValidation.valid) {
      return `Error: ${pathValidation.error}`;
    }
    const filePath = pathValidation.resolved;

    if (!existsSync(filePath)) {
      return `Error: File not found: ${filePath}`;
    }

    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return `Error: Path is a directory, not a file: ${filePath}`;
    }

    const MAX_BYTES = 100 * 1024; // 100 KB read limit

    // For large files, read only the first 100 KB — avoids allocating huge strings
    if (stat.size > MAX_BYTES) {
      const content = await Bun.file(filePath).slice(0, MAX_BYTES).text();
      return content + `\n... [truncated, file is ${stat.size} bytes]`;
    }

    return readFileSync(filePath, 'utf-8');
  },
};

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file on disk. Creates the file if it does not exist, overwrites if it does. Optionally specify a "target" sidecar to write on a remote machine.',
  category: 'file-ops',
  parameters: {
    path: {
      type: 'string',
      description: 'The absolute or relative path to the file to write',
      required: true,
    },
    content: {
      type: 'string',
      description: 'The content to write to the file',
      required: true,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID to write on a remote machine (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'write_file', { path: params.path, content: params.content }, 'filesystem');
    }

    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;

    const rawPath = params.path as string;
    const baseCwd = getDefaultCwd() || homedir();
    const pathValidation = validatePath(rawPath, baseCwd);
    if (!pathValidation.valid) {
      return `Error: ${pathValidation.error}`;
    }
    const filePath = pathValidation.resolved;
    const content = params.content as string;

    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
      return `File written successfully: ${filePath} (${content.length} bytes)`;
    } catch (err) {
      return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: 'List the contents of a directory. Returns file and folder names with their types and sizes. Optionally specify a "target" sidecar to list on a remote machine.',
  category: 'file-ops',
  parameters: {
    path: {
      type: 'string',
      description: 'The absolute or relative path to the directory to list',
      required: true,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID to list on a remote machine (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'list_directory', { path: params.path }, 'filesystem');
    }

    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;

    const rawPath = params.path as string;
    const baseCwd = getDefaultCwd() || homedir();
    const pathValidation = validatePath(rawPath, baseCwd);
    if (!pathValidation.valid) {
      return `Error: ${pathValidation.error}`;
    }
    const dirPath = pathValidation.resolved;

    if (!existsSync(dirPath)) {
      return `Error: Directory not found: ${dirPath}`;
    }

    const stat = statSync(dirPath);
    if (!stat.isDirectory()) {
      return `Error: Path is a file, not a directory: ${dirPath}`;
    }

    const entries = readdirSync(dirPath);
    const lines: string[] = [];

    for (const entry of entries) {
      try {
        const entryPath = join(dirPath, entry);
        const entryStat = statSync(entryPath);
        const type = entryStat.isDirectory() ? 'dir' : 'file';
        const size = entryStat.isDirectory() ? '' : ` (${entryStat.size} bytes)`;
        lines.push(`${type}  ${entry}${size}`);
      } catch {
        lines.push(`???  ${entry}`);
      }
    }

    if (lines.length === 0) {
      return `[empty directory: ${dirPath}]`;
    }

    return lines.join('\n');
  },
};

// --- Clipboard / Screenshot / System Info helpers ---

function localClipboardRead(): string {
  const os = platform();
  if (os === 'darwin') {
    return execSync('pbpaste', { encoding: 'utf-8' });
  } else if (os === 'win32') {
    return execSync('powershell -command Get-Clipboard', { encoding: 'utf-8' }).trimEnd();
  } else {
    try {
      return execSync('xclip -selection clipboard -o', { encoding: 'utf-8' });
    } catch {
      return execSync('xsel --clipboard --output', { encoding: 'utf-8' });
    }
  }
}

function localClipboardWrite(content: string): void {
  const os = platform();
  if (os === 'darwin') {
    execSync('pbcopy', { input: content, encoding: 'utf-8' });
  } else if (os === 'win32') {
    execSync('powershell -command Set-Clipboard', { input: content, encoding: 'utf-8' });
  } else {
    try {
      execSync('xclip -selection clipboard', { input: content, encoding: 'utf-8' });
    } catch {
      execSync('xsel --clipboard --input', { input: content, encoding: 'utf-8' });
    }
  }
}

function localCaptureScreen(): string {
  const os = platform();
  const tmp = join(tmpdir(), `jarvis-screenshot-${Date.now()}.png`);
  if (os === 'darwin') {
    execSync(`screencapture -x ${tmp}`);
  } else if (os === 'win32') {
    execSync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save('${tmp}') }"`);
  } else {
    try {
      execSync(`scrot ${tmp}`);
    } catch {
      execSync(`import -window root ${tmp}`);
    }
  }
  const data = readFileSync(tmp);
  unlinkSync(tmp);
  return data.toString('base64');
}

function localSystemInfo(): Record<string, unknown> {
  return {
    hostname: hostname(),
    os: platform(),
    arch: arch(),
    cpus: cpus().length,
    node_version: version(),
  };
}

// --- Clipboard / Screenshot / System Info tools ---

export const getClipboardTool: ToolDefinition = {
  name: 'get_clipboard',
  description: 'Read the clipboard contents. Optionally specify a "target" sidecar name/ID to read from a remote machine instead of locally.',
  category: 'general',
  parameters: {
    target: {
      type: 'string',
      description: 'Sidecar name or ID for remote execution (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) return routeToSidecar(target, 'get_clipboard', {}, 'clipboard');
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      const content = localClipboardRead();
      return content || '[clipboard is empty]';
    } catch (err) {
      return `Error reading clipboard: ${err instanceof Error ? err.message : err}`;
    }
  },
};

export const setClipboardTool: ToolDefinition = {
  name: 'set_clipboard',
  description: 'Write text to the clipboard. Optionally specify a "target" sidecar name/ID to write to a remote machine instead of locally.',
  category: 'general',
  parameters: {
    content: {
      type: 'string',
      description: 'The text to write to the clipboard',
      required: true,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID for remote execution (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) return routeToSidecar(target, 'set_clipboard', { content: params.content }, 'clipboard');
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      localClipboardWrite(params.content as string);
      return 'Clipboard updated.';
    } catch (err) {
      return `Error writing clipboard: ${err instanceof Error ? err.message : err}`;
    }
  },
};

export const captureScreenTool: ToolDefinition = {
  name: 'capture_screen',
  description: 'Take a screenshot of the screen. Optionally specify a "target" sidecar name/ID to capture a remote machine instead of locally.',
  category: 'general',
  parameters: {
    target: {
      type: 'string',
      description: 'Sidecar name or ID for remote execution (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) return routeToSidecar(target, 'capture_screen', {}, 'screenshot');
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      const base64 = localCaptureScreen();
      return JSON.stringify({ type: 'inline', mime_type: 'image/png', data: base64 });
    } catch (err) {
      return `Error capturing screen: ${err instanceof Error ? err.message : err}`;
    }
  },
};

export const getSystemInfoTool: ToolDefinition = {
  name: 'get_system_info',
  description: 'Get system information (hostname, OS, architecture, CPU count). Optionally specify a "target" sidecar name/ID to query a remote machine instead of locally.',
  category: 'general',
  parameters: {
    target: {
      type: 'string',
      description: 'Sidecar name or ID for remote execution (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) return routeToSidecar(target, 'get_system_info', {}, 'system_info');
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    return JSON.stringify(localSystemInfo(), null, 2);
  },
};

// --- Browser Tool Helpers ---

const MAX_PAGE_TEXT = 2000;   // chars of visible page text
const MAX_ELEMENTS = 80;      // interactive elements shown to LLM
const MAX_SAME_ROLE = 15;     // max elements with the same role (e.g., gridcell)

function formatSnapshot(snap: PageSnapshot): string {
  const lines: string[] = [];
  lines.push(`Page: ${snap.title}`);
  lines.push(`URL: ${snap.url}`);
  lines.push('');
  lines.push('--- Page Text ---');
  lines.push(snap.text.slice(0, MAX_PAGE_TEXT));
  if (snap.text.length > MAX_PAGE_TEXT) {
    lines.push(`... (${snap.text.length - MAX_PAGE_TEXT} chars truncated)`);
  }
  lines.push('');

  if (snap.elements.length > 0) {
    // Prioritize: inputs/textboxes/buttons first, then cap repeated roles.
    // Elements with UNIQUE aria-labels are always shown (they're distinct actions).
    // Elements that share an aria-label (e.g. 50 star toggles) are capped.
    // This prevents repetitive lists from hiding important action buttons like Send.

    // Pre-count aria-label frequency to identify repeated vs unique labels
    const labelFreq = new Map<string, number>();
    for (const el of snap.elements) {
      const label = el.attrs['aria-label'];
      if (label) labelFreq.set(label, (labelFreq.get(label) || 0) + 1);
    }

    const roleCounts = new Map<string, number>();
    const shown: typeof snap.elements = [];
    const deferred: typeof snap.elements = [];

    for (const el of snap.elements) {
      const role = el.attrs.role || el.tag;
      const count = roleCounts.get(role) || 0;
      // Always include high-value elements (inputs, textboxes, contenteditable, buttons)
      const isHighValue = el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select'
        || el.tag === 'button'
        || el.attrs.contenteditable === 'true' || el.attrs.role === 'textbox';
      // Elements with a unique aria-label are distinct actions (e.g. Send, Attach, Delete)
      const hasUniqueLabel = el.attrs['aria-label'] && (labelFreq.get(el.attrs['aria-label']) || 0) === 1;
      if (isHighValue || hasUniqueLabel) {
        shown.push(el);
      } else if (count < MAX_SAME_ROLE) {
        shown.push(el);
        roleCounts.set(role, count + 1);
      } else {
        deferred.push(el);
      }
    }

    // Fill remaining budget with deferred elements
    const budget = MAX_ELEMENTS - shown.length;
    if (budget > 0) {
      shown.push(...deferred.slice(0, budget));
    }

    // Sort by original ID order so positions make sense
    shown.sort((a, b) => a.id - b.id);

    // Highlight key interactive elements at the top so the LLM finds them immediately
    const keyInputs = shown.filter(el =>
      el.tag === 'input' || el.tag === 'textarea' || el.tag === 'select'
      || el.attrs.contenteditable === 'true' || el.attrs.role === 'textbox'
    );
    const keyButtons = shown.filter(el =>
      (el.tag === 'button' || el.attrs.role === 'button') && el.attrs['aria-label']
    );
    if (keyInputs.length > 0 || keyButtons.length > 0) {
      lines.push('--- Key Elements ---');
      for (const el of keyInputs) {
        const label = el.attrs['aria-label'] || el.attrs.placeholder || el.attrs.name || el.tag;
        lines.push(`[${el.id}] INPUT: ${label}${el.attrs.contenteditable ? ' (contenteditable)' : ''}`);
      }
      for (const el of keyButtons) {
        lines.push(`[${el.id}] BUTTON: ${el.attrs['aria-label']}`);
      }
      lines.push('');
    }

    lines.push(`--- Interactive Elements (${shown.length}/${snap.elements.length}) ---`);
    for (const el of shown) {
      const attrParts: string[] = [];
      if (el.attrs.name) attrParts.push(`name="${el.attrs.name}"`);
      if (el.attrs.placeholder) attrParts.push(`placeholder="${el.attrs.placeholder}"`);
      if (el.attrs.type) attrParts.push(`type="${el.attrs.type}"`);
      if (el.attrs.href) attrParts.push(`href="${el.attrs.href.slice(0, 80)}"`);
      if (el.attrs['aria-label']) attrParts.push(`aria-label="${el.attrs['aria-label']}"`);
      if (el.attrs.role) attrParts.push(`role="${el.attrs.role}"`);
      if (el.attrs.contenteditable) attrParts.push(`contenteditable="${el.attrs.contenteditable}"`);
      if (el.attrs['data-testid']) attrParts.push(`data-testid="${el.attrs['data-testid']}"`);

      const textStr = el.text ? ` "${el.text.slice(0, 50)}"` : '';
      const attrStr = attrParts.length > 0 ? ' ' + attrParts.join(' ') : '';
      lines.push(`[${el.id}] ${el.tag}${textStr}${attrStr}`);
    }
    if (snap.elements.length > shown.length) {
      lines.push(`(${snap.elements.length - shown.length} repeated list items hidden. All inputs, buttons, and textboxes are shown above.)`);
    }
  } else {
    lines.push('(no interactive elements found)');
  }

  return lines.join('\n');
}

// --- Browser Tool Implementations ---

export const browserNavigateTool: ToolDefinition = {
  name: 'browser_navigate',
  description: 'Navigate the browser to a URL. Returns page text content and a list of interactive elements with [id] numbers you can reference in browser_click and browser_type. Optionally specify a "target" sidecar to use a remote browser.',
  category: 'browser',
  parameters: {
    url: {
      type: 'string',
      description: 'The URL to navigate to',
      required: true,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID to use a remote browser (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'browser_navigate', { url: params.url }, 'browser');
    }
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      const snap = await browser.navigate(params.url as string);
      return formatSnapshot(snap);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const browserSnapshotTool: ToolDefinition = {
  name: 'browser_snapshot',
  description: 'Get the current page content and interactive elements. Each element has an [id] you can use with browser_click and browser_type. Use this after clicking or typing to see what changed.',
  category: 'browser',
  parameters: {
    target: {
      type: 'string',
      description: 'Sidecar name or ID to use a remote browser (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'browser_snapshot', {}, 'browser');
    }
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      const snap = await browser.snapshot();
      return formatSnapshot(snap);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const browserClickTool: ToolDefinition = {
  name: 'browser_click',
  description: 'Click an interactive element on the page by its [id] from the last browser_navigate or browser_snapshot.',
  category: 'browser',
  parameters: {
    element_id: {
      type: 'number',
      description: 'The [id] of the element to click (from browser_snapshot)',
      required: true,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID to use a remote browser (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'browser_click', { element_id: params.element_id }, 'browser');
    }
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      return await browser.click(params.element_id as number);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const browserTypeTool: ToolDefinition = {
  name: 'browser_type',
  description: 'Type text into an input element by its [id]. Set submit to true to press Enter after typing (useful for search forms).',
  category: 'browser',
  parameters: {
    element_id: {
      type: 'number',
      description: 'The [id] of the input element to type into (from browser_snapshot)',
      required: true,
    },
    text: {
      type: 'string',
      description: 'The text to type',
      required: true,
    },
    submit: {
      type: 'boolean',
      description: 'Press Enter after typing (default: false)',
      required: false,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID to use a remote browser (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'browser_type', {
        element_id: params.element_id,
        text: params.text,
        submit: params.submit,
      }, 'browser');
    }
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      return await browser.type(
        params.element_id as number,
        params.text as string,
        (params.submit as boolean) ?? false,
      );
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const browserScreenshotTool: ToolDefinition = {
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current browser page. The image is sent directly to the AI for visual analysis.',
  category: 'browser',
  parameters: {
    target: {
      type: 'string',
      description: 'Sidecar name or ID to use a remote browser (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'browser_screenshot', {}, 'browser');
    }
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      const { base64, mimeType } = await browser.screenshotBuffer();
      return {
        content: [
          { type: 'text' as const, text: 'Browser screenshot captured.' },
          { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType, data: base64 } },
        ],
      } satisfies ToolResult;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const browserUploadFileTool: ToolDefinition = {
  name: 'browser_upload_file',
  description: 'Upload a file to a file input on the page. Use this after clicking an upload/attach button that triggers a file picker dialog. This bypasses the native file picker and sets the file directly via CDP.',
  category: 'browser',
  parameters: {
    file_path: {
      type: 'string',
      description: 'Absolute path to the file to upload',
      required: true,
    },
    selector: {
      type: 'string',
      description: 'CSS selector for the file input element (default: first input[type="file"] on the page)',
      required: false,
    },
  },
  execute: async (params) => {
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      return await browser.uploadFile(
        params.file_path as string,
        params.selector as string | undefined,
      );
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const browserScrollTool: ToolDefinition = {
  name: 'browser_scroll',
  description: 'Scroll the page up or down. Use this when you need to see content below the fold. After scrolling, use browser_snapshot to see the new content.',
  category: 'browser',
  parameters: {
    direction: {
      type: 'string',
      description: 'Scroll direction: "down" or "up" (default: "down")',
      required: false,
    },
    amount: {
      type: 'number',
      description: 'Pixels to scroll (default: one viewport height). Use larger values like 2000 to jump further.',
      required: false,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID to use a remote browser (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    if (target) {
      return routeToSidecar(target, 'browser_scroll', {
        direction: params.direction,
        amount: params.amount,
      }, 'browser');
    }
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      const direction = (params.direction as string) === 'up' ? 'up' : 'down';
      const amount = params.amount as number | undefined;
      return await browser.scroll(direction, amount);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Safe JavaScript expression patterns allowed for browser_evaluate.
 * These patterns prevent code injection while allowing useful DOM operations.
 */
const SAFE_JS_PATTERNS = [
  // DOM Queries
  /^\s*document\.(querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName)\s*\(/i,
  // Element properties
  /^\s*[\w.$]+\.(textContent|innerText|innerHTML|value|className|classList)\s*(=|\(|\.)/i,
  // Element methods
  /^\s*[\w.$]+\.(click|focus|blur|select|scrollIntoView|getBoundingClientRect)\s*\(/i,
  // Safe navigation
  /^\s*\(?[\w.$]+\??\.(querySelector|querySelectorAll|getElementsByTagName|getElementsByClassName)\s*\(/i,
  // Event dispatch
  /^\s*[\w.$]+\.(dispatchEvent|click)\s*\(/i,
  // Array methods on query results
  /^\s*Array\.from\s*\(\s*document\./i,
  // IIFE wrapper (will be validated recursively)
  /^\s*\(\(\)\s*=>\s*\{[\s\S]*\}\)\(\)\s*$/i,
];

/**
 * Validate JavaScript expression against safe patterns.
 * Blocks: eval, Function constructor, script injection, event handlers, etc.
 */
function isSafeJsExpression(expr: string): { safe: true } | { safe: false; reason: string } {
  const blocked = [
    { pattern: /\beval\s*\(/i, reason: 'eval() is not allowed' },
    { pattern: /\bnew\s+Function\s*\(/i, reason: 'Function constructor is not allowed' },
    { pattern: /\bsetTimeout\s*\(/i, reason: 'setTimeout is not allowed' },
    { pattern: /\bsetInterval\s*\(/i, reason: 'setInterval is not allowed' },
    { pattern: /\bfetch\s*\(/i, reason: 'fetch() is not allowed - use http_request tool' },
    { pattern: /\bXMLHttpRequest/i, reason: 'XMLHttpRequest is not allowed' },
    { pattern: /\bWebSocket/i, reason: 'WebSocket is not allowed' },
    { pattern: /\bimport\s*\(/i, reason: 'Dynamic import is not allowed' },
    { pattern: /\bdocument\.write/i, reason: 'document.write() is not allowed' },
    { pattern: /\bdocument\.open\s*\(/i, reason: 'document.open() is not allowed' },
    { pattern: /\bdocument\.close\s*\(/i, reason: 'document.close() is not allowed' },
    { pattern: /\bon\w+\s*=/i, reason: 'Event handler assignment is not allowed' },
    { pattern: /<\s*script/i, reason: 'Script tag injection is not allowed' },
    { pattern: /javascript\s*:/i, reason: 'javascript: URLs are not allowed' },
    { pattern: /\bcookie\b/i, reason: 'Cookie access is not allowed' },
    { pattern: /\blocalStorage\b/i, reason: 'localStorage access is not allowed' },
    { pattern: /\bsessionStorage\b/i, reason: 'sessionStorage access is not allowed' },
  ];

  for (const { pattern, reason } of blocked) {
    if (pattern.test(expr)) {
      return { safe: false, reason };
    }
  }

  // Check if expression matches any safe pattern
  for (const safePattern of SAFE_JS_PATTERNS) {
    if (safePattern.test(expr)) {
      return { safe: true };
    }
  }

  // For IIFE, validate inner content
  const iifeMatch = expr.match(/^\s*\(\(\)\s*=>\s*\{([\s\S]*)\}\)\(\)\s*$/);
  if (iifeMatch) {
    const innerContent = iifeMatch[1];
    // Recursively validate non-IIFE parts
    const lines = innerContent!.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
    for (const line of lines) {
      const result = isSafeJsExpression(line);
      if (!result.safe) return result;
    }
    return { safe: true };
  }

  return { safe: false, reason: 'Expression does not match allowed patterns' };
}

export const browserEvaluateTool: ToolDefinition = {
  name: 'browser_evaluate',
  description: 'Execute safe JavaScript expressions in the browser page context for DOM queries and manipulation. Blocked: eval, fetch, timers, cookies, storage.',
  category: 'browser',
  parameters: {
    expression: {
      type: 'string',
      description: 'JavaScript expression (limited to safe DOM operations). Examples: document.querySelector("#btn").click(), document.title',
      required: true,
    },
    target: {
      type: 'string',
      description: 'Sidecar name or ID to use a remote browser (omit for local)',
      required: false,
    },
  },
  execute: async (params) => {
    const target = params.target as string | undefined;
    const expression = String(params.expression ?? '');

    // Validate expression against security patterns
    const validation = isSafeJsExpression(expression);
    if (!validation.safe) {
      return `Error: Blocked unsafe expression - ${validation.reason}`;
    }

    if (target) {
      return routeToSidecar(target, 'browser_evaluate', { expression }, 'browser');
    }
    if (isNoLocalTools()) return LOCAL_DISABLED_MSG;
    try {
      const result = await browser.evaluate(expression);
      if (result === undefined || result === null) return '(no return value)';
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

// --- Graphify Tools ---

export const graphifySearchTool: ToolDefinition = {
  name: 'graphify_search',
  description: 'Search the knowledge graph for code concepts, files, or relationships. Returns matching entities with their summaries.',
  category: 'knowledge',
  parameters: {
    query: {
      type: 'string',
      description: 'Search query (keyword or phrase)',
      required: true,
    },
    limit: {
      type: 'number',
      description: 'Maximum results to return (default: 20)',
      required: false,
    },
  },
  execute: async (params) => {
    try {
      const { getGraphifyService } = await import('../../services/graphify-service.ts');
      const service = getGraphifyService();
      const limit = (params.limit as number) || 20;
      const results = service.search(params.query as string, limit);
      return JSON.stringify(results, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const graphifyImportTool: ToolDefinition = {
  name: 'graphify_import',
  description: 'Import a knowledge graph from Graphify output (graph.json) into the Jarvis Vault.',
  category: 'knowledge',
  parameters: {
    path: {
      type: 'string',
      description: 'Path to graph.json file or directory containing it',
      required: true,
    },
    projectId: {
      type: 'string',
      description: 'Optional project ID to associate the imported nodes with',
      required: false,
    },
  },
  execute: async (params) => {
    try {
      const { getGraphifyService } = await import('../../services/graphify-service.ts');
      const service = getGraphifyService();
      const result = await service.importGraph(params.path as string, params.projectId as string | undefined);
      return JSON.stringify(result, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const graphifyConnectionsTool: ToolDefinition = {
  name: 'graphify_connections',
  description: 'Get relationships and connections for a specific entity in the knowledge graph.',
  category: 'knowledge',
  parameters: {
    entityId: {
      type: 'string',
      description: 'Entity ID to get connections for',
      required: true,
    },
  },
  execute: async (params) => {
    try {
      const { getGraphifyService } = await import('../../services/graphify-service.ts');
      const service = getGraphifyService();
      const connections = service.getConnections(params.entityId as string);
      return JSON.stringify(connections, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const vectorSearchTool: ToolDefinition = {
  name: 'vector_search',
  description: 'Semantic search across the Jarvis Vault using HNSW vector embeddings. Returns results by meaning, not just keywords.',
  category: 'knowledge',
  parameters: {
    query: {
      type: 'string',
      description: 'Search query (semantic matching)',
      required: true,
    },
    limit: {
      type: 'number',
      description: 'Maximum results to return (default: 20)',
      required: false,
    },
  },
  execute: async (params) => {
    try {
      const { getVectorIndex } = await import('../../vault/vector-index.ts');
      const service = getVectorIndex();
      const limit = (params.limit as number) || 20;
      const results = await service.search(params.query as string, limit);
      return JSON.stringify(results, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/**
 * Non-browser tools (terminal, file operations).
 * Safe to share across multiple agent services — they are stateless.
 */
export const NON_BROWSER_TOOLS: ToolDefinition[] = [
  runCommandTool,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  getClipboardTool,
  setClipboardTool,
  captureScreenTool,
  getSystemInfoTool,
  listSidecarsTool,
  graphifySearchTool,
  graphifyImportTool,
  graphifyConnectionsTool,
  vectorSearchTool,
  sshRunTool,
  listRemoteConnectionsTool,
  // VM lifecycle (VirtualBox)
  vmListTool,
  vmInfoTool,
  vmGetStateTool,
  vmStartTool,
  vmStopTool,
  vmSnapshotTakeTool,
  vmSnapshotListTool,
  vmSnapshotRestoreTool,
  vmSnapshotDeleteTool,
  // Serial console
  vmSerialReadTool,
  vmSerialSendTool,
];

/**
 * All built-in tools.
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  ...NON_BROWSER_TOOLS,
  browserNavigateTool,
  browserSnapshotTool,
  browserClickTool,
  browserTypeTool,
  browserScrollTool,
  browserUploadFileTool,
  browserEvaluateTool,
  browserScreenshotTool,
  ...DESKTOP_TOOLS,
];

/**
 * Create browser tools bound to a specific BrowserController.
 * Used to give the background agent its own browser instance
 * while keeping tool definitions identical to the main agent's.
 */
export function createBrowserTools(ctrl: BrowserController): ToolDefinition[] {
  return [
    {
      name: 'browser_navigate',
      description: browserNavigateTool.description,
      category: 'browser',
      parameters: browserNavigateTool.parameters,
      execute: async (params) => {
        try {
          const snap = await ctrl.navigate(params.url as string);
          return formatSnapshot(snap);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_snapshot',
      description: browserSnapshotTool.description,
      category: 'browser',
      parameters: browserSnapshotTool.parameters,
      execute: async () => {
        try {
          const snap = await ctrl.snapshot();
          return formatSnapshot(snap);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_click',
      description: browserClickTool.description,
      category: 'browser',
      parameters: browserClickTool.parameters,
      execute: async (params) => {
        try {
          return await ctrl.click(params.element_id as number);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_type',
      description: browserTypeTool.description,
      category: 'browser',
      parameters: browserTypeTool.parameters,
      execute: async (params) => {
        try {
          return await ctrl.type(
            params.element_id as number,
            params.text as string,
            (params.submit as boolean) ?? false,
          );
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_scroll',
      description: browserScrollTool.description,
      category: 'browser',
      parameters: browserScrollTool.parameters,
      execute: async (params) => {
        try {
          const direction = (params.direction as string) === 'up' ? 'up' : 'down';
          const amount = params.amount as number | undefined;
          return await ctrl.scroll(direction, amount);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_evaluate',
      description: browserEvaluateTool.description,
      category: 'browser',
      parameters: browserEvaluateTool.parameters,
      execute: async (params) => {
        try {
          const result = await ctrl.evaluate(params.expression as string);
          if (result === undefined || result === null) return '(no return value)';
          return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'browser_screenshot',
      description: browserScreenshotTool.description,
      category: 'browser',
      parameters: browserScreenshotTool.parameters,
      execute: async () => {
        try {
          const { base64, mimeType } = await ctrl.screenshotBuffer();
          return {
            content: [
              { type: 'text' as const, text: 'Browser screenshot captured.' },
              { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType, data: base64 } },
            ],
          } satisfies ToolResult;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
