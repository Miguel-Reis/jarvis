/**
 * Live Screen Service
 *
 * Continuous screen capture from connected sidecars for real-time awareness.
 * Unlike the local ScreenCaptureService, this uses the sidecar RPC system
 * to capture screens from remote Windows/macOS/Linux machines.
 *
 * Features:
 * - Auto-detects connected sidecars with screenshot capability
 * - Configurable capture interval per sidecar
 * - Circular buffer for recent captures
 * - Event emission for VLM analyzer integration
 * - Privacy mode to pause captures
 */

import type { Service, ServiceStatus } from '../daemon/types.ts';
import { getSidecarManager, resolveDefaultSidecar } from '../actions/tools/sidecar-route.ts';
import type { SidecarInfo } from '../sidecar/types.ts';
import { getDb, generateId } from '../vault/schema.ts';

export interface LiveScreenConfig {
  enabled: boolean;
  captureIntervalMs: number;    // Default: 5000 (5 seconds for live feel)
  maxWidth: number;             // Default: 1920
  maxHeight: number;            // Default: 1080
  quality: number;              // Default: 0.8 (80%)
  privacyMode: boolean;         // Pause captures
  targetSidecar?: string;       // Specific sidecar ID/name, or auto-select
}

const DEFAULT_CONFIG: LiveScreenConfig = {
  enabled: true,
  captureIntervalMs: 5000,      // 5 seconds for "live" feel
  maxWidth: 1920,
  maxHeight: 1080,
  quality: 0.8,
  privacyMode: false,
  targetSidecar: undefined,
};

export interface LiveScreenResult {
  sidecarId: string;
  sidecarName: string;
  imageData?: Buffer;
  base64?: string;
  mimeType: string;
  timestamp: number;
  width: number;
  height: number;
  error?: string;
}

export type LiveScreenCallback = (capture: LiveScreenResult) => void;

export class LiveScreenService implements Service {
  name = 'live-screen';
  private config: LiveScreenConfig;
  private statusState: ServiceStatus = 'stopped';
  private captureIntervals = new Map<string, Timer>();  // Per-sidecar intervals
  private lastCapture: LiveScreenResult | null = null;
  private captureBuffer: LiveScreenResult[] = [];  // Circular buffer
  private maxBufferSize = 10;  // Keep last 10 captures
  private onCapture?: LiveScreenCallback;
  private isWSL: boolean = false;

  constructor(config?: Partial<LiveScreenConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isWSL = this.detectWSL();
  }

  /**
   * Detect if running on WSL2
   */
  private detectWSL(): boolean {
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
      return true;
    }

    try {
      const version = Bun.file('/proc/version').text().catch(() => '').toLowerCase();
      if (version.includes('microsoft')) {
        return true;
      }
    } catch {
      // Ignore if can't read /proc/version
    }

