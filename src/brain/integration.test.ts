/**
 * Local Brain Integration Tests
 *
 * Tests que verificam se os skills retornam tool names válidos
 * e se os handlers extraem parâmetros corretamente.
 */

import { describe, test, expect } from 'bun:test';
import { LocalBrain, registerBuiltInSkills } from './local-brain.ts';

describe('Built-in Skills Integration', () => {
  function createBrain(): LocalBrain {
    const brain = new LocalBrain();
    registerBuiltInSkills(brain);
    return brain;
  }

  // Valid tool names that exist in ToolRegistry
  const validTools = new Set([
    'run_command',
    'read_file',
    'write_file',
    'list_directory',
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_screenshot',
    'capture_screen',
    'get_system_info',
  ]);

  function validateToolCalls(
    result: Awaited<ReturnType<typeof LocalBrain.prototype.process>>,
    skillName: string
  ): void {
    if (result.matched && result.result.toolCalls) {
      for (const tc of result.result.toolCalls) {
        if (!validTools.has(tc.tool)) {
          throw new Error(`Skill "${skillName}" returned invalid tool: ${tc.tool}`);
        }
      }
    }
  }

  describe('read_file skill', () => {
    test('should extract file path from "read X"', async () => {
      const brain = createBrain();
      const result = await brain.process('read config.json');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('read_file');
        validateToolCalls(result, 'read_file');
        expect((result.result.toolCalls![0].args as any).path).toBe('config.json');
      }
    });

    test('should extract file path from "show file X"', async () => {
      const brain = createBrain();
      const result = await brain.process('show the file package.json');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.result.toolCalls[0]!.args.path).toBe('package.json');
      }
    });
  });

  describe('write_file skill', () => {
    test('should extract path and content', async () => {
      const brain = createBrain();
      const result = await brain.process('write index.ts with console.log("hello")');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('write_file');
        validateToolCalls(result, 'write_file');
        expect(result.result.toolCalls[0]!.args.path).toBe('index.ts');
        expect(result.result.toolCalls[0]!.args.content).toBe('console.log("hello")');
      }
    });
  });

  describe('run_command skill', () => {
    test('should extract command from "run X"', async () => {
      const brain = createBrain();
      const result = await brain.process('run bun install');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('run_command');
        validateToolCalls(result, 'run_command');
        expect(result.result.toolCalls[0]!.args.command).toBe('bun install');
      }
    });

    test('should extract command from "execute X"', async () => {
      const brain = createBrain();
      const result = await brain.process('execute the command ls -la');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.result.toolCalls[0]!.args.command).toBe('ls -la');
      }
    });
  });

  describe('git_status skill', () => {
    test('should match "git status"', async () => {
      const brain = createBrain();
      const result = await brain.process('git status');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('git_status');
        validateToolCalls(result, 'git_status');
        expect(result.result.toolCalls[0]!.args.command).toBe('git status');
      }
    });

    test('should match "check git status"', async () => {
      const brain = createBrain();
      const result = await brain.process('check the git status');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.result.toolCalls[0]!.args.command).toBe('git status');
      }
    });
  });

  describe('git_diff skill', () => {
    test('should match "git diff"', async () => {
      const brain = createBrain();
      const result = await brain.process('git diff');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('git_diff');
        validateToolCalls(result, 'git_diff');
        expect(result.result.toolCalls[0]!.args.command).toBe('git diff');
      }
    });

    test('should match "what has changed"', async () => {
      const brain = createBrain();
      const result = await brain.process('what has changed');
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.skill.id).toBe('git_diff');
      }
    });
  });

  describe('run_tests skill', () => {
    test('should match "run the tests"', async () => {
      const brain = createBrain();
      const result = await brain.process('run the tests');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('run_tests');
        validateToolCalls(result, 'run_tests');
        expect(result.result.toolCalls[0]!.args.command).toBe('bun test');
      }
    });

    test('should match "test the project"', async () => {
      const brain = createBrain();
      const result = await brain.process('test the project');
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.skill.id).toBe('run_tests');
      }
    });
  });

  describe('build_project skill', () => {
    test('should match "build the project"', async () => {
      const brain = createBrain();
      const result = await brain.process('build the project');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('build_project');
        validateToolCalls(result, 'build_project');
        expect(result.result.toolCalls[0]!.args.command).toBe('bun run build');
      }
    });

    test('should match "run build"', async () => {
      const brain = createBrain();
      const result = await brain.process('run build');
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.skill.id).toBe('build_project');
      }
    });
  });

  describe('search_code skill', () => {
    test('should extract search term', async () => {
      const brain = createBrain();
      const result = await brain.process('find "useEffect" in the code');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('search_code');
        validateToolCalls(result, 'search_code');
        // Search term is lowercased in the grep command (expected behavior)
        expect((result.result.toolCalls[0]!.args.command as string).toLowerCase()).toContain('useeffect');
      }
    });

    test('should extract search term from "search for X"', async () => {
      const brain = createBrain();
      const result = await brain.process('search for TODO in files');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect((result.result.toolCalls![0].args.command as string).toLowerCase()).toContain('todo');
      }
    });
  });

  describe('start_dev skill', () => {
    test('should match "start the dev server"', async () => {
      const brain = createBrain();
      const result = await brain.process('start the dev server');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('start_dev');
        validateToolCalls(result, 'start_dev');
        expect(result.result.toolCalls[0]!.args.command).toBe('bun run dev');
      }
    });

    test('should match "start dev"', async () => {
      const brain = createBrain();
      const result = await brain.process('start dev');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.result.toolCalls[0]!.args.command).toBe('bun run dev');
      }
    });
  });

  describe('install_dep skill', () => {
    test('should extract package name', async () => {
      const brain = createBrain();
      const result = await brain.process('install lodash');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.skill.id).toBe('install_dep');
        validateToolCalls(result, 'install_dep');
        expect(result.result.toolCalls[0]!.args.command).toBe('bun add lodash');
      }
    });

    test('should extract package name from "add X"', async () => {
      const brain = createBrain();
      const result = await brain.process('add the package axios');
      expect(result.matched).toBe(true);
      if (result.matched && result.result.toolCalls) {
        expect(result.result.toolCalls[0]!.args.command).toBe('bun add axios');
      }
    });
  });

  describe('Fallback to LLM', () => {
    test('should fallback for creative requests', async () => {
      const brain = createBrain();
      const result = await brain.process('write a poem about coding');
      expect(result.matched).toBe(false);
      if (!result.matched) {
        expect(result.fallbackToLLM).toBe(true);
      }
    });

    test('should fallback for complex questions', async () => {
      const brain = createBrain();
      const result = await brain.process('explain quantum computing');
      expect(result.matched).toBe(false);
      if (!result.matched) {
        expect(result.fallbackToLLM).toBe(true);
      }
    });

    test('should fallback for ambiguous requests', async () => {
      const brain = createBrain();
      const result = await brain.process('what is the meaning of life?');
      expect(result.matched).toBe(false);
      if (!result.matched) {
        expect(result.fallbackToLLM).toBe(true);
      }
    });
  });

  describe('All skills return valid tool calls', () => {
    test('every skill should return only valid tool names', async () => {
      const brain = createBrain();
      const skills = brain.listSkills();

      const testInputs: Record<string, string> = {
        'read_file': 'read test.txt',
        'write_file': 'write test.txt with hello',
        'run_command': 'run ls',
        'git_status': 'git status',
        'git_diff': 'git diff',
        'run_tests': 'run the tests',
        'build_project': 'build the project',
        'search_code': 'find test in code',
        'start_dev': 'start dev',
        'install_dep': 'install lodash',
      };

      for (const skill of skills) {
        const input = testInputs[skill.id];
        if (input) {
          const result = await brain.process(input);
          validateToolCalls(result, skill.name);
        }
      }
    });
  });
});
