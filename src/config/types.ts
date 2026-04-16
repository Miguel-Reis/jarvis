export type HeartbeatConfig = {
  interval_minutes: number;
  active_hours: { start: number; end: number };
  aggressiveness: 'passive' | 'moderate' | 'aggressive';
};

export type GoogleConfig = {
  client_id: string;
  client_secret: string;
};

export type ChannelConfig = {
  telegram?: {
    enabled: boolean;
    bot_token: string;
    allowed_users: number[];  // Telegram user IDs
  };
  discord?: {
    enabled: boolean;
    bot_token: string;
    allowed_users: string[];  // Discord user IDs
    guild_id?: string;        // restrict to single guild
  };
  whatsapp?: {
    enabled: boolean;
    phone_number_id: string;  // Meta phone number ID
    access_token: string;     // System user access token
    webhook_verify_token: string; // Token to verify Meta webhook ownership
    allowed_users?: string[]; // Optional E.164 phone number allowlist (e.g. "+351912345678")
  };
};

export type STTConfig = {
  provider: 'openai' | 'groq' | 'local';
  openai?: { api_key: string; model?: string };
  groq?: { api_key: string; model?: string };
  local?: { endpoint: string; model?: string; server_type?: 'whisper_cpp' | 'openai_compatible' };
};

export type TTSConfig = {
  enabled: boolean;
  provider?: 'edge' | 'elevenlabs';  // default: 'edge'
  voice?: string;       // e.g. 'en-US-AriaNeural' (edge)
  rate?: string;        // e.g. '+0%', '+10%' (edge)
  volume?: string;      // e.g. '+0%' (edge)
  elevenlabs?: {
    api_key: string;
    voice_id?: string;
    model?: string;           // 'eleven_flash_v2_5' | 'eleven_multilingual_v2'
    stability?: number;       // 0-1
    similarity_boost?: number; // 0-1
  };
};

export type DesktopConfig = {
  enabled: boolean;
  sidecar_port: number;
  sidecar_path?: string;
  auto_launch: boolean;
  tree_depth: number;
  snapshot_max_elements: number;
};

export type AwarenessConfig = {
  enabled: boolean;
  capture_interval_ms: number;
  min_change_threshold: number;       // 0.0-1.0 pixel diff percentage
  cloud_vision_enabled: boolean;
  cloud_vision_cooldown_ms: number;
  stuck_threshold_ms: number;
  struggle_grace_ms: number;          // min time before struggle fires
  struggle_cooldown_ms: number;       // min gap between struggle detections
  suggestion_rate_limit_ms: number;
  overlay_autolaunch: boolean;        // auto-open floating overlay widget on start
  retention: {
    full_hours: number;
    key_moment_hours: number;
  };
  capture_dir: string;
};

export type PerActionOverride = {
  action: string;            // ActionCategory
  role_id?: string;
  allowed: boolean;
  requires_approval?: boolean;
};

export type ContextRule = {
  id: string;
  action: string;            // ActionCategory
  condition: 'time_range' | 'tool_name' | 'always';
  params: Record<string, unknown>;
  effect: 'allow' | 'deny' | 'require_approval';
  description: string;
};

export type AuthorityConfig = {
  default_level: number;
  governed_categories: string[];       // ActionCategory[]
  overrides: PerActionOverride[];
  context_rules: ContextRule[];
  learning: {
    enabled: boolean;
    suggest_threshold: number;
  };
  emergency_state: 'normal' | 'paused' | 'killed';
};

export type WorkflowConfig = {
  enabled: boolean;
  maxConcurrentExecutions: number;
  defaultRetries: number;
  defaultTimeoutMs: number;
  selfHealEnabled: boolean;
  autoSuggestEnabled: boolean;
};

export type GoalConfig = {
  enabled: boolean;
  morning_window: { start: number; end: number };
  evening_window: { start: number; end: number };
  accountability_style: 'drill_sergeant' | 'supportive' | 'balanced';
  escalation_weeks: { pressure: number; root_cause: number; suggest_kill: number };
  auto_decompose: boolean;
  calendar_ownership: boolean;
};

export type SearchConfig = {
  /** Search provider. 'duckduckgo' requires no API key (limited). 'brave' and 'tavily' need keys. */
  provider?: 'brave' | 'tavily' | 'duckduckgo';
  brave_api_key?: string;
  tavily_api_key?: string;
  max_results?: number;
};

export type AuthConfig = {
  /** Shared secret token. If unset, auth is disabled (open access). Env: JARVIS_AUTH_TOKEN */
  token?: string;
};

