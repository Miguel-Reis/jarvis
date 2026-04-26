import type { AppController, WindowInfo, UIElement } from './interface.ts';

/**
 * Windows App Controller — graceful stub.
 * The Go sidecar (launched via SidecarManager) handles all desktop control
 * on Windows via UIAutomation — use the sidecar desktop tools instead.
 */
export class WindowsAppController implements AppController {
  private warn(method: string): void {
    console.warn(`[WindowsAppController] ${method}: delegate to sidecar for full Windows support`);
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
