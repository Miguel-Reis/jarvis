/**
 * Voice Loop Service
 *
 * Low-latency STT/TTS loop for voice-first interaction.
 * Manages voice sessions, streaming transcription, and TTS responses.
 *
 * Features:
 * - Streaming STT for real-time transcription
 * - TTS response queuing
 * - Voice activity detection
 * - Interruption handling (barge-in)
 */

import type { Service, ServiceStatus } from '../daemon/types.ts';
import type { STTProvider, TTSProvider } from '../comms/voice.ts';

export interface VoiceSession {
  id: string;
  userId: string;
  startedAt: number;
  lastActivityAt: number;
  state: 'listening' | 'processing' | 'speaking' | 'idle';
  transcript: string;
  responseBuffer: Buffer[];
}

export interface VoiceLoopConfig {
  enabled: boolean;
  sessionTimeoutMs: number;       // Default: 30000 (30s idle timeout)
  maxSessionDurationMs: number;   // Default: 300000 (5min max)
  streamingChunkSize: number;     // Default: 1024 bytes
  bargeInEnabled: boolean;        // Allow interruption during TTS
}

const DEFAULT_CONFIG: VoiceLoopConfig = {
  enabled: true,
  sessionTimeoutMs: 30000,
  maxSessionDurationMs: 300000,
  streamingChunkSize: 1024,
  bargeInEnabled: true,
};

export class VoiceLoopService implements Service {
  name = 'voice-loop';
  private config: VoiceLoopConfig;
  private statusState: ServiceStatus = 'stopped';
  private sessions = new Map<string, VoiceSession>();
  private sttProvider: STTProvider | null = null;
  private ttsProvider: TTSProvider | null = null;
  private cleanupTimer: Timer | null = null;

  // Callbacks
  private onTranscript?: (sessionId: string, transcript: string) => void;
  private onTTSDone?: (sessionId: string) => void;
  private onSessionEnd?: (sessionId: string) => void;

  constructor(config?: Partial<VoiceLoopConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the service
   */
  async start(): Promise<void> {
    console.log('[VoiceLoop] Starting...');
    this.statusState = 'starting';

    try {
      // Start cleanup timer
      this.cleanupTimer = setInterval(() => {
        this.cleanupIdleSessions();
      }, 10000);

      this.statusState = 'running';
      console.log('[VoiceLoop] Running (ready for voice sessions)');
    } catch (err) {
      this.statusState = 'error';
      console.error('[VoiceLoop] Start error:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    console.log('[VoiceLoop] Stopping...');
    this.statusState = 'stopping';

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // End all sessions
    for (const [id, session] of this.sessions.entries()) {
      this.endSession(id);
    }
    this.sessions.clear();

    this.statusState = 'stopped';
    console.log('[VoiceLoop] Stopped');
  }

  /**
   * Get current service status
   */
  status(): ServiceStatus {
    return this.statusState;
  }

  /**
   * Set STT provider
   */
  setSTTProvider(provider: STTProvider): void {
    this.sttProvider = provider;
    console.log('[VoiceLoop] STT provider set');
  }

  /**
   * Set TTS provider
   */
  setTTSProvider(provider: TTSProvider): void {
    this.ttsProvider = provider;
    console.log('[VoiceLoop] TTS provider set');
  }

  /**
   * Set callbacks
   */
  setTranscriptCallback(callback: (sessionId: string, transcript: string) => void): void {
    this.onTranscript = callback;
  }

  setTTSDoneCallback(callback: (sessionId: string) => void): void {
    this.onTTSDone = callback;
  }

  setSessionEndCallback(callback: (sessionId: string) => void): void {
    this.onSessionEnd = callback;
  }

  /**
   * Start a new voice session
   */
  startSession(userId: string): string {
    const sessionId = `voice_${Date.now()}_${userId}`;

    const session: VoiceSession = {
      id: sessionId,
      userId,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      state: 'listening',
      transcript: '',
      responseBuffer: [],
    };

    this.sessions.set(sessionId, session);
    console.log(`[VoiceLoop] Session started: ${sessionId} for user ${userId}`);

    return sessionId;
  }

  /**
   * End a voice session
   */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = 'idle';
      this.sessions.delete(sessionId);
      console.log(`[VoiceLoop] Session ended: ${sessionId}`);

      if (this.onSessionEnd) {
        this.onSessionEnd(sessionId);
      }
    }
  }

  /**
   * Process audio chunk (streaming STT)
   */
  async processAudioChunk(sessionId: string, audioChunk: Buffer): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.sttProvider) {
      return null;
    }

