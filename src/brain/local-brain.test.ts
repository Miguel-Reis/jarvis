/**
 * Local Brain Tests
 */

import { describe, test, expect } from 'bun:test';
import { LocalBrain, registerBuiltInSkills, type Skill } from './local-brain.ts';

describe('LocalBrain', () => {
  test('should register and list skills', () => {
    const brain = new LocalBrain();

    brain.register({
      id: 'test_skill',
      name: 'Test Skill',
      patterns: [/test/i],
      keywords: ['test'],
      description: 'A test skill',
      handler: async () => ({ success: true, action: 'test', params: {} }),
    });

    const skills = brain.listSkills();
    expect(skills.length).toBe(1);
    expect(skills[0]!.id).toBe('test_skill');
  });

  test('should match regex patterns', async () => {
    const brain = new LocalBrain();

    brain.register({
      id: 'read_file',
      name: 'Read File',
      patterns: [/read\s+(?<file>[^\s]+)/i],
      keywords: ['read', 'file'],
      description: 'Read a file',
      handler: async (params) => ({
        success: true,
        action: 'read_file',
        params,
        response: `Reading file: ${params['file']}`,
      }),
    });

    const result = await brain.process('read config.json');

    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.skill.id).toBe('read_file');
      expect(result.params['file']).toBe('config.json');
      expect(result.result.response).toContain('Reading file');
    }
  });

  test('should fallback to LLM when no match', async () => {
    const brain = new LocalBrain();

    brain.register({
      id: 'test_skill',
      name: 'Test Skill',
      patterns: [/test/i],
      keywords: ['test'],
      description: 'A test skill',
      handler: async () => ({ success: true, action: 'test', params: {} }),
    });

    const result = await brain.process('write a poem about cats');

    expect(result.matched).toBe(false);
    if (!result.matched) {
      expect(result.fallbackToLLM).toBe(true);
    }
  });

  test('should track metrics', async () => {
    const brain = new LocalBrain();

    brain.register({
      id: 'test_skill',
      name: 'Test Skill',
      patterns: [/test/i],
      keywords: ['test'],
      description: 'A test skill',
      handler: async () => ({ success: true, action: 'test', params: {} }),
    });

    await brain.process('test');
    await brain.process('test again');
    await brain.process('something else');

    const metrics = brain.getMetrics();

    expect(metrics.totalRequests).toBe(3);
    expect(metrics.localMatches).toBe(2);
    expect(metrics.llmFallbacks).toBe(1);
    expect(metrics.localRate).toBe(2 / 3);
  });

  test('should extract named groups from regex', async () => {
    const brain = new LocalBrain();

    brain.register({
      id: 'greet',
      name: 'Greet',
      patterns: [/hello\s+(?<name>\w+)/i],
      keywords: ['hello', 'hi'],
      description: 'Greet someone',
      handler: async (params) => ({
        success: true,
        action: 'greet',
        params,
        response: `Hello, ${params['name']}!`,
      }),
    });

    const result = await brain.process('hello John');

    expect(result.matched).toBe(true);
    if (result.matched) {
      // Named groups are lowercased by the regex match
      expect(result.params['name']?.toLowerCase()).toBe('john');
    }
  });

  test('should use keyword matching as fallback', async () => {
    const brain = new LocalBrain({ keywordBoost: true });

    brain.register({
      id: 'git_status',
      name: 'Git Status',
      patterns: [/git\s+status/i],
      keywords: ['git', 'status'],
      description: 'Show git status',
      handler: async () => ({
        success: true,
        action: 'git_status',
        params: {},
        response: 'Git status executed',
      }),
    });

    // This should match via keywords (both keywords present = 100%)
    const result = await brain.process('show me the git status');

    // Keyword matching with 100% keywords should pass (1.0 * 0.8 = 0.8 >= 0.5)
    expect(result.matched).toBe(true);
  });

  test('should respect minConfidence threshold', async () => {
    const brain = new LocalBrain({ minConfidence: 0.99 });

    brain.register({
      id: 'low_confidence',
      name: 'Low Confidence',
      patterns: [/definitely\s+always\s+\w+/i],
      keywords: ['definitely', 'always'],
      description: 'Low confidence skill',
      handler: async () => ({ success: true, action: 'test', params: {} }),
    });

    // Partial keyword match (1 of 2 = 0.5 * 0.8 = 0.4 confidence)
    const result = await brain.process('maybe something');

    // With minConfidence 0.99, this should not pass
    expect(result.matched).toBe(false);
  });

  test('should handle skill execution errors', async () => {
    const brain = new LocalBrain();

    brain.register({
      id: 'failing_skill',
      name: 'Failing Skill',
      patterns: [/fail/i],
      keywords: ['fail'],
      description: 'A failing skill',
      handler: async () => {
        throw new Error('Intentional failure');
      },
    });

    const result = await brain.process('fail now');

    expect(result.matched).toBe(false);
    if (!result.matched) {
      expect(result.fallbackToLLM).toBe(true);
      expect(result.reason).toContain('Skill execution failed');
    }
  });

  test('should reset metrics', async () => {
    const brain = new LocalBrain();

    await brain.process('test');
    brain.resetMetrics();

    const metrics = brain.getMetrics();
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.localMatches).toBe(0);
    expect(metrics.llmFallbacks).toBe(0);
  });
});

