/**
 * Screen Capture Service
 *
 * Captures screenshots for visual context analysis.
 * Uses screenshot-desktop for cross-platform support.
 *
 * Privacy features:
 * - Buffer circular (sem persistência em disco)
 * - Privacy mode para pausar capturas
 * - Redaction de dados sensíveis via VLM
 */

import type { Service, ServiceStatus } from '../daemon/types.ts';
import { getDb, generateId } from '../vault/schema.ts';

export interface ScreenCaptureConfig {
  enabled: boolean;
  captureIntervalMs: number;    // Default: 30000 (30 seconds)
  maxWidth: number;             // Default: 1920
  maxHeight: number;            // Default: 1080
  quality: number;              // Default: 0.8 (80%)
  privacyMode: boolean;         // Pause captures
}

const DEFAULT_CONFIG: ScreenCaptureConfig = {
  enabled: true,
  captureIntervalMs: 30000,
  maxWidth: 1920,
  maxHeight: 1080,
  quality: 0.8,
  privacyMode: false,
};

export interface ScreenCaptureResult {
  imageData: Buffer;
  base64: string;
  mimeType: string;
  timestamp: number;
  width: number;
  height: number;
}

export class ScreenCaptureService implements Service {
  name = 'screen-capture';
  private config: ScreenCaptureConfig;
  private statusState: ServiceStatus = 'stopped';
  private captureInterval: Timer | null = null;
  private lastCapture: ScreenCaptureResult | null = null;
  private captureBuffer: ScreenCaptureResult[] = [];  // Circular buffer
  private maxBufferSize = 5;  // Keep last 5 captures
  private onCapture?: (capture: ScreenCaptureResult) => void;
  private isWSL: boolean = false;

  constructor(config?: Partial<ScreenCaptureConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isWSL = false;
  }

  /**
   * Detect if running on WSL2
   */
  private detectWSL(): boolean {
    // Check environment variables
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
      return true;
    }

    // Check /proc/version for Microsoft
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
   * Start the service
   */
  async start(): Promise<void> {
    console.log('[ScreenCapture] Starting...');
    this.statusState = 'starting';

    try {
      // Check for WSL2 (screenshot-desktop doesn't work on WSL2)
      if (this.detectWSL()) {
        console.log('[ScreenCapture] WSL2 detected - screen capture is not supported on WSL2');
        this.statusState = 'stopped';
        console.log('[ScreenCapture] Service disabled (WSL2 incompatible)');
        return;
      }

      // Start capture interval if enabled and not in privacy mode
      if (this.config.enabled && !this.config.privacyMode) {
        this.startCaptureInterval();
      }

      this.statusState = 'running';
      console.log(`[ScreenCapture] Running (interval: ${this.config.captureIntervalMs}ms)`);
    } catch (err) {
      this.statusState = 'error';
      console.error('[ScreenCapture] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[ScreenCapture] Stopping...');
    this.statusState = 'stopping';

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    // Clear buffer for privacy
    this.captureBuffer = [];
    this.lastCapture = null;

    this.statusState = 'stopped';
    console.log('[ScreenCapture] Stopped (buffer cleared)');
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
  setCaptureCallback(callback: (capture: ScreenCaptureResult) => void): void {
    this.onCapture = callback;
  }

  /**
   * Start periodic capture
   */
  private startCaptureInterval(): void {
    this.captureInterval = setInterval(() => {
      if (!this.config.privacyMode && this.config.enabled) {
        this.captureScreen().catch(err =>
          console.error('[ScreenCapture] Capture error:', err instanceof Error ? err.message : err)
        );
      }
    }, this.config.captureIntervalMs);

    console.log(`[ScreenCapture] Interval started (${this.config.captureIntervalMs}ms)`);
  }

  /**
   * Capture current screen
   */
  async captureScreen(): Promise<ScreenCaptureResult | null> {
    try {
      // Dynamic import for screenshot-desktop (no types available)
      const screenshotModule = await import('screenshot-desktop' as any);
      const screenshot = screenshotModule.default || screenshotModule;

      const imageData: Buffer = await screenshot({
        screen: 0,  // Primary monitor
        format: 'png',
      });

      // Get image dimensions (approximate for PNG)
      const width = this.config.maxWidth;
      const height = this.config.maxHeight;

      // Convert to base64 for VLM API
      const base64 = imageData.toString('base64');
      const mimeType = 'image/png';

      const result: ScreenCaptureResult = {
        imageData,
        base64,
        mimeType,
        timestamp: Date.now(),
        width,
        height,
      };

      // Store in buffer (circular)
      this.lastCapture = result;
      this.captureBuffer.push(result);
      if (this.captureBuffer.length > this.maxBufferSize) {
        this.captureBuffer.shift();
      }

      // Callback for VLM analyzer
      if (this.onCapture) {
        this.onCapture(result);
      }

      // Persist to database
      this.persistToDatabase(result);

      console.log(`[ScreenCapture] Captured ${width}x${height} (${(imageData.length / 1024).toFixed(1)}KB)`);
      return result;
    } catch (err) {
      console.error('[ScreenCapture] Screenshot failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Get last capture
   */
  getLastCapture(): ScreenCaptureResult | null {
    return this.lastCapture;
  }

  /**
   * Get capture buffer (last N captures)
   */
  getBuffer(): ScreenCaptureResult[] {
    return [...this.captureBuffer];
  }

  /**
   * Clear capture buffer
   */
  clearBuffer(): void {
    this.captureBuffer = [];
    this.lastCapture = null;
    console.log('[ScreenCapture] Buffer cleared');
  }

  /**
   * Enable/disable privacy mode
   */
  setPrivacyMode(enabled: boolean): void {
    this.config.privacyMode = enabled;
    if (enabled) {
      console.log('[ScreenCapture] Privacy mode ON - captures paused');
      this.clearBuffer();
    } else {
      console.log('[ScreenCapture] Privacy mode OFF - captures resumed');
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
    if (!enabled && this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    } else if (enabled && !this.captureInterval) {
      this.startCaptureInterval();
    }
    console.log(`[ScreenCapture] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Trigger manual capture (on-demand)
   */
  async captureNow(): Promise<ScreenCaptureResult | null> {
    console.log('[ScreenCapture] Manual capture triggered');
    return this.captureScreen();
  }

  /**
   * Persist capture to database
   */
  private persistToDatabase(capture: ScreenCaptureResult): void {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        INSERT INTO screen_captures (id, image_path, width, height, captured_at, context_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        generateId(),
        'memory://buffer',  // In-memory capture, not persisted to disk
        capture.width,
        capture.height,
        capture.timestamp,
        JSON.stringify({ mimeType: capture.mimeType, sizeBytes: capture.imageData.length }),
      );
    } catch (err) {
      console.error('[ScreenCapture] Database insert failed:', err instanceof Error ? err.message : err);
    }
  }
}
