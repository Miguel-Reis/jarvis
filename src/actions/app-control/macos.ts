import type { AppController, WindowInfo, UIElement } from './interface.ts';

/**
 * macOS App Controller — graceful stub.
 * Full implementation requires AXUIElement/AppleScript native bindings.
 * The Go sidecar (launched via SidecarManager) handles all desktop control
 * on macOS via AppleScript — use the sidecar desktop tools instead.
 */
export class MacAppController implements AppController {
  private warn(method: string): void {
    console.warn(`[MacAppController] ${method}: delegate to sidecar for full macOS support`);
  }

  async getActiveWindow(): Promise<WindowInfo> {
    this.warn('getActiveWindow');
    return { pid: 0, title: '', className: '', bounds: { x: 0, y: 0, width: 0, height: 0 }, focused: false };
  }

  async getWindowTree(_pid: number): Promise<UIElement[]> {
    this.warn('getWindowTree');
    return [];
  }

  async listWindows(): Promise<WindowInfo[]> {
    this.warn('listWindows');
    return [];
  }

  async clickElement(_element: UIElement): Promise<void> {
    this.warn('clickElement');
  }

  async typeText(_text: string): Promise<void> {
    this.warn('typeText');
  }

  async pressKeys(_keys: string[]): Promise<void> {
    this.warn('pressKeys');
  }

  async captureScreen(): Promise<Buffer> {
    this.warn('captureScreen');
    return Buffer.alloc(0);
  }

  async captureWindow(_pid: number): Promise<Buffer> {
    this.warn('captureWindow');
    return Buffer.alloc(0);
  }

  async focusWindow(_pid: number): Promise<void> {
    this.warn('focusWindow');
  }
}
