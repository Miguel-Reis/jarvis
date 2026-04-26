/**
 * Capture Engine — Continuous Desktop Screenshot Capture
 *
 * Implements the Observer interface. Captures the full desktop at configurable
 * intervals, computes pixel-diff to skip unchanged frames, manages disk storage
 * with tiered retention, and adapts capture frequency based on system load.
 */

import { mkdirSync, existsSync, unlinkSync, readdirSync, statSync, rmdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Observer, ObserverEventHandler } from '../observers/index.ts';
import type { AwarenessConfig } from '../config/types.ts';
import type { DesktopController } from '../actions/app-control/desktop-controller.ts';
import { generateId } from '../vault/schema.ts';
import { deleteCapturesBefore } from '../vault/awareness.ts';
import type { CaptureFrame } from './types.ts';

let sharp: any = null;
try {
  sharp = require('sharp');
} catch { /* sharp not available — thumbnails disabled */ }

export class CaptureEngine implements Observer {
  name = 'awareness-capture';

  private config: AwarenessConfig;
  private desktop: DesktopController;
  private handler: ObserverEventHandler | null = null;
  private running = false;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private previousBuffer: Buffer | null = null;
  private latestFrame: CaptureFrame | null = null;
  private captureDir: string;
  private currentIntervalMs: number;

  constructor(config: AwarenessConfig, desktop: DesktopController) {
    this.config = config;
    this.desktop = desktop;
    this.captureDir = config.capture_dir.replace(/^~/, os.homedir());
    this.currentIntervalMs = config.capture_interval_ms;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Ensure capture directory exists
    mkdirSync(this.captureDir, { recursive: true });

    console.log(`[CaptureEngine] Started — interval: ${this.currentIntervalMs}ms, dir: ${this.captureDir}`);

    // Start capture loop
    this.captureTimer = setInterval(() => this.captureLoop(), this.currentIntervalMs);

    // Start retention cleanup every 10 minutes
    this.cleanupTimer = setInterval(() => this.cleanupRetention(), 10 * 60 * 1000);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    console.log('[CaptureEngine] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  onEvent(handler: ObserverEventHandler): void {
    this.handler = handler;
  }

  getLatestFrame(): CaptureFrame | null {
    return this.latestFrame;
  }

  getPreviousBuffer(): Buffer | null {
    return this.previousBuffer;
  }

  private capturing = false;
  private connectRetries = 0;
  private readonly MAX_CONNECT_RETRIES = 3;

  private async captureLoop(): Promise<void> {
    if (!this.running || this.capturing) return;
    this.capturing = true;

    try {
      // Adaptive throttle: check system load (use CPU count as baseline)
      const cpuCount = os.cpus().length;
      const load = os.loadavg()[0];
      const loadThreshold = Math.max(cpuCount * 1.5, 8);
      if (load! > loadThreshold) return;

      // Connect to sidecar with timeout
      if (!this.desktop.connected) {
        if (this.connectRetries >= this.MAX_CONNECT_RETRIES) {
          // Stop retrying — sidecar isn't available
          if (this.connectRetries === this.MAX_CONNECT_RETRIES) {
            console.error('[CaptureEngine] Sidecar unavailable after 3 attempts — stopping captures');
            this.connectRetries++;
          }
          return;
        }

        try {
          const connectPromise = this.desktop.connect();
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Sidecar connect timeout (10s)')), 10000)
          );
          await Promise.race([connectPromise, timeoutPromise]);
          this.connectRetries = 0;
          console.log('[CaptureEngine] Sidecar connected');
        } catch (err) {
          this.connectRetries++;
          console.error(`[CaptureEngine] Sidecar connect failed (attempt ${this.connectRetries}/${this.MAX_CONNECT_RETRIES}):`, err instanceof Error ? err.message : err);
          return;
        }
      }

      const imageBuffer = await this.desktop.captureScreen();

      // Pixel diff against previous frame
      const changePct = this.computePixelDiff(imageBuffer);

      if (changePct < this.config.min_change_threshold && this.previousBuffer) {
        return;
      }

      const id = generateId();
      const now = Date.now();

      // Save to disk
      const imagePath = this.saveCapture(imageBuffer, now);

      // Generate thumbnail (non-blocking, best-effort)
      const thumbnailPath = await this.generateThumbnail(imagePath);

      const frame: CaptureFrame = {
        id,
        timestamp: now,
        imageBuffer,
        pixelChangePct: changePct,
      };

      this.latestFrame = frame;
      this.previousBuffer = imageBuffer;

      // Emit event for processing pipeline
      if (this.handler) {
        this.handler({
          type: 'screen_capture',
          data: {
            captureId: id,
            pixelChangePct: changePct,
            imagePath,
            thumbnailPath,
            imageBuffer,
          },
          timestamp: now,
        });
      }
    } catch (err) {
      console.error('[CaptureEngine] Capture failed:', err instanceof Error ? err.message : err);
      // If socket died, reset connection state
      if (err instanceof Error && (err.message.includes('ECONNREFUSED') || err.message.includes('destroyed') || err.message.includes('closed'))) {
        try { await this.desktop.disconnect(); } catch { /* ignore */ }
      }
    } finally {
      this.capturing = false;
    }
  }

