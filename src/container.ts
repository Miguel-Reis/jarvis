/**
 * Dependency Injection Container
 *
 * Centralized container for managing singleton service instances.
 * Replaces ad-hoc singleton getters with a unified registry.
 */

import { TimeTrackerService } from './services/time-tracker-service.ts';
import { MetricsService } from './services/metrics-service.ts';
import { PredictionEngine } from './services/prediction-engine.ts';
import { CoordinationLogger } from './services/coordination-logger-service.ts';
import { DeepMemorySynthesisService } from './services/deep-memory-synthesis-service.ts';
import { VoiceLoopService } from './services/voice-loop-service.ts';
import { DailyRhythmService } from './services/daily-rhythm-service.ts';
import { GraphifyService } from './services/graphify-service.ts';

// Private singleton instances
let _timeTracker: TimeTrackerService | null = null;
let _metricsService: MetricsService | null = null;
let _predictionEngine: PredictionEngine | null = null;
let _coordinationLogger: CoordinationLogger | null = null;
let _deepMemorySynthesis: DeepMemorySynthesisService | null = null;
let _voiceLoopService: VoiceLoopService | null = null;
let _dailyRhythmService: DailyRhythmService | null = null;
let _graphifyService: GraphifyService | null = null;

/**
 * DI Container for application services
 */
export const container = {
  /**
   * Get or create TimeTrackerService singleton
   */
  getTimeTracker(): TimeTrackerService {
    if (!_timeTracker) {
      _timeTracker = new TimeTrackerService();
    }
    return _timeTracker;
  },

  /**
   * Get or create MetricsService singleton
   */
  getMetricsService(): MetricsService {
    if (!_metricsService) {
      _metricsService = new MetricsService();
    }
    return _metricsService;
  },

  /**
   * Get or create PredictionEngine singleton
   */
  getPredictionEngine(): PredictionEngine {
    if (!_predictionEngine) {
      _predictionEngine = new PredictionEngine();
    }
    return _predictionEngine;
  },

  /**
   * Get or create CoordinationLogger singleton
   */
  getCoordinationLogger(): CoordinationLogger {
    if (!_coordinationLogger) {
      _coordinationLogger = new CoordinationLogger();
    }
    return _coordinationLogger;
  },

  /**
   * Get or create DeepMemorySynthesisService singleton
   */
  getDeepMemorySynthesisService(): DeepMemorySynthesisService {
    if (!_deepMemorySynthesis) {
      _deepMemorySynthesis = new DeepMemorySynthesisService();
    }
    return _deepMemorySynthesis;
  },

  /**
   * Get or create VoiceLoopService singleton
   */
  getVoiceLoopService(): VoiceLoopService {
    if (!_voiceLoopService) {
      _voiceLoopService = new VoiceLoopService();
    }
    return _voiceLoopService;
  },

  /**
   * Get or create DailyRhythmService singleton
   */
  getDailyRhythmService(): DailyRhythmService {
    if (!_dailyRhythmService) {
      _dailyRhythmService = new DailyRhythmService();
    }
    return _dailyRhythmService;
  },

  /**
   * Get or create GraphifyService singleton
   */
  getGraphifyService(): GraphifyService {
    if (!_graphifyService) {
      _graphifyService = new GraphifyService();
    }
    return _graphifyService;
  },

  /**
   * Reset all singletons (for testing)
   */
  reset(): void {
    _timeTracker = null;
    _metricsService = null;
    _predictionEngine = null;
    _coordinationLogger = null;
    _deepMemorySynthesis = null;
    _voiceLoopService = null;
    _dailyRhythmService = null;
    _graphifyService = null;
  },
};

// Legacy getters for backward compatibility - redirect to container
export const getTimeTracker = () => container.getTimeTracker();
export const getMetricsService = () => container.getMetricsService();
export const getPredictionEngine = () => container.getPredictionEngine();
export const getCoordinationLogger = () => container.getCoordinationLogger();
export const getDeepMemorySynthesisService = () => container.getDeepMemorySynthesisService();
export const getVoiceLoopService = () => container.getVoiceLoopService();
export const getDailyRhythmService = () => container.getDailyRhythmService();
export const getGraphifyService = () => container.getGraphifyService();