    session.lastActivityAt = Date.now();
    session.state = 'listening';

    try {
      // For streaming, accumulate chunks and transcribe periodically
      session.responseBuffer.push(audioChunk);

      // Transcribe when we have enough data
      const totalSize = session.responseBuffer.reduce((a, b) => a + b.length, 0);
      if (totalSize >= this.config.streamingChunkSize * 10) {
        const audioBuffer = Buffer.concat(session.responseBuffer);
        session.responseBuffer = [];

        const transcript = await this.sttProvider.transcribe(audioBuffer);

        if (transcript) {
          session.transcript = transcript;
          session.state = 'processing';

          if (this.onTranscript) {
            this.onTranscript(sessionId, transcript);
          }

          return transcript;
        }
      }

      return null;
    } catch (err) {
      console.error('[VoiceLoop] STT error:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Process complete audio (single-shot STT)
   */
  async processAudio(sessionId: string, audioBuffer: Buffer): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.sttProvider) {
      return null;
    }

    session.lastActivityAt = Date.now();
    session.state = 'listening';

    try {
      const transcript = await this.sttProvider.transcribe(audioBuffer);

      if (transcript) {
        session.transcript = transcript;
        session.state = 'processing';
        console.log(`[VoiceLoop] Transcribed: "${transcript.slice(0, 50)}..."`);

        if (this.onTranscript) {
          this.onTranscript(sessionId, transcript);
        }

        return transcript;
      }

      return null;
    } catch (err) {
      console.error('[VoiceLoop] STT error:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Synthesize response to TTS
   */
  async synthesizeResponse(sessionId: string, text: string): Promise<Buffer | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.ttsProvider) {
      return null;
    }

    session.lastActivityAt = Date.now();
    session.state = 'speaking';

    try {
      const audioBuffer = await this.ttsProvider.synthesize(text);
      console.log(`[VoiceLoop] TTS generated: ${audioBuffer.length} bytes`);

      return audioBuffer;
    } catch (err) {
      console.error('[VoiceLoop] TTS error:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Handle barge-in (user interruption during TTS)
   */
  handleBargeIn(sessionId: string): void {
    if (!this.config.bargeInEnabled) return;

    const session = this.sessions.get(sessionId);
    if (session && session.state === 'speaking') {
      console.log(`[VoiceLoop] Barge-in detected for session ${sessionId}`);
      session.state = 'listening';
      session.responseBuffer = [];
    }
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): VoiceSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get active sessions count
   */
  getActiveSessionsCount(): number {
    return this.sessions.size;
  }

  /**
   * Cleanup idle sessions
   */
  private cleanupIdleSessions(): void {
    const now = Date.now();

    for (const [id, session] of this.sessions.entries()) {
      const idleTime = now - session.lastActivityAt;
      const sessionDuration = now - session.startedAt;

      if (idleTime > this.config.sessionTimeoutMs || sessionDuration > this.config.maxSessionDurationMs) {
        console.log(`[VoiceLoop] Cleaning up idle session: ${id}`);
        this.endSession(id);
      }
    }
  }

  /**
   * Get voice loop stats
   */
  getStats(): {
    activeSessions: number;
    totalSessions: number;
    config: VoiceLoopConfig;
  } {
    return {
      activeSessions: this.sessions.size,
      totalSessions: this.sessions.size,
      config: { ...this.config },
    };
  }
}

// Singleton
let instance: VoiceLoopService | null = null;

export function getVoiceLoopService(): VoiceLoopService {
  if (!instance) {
    instance = new VoiceLoopService();
  }
  return instance;
}
