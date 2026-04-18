/**
 * Auto-updater — polls the remote git branch and restarts the daemon when new commits arrive.
 *
 * Config (via env or jarvis config):
 *   JARVIS_AUTO_UPDATE=true          enable auto-updates (default: false)
 *   JARVIS_UPDATE_BRANCH             branch to track (default: current branch)
 *   JARVIS_UPDATE_INTERVAL_SECS      poll interval in seconds (default: 300 = 5min)
 *
 * The updater runs `git fetch` + compares local vs remote HEAD SHA.
 * If they differ it runs `git pull --ff-only`, `bun install`, then calls process.exit(0)
 * so the process manager (systemd, PM2, etc.) restarts the daemon with the new code.
 */

import { $ } from 'bun';

export type UpdaterConfig = {
  enabled: boolean;
  branch?: string;
  intervalSecs?: number;
};

export class Updater {
  private enabled: boolean;
  private branch: string | null;
  private intervalSecs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentSha: string | null = null;

  constructor(config: UpdaterConfig) {
    this.enabled = config.enabled;
    this.branch = config.branch ?? null;
    this.intervalSecs = config.intervalSecs ?? 300;
  }

  async start(): Promise<void> {
    if (!this.enabled) return;

    // Resolve branch if not provided
    if (!this.branch) {
      try {
        this.branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
      } catch {
        console.error('[Updater] Cannot determine current branch — auto-update disabled');
        return;
      }
    }

    // Capture current HEAD
    try {
      this.currentSha = (await $`git rev-parse HEAD`.text()).trim();
    } catch {
      console.error('[Updater] Cannot read HEAD SHA — auto-update disabled');
      return;
    }

    console.log(`[Updater] Watching branch "${this.branch}" (interval: ${this.intervalSecs}s)`);
    this.timer = setInterval(() => this.check(), this.intervalSecs * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    try {
      // Fetch remote silently
      await $`git fetch origin ${this.branch!} --quiet`.quiet();

      const remoteSha = (await $`git rev-parse origin/${this.branch!}`.text()).trim();
      if (remoteSha === this.currentSha) return;

      console.log(`[Updater] New commit detected on "${this.branch}": ${remoteSha.slice(0, 8)}`);
      await this.applyUpdate(remoteSha);
    } catch (err) {
      // Network errors, lock files, etc. — silent, retry next interval
      console.error('[Updater] Check failed:', err instanceof Error ? err.message : err);
    }
  }

  private async applyUpdate(newSha: string): Promise<void> {
    console.log('[Updater] Pulling update...');
    try {
      await $`git pull --ff-only origin ${this.branch!}`.quiet();
    } catch (err) {
      console.error('[Updater] git pull failed (diverged history?) — skipping:', err instanceof Error ? err.message : err);
      return;
    }

    // Re-install dependencies in case package.json changed
    console.log('[Updater] Running bun install...');
    try {
      await $`bun install --frozen-lockfile`.quiet();
    } catch {
      // Non-fatal — maybe lockfile changed, continue anyway
      try { await $`bun install`.quiet(); } catch {}
    }

    console.log(`[Updater] Update applied (${newSha.slice(0, 8)}). Restarting...`);
    // Exit cleanly — process manager (systemd, PM2, etc.) will restart
    process.exit(0);
  }
}

/**
 * Build an Updater from environment / config.
 * Call from daemon index.ts during startup.
 */
export function createUpdater(): Updater {
  const enabled = process.env['JARVIS_AUTO_UPDATE'] === 'true';
  const branch = process.env['JARVIS_UPDATE_BRANCH'] || undefined;
  const intervalSecs = process.env['JARVIS_UPDATE_INTERVAL_SECS']
    ? parseInt(process.env['JARVIS_UPDATE_INTERVAL_SECS']!, 10)
    : 300;

  return new Updater({ enabled, branch, intervalSecs });
}