  /**
   * Fast pixel diff using sampled byte comparison.
   * Compares every 100th byte of the raw buffer. Returns percentage of changed samples (0.0-1.0).
   */
  private computePixelDiff(current: Buffer): number {
    if (!this.previousBuffer) return 1.0; // First frame — always significant
    if (current.length !== this.previousBuffer.length) return 1.0; // Size changed — significant

    const step = 100;
    let changed = 0;
    let total = 0;

    for (let i = 0; i < current.length; i += step) {
      total++;
      if (current[i] !== this.previousBuffer[i]) {
        changed++;
      }
    }

    return total > 0 ? changed / total : 1.0;
  }

  /**
   * Save PNG to disk in date-organized directory.
   * Returns the file path.
   */
  private saveCapture(imageBuffer: Buffer, timestamp: number): string {
    const date = new Date(timestamp);
    const dateDir = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const fileName = `${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}.png`;

    const dir = path.join(this.captureDir, dateDir);
    mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, fileName);
    writeFileSync(filePath, imageBuffer);

    return filePath;
  }

  /**
   * Generate a 200px-wide JPEG thumbnail from a full PNG capture.
   * Uses sharp if available. Returns thumbnail path or null.
   */
  private async generateThumbnail(fullImagePath: string): Promise<string | null> {
    if (!sharp) return null;

    const thumbPath = fullImagePath.replace(/\.png$/, '-thumb.jpg');
    try {
      await sharp(fullImagePath).resize(200).jpeg({ quality: 60 }).toFile(thumbPath);
      return thumbPath;
    } catch {
      return null;
    }
  }

  /**
   * Clean up old captures based on tiered retention config.
   * - 'full' tier: delete images + DB rows older than full_hours
   * - 'key_moment' tier: delete images + DB rows older than key_moment_hours
   * Disk files older than the max retention window are removed as orphans.
   */
  private cleanupRetention(): void {
    try {
      const now = Date.now();
      const fullCutoff = now - (this.config.retention.full_hours * 60 * 60 * 1000);
      const keyMomentCutoff = now - (this.config.retention.key_moment_hours * 60 * 60 * 1000);

      // Delete DB rows by tier
      let fullDeleted = 0;
      let keyDeleted = 0;
      try {
        fullDeleted = deleteCapturesBefore(fullCutoff, 'full');
        keyDeleted = deleteCapturesBefore(keyMomentCutoff, 'key_moment');
      } catch { /* DB may not be initialized in tests */ }

      // Clean up orphan files on disk
      if (!existsSync(this.captureDir)) return;

      const dateDirs = readdirSync(this.captureDir);
      for (const dateDir of dateDirs) {
        const dirPath = path.join(this.captureDir, dateDir);
        try {
          const stat = statSync(dirPath);
          if (!stat.isDirectory()) continue;

          const files = readdirSync(dirPath);
          let remaining = files.length;

          for (const file of files) {
            const filePath = path.join(dirPath, file);
            try {
              const fileStat = statSync(filePath);
              // Delete files older than max retention (key_moment_hours)
              if (fileStat.mtimeMs < keyMomentCutoff) {
                unlinkSync(filePath);
                remaining--;
              }
            } catch { /* file already gone */ }
          }

          // Remove empty date directories
          if (remaining === 0) {
            try {
              if (readdirSync(dirPath).length === 0) rmdirSync(dirPath);
            } catch { /* ignore */ }
          }
        } catch { /* skip */ }
      }

      if (fullDeleted > 0 || keyDeleted > 0) {
        console.log(`[CaptureEngine] Retention cleanup: ${fullDeleted} full, ${keyDeleted} key_moment captures deleted`);
      }
    } catch (err) {
      console.error('[CaptureEngine] Retention cleanup error:', err instanceof Error ? err.message : err);
    }
  }
}
