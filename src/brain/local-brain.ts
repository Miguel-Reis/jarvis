/**
 * Local Brain - Skill Matching Without LLM
 *
 * Matches user intents to pre-defined skill patterns using regex and keyword matching.
 * Falls back to LLM only when no pattern match is found.
 *
 * Expected impact: 80% reduction in LLM costs, 90% latency reduction for simple tasks.
 */

export interface Skill {
  id: string;
  name: string;
  patterns: RegExp[];
  keywords: string[];
  description: string;
  handler: (params: Record<string, string>) => Promise<SkillResult>;
}

export interface SkillResult {
  success: boolean;
  action: string;
  params: Record<string, string>;
  response?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export type LocalBrainResult =
  | {
      matched: true;
      skill: Skill;
      params: Record<string, string>;
      result: SkillResult;
    }
  | {
      matched: false;
      fallbackToLLM: true;
      reason: string;
    };

export interface LocalBrainOptions {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Minimum confidence score for pattern match (0-1) */
  minConfidence?: number;
  /** Enable keyword boosting */
  keywordBoost?: boolean;
}

const DEFAULT_OPTIONS: Required<LocalBrainOptions> = {
  verbose: false,
  minConfidence: 0.6,
  keywordBoost: true,
};

export class LocalBrain {
  private skills = new Map<string, Skill>();
  private options: Required<LocalBrainOptions>;

  // Metrics
  private totalRequests = 0;
  private localMatches = 0;
  private llmFallbacks = 0;

  constructor(options?: LocalBrainOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Register a skill with patterns and handler
   */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
    if (this.options.verbose) {
      console.log(`[LocalBrain] Registered skill: ${skill.name} (${skill.id})`);
    }
  }