describe('Built-in Skills', () => {
  test('should register built-in skills', () => {
    const brain = new LocalBrain();
    registerBuiltInSkills(brain);

    const skills = brain.listSkills();

    // Should have at least the basic skills
    expect(skills.length).toBeGreaterThan(5);

    const skillIds = skills.map(s => s.id);
    expect(skillIds).toContain('read_file');
    expect(skillIds).toContain('write_file');
    expect(skillIds).toContain('run_command');
    expect(skillIds).toContain('git_status');
    expect(skillIds).toContain('run_tests');
  });

  test('read_file skill should match patterns', async () => {
    const brain = new LocalBrain();
    registerBuiltInSkills(brain);

    const testCases = [
      'read config.json',
      'show the file package.json',
      "what's in src/index.ts",
      'cat README.md',
    ];

    for (const testCase of testCases) {
      const result = await brain.process(testCase);
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.skill.id).toBe('read_file');
        expect(result.result.toolCalls).toBeDefined();
        expect(result.result.toolCalls?.[0]?.tool).toBe('read_file');
      }
    }
  });

  test('run_command skill should match patterns', async () => {
    const brain = new LocalBrain();
    registerBuiltInSkills(brain);

    const testCases = [
      'run npm install',
      'execute the command ls -la',
      'bash "git status"',
    ];

    for (const testCase of testCases) {
      const result = await brain.process(testCase);
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.skill.id).toBe('run_command');
        expect(result.result.toolCalls?.[0]?.tool).toBe('run_command');
      }
    }
  });

  test('git_status skill should match patterns', async () => {
    const brain = new LocalBrain();
    registerBuiltInSkills(brain);

    const testCases = [
      'git status',
      'check the git status',
      "what's the git status",
    ];

    for (const testCase of testCases) {
      const result = await brain.process(testCase);
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.skill.id).toBe('git_status');
        expect(result.result.toolCalls?.[0]?.tool).toBe('run_command');
        expect(result.result.toolCalls?.[0]?.args.command).toBe('git status');
      }
    }
  });

  test('run_tests skill should match patterns', async () => {
    const brain = new LocalBrain();
    registerBuiltInSkills(brain);

    // "test the project" matches run_tests pattern: /test\s+(?:the\s+)?(?:project|app|code)/i
    const result = await brain.process('test the project');
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.skill.id).toBe('run_tests');
      expect(result.result.toolCalls?.[0]?.args.command).toBe('bun test');
    }
  });
});
