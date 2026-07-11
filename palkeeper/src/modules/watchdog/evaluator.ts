export interface WatchdogSample {
  /** RAM do processo em bytes (null = indisponível) */
  ramBytes: number | null;
  /** FPS do servidor (null = métricas indisponíveis) */
  fps: number | null;
  timestamp: number;
}

export interface WatchdogEvaluatorConfig {
  memoryLimitMB: number;
  fpsThreshold: number;
  sustainedMinutes: number;
  cooldownMinutes: number;
}

export type WatchdogDecision =
  | { kind: "ok" }
  | { kind: "breaching"; sinceMs: number; reason: string }
  | { kind: "restart"; reason: string };

/**
 * Lógica pura do watchdog (o Palworld tem memory leak conhecido):
 * RAM acima do limite OU FPS abaixo do limiar têm de se manter
 * `sustainedMinutes` seguidos para disparar um restart; depois de um
 * disparo há um cooldown para nunca entrar em loop de restarts.
 */
export class WatchdogEvaluator {
  private breachStart: number | null = null;
  private breachReason = "";
  private lastRestartAt: number | null = null;

  constructor(private readonly config: WatchdogEvaluatorConfig) {}

  evaluate(sample: WatchdogSample): WatchdogDecision {
    const reasons: string[] = [];
    if (sample.ramBytes !== null && sample.ramBytes > this.config.memoryLimitMB * 1024 * 1024) {
      reasons.push(`RAM ${(sample.ramBytes / 1024 / 1024).toFixed(0)}MB > ${this.config.memoryLimitMB}MB`);
    }
    if (sample.fps !== null && sample.fps < this.config.fpsThreshold) {
      reasons.push(`FPS ${sample.fps} < ${this.config.fpsThreshold}`);
    }

    if (reasons.length === 0) {
      this.breachStart = null;
      return { kind: "ok" };
    }

    if (
      this.lastRestartAt !== null &&
      sample.timestamp - this.lastRestartAt < this.config.cooldownMinutes * 60_000
    ) {
      // ainda em cooldown: não acumula breach para não disparar logo a seguir
      this.breachStart = null;
      return { kind: "ok" };
    }

    if (this.breachStart === null) {
      this.breachStart = sample.timestamp;
      this.breachReason = reasons.join(" e ");
    }

    const elapsed = sample.timestamp - this.breachStart;
    if (elapsed >= this.config.sustainedMinutes * 60_000) {
      this.lastRestartAt = sample.timestamp;
      this.breachStart = null;
      return { kind: "restart", reason: this.breachReason };
    }
    return { kind: "breaching", sinceMs: elapsed, reason: this.breachReason };
  }

  /** Regista um restart externo (ex.: agendado) para o cooldown contar também. */
  noteRestart(timestamp: number): void {
    this.lastRestartAt = timestamp;
    this.breachStart = null;
  }
}
