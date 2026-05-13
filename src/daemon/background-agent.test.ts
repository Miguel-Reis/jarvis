import { test, expect, describe } from 'bun:test';
import { createBrowserTools, NON_BROWSER_TOOLS, BUILTIN_TOOLS } from '../actions/tools/builtin.ts';
import { BrowserController } from '../actions/browser/session.ts';

describe('NON_BROWSER_TOOLS', () => {
  test('contains the expected non-browser tools', () => {
    // 15 base tools + 9 VM tools + 2 serial console tools = 26
    expect(NON_BROWSER_TOOLS).toHaveLength(26);
    const names = NON_BROWSER_TOOLS.map(t => t.name);
    expect(names).toContain('run_command');
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('list_directory');
    expect(names).toContain('list_sidecars');
    expect(names).toContain('get_clipboard');
    expect(names).toContain('set_clipboard');
    expect(names).toContain('capture_screen');
    expect(names).toContain('get_system_info');
    expect(names).toContain('ssh_run');
    expect(names).toContain('list_remote_connections');
    // Phase 2 VM tools
    expect(names).toContain('vm_list');
    expect(names).toContain('vm_info');
    expect(names).toContain('vm_get_state');
    expect(names).toContain('vm_start');
    expect(names).toContain('vm_stop');
    expect(names).toContain('vm_snapshot_take');
    expect(names).toContain('vm_snapshot_list');
    expect(names).toContain('vm_snapshot_restore');
    expect(names).toContain('vm_snapshot_delete');
    // Phase 3 serial console
    expect(names).toContain('vm_serial_read');
    expect(names).toContain('vm_serial_send');
  });

  test('none have browser category', () => {
    for (const tool of NON_BROWSER_TOOLS) {
      expect(tool.category).not.toBe('browser');
    }
  });
});

describe('createBrowserTools', () => {
  test('returns 7 browser tools', () => {
    const ctrl = new BrowserController(9999);
    const tools = createBrowserTools(ctrl);
    expect(tools).toHaveLength(7);
  });

  test('all tools have browser category', () => {
    const ctrl = new BrowserController(9999);
    const tools = createBrowserTools(ctrl);
    for (const tool of tools) {
      expect(tool.category).toBe('browser');
    }
  });

  test('tool names match expected browser tools', () => {
    const ctrl = new BrowserController(9999);
    const tools = createBrowserTools(ctrl);
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'browser_click',
      'browser_evaluate',
      'browser_navigate',
      'browser_screenshot',
      'browser_scroll',
      'browser_snapshot',
      'browser_type',
    ]);
  });

  test('BUILTIN_TOOLS = NON_BROWSER_TOOLS + 8 browser + 9 desktop tools', () => {
    // 8 browser tools + 9 desktop tools = 17 UI tools
    expect(BUILTIN_TOOLS).toHaveLength(NON_BROWSER_TOOLS.length + 8 + 9);
  });

  test('browser tools count', () => {
    const ctrl = new BrowserController(9999);
    const tools = createBrowserTools(ctrl);
    expect(tools.length).toBeGreaterThanOrEqual(7);
  });
});

describe('BrowserController parameterization', () => {
  test('accepts custom port', () => {
    const ctrl = new BrowserController(9223);
    // Should not throw — port is stored internally
    expect(ctrl).toBeDefined();
  });

  test('accepts custom port and profile dir', () => {
    const ctrl = new BrowserController(9223, '/tmp/test-bg-profile');
    expect(ctrl).toBeDefined();
  });

  test('defaults work (no args)', () => {
    const ctrl = new BrowserController();
    expect(ctrl).toBeDefined();
  });
});
