/**
 * @file src/neko/control.ts
 * @description Neko WebSocket control session.
 *
 * Connects to the Neko WebSocket API and sends mouse/keyboard events.
 * Protocol: JSON over WebSocket — { event: string, data?: object }
 *
 * Neko WS endpoint: ws://HOST:PORT/api/room/websocket?token=TOKEN
 *
 * Relevant event names (from neko/server/pkg/types/event/events.go):
 *   control/move         { x, y }
 *   control/scroll       { delta_x, delta_y }
 *   control/buttonpress  { code, x?, y? }
 *   control/buttondown   { code, x?, y? }
 *   control/buttonup     { code, x?, y? }
 *   control/keypress     { keysym, x?, y? }
 *   control/keydown      { keysym, x?, y? }
 *   control/keyup        { keysym, x?, y? }
 *   control/paste        { text }   ← sets clipboard AND sends Ctrl+V
 *   control/cut          (no data)
 *   control/copy         (no data)
 *   control/select_all   (no data)
 *   control/request      (no data)
 *   control/release      (no data)
 *   clipboard/set        { text }
 *   client/heartbeat     (no data)
 */

import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// X11 Keysyms — commonly used keys
// ---------------------------------------------------------------------------

export const XK = {
  // Navigation
  Left:     0xff51,
  Up:       0xff52,
  Right:    0xff53,
  Down:     0xff54,
  Home:     0xff50,
  End:      0xff57,
  PageUp:   0xff55,
  PageDown: 0xff56,

  // Editing
  BackSpace: 0xff08,
  Tab:       0xff09,
  Return:    0xff0d,
  Escape:    0xff1b,
  Delete:    0xffff,
  Insert:    0xff63,
  Space:     0x0020,

  // Modifiers
  Shift_L:   0xffe1,
  Shift_R:   0xffe2,
  Control_L: 0xffe3,
  Control_R: 0xffe4,
  Alt_L:     0xffe9,
  Alt_R:     0xffea,
  Super_L:   0xffeb,

  // Function keys
  F1:  0xffbe,
  F2:  0xffbf,
  F3:  0xffc0,
  F4:  0xffc1,
  F5:  0xffc2,
  F6:  0xffc3,
  F7:  0xffc4,
  F8:  0xffc5,
  F9:  0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,

  // Printable (lowercase = use charCode for a-z, 0-9)
  // e.g. 'a' = 0x61, 'z' = 0x7a, '0' = 0x30, '9' = 0x39
  a: 0x61, b: 0x62, c: 0x63, d: 0x64, e: 0x65, f: 0x66,
  g: 0x67, h: 0x68, i: 0x69, j: 0x6a, k: 0x6b, l: 0x6c,
  m: 0x6d, n: 0x6e, o: 0x6f, p: 0x70, q: 0x71, r: 0x72,
  s: 0x73, t: 0x74, u: 0x75, v: 0x76, w: 0x77, x: 0x78,
  y: 0x79, z: 0x7a,
} as const;

// Mouse button codes (X11)
export const MouseButton = {
  Left:   1,
  Middle: 2,
  Right:  3,
} as const;

// Friendly key name → keysym mapping for Discord commands
export const NAMED_KEYS: Record<string, number> = {
  enter:    XK.Return,
  return:   XK.Return,
  escape:   XK.Escape,
  esc:      XK.Escape,
  backspace: XK.BackSpace,
  delete:   XK.Delete,
  del:      XK.Delete,
  insert:   XK.Insert,
  tab:      XK.Tab,
  space:    XK.Space,
  home:     XK.Home,
  end:      XK.End,
  pageup:   XK.PageUp,
  pagedown: XK.PageDown,
  up:       XK.Up,
  down:     XK.Down,
  left:     XK.Left,
  right:    XK.Right,
  f1:  XK.F1,  f2:  XK.F2,  f3:  XK.F3,  f4:  XK.F4,
  f5:  XK.F5,  f6:  XK.F6,  f7:  XK.F7,  f8:  XK.F8,
  f9:  XK.F9,  f10: XK.F10, f11: XK.F11, f12: XK.F12,
};

// ---------------------------------------------------------------------------
// NekoControlSession
// ---------------------------------------------------------------------------

export class NekoControlSession {
  private ws: WebSocket;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;

