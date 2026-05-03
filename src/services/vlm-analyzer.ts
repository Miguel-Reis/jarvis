/**
 * VLM Analyzer — Visual Language Model Analysis
 *
 * Analyzes screenshots using Claude Vision API to extract:
 * - Current application context
 * - Errors or warnings visible
 * - Code being edited
 * - Documentation being read
 * - User activity type (coding, browsing, reading, etc.)
 *
 * Results are injected into agent context for "UI-aware" assistance.
 */

import type { Service, ServiceStatus } from '../daemon/services.ts';
import type { ScreenCaptureResult } from './screen-capture.ts';
import { InterruptManager } from '../agents/interrupt-manager.ts';

export interface VLMAnalyzerConfig {
  enabled: boolean;
  model: string;              // Default: 'claude-sonnet-4-6'
  maxTokens: number;          // Default: 500
  analysisInterval: number;   // Analyze every N captures (default: 1 = every capture)
}

const DEFAULT_CONFIG: VLMAnalyzerConfig = {
  enabled: true,
  model: 'claude-sonnet-4-6',
  maxTokens: 500,
  analysisInterval: 1,
};

export interface VisualContext {
  application: string;        // e.g., "VS Code", "Terminal", "Chrome"
  activityType: 'coding' | 'browsing' | 'reading' | 'debugging' | 'chatting' | 'unknown';
  errorsVisible: boolean;
  errorsDescription?: string;
  codeVisible: boolean;
  codeLanguage?: string;
  documentationVisible: boolean;
  summary: string;
  confidence: number;         // 0.0-1.0
  timestamp: number;
}

export class VLMAnalyzer implements Service {
  name = 'vlm-analyzer';
  private config: VLMAnalyzerConfig;
  private statusState: ServiceStatus = 'stopped';
  private interruptManager?: InterruptManager;
  private captureCount = 0;
  private lastContext: VisualContext | null = null;
  private onContextChange?: (context: VisualContext) => void;

  constructor(config?: Partial<VLMAnalyzerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set interrupt manager for error alerts
   */
  setInterruptManager(manager: InterruptManager): void {
    this.interruptManager = manager;
  }

  /**
   * Set context change callback
   */
  setContextChangeCallback(callback: (context: VisualContext) => void): void {
    this.onContextChange = callback;
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    console.log('[VLMAnalyzer] Starting...');
    this.statusState = 'starting';

    try {
      this.statusState = 'running';
      console.log('[VLMAnalyzer] Running (ready to analyze captures)');
    } catch (err) {
      this.statusState = 'error';
      console.error('[VLMAnalyzer] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[VLMAnalyzer] Stopping...');
    this.statusState = 'stopping';
    this.statusState = 'stopped';
    console.log('[VLMAnalyzer] Stopped');
  }

  /**
   * Get current service status
   */
  status(): ServiceStatus {
    return this.statusState;
  }

  /**
   * Analyze a screen capture
   */
  async analyzeCapture(capture: ScreenCaptureResult): Promise<VisualContext | null> {
    this.captureCount++;

    // Skip analysis if not enabled or not the right interval
    if (!this.config.enabled || (this.captureCount % this.config.analysisInterval !== 0)) {
      return null;
    }

    try {
      // Build prompt for visual analysis
      const prompt = `Analyze this screenshot and provide a structured summary. Focus on:
1. What application is visible? (VS Code, Terminal, browser, etc.)
2. What activity is the user doing? (coding, debugging, browsing docs, etc.)
3. Are there any visible errors, warnings, or alerts?
4. Is code visible? If so, what language?
5. Is documentation visible?

Respond in this exact JSON format:
{
  "application": "App name",
  "activityType": "coding|browsing|reading|debugging|chatting|unknown",
  "errorsVisible": true/false,
  "errorsDescription": "Brief description if errors visible",
  "codeVisible": true/false,
  "codeLanguage": "language if code visible",
  "documentationVisible": true/false,
  "summary": "One sentence summary of what user is doing",
  "confidence": 0.0-1.0
}`;

      // Call Claude Vision API
      const context = await this.callClaudeVision(capture.base64, capture.mimeType, prompt);

      if (context) {
        context.timestamp = capture.timestamp;
        this.lastContext = context;

        // Trigger interrupt if errors detected
        if (context.errorsVisible && this.interruptManager) {
          await this.interruptManager.triggerInterrupt({
            type: 'visual_error_detected',
            severity: 'high',
            data: {
              error: context.errorsDescription,
              application: context.application,
              activity: context.activityType,
            },
            message: `Visual error detected: ${context.errorsDescription?.slice(0, 100) ?? 'Error visible on screen'}`,
          });
        }

        // Callback for context injection
        if (this.onContextChange) {
          this.onContextChange(context);
        }

        console.log(`[VLMAnalyzer] Analyzed: ${context.application} - ${context.activityType} (${(context.confidence * 100).toFixed(0)}% confidence)`);
      }

      return context;
    } catch (err) {
      console.error('[VLMAnalyzer] Analysis error:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Call Claude Vision API for analysis
   */
  private async callClaudeVision(
    base64Image: string,
    mimeType: string,
    prompt: string
  ): Promise<VisualContext | null> {
    try {
      // Use Anthropic API directly
      const { Anthropic } = await import('@anthropic-ai/sdk');

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.warn('[VLMAnalyzer] ANTHROPIC_API_KEY not set, skipping analysis');
        return null;
      }

      const anthropic = new Anthropic({ apiKey });

      const response = await anthropic.messages.create({
        model: this.config.model as any,
        max_tokens: this.config.maxTokens,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        }],
      });

      // Extract JSON from response
      const textContent = response.content.find((block: any) => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return null;
      }

      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[VLMAnalyzer] No JSON in response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as VisualContext;

      // Validate required fields
      if (!parsed.application || !parsed.activityType || !parsed.summary) {
        console.warn('[VLMAnalyzer] Invalid response structure');
        return null;
      }

      return {
        ...parsed,
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      };
    } catch (err) {
      console.error('[VLMAnalyzer] Claude API error:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Get last analyzed context
   */
  getLastContext(): VisualContext | null {
    return this.lastContext;
  }

  /**
   * Format context for system prompt injection
   */
  getPromptInjection(): string {
    if (!this.lastContext) {
      return '';
    }

    const ctx = this.lastContext;
    const lines: string[] = ['## 👁️ VISUAL CONTEXT (Screen Analysis)'];
    lines.push(`**Application**: ${ctx.application}`);
    lines.push(`**Activity**: ${ctx.activityType}`);
    lines.push(`**Summary**: ${ctx.summary}`);

    if (ctx.codeVisible) {
      lines.push(`**Code**: Yes${ctx.codeLanguage ? ` (${ctx.codeLanguage})` : ''}`);
    }

    if (ctx.documentationVisible) {
      lines.push('**Documentation**: Visible');
    }

    if (ctx.errorsVisible) {
      lines.push(`⚠️ **Errors**: ${ctx.errorsDescription ?? 'Yes'}`);
    }

    lines.push(`**Confidence**: ${(ctx.confidence * 100).toFixed(0)}%`);

    return lines.join('\n');
  }

  /**
   * Get analysis stats
   */
  getStats(): { capturesAnalyzed: number; lastAnalysis?: number } {
    return {
      capturesAnalyzed: this.captureCount,
      lastAnalysis: this.lastContext?.timestamp,
    };
  }
}
