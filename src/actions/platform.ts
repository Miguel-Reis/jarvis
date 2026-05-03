/**
 * Platform utilities — abstracts Windows vs Linux vs macOS differences.
 * Single source of truth for platform-aware tooling so the agent (and tools)
 * always use the right commands and paths for the current OS.
 */

export type OS = 'windows' | 'linux' | 'darwin';

/** Detect the current OS from Node.js process.platform */
export function detectOS(): OS {
  const p = typeof process !== 'undefined' && process.platform ? process.platform : 'linux';
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'darwin';
  return 'linux';
}

/** Whether we're running on Windows (native or WSL) */
export function isWindows(): boolean {
  return detectOS() === 'windows';
}

/** Whether we're running on Linux (native or WSL) */
export function isLinux(): boolean {
  return detectOS() === 'linux';
}

/** Whether we're running on macOS */
export function isMacOS(): boolean {
  return detectOS() === 'darwin';
}

/** True when running inside WSL (Windows Subsystem for Linux) */
export function isWSL(): boolean {
  if (detectOS() !== 'linux') return false;
  try {
    return require('fs').existsSync('/proc/version')
      && require('fs').readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

/**
 * Translate a generic Unix command to the current platform's equivalent.
 * E.g.  translateCommand('cat', 'foo.txt')  →  'type foo.txt'   (on Windows)
 *       translateCommand('ls', '-lah')      →  'dir /a /-s'    (on Windows)
 *       translateCommand('rm', 'foo')       →  'rm foo'        (on Linux, no change)
 */
export function translateCommand(input: string | null | undefined = '', ...args: string[]): string {
  const os = detectOS();
  // Safe normalization: ensure we always have a string
  const unixCmd = input == null ? '' : String(input);
  const parts = unixCmd.trim().split(/\s+/);
  const cmd = parts[0] != null ? parts[0].toLowerCase() : '';
  const rest = args.join(' ');

  if (os === 'windows') {
    switch (cmd) {
      case 'cat':    return `type ${rest}`;
      case 'ls':     return `dir ${rest || '.'}`;
      case 'll':     return `dir /a ${rest || '.'}`;
      case 'la':     return `dir /a ${rest || '.'}`;
      case 'rm':     return `del /f /q ${rest}`;
      case 'rmdir':  return `rmdir /s /q ${rest}`;
      case 'mkdir':  return `mkdir ${rest}`;
      case 'cp':     return `copy ${rest}`;
      case 'mv':     return `move ${rest}`;
      case 'grep':   return `findstr ${rest}`;
      case 'which':  return `where ${rest}`;
      case 'pwd':    return `cd`;
      case 'touch':  return `copy nul ${rest} >nul 2>&1`;
      case 'head':   return `powershell -command "Get-Content ${rest} | Select-Object -First 10"`;
      case 'tail':   return `powershell -command "Get-Content ${rest} -Tail 10"`;
      case 'diff':   return `fc ${rest}`;
      case 'sort':   return `sort ${rest}`;
      case 'wc':     return `findstr /r /c:"." ${rest} | find /c /v ""`;
      case 'uname':   return `ver`;
      case 'chmod':   return `icacls ${rest}`;   // Windows equivalent
      case 'chown':   return `icacls ${rest}`;   // Windows equivalent (owner via icacls)
      case 'kill':    return `taskkill /f /pid ${rest}`;
      case 'ps':      return `tasklist /v`;
      case 'df':      return `wmic logicaldisk get name,size,freespace /format:list`;
      case 'du':      return `powershell -command "Get-ChildItem ${rest} -Recurse | Measure-Object -Property Length -Sum"`;
      case 'mount':   return `wmic logicaldisk get name,filesystem /format:list`;
      case 'unmount': return `mountvol ${rest} /p`;
      case 'curl':    return `curl.exe ${rest}`;  // Use curl.exe to avoid PowerShell alias
      case 'wget':    return `Invoke-WebRequest ${rest}`;
      case 'sed':    return `powershell -command "$input | %{ ${rest} }"`;
      case 'awk':    return `powershell -command "$input | ForEach-Object { ${rest} }"`;
      case 'xargs':   return `for %i in (${rest}) do `;
      case 'env':     return `set`;
      case 'true':    return `rem`;
      case 'false':   return `cmd /c exit 1`;
      default:        return unixCmd + (rest ? ` ${rest}` : '');
    }
  }

  // Linux / macOS — use as-is
  return unixCmd + (rest ? ` ${rest}` : '');
}

/**
 * Get a human-readable description of the current platform for system facts.
 */
export function getPlatformDescription(): string {
  const os = detectOS();
  const inWSL = isWSL();

  if (os === 'windows') return 'Windows' + (inWSL ? ' (WSL)' : '');
  if (os === 'darwin') return 'macOS';
  return 'Linux' + (inWSL ? ' (WSL)' : '');
}

/**
 * Return a map of common Unix commands to their platform equivalents.
 * Useful for the LLM system prompt to know what to use.
 */
export function getCommandAliases(): Record<string, string> {
  const os = detectOS();
  if (os === 'windows') {
    return {
      'cat':    'type',
      'ls':     'dir',
      'll':     'dir /a',
      'la':     'dir /a',
      'rm':     'del /f /q',
      'rmdir':  'rmdir /s /q',
      'mkdir':  'mkdir',
      'cp':     'copy',
      'mv':     'move',
      'grep':   'findstr',
      'which':  'where',
      'pwd':    'cd',
      'touch':  'copy nul',
      'head':   'Get-Content -TotalCount 10',
      'tail':   'Get-Content -Tail 10',
      'diff':   'fc',
      'sort':   'sort',
      'wc':     'findstr /r /c:.| find /c /v ""',
      'kill':   'taskkill /f /pid',
      'ps':     'tasklist /v',
      'df':     'wmic logicaldisk get name,size,freespace',
      'du':     'Get-ChildItem -Recurse | Measure-Object Length',
      'curl':   'curl.exe',
      'sed':    'powershell -command ...',
      'env':    'set',
      'chmod':  'icacls',
      'chown':  'icacls',
    };
  }
  // Linux / macOS
  return {};
}
