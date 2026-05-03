/**
 * WakeWordService — "Hey Jarvis" Detection
 *
 * Uses OpenWakeWord WASM for local, private wake-word detection.
 * Triggers an interrupt when the wake word is detected.
 */

import { InterruptManager } from '../agents/interrupt-manager.ts';

export interface WakeWordConfig {
  enabled: boolean;
  sensitivity: number; // 0.0 - 1.0 (default: 0.7)
  modelPath?: string;  // Custom model path
}

const DEFAULT_CONFIG: WakeWordConfig = {
  enabled: true,
  sensitivity: 0.7,
};

// OpenWakeWord WASM types (lazy loaded)
type WakeWordDetector = {
  init: () => Promise<void>;
  processAudio: (float32Audio: Float32Array) => Promise<{ wakeWord: string; confidence: number } | null>;
  destroy: () => void;
};

export class WakeWordService {
  private config: WakeWordConfig;
  private interruptManager: InterruptManager;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private detector: WakeWordDetector | null = null;
  private isListening = false;
  private lastDetectionTime = 0;
  private cooldownMs = 5000; // 5 second cooldown between detections
  private scriptProcessor: ScriptProcessorNode | null = null;

  constructor(interruptManager: InterruptManager, config?: Partial<WakeWordConfig>) {
    this.interruptManager = interruptManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start wake-word detection with OpenWakeWord WASM
   */
  async start(): Promise<boolean> {
    if (!this.config.enabled) {
      console.log('[WakeWordService] Disabled by config');
      return false;
    }

    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: 16000 });

      // Initialize OpenWakeWord WASM detector
      await this.initWakeWordDetector();

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create script processor for real-time audio analysis
      this.scriptProcessor = this.audioContext.createScriptProcessor(8192, 1, 1);
      this.scriptProcessor.onaudioprocess = (e) => this.handleAudioChunk(e);

      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      this.isListening = true;
      console.log('[WakeWordService] Listening for "Hey Jarvis" (OpenWakeWord WASM active)');

      return true;
    } catch (err) {
      console.error('[WakeWordService] Failed to start:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * Initialize OpenWakeWord WASM detector
   */
  private async initWakeWordDetector(): Promise<void> {
    try {
      // Lazy load the WASM module
      const { WakeWordDetector } = await import('openwakeword-wasm-browser');

      const detectorInstance = new WakeWordDetector({
        modelPaths: {
          hey_jarvis: '/openwakeword/models/hey_jarvis_v0.1.onnx',
        },
        sensitivity: this.config.sensitivity,
      });

      await detectorInstance.init();
      this.detector = detectorInstance;
      console.log('[WakeWordService] OpenWakeWord WASM initialized');
    } catch (err) {
      console.warn('[WakeWordService] WASM init failed, falling back to energy detection:', err instanceof Error ? err.message : err);
      this.detector = null;
    }
  }

  /**
   * Stop wake-word detection
   */
  stop(): void {
    this.isListening = false;

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.detector) {
      this.detector.destroy();
      this.detector = null;
    }

    console.log('[WakeWordService] Stopped');
  }

  /**
   * Handle audio chunk from ScriptProcessorNode
   */
  private async handleAudioChunk(event: AudioProcessingEvent): Promise<void> {
    if (!this.isListening || !this.detector) return;

    const inputData = event.inputBuffer.getChannelData(0);
    const float32Audio = new Float32Array(inputData);

    try {
      const result = await this.detector.processAudio(float32Audio);

      if (result) {
        const now = Date.now();
        if (now - this.lastDetectionTime > this.cooldownMs) {
          this.lastDetectionTime = now;
          console.log(`[WakeWordService] Wake word detected: ${result.wakeWord} (${(result.confidence * 100).toFixed(1)}%)`);
          await this.triggerWakeWord(result.confidence);
        }
      }
    } catch (err) {
      console.error('[WakeWordService] Process audio error:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Trigger wake-word interrupt
   */
  private async triggerWakeWord(confidence: number): Promise<void> {
    console.log(`[WakeWordService] 🎤 WAKE WORD DETECTED: "Hey Jarvis" (${(confidence * 100).toFixed(1)}% confidence)`);

    await this.interruptManager.triggerInterrupt({
      type: 'wake_word_detected',
      severity: 'critical',
      data: {
        wakeWord: 'hey_jarvis',
        confidence,
      },
      message: 'Wake word "Hey Jarvis" detected - user is requesting attention',
    });
  }

  /**
   * Update sensitivity
   */
  setSensitivity(sensitivity: number): void {
    this.config.sensitivity = Math.max(0, Math.min(1, sensitivity));
    console.log(`[WakeWordService] Sensitivity updated: ${this.config.sensitivity.toFixed(2)}`);
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.isListening && this.audioContext !== null;
  }

  /**
   * Check if WASM detector is loaded
   */
  isWasmActive(): boolean {
    return this.detector !== null;
  }
}

/**
 * Browser-compatible audio monitor for wake-word detection
 *
 * This is a lightweight alternative that works without WASM models.
 * Use this for development or when OpenWakeWord models are not available.
 */
export class SimpleAudioMonitor {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private isMonitoring = false;
  private onSoundDetected?: (energy: number) => void;

  constructor(onSoundDetected?: (energy: number) => void) {
    this.onSoundDetected = onSoundDetected;
  }

  async start(): Promise<boolean> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      this.isMonitoring = true;
      this.monitorLoop();

      console.log('[SimpleAudioMonitor] Started');
      return true;
    } catch (err) {
      console.error('[SimpleAudioMonitor] Failed to start:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  stop(): void {
    this.isMonitoring = false;

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    console.log('[SimpleAudioMonitor] Stopped');
  }

  private monitorLoop(): void {
    if (!this.isMonitoring || !this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const check = () => {
      if (!this.isMonitoring || !this.analyser) return;

      this.analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;

      if (average > 30 && this.onSoundDetected) {
        this.onSoundDetected(average);
      }

      setTimeout(check, 100);
    };

    check();
  }
}