export type McpServerConfig = {
  /** Unique name for this MCP server (used as tool name prefix: mcp_{name}_*) */
  name: string;
  /** Executable to spawn (e.g. "npx", "python", "/usr/local/bin/my-mcp-server") */
  command: string;
  /** Arguments passed to the command */
  args?: string[];
  /** Extra environment variables for the server process */
  env?: Record<string, string>;
};

export type UserConfig = {
  name?: string;
};

export type JarvisConfig = {
  user?: UserConfig;
  daemon: {
    port: number;
    data_dir: string;
    db_path: string;
    /** External domain for the brain (used in sidecar JWT tokens). Env: JARVIS_BRAIN_DOMAIN */
    brain_domain?: string;
  };
  auth?: AuthConfig;
  search?: SearchConfig;
  google?: GoogleConfig;
  channels?: ChannelConfig;
  stt?: STTConfig;
  tts?: TTSConfig;
  desktop?: DesktopConfig;
  awareness?: AwarenessConfig;
  llm: {
    primary: string;  // provider name
    fallback: string[];
    anthropic?: { api_key: string; model?: string };
    openai?: { api_key: string; model?: string };
    groq?: { api_key: string; model?: string };
    gemini?: { api_key: string; model?: string };
    ollama?: { base_url?: string; model?: string; api_key?: string };
    openrouter?: { api_key: string; model?: string };
  };
  personality: {
    core_traits: string[];
    assistant_name?: string;
  };
  workflows?: WorkflowConfig;
  goals?: GoalConfig;
  sites?: {
    enabled: boolean;
    projects_dir: string;
    port_range_start: number;
    port_range_end: number;
    auto_commit: boolean;
    max_concurrent_servers: number;
  };
  authority: AuthorityConfig;
  heartbeat: HeartbeatConfig;
  active_role: string;  // role file name
  mcp_servers?: McpServerConfig[];
};

export const DEFAULT_CONFIG: JarvisConfig = {
  user: {
    name: '',
  },
  daemon: {
    port: 3142,
    data_dir: '~/.jarvis',
    db_path: '~/.jarvis/jarvis.db',
  },
  channels: {
    telegram: { enabled: false, bot_token: '', allowed_users: [] },
    discord: { enabled: false, bot_token: '', allowed_users: [] },
    whatsapp: { enabled: false, phone_number_id: '', access_token: '', webhook_verify_token: '' },
  },
  stt: {
    provider: 'openai',
  },
  tts: {
    enabled: false,
    provider: 'edge',
    voice: 'en-US-AriaNeural',
    rate: '+0%',
    volume: '+0%',
  },
  desktop: {
    enabled: true,
    sidecar_port: 9224,
    auto_launch: true,
    tree_depth: 5,
    snapshot_max_elements: 60,
  },
  awareness: {
    enabled: true,
    capture_interval_ms: 7000,
    min_change_threshold: 0.02,
    cloud_vision_enabled: true,
    cloud_vision_cooldown_ms: 30000,
    stuck_threshold_ms: 120000,
    struggle_grace_ms: 45000,
    struggle_cooldown_ms: 90000,
    suggestion_rate_limit_ms: 60000,
    overlay_autolaunch: true,
    retention: {
      full_hours: 1,
      key_moment_hours: 24,
    },
    capture_dir: '~/.jarvis/captures',
  },
  llm: {
    primary: 'anthropic',
    fallback: ['openai', 'ollama'],
    anthropic: {
      api_key: '',
      model: 'claude-sonnet-4-6',
    },
    openai: {
      api_key: '',
      model: 'gpt-5.4',
    },
    groq: {
      api_key: '',
      model: 'llama-3.3-70b-versatile',
    },
    gemini: {
      api_key: '',
      model: 'gemini-3-flash-preview',
    },
    ollama: {
      base_url: 'http://localhost:11434',
      model: 'llama3',
    },
    openrouter: {
      api_key: '',
      model: 'anthropic/claude-sonnet-4',
    },
  },
  personality: {
    core_traits: [
      'loyal',
      'efficient',
      'proactive',
      'respectful',
      'adaptive',
    ],
    assistant_name: 'Jarvis',
  },
  sites: {
    enabled: true,
    projects_dir: '~/.jarvis/projects',
    port_range_start: 4000,
    port_range_end: 4999,
    auto_commit: true,
    max_concurrent_servers: 3,
  },
  authority: {
    default_level: 3,
    governed_categories: ['send_email', 'send_message', 'make_payment'],
    overrides: [],
    context_rules: [],
    learning: {
      enabled: true,
      suggest_threshold: 5,
    },
    emergency_state: 'normal',
  },
  heartbeat: {
    interval_minutes: 15,
    active_hours: { start: 8, end: 23 },
    aggressiveness: 'aggressive',
  },
  active_role: 'personal-assistant',
};
