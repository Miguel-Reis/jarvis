export interface PalworldConfig {
  /** URL base da REST API oficial (ex.: http://127.0.0.1:8212) */
  restUrl: string;
  /** AdminPassword do servidor (env PALWORLD_ADMIN_PASSWORD) */
  adminPassword: string;
  rcon: {
    enabled: boolean;
    host: string;
    port: number;
  };
  /** Caminho para a pasta Pal/Saved montada no container */
  savedPath: string;
  /** Timeout por pedido HTTP à REST API */
  requestTimeoutMs: number;
  /** Tentativas por chamada (retries exponenciais) */
  maxRetries: number;
  circuitBreaker: {
    /** Falhas consecutivas até abrir o circuito */
    failureThreshold: number;
    /** Segundos em aberto antes de tentar um probe (half-open) */
    cooldownSeconds: number;
  };
}

export interface PelicanConfig {
  enabled: boolean;
  /** URL base do painel Pelican (ex.: https://painel.example.com) */
  url: string;
  /** Identificador curto do servidor no Pelican */
  serverId: string;
  /** Client API key (env PELICAN_API_KEY) */
  apiKey: string;
}

export interface AutosaveConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export interface BackupConfig {
  enabled: boolean;
  /** Pasta onde guardar os tar.gz */
  path: string;
  /** Quantos backups válidos manter */
  keep: number;
}

export interface RestartConfig {
  enabled: boolean;
  /** Expressão cron (ex.: "0 6 * * *") */
  cron: string;
  /** Minutos de aviso antes do restart (ordem decrescente) */
  countdownMinutes: number[];
  /** Minutos à espera que o servidor volte online após o Pelican start */
  serverReturnTimeoutMinutes: number;
}

export interface ApiConfig {
  port: number;
  host: string;
  /** Token de auth da API interna (env PALKEEPER_API_TOKEN) */
  token: string;
}

export interface MessagesConfig {
  /** {minutes} é substituído pelo número de minutos */
  restartWarning: string;
  restartNow: string;
  restartDone: string;
  [key: string]: string;
}

export interface AppConfig {
  timezone: string;
  logLevel: string;
  database: { path: string };
  palworld: PalworldConfig;
  pelican: PelicanConfig;
  autosave: AutosaveConfig;
  backup: BackupConfig;
  restart: RestartConfig;
  api: ApiConfig;
  messages: MessagesConfig;
}