  /**
   * Process an intent and try to match with a local skill
   */
  async process(intent: string): Promise<LocalBrainResult> {
    this.totalRequests++;

    const match = this.findBestMatch(intent);

    if (match) {
      this.localMatches++;
      if (this.options.verbose) {
        console.log(`[LocalBrain] Matched skill: ${match.skill.name} (confidence: ${match.confidence})`);
      }

      try {
        const result = await match.skill.handler(match.params);
        return {
          matched: true,
          skill: match.skill,
          params: match.params,
          result,
        };
      } catch (error) {
        if (this.options.verbose) {
          console.error(`[LocalBrain] Skill execution failed: ${error}`);
        }
        this.llmFallbacks++;
        return {
          matched: false,
          fallbackToLLM: true,
          reason: `Skill execution failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    this.llmFallbacks++;
    return {
      matched: false,
      fallbackToLLM: true,
      reason: 'No matching skill pattern found',
    };
  }

  /**
   * Get metrics
   */
  getMetrics(): {
    totalRequests: number;
    localMatches: number;
    llmFallbacks: number;
    localRate: number;
  } {
    return {
      totalRequests: this.totalRequests,
      localMatches: this.localMatches,
      llmFallbacks: this.llmFallbacks,
      localRate: this.totalRequests > 0 ? this.localMatches / this.totalRequests : 0,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.totalRequests = 0;
    this.localMatches = 0;
    this.llmFallbacks = 0;
  }

  /**
   * List all registered skills
   */
  listSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  // --- Private methods ---

  private findBestMatch(intent: string): { skill: Skill; params: Record<string, string>; confidence: number } | null {
    const normalizedIntent = intent.toLowerCase().trim();
    let bestMatch: { skill: Skill; params: Record<string, string>; confidence: number } | null = null;

    for (const skill of this.skills.values()) {
      const { match, params, confidence } = this.matchSkill(skill, normalizedIntent);

      if (match && confidence >= this.options.minConfidence) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { skill, params, confidence };
        }
      }
    }

    return bestMatch;
  }

  private matchSkill(
    skill: Skill,
    normalizedIntent: string
  ): { match: boolean; params: Record<string, string>; confidence: number } {
    // Try regex patterns first
    for (const pattern of skill.patterns) {
      const match = normalizedIntent.match(pattern);
      if (match) {
        const params = this.extractParams(match, skill);
        const confidence = this.calculateConfidence(match, skill, normalizedIntent);
        return { match: true, params, confidence };
      }
    }

    // Fall back to keyword matching
    if (this.options.keywordBoost) {
      const keywordMatches = skill.keywords.filter(kw => normalizedIntent.includes(kw.toLowerCase()));
      if (keywordMatches.length > 0) {
        const confidence = keywordMatches.length / Math.max(skill.keywords.length, 1);
        if (confidence >= 0.5) {
          return {
            match: true,
            params: {},
            confidence: confidence * 0.8 // Keyword matches have lower confidence
          };
        }
      }
    }

    return { match: false, params: {}, confidence: 0 };
  }

  private extractParams(match: RegExpMatchArray, skill: Skill): Record<string, string> {
    const params: Record<string, string> = {};

    // Extract named groups from regex
    if (match.groups) {
      Object.assign(params, match.groups);
    }

    // Extract positional groups as param1, param2, etc.
    for (let i = 1; i < match.length; i++) {
      const val = match[i];
      if (val && !params[`param${i}`]) {
        params[`param${i}`] = val;
      }
    }

    return params;
  }

  private calculateConfidence(
    match: RegExpMatchArray,
    skill: Skill,
    normalizedIntent: string
  ): number {
    // Base confidence from regex match quality
    let confidence = 0.8;

    // Boost if full match (not partial)
    if (match[0] === normalizedIntent) {
      confidence += 0.15;
    }

    // Boost if all keywords are present
    const keywordMatches = skill.keywords.filter(kw => normalizedIntent.includes(kw.toLowerCase()));
    if (keywordMatches.length === skill.keywords.length) {
      confidence += 0.05;
    }

    return Math.min(confidence, 1.0);
  }
}

// --- Built-in Skills ---

/**
 * Register built-in skills for common operations
 */
export function registerBuiltInSkills(brain: LocalBrain): void {
  // ================================================================
  // ORDER MATTERS! Register specific skills BEFORE generic ones.
  // The findBestMatch returns the FIRST skill with highest confidence.
  // ================================================================

  // 1. Git operations (very specific patterns)
  brain.register({
    id: 'git_status',
    name: 'Git Status',
    patterns: [
      /git\s+status/i,
      /(?:check|show)\s+(?:the\s+)?(?:git\s+)?status/i,
      /what'?s?\s+(?:the\s+)?(?:git\s+)?status/i,
    ],
    keywords: ['git', 'status', 'changes', 'commit'],
    description: 'Show git status',
    handler: async () => ({
      success: true,
      action: 'git_status',
      params: {},
      toolCalls: [{ tool: 'run_command', args: { command: 'git status' } }],
    }),
  });

  brain.register({
    id: 'git_diff',
    name: 'Git Diff',
    patterns: [
      /git\s+diff/i,
      /(?:show|check)\s+(?:the\s+)?(?:git\s+)?diff/i,
      /what\s+(?:has\s+)?(?:changed|modified)/i,
    ],
    keywords: ['git', 'diff', 'changes', 'modified'],
    description: 'Show git diff',
    handler: async () => ({
      success: true,
      action: 'git_diff',
      params: {},
      toolCalls: [{ tool: 'run_command', args: { command: 'git diff' } }],
    }),
  });

  // 2. Project operations (specific "run tests", "build" patterns)
  brain.register({
    id: 'run_tests',
    name: 'Run Tests',
    patterns: [
      /(?:run|execute)\s+(?:the\s+)?tests/i,
      /(?:run|execute)\s+test/i,
      /test\s+(?:the\s+)?(?:project|app|code)/i,
    ],
    keywords: ['test', 'tests', 'testing', 'spec', 'specs'],
    description: 'Run project tests',
    handler: async () => ({
      success: true,
      action: 'run_tests',
      params: {},
      toolCalls: [{ tool: 'run_command', args: { command: 'bun test' } }],
    }),
  });

  brain.register({
    id: 'build_project',
    name: 'Build Project',
    patterns: [
      /(?:build|compile)\s+(?:the\s+)?(?:project|app|code)/i,
      /(?:run\s+)?build/i,
    ],
    keywords: ['build', 'compile', 'bundle'],
    description: 'Build the project',
    handler: async () => ({
      success: true,
      action: 'build_project',
      params: {},
      toolCalls: [{ tool: 'run_command', args: { command: 'bun run build' } }],
    }),
  });

  // 3. Dev server
  brain.register({
    id: 'start_dev',
    name: 'Start Dev Server',
    patterns: [
      /(?:start|run|launch)\s+(?:the\s+)?(?:dev|development)?\s*(?:server)?/i,
      /start\s+(?:the\s+)?app/i,
    ],
    keywords: ['start', 'dev', 'development', 'server', 'run', 'launch'],
    description: 'Start the development server',
    handler: async () => ({
      success: true,
      action: 'start_dev',
      params: {},
      toolCalls: [{ tool: 'run_command', args: { command: 'bun run dev' } }],
    }),
  });

  // 4. File operations
  brain.register({
    id: 'read_file',
    name: 'Read File',
    patterns: [
      /(?:read|show|display|cat|view|open)\s+(?:the\s+)?(?:file\s+)?["']?([^"'\s]+)["']?/i,
      /what'?s?\s+(?:in|inside|the\s+contents\s+of)\s+["']?([^"'\s]+)["']?/i,
    ],
    keywords: ['read', 'file', 'show', 'contents', 'view'],
    description: 'Read the contents of a file',
    handler: async (params) => {
      const filePath = params['1'] || params['param1'];
      if (!filePath) {
        return {
          success: false,
          action: 'read_file',
          params,
          response: 'Could not extract file path from request',
        };
      }
      return {
        success: true,
        action: 'read_file',
        params: { path: filePath },
        toolCalls: [{ tool: 'read_file', args: { path: filePath } }],
      };
    },
  });

  brain.register({
    id: 'write_file',
    name: 'Write File',
    patterns: [
      /(?:write|create|save|make)\s+(?:a\s+)?(?:file\s+)?["']?([^"'\s]+)["']?\s+(?:with|containing|as)\s+(.+)/i,
      /(?:set|update)\s+(?:the\s+)?(?:file\s+)?["']?([^"'\s]+)["']?\s+to\s+(.+)/i,
    ],
    keywords: ['write', 'create', 'save', 'file', 'make'],
    description: 'Create or update a file with content',
    handler: async (params) => {
      const filePath = params['1'] || params['param1'];
      const content = params['2'] || params['param2'];
      if (!filePath || !content) {
        return {
          success: false,
          action: 'write_file',
          params,
          response: 'Could not extract file path or content from request',
        };
      }
      return {
        success: true,
        action: 'write_file',
        params: { path: filePath, content },
        toolCalls: [{ tool: 'write_file', args: { path: filePath, content } }],
      };
    },
  });

  // 5. Search operations
  brain.register({
    id: 'search_code',
    name: 'Search Code',
    patterns: [
      /(?:find|search|grep)\s+(?:for\s+)?["']?([^"'\s]+)["']?\s+(?:in\s+)?(?:the\s+)?(?:code|project|files)?/i,
      /where\s+(?:is|are)\s+["']?([^"'\s]+)["']?\s+(?:defined|used)/i,
    ],
    keywords: ['find', 'search', 'grep', 'locate', 'where'],
    description: 'Search for text in codebase',
    handler: async (params) => {
      const searchTerm = params['1'] || params['param1'];
      if (!searchTerm) {
        return {
          success: false,
          action: 'search_code',
          params,
          response: 'Could not extract search term from request',
        };
      }
      return {
        success: true,
        action: 'search_code',
        params: { query: searchTerm },
        toolCalls: [{ tool: 'run_command', args: { command: `grep -r "${searchTerm}" .` } }],
      };
    },
  });

  // 6. Install dependencies
  brain.register({
    id: 'install_dep',
    name: 'Install Dependency',
    patterns: [
      /(?:install|add)\s+(?:the\s+)?(?:package\s+)?(?:dependency\s+)?["']?([^"'\s]+)["']?/i,
      /(?:install|add)\s+([^"'\s]+)/i,
    ],
    keywords: ['install', 'add', 'package', 'dependency', 'npm', 'bun'],
    description: 'Install a dependency',
    handler: async (params) => {
      const packageName = params['1'] || params['param1'];
      if (!packageName) {
        return {
          success: false,
          action: 'install_dep',
          params,
          response: 'Could not extract package name from request',
        };
      }
      return {
        success: true,
        action: 'install_dep',
        params: { package: packageName },
        toolCalls: [{ tool: 'run_command', args: { command: `bun add ${packageName}` } }],
      };
    },
  });

  // 7. Generic run_command (LAST - catches remaining "run X" patterns)
  brain.register({
    id: 'run_command',
    name: 'Run Command',
    patterns: [
      /(?:run|execute|bash|shell|cmd)\s+(?:the\s+)?(?:command\s+)?["']?([^"']+)["']?/i,
      /(?:please\s+)?(?:run|execute)\s+(?:this\s+)?(?:command)?\s*:\s*(.+)/i,
    ],
    keywords: ['run', 'execute', 'command', 'bash', 'shell'],
    description: 'Execute a shell command',
    handler: async (params) => {
      const command = params['1'] || params['param1'] || params['2'] || params['param2'];
      if (!command) {
        return {
          success: false,
          action: 'run_command',
          params,
          response: 'Could not extract command from request',
        };
      }
      return {
        success: true,
        action: 'run_command',
        params: { command },
        toolCalls: [{ tool: 'run_command', args: { command } }],
      };
    },
  });
}

// Global instance
export const globalLocalBrain = new LocalBrain({ verbose: true });
registerBuiltInSkills(globalLocalBrain);
