/**
 * OCR Engine — Local Text Extraction via Tesseract.js
 *
 * Maintains a persistent Tesseract worker for fast repeated OCR.
 * WASM-based, no native dependencies, runs in Bun.
 */

import type { OCRResult } from './types.ts';

export class OCREngine {
  private worker: any = null;
  private ready = false;
  private initializing = false;

  /**
   * Initialize the Tesseract worker. Call once before extractText().
   * Loads the English language model (~2s on first run, cached after).
   */
  async initialize(): Promise<void> {
    if (this.ready || this.initializing) return;
    this.initializing = true;

    try {
      const Tesseract = await import('tesseract.js');
      this.worker = await Tesseract.createWorker('eng');
      this.ready = true;
      console.log('[OCREngine] Tesseract worker initialized (eng)');
    } catch (err) {
      this.initializing = false;
      console.error('[OCREngine] Failed to initialize:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Shut down the Tesseract worker.
   */
  async shutdown(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch { /* ignore */ }
      this.worker = null;
      this.ready = false;
      this.initializing = false;
      console.log('[OCREngine] Worker terminated');
    }
  }

  /**
   * Extract text from a PNG image buffer.
   * Returns the extracted text, confidence score, and processing duration.
   */
  async extractText(imageBuffer: Buffer): Promise<OCRResult> {
    if (!this.ready || !this.worker) {
      throw new Error('OCR engine not initialized. Call initialize() first.');
    }

    const start = performance.now();

    try {
      const result = await this.worker.recognize(imageBuffer);
      const durationMs = Math.round(performance.now() - start);

      if (durationMs > 500) {
        console.warn(`[OCREngine] Slow OCR: ${durationMs}ms`);
      }

      return {
        text: result.data.text || '',
        confidence: result.data.confidence || 0,
        durationMs,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      console.error('[OCREngine] Recognition failed:', err instanceof Error ? err.message : err);
      return {
        text: '',
        confidence: 0,
        durationMs,
      };
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}
