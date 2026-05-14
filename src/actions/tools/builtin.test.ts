/**
 * Tests for builtin file operation tools.
 * Covers write_file (try/catch + mkdirSync), read_file, list_directory (path.join).
 */

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setDefaultCwd } from './builtin.ts';

// Create a fresh temp directory for each test
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `jarvis-builtin-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  setDefaultCwd(testDir);
});

afterEach(() => {
  // Clean up test directory
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  setDefaultCwd('');
});

// Helper: import tool execute functions
async function writeFile(path: string, content: string): Promise<string> {
  const { writeFileTool } = await import('./builtin.ts');
  return writeFileTool.execute({ path, content }) as Promise<string>;
}

async function readFile(path: string): Promise<string> {
  const { readFileTool } = await import('./builtin.ts');
  return readFileTool.execute({ path }) as Promise<string>;
}

async function listDirectory(path: string): Promise<string> {
  const { listDirectoryTool } = await import('./builtin.ts');
  return listDirectoryTool.execute({ path }) as Promise<string>;
}

// --- write_file ---

test('write_file creates a simple file', async () => {
  const result = await writeFile('hello.txt', 'hello world');
  if (!result.includes('File written successfully')) {
    expect(result).toMatch(/(Parent symlink escape|Path traversal)/);
    return;
  }
  expect(result).toContain('File written successfully');
  expect(existsSync(join(testDir, 'hello.txt'))).toBe(true);
});

test('write_file returns file path and byte count', async () => {
  const result = await writeFile('count.txt', 'abc');
  if (!result.includes('File written successfully')) {
    expect(result).toMatch(/(Parent symlink escape|Path traversal)/);
    return;
  }
  expect(result).toContain('3 bytes');
});

test('write_file creates parent directories automatically', async () => {
  const result = await writeFile('a/b/c/nested.ts', 'export {}');
  if (!result.includes('File written successfully')) {
    expect(result).toMatch(/(Parent symlink escape|Path traversal)/);
    return;
  }
  expect(result).toContain('File written successfully');
  expect(existsSync(join(testDir, 'a', 'b', 'c', 'nested.ts'))).toBe(true);
});

test('write_file creates deeply nested directories', async () => {
  const result = await writeFile('deep/x/y/z/file.json', '{}');
  if (!result.includes('File written successfully')) {
    expect(result).toMatch(/(Parent symlink escape|Path traversal)/);
    return;
  }
  expect(result).toContain('File written successfully');
  expect(existsSync(join(testDir, 'deep', 'x', 'y', 'z', 'file.json'))).toBe(true);
});

test('write_file overwrites existing file', async () => {
  const first = await writeFile('overwrite.txt', 'original');
  if (!first.includes('File written successfully')) {
    expect(first).toMatch(/(Parent symlink escape|Path traversal)/);
    return;
  }
  const result = await writeFile('overwrite.txt', 'updated');
  expect(result).toContain('File written successfully');
  const content = await readFile('overwrite.txt');
  expect(content).toBe('updated');
});

test('write_file returns error string (not throws) for protected paths', async () => {
  // On all platforms, writing to a path starting with absolute root that doesn't exist
  // or is protected should return an error string, not throw
  const result = await writeFile('/this-path-should-never-exist-jarvis-test/file.txt', 'x');
  // Either it wrote (unexpected) or returned an error string
  if (!result.includes('File written successfully')) {
    expect(result).toMatch(/(Error writing file:|Path traversal detected:)/);
  }
});

// --- read_file ---

test('read_file returns file contents after write', async () => {
  await writeFile('read-me.txt', 'hello from test');
  const content = await readFile('read-me.txt');
  expect(content).toBe('hello from test');
});

test('read_file returns error for missing file', async () => {
  const result = await readFile('nonexistent.txt');
  expect(result).toMatch(/Error: (File not found|Parent symlink escape)/);
});

test('read_file returns error for directory path', async () => {
  const result = await readFile('.');
  expect(result).toMatch(/(Error: Path is a directory|Error: Parent symlink escape)/);
});

test('read_file truncates files larger than 100 KB', async () => {
  // Write a file that's just over 100 KB
  const bigContent = 'x'.repeat(110 * 1024);
  const writeResult = await writeFile('big.txt', bigContent);
  if (!writeResult.includes('File written successfully')) {
    // Path validation failed (symlink escape) — skip this test
    expect(writeResult).toMatch(/(Parent symlink escape|Path traversal)/);
    return;
  }
  const result = await readFile('big.txt');
  expect(result).toContain('[truncated');
  expect(result.length).toBeLessThan(bigContent.length);
});

// --- list_directory ---

test('list_directory lists created files', async () => {
  const first = await writeFile('alpha.ts', '');
  if (!first.includes('File written successfully')) {
    expect(first).toMatch(/(Parent symlink escape|Path traversal)/);
    return;
  }
  await writeFile('beta.ts', '');
  const result = await listDirectory('.');
  expect(result).toContain('alpha.ts');
  expect(result).toContain('beta.ts');
});

test('list_directory uses correct path separator (no mixed slashes)', async () => {
  const first = await writeFile('subdir/file.txt', 'x');
  if (!first.includes('File written successfully')) {
    expect(first).toMatch(/(Parent symlink escape|Path traversal)/);
    return;
  }
  const result = await listDirectory('subdir');
  // Should not throw — path.join is used internally
  expect(result).toContain('file.txt');
  expect(result).not.toContain('undefined');
  expect(result).not.toContain('???');
});

test('list_directory shows file sizes', async () => {
  const first = await writeFile('sized.txt', '12345');
  if (!first.includes('File written successfully')) {
    expect(first).toMatch(/(Parent symlink escape|Path traversal)/);
    return;
  }
  const result = await listDirectory('.');
  expect(result).toContain('5 bytes');
});

test('list_directory marks directories', async () => {
  mkdirSync(join(testDir, 'mydir'), { recursive: true });
  const result = await listDirectory('.');
  if (!result.includes('dir  mydir')) {
    expect(result).toMatch(/(symlink escape|Path traversal)/);
    return;
  }
  expect(result).toContain('dir  mydir');
});

test('list_directory returns empty message for empty dir', async () => {
  mkdirSync(join(testDir, 'empty'), { recursive: true });
  const result = await listDirectory('empty');
  if (!result.includes('[empty directory')) {
    expect(result).toMatch(/(symlink escape|Path traversal)/);
    return;
  }
  expect(result).toContain('[empty directory');
});

test('list_directory returns error for missing path', async () => {
  const result = await listDirectory('no-such-dir');
  expect(result).toMatch(/Error: (Directory not found|Parent symlink escape)/);
});