    return false;
  }

  /**
   * Get connected sidecars with screenshot capability
   */
  private getAvailableSidecars(): SidecarInfo[] {
    const manager = getSidecarManager();
    if (!manager) return [];

    const sidecars = manager.listSidecars();
    return sidecars.filter(
      (s) =>
        s.connected &&
        s.capabilities?.includes('screenshot') &&
        !s.unavailable_capabilities?.some((u) => u.name === 'screenshot'),
    );
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    console.log('[LiveScreen] Starting...');
    this.statusState = 'starting';

    try {
      if (this.isWSL) {
        console.log('[LiveScreen] Running on WSL2 - will use sidecars for captures');
      }

      // Start capture intervals if enabled and not in privacy mode
      if (this.config.enabled && !this.config.privacyMode) {
        this.startCaptureIntervals();
      }

      this.statusState = 'running';
      console.log(`[LiveScreen] Running (interval: ${this.config.captureIntervalMs}ms)`);
    } catch (err) {
      this.statusState = 'error';
      console.error('[LiveScreen] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[LiveScreen] Stopping...');
    this.statusState = 'stopping';

    // Stop all intervals
    for (const [sidecarId, timer] of this.captureIntervals) {
      clearInterval(timer);
    }
    this.captureIntervals.clear();

    // Clear buffer for privacy
    this.captureBuffer = [];
    this.lastCapture = null;

    this.statusState = 'stopped';
    console.log('[LiveScreen] Stopped (buffer cleared)');
  }

  /**
   * Get current service status
   */
  status(): ServiceStatus {
    return this.statusState;
  }

  /**
   * Set capture callback (for VLM analyzer)
   */
  setCaptureCallback(callback: LiveScreenCallback): void {
    this.onCapture = callback;
  }

  /**
   * Start periodic captures for all available sidecars
   */
  private startCaptureIntervals(): void {
    const sidecars = this.getAvailableSidecars();

    if (sidecars.length === 0) {
      console.log('[LiveScreen] No connected sidecars with screenshot capability yet');
      // Retry after interval to catch sidecars that connect later
      const retryTimer = setInterval(() => {
        const newSidecars = this.getAvailableSidecars();
        if (newSidecars.length > 0 && this.captureIntervals.size === 0) {
          clearInterval(retryTimer);
          this.startCaptureIntervals();
        }
      }, this.config.captureIntervalMs * 2);
      return;
    }

    console.log(`[LiveScreen] Starting captures for ${sidecars.length} sidecar(s): ${sidecars.map(s => s.name).join(', ')}`);

    for (const sidecar of sidecars) {
      if (!this.captureIntervals.has(sidecar.id)) {
        const timer = setInterval(() => {
          if (!this.config.privacyMode && this.config.enabled) {
            this.captureFromSidecar(sidecar).catch(err =>
              console.error(`[LiveScreen] Capture error for ${sidecar.name}:`, err instanceof Error ? err.message : err)
            );
          }
        }, this.config.captureIntervalMs);

        this.captureIntervals.set(sidecar.id, timer);
      }
    }
  }

  /**
   * Stop intervals for sidecars that are no longer available
   */
  private cleanupIntervals(): void {
    const availableIds = new Set(this.getAvailableSidecars().map(s => s.id));

    for (const [sidecarId, timer] of this.captureIntervals) {
      if (!availableIds.has(sidecarId)) {
        clearInterval(timer);
        this.captureIntervals.delete(sidecarId);
        console.log(`[LiveScreen] Stopped capture for disconnected sidecar: ${sidecarId}`);
      }
    }
  }

  /**
   * Capture screen from a specific sidecar
   */
  private async captureFromSidecar(sidecar: SidecarInfo): Promise<LiveScreenResult | null> {
    try {
      const manager = getSidecarManager();
      if (!manager) {
        return {
          sidecarId: sidecar.id,
          sidecarName: sidecar.name,
          mimeType: 'image/png',
          timestamp: Date.now(),
          width: 0,
          height: 0,
          error: 'Sidecar manager not available',
        };
      }

      // Dispatch capture_screen RPC
      const result = await manager.dispatchRPC(sidecar.id, 'capture_screen', {}, {
        initial: 10000,
        max: 30000,
      });

      // Handle "detached" result
      if (result === 'detached') {
        console.log(`[LiveScreen] Capture detached for ${sidecar.name}`);
        return null;
      }

      // Parse result - sidecar returns { _binary: base64String } or similar
      let base64: string | undefined;
      let imageData: Buffer | undefined;

      if (typeof result === 'string') {
        // Try to parse as JSON
        try {
          const parsed = JSON.parse(result);
          if (parsed._binary) {
            base64 = parsed._binary;
            imageData = Buffer.from(base64, 'base64');
          } else if (parsed.data) {
            base64 = parsed.data;
            imageData = Buffer.from(base64, 'base64');
          }
        } catch {
          // Not JSON, might be raw base64
          base64 = result;
          imageData = Buffer.from(result, 'base64');
        }
      } else if (typeof result === 'object' && result !== null) {
        const resultObj = result as Record<string, unknown>;
        if (resultObj._binary) {
          base64 = resultObj._binary as string;
          imageData = Buffer.from(base64, 'base64');
        } else if (resultObj.data) {
          base64 = resultObj.data as string;
          imageData = Buffer.from(base64, 'base64');
        }
      }

      if (!base64 || !imageData) {
        console.warn(`[LiveScreen] No image data in result from ${sidecar.name}:`, result);
        return null;
      }

      const captureResult: LiveScreenResult = {
        sidecarId: sidecar.id,
        sidecarName: sidecar.name,
        imageData,
        base64,
        mimeType: 'image/png',
        timestamp: Date.now(),
        width: this.config.maxWidth,
        height: this.config.maxHeight,
      };

      // Store in buffer (circular)
      this.lastCapture = captureResult;
      this.captureBuffer.push(captureResult);
      if (this.captureBuffer.length > this.maxBufferSize) {
        this.captureBuffer.shift();
      }

      // Callback for VLM analyzer
      if (this.onCapture) {
        this.onCapture(captureResult);
      }

      // Persist to database
      this.persistToDatabase(captureResult);

      console.log(`[LiveScreen] Captured from ${sidecar.name} (${(imageData.length / 1024).toFixed(1)}KB)`);
      return captureResult;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[LiveScreen] Screenshot failed for ${sidecar.name}:`, errorMsg);

      const errorResult: LiveScreenResult = {
        sidecarId: sidecar.id,
        sidecarName: sidecar.name,
        mimeType: 'image/png',
        timestamp: Date.now(),
        width: 0,
        height: 0,
        error: errorMsg,
      };

      if (this.onCapture) {
        this.onCapture(errorResult);
      }

      return errorResult;
    }
  }

  /**
   * Trigger manual capture from all sidecars
   */
  async captureNow(): Promise<LiveScreenResult[]> {
    console.log('[LiveScreen] Manual capture triggered');
    const sidecars = this.getAvailableSidecars();
    const results: LiveScreenResult[] = [];

    for (const sidecar of sidecars) {
      const result = await this.captureFromSidecar(sidecar);
      if (result) results.push(result);
    }

    return results;
  }

  /**
   * Trigger manual capture from a specific sidecar
   */
  async captureFrom(targetSidecar: string): Promise<LiveScreenResult | null> {
    console.log(`[LiveScreen] Manual capture from: ${targetSidecar}`);
    const manager = getSidecarManager();
    if (!manager) return null;

    const sidecars = manager.listSidecars();
    const sidecar = sidecars.find(
      (s) => s.id === targetSidecar || s.name.toLowerCase() === targetSidecar.toLowerCase(),
    );

    if (!sidecar) {
      console.error(`[LiveScreen] Sidecar not found: ${targetSidecar}`);
      return null;
    }

    return this.captureFromSidecar(sidecar);
  }

  /**
   * Get last capture
   */
  getLastCapture(): LiveScreenResult | null {
    return this.lastCapture;
  }

  /**
   * Get capture buffer (last N captures)
   */
  getBuffer(): LiveScreenResult[] {
    return [...this.captureBuffer];
  }

  /**
   * Clear capture buffer
   */
  clearBuffer(): void {
    this.captureBuffer = [];
    this.lastCapture = null;
    console.log('[LiveScreen] Buffer cleared');
  }

  /**
   * Enable/disable privacy mode
   */
  setPrivacyMode(enabled: boolean): void {
    this.config.privacyMode = enabled;
    if (enabled) {
      console.log('[LiveScreen] Privacy mode ON - captures paused');
      this.clearBuffer();
    } else {
      console.log('[LiveScreen] Privacy mode OFF - captures resumed');
      this.startCaptureIntervals();
    }
  }

  /**
   * Check if in privacy mode
   */
  isPrivacyMode(): boolean {
    return this.config.privacyMode;
  }

  /**
   * Enable/disable captures
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      // Stop all intervals
      for (const [_, timer] of this.captureIntervals) {
        clearInterval(timer);
      }
      this.captureIntervals.clear();
    } else if (!this.config.privacyMode) {
      this.startCaptureIntervals();
    }
    console.log(`[LiveScreen] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Set target sidecar (or undefined for auto-select all)
   */
  setTargetSidecar(target: string | undefined): void {
    this.config.targetSidecar = target;
    console.log(`[LiveScreen] Target sidecar: ${target || 'auto-select all'}`);

    // Restart intervals with new target
    if (this.config.enabled && !this.config.privacyMode) {
      this.stopIntervals();
      this.startCaptureIntervals();
    }
  }

  /**
   * Stop all capture intervals
   */
  private stopIntervals(): void {
    for (const [_, timer] of this.captureIntervals) {
      clearInterval(timer);
    }
    this.captureIntervals.clear();
  }

  /**
   * Get connected sidecar count
   */
  getConnectedSidecarCount(): number {
    return this.getAvailableSidecars().length;
  }

  /**
   * Persist capture to database
   */
  private persistToDatabase(capture: LiveScreenResult): void {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        INSERT INTO screen_captures (id, image_path, width, height, captured_at, context_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        generateId(),
        `sidecar://${capture.sidecarId}`,
        capture.width,
        capture.height,
        capture.timestamp,
        JSON.stringify({
          mimeType: capture.mimeType,
          sizeBytes: capture.imageData?.length ?? 0,
          sidecarName: capture.sidecarName,
        }),
      );
    } catch (err) {
      console.error('[LiveScreen] Database insert failed:', err instanceof Error ? err.message : err);
    }
  }
}