  constructor(
    private readonly wsUrl: string,
  ) {
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this.connected = true;
      console.log('[Neko/Control] WebSocket connected ✅');
      // Heartbeat every 5 s to keep the session alive
      this.heartbeatTimer = setInterval(() => {
        this.send('client/heartbeat');
      }, 5_000);
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { event: string; data?: unknown };
        // Only log unexpected / error messages to keep logs clean
        if (msg.event === 'system/disconnect') {
          console.warn('[Neko/Control] Server disconnected:', msg.data);
        }
      } catch { /* ignore non-JSON */ }
    });

    this.ws.on('error', (err) => {
      console.error('[Neko/Control] WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      this.connected = false;
      console.log('[Neko/Control] WebSocket closed');
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    });
  }

  /** True once the WebSocket handshake completes. */
  isConnected(): boolean {
    return this.connected && this.ws.readyState === WebSocket.OPEN;
  }

  /** Wait for the WS connection to open (up to timeoutMs). */
  waitForConnect(timeoutMs = 5_000): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('[Neko/Control] WebSocket connect timed out'));
      }, timeoutMs);
      this.ws.once('open', () => { clearTimeout(timeout); resolve(); });
      this.ws.once('error', (e) => { clearTimeout(timeout); reject(e); });
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private send(event: string, data?: Record<string, unknown>): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Neko/Control] WS not open — dropping:', event);
      return;
    }
    const payload = data !== undefined ? { event, data } : { event };
    this.ws.send(JSON.stringify(payload));
  }

  /** Press modifier keys down, then other keys down, then release all. */
  private async chord(modifiers: number[], keys: number[]): Promise<void> {
    for (const k of modifiers) this.send('control/keydown', { keysym: k });
    await delay(30);
    for (const k of keys) this.send('control/keydown', { keysym: k });
    await delay(30);
    for (const k of [...keys].reverse()) this.send('control/keyup', { keysym: k });
    await delay(30);
    for (const k of [...modifiers].reverse()) this.send('control/keyup', { keysym: k });
  }

  // ---------------------------------------------------------------------------
  // Public control API
  // ---------------------------------------------------------------------------

  /** Move the mouse cursor to (x, y) in screen coordinates. */
  moveMouse(x: number, y: number): void {
    this.send('control/move', { x, y });
  }

  /**
   * Click at (x, y). Button: 1=left, 2=middle, 3=right.
   * Moves first, then presses+releases the button.
   */
  async click(x: number, y: number, button: 1 | 2 | 3 = 1): Promise<void> {
    this.moveMouse(x, y);
    await delay(50);
    this.send('control/buttonpress', { code: button, x, y });
  }

  /** Scroll by (deltaX, deltaY) — negative deltaY = scroll up. */
  scroll(deltaX: number, deltaY: number): void {
    this.send('control/scroll', { delta_x: deltaX, delta_y: deltaY });
  }

  /**
   * Paste text into the currently focused element.
   * Uses Neko's control/paste event which sets the clipboard AND sends Ctrl+V.
   */
  pasteText(text: string): void {
    this.send('control/paste', { text });
  }

  /** Press a single key by keysym (tap = down + up). */
  keyPress(keysym: number): void {
    this.send('control/keypress', { keysym });
  }

  /** Press Enter. */
  pressEnter(): void {
    this.keyPress(XK.Return);
  }

  /** Press Escape. */
  pressEscape(): void {
    this.keyPress(XK.Escape);
  }

  /** Press F5 (browser refresh). */
  refresh(): void {
    this.keyPress(XK.F5);
  }

  /** Press Ctrl+T (new browser tab). */
  async newTab(): Promise<void> {
    await this.chord([XK.Control_L], [XK.t]);
  }

  /** Press Ctrl+W (close current tab). */
  async closeTab(): Promise<void> {
    await this.chord([XK.Control_L], [XK.w]);
  }

  /** Press Ctrl+Shift+T (reopen closed tab). */
  async reopenTab(): Promise<void> {
    await this.chord([XK.Control_L, XK.Shift_L], [XK.t]);
  }

  /** Press Alt+Left (browser back). */
  async goBack(): Promise<void> {
    await this.chord([XK.Alt_L], [XK.Left]);
  }

  /** Press Alt+Right (browser forward). */
  async goForward(): Promise<void> {
    await this.chord([XK.Alt_L], [XK.Right]);
  }

  /**
   * Navigate to a URL by focusing the address bar (Ctrl+L),
   * pasting the URL, then pressing Enter.
   */
  async navigateToUrl(url: string): Promise<void> {
    await this.chord([XK.Control_L], [XK.l]); // Ctrl+L → focus address bar
    await delay(200);
    this.pasteText(url);
    await delay(100);
    this.keyPress(XK.Return);
  }

  /** Press Ctrl+Z (undo). */
  async undo(): Promise<void> {
    await this.chord([XK.Control_L], [XK.z]);
  }

  /** Press Ctrl+A (select all). */
  selectAll(): void {
    this.send('control/select_all');
  }

  /** Copy selection to clipboard. */
  copy(): void {
    this.send('control/copy');
  }

  /** Cut selection. */
  cut(): void {
    this.send('control/cut');
  }

  /** Disconnect the WebSocket and clean up timers. */
  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create and connect a NekoControlSession for the given Neko URL and token.
 * Waits for the WebSocket handshake before returning.
 */
export async function connectNekoControl(
  nekoUrl: string,
  token: string,
): Promise<NekoControlSession> {
  const wsUrl = nekoUrl.replace(/^http/, 'ws') + `/api/room/websocket?token=${encodeURIComponent(token)}`;
  console.log(`[Neko/Control] Connecting to ${wsUrl.split('?')[0]}...`);
  const session = new NekoControlSession(wsUrl);
  await session.waitForConnect(8_000);
  console.log('[Neko/Control] Ready to accept control commands');
  return session;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
