/**
 * @file src/neko/client.ts
 * @description Neko instance client — handles auto-login via the Neko REST API
 * and provides a screen-capture stream for Discord via FFmpeg MJPEG polling.
 *
 * Strategy:
 *   1. Authenticate with POST /api/login (user or admin credentials).
 *   2. Continuously fetch GET /api/screenshot (returns a JPEG frame).
 *   3. Write frames as an MJPEG stream to a pipe that FFmpeg reads.
 *
 * The resulting FFmpeg stdin stream is compatible with `startExternalStream`
 * via the existing `playExternalStream` plumbing in video-streamer.ts.
 */

import { PassThrough } from 'stream';
import config from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NekoLoginResult {
  /** Authenticated session token (cookie value). */
  token: string;
  /** Role of the authenticated user. */
  role: 'user' | 'admin';
}

export interface NekoConfig {
  /** Base URL of the neko instance, e.g. http://localhost:8090 */
  url: string;
  /** User password (member login). */
  userPassword: string;
  /** Admin password (admin login — grants additional permissions). */
  adminPassword: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** MJPEG boundary marker. */
const MJPEG_BOUNDARY = 'nekoboundary';

/**
 * Build the neko config from environment variables.
 *
 * Required env vars:
 *   NEKO_URL             — base URL (default: http://localhost:8090)
 *   NEKO_USER_PASSWORD   — member password (default: neko)
 *   NEKO_ADMIN_PASSWORD  — admin password  (default: admin)
 */
export function getNekoConfig(): NekoConfig {
  return {
    url: (process.env.NEKO_URL ?? 'http://localhost:8090').replace(/\/$/, ''),
    userPassword: process.env.NEKO_USER_PASSWORD ?? 'neko',
    adminPassword: process.env.NEKO_ADMIN_PASSWORD ?? 'admin',
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Authenticate with the Neko instance.
 *
 * Tries admin first, falls back to user.
 * Returns the session token extracted from the `Set-Cookie` header.
 */
export async function nekoLogin(cfg: NekoConfig): Promise<NekoLoginResult> {
  const tryLogin = async (password: string, role: 'admin' | 'user'): Promise<string | null> => {
    try {
      const res = await fetch(`${cfg.url}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: password }),
      });

      if (!res.ok) {
        console.warn(`[Neko] Login as ${role} failed — HTTP ${res.status}`);
        return null;
      }

      // Neko sets a session cookie named `NEKO_SESSION`
      const setCookie = res.headers.get('set-cookie') ?? '';
      const match = setCookie.match(/NEKO_SESSION=([^;]+)/);
      if (!match) {
        // Neko v2 returns the token in the JSON body
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const token = (body as any)?.token as string | undefined;
        if (token) return token;
        console.warn(`[Neko] Login as ${role} succeeded but no session token found`);
        return null;
      }

      return match[1];
    } catch (err) {
      console.warn(`[Neko] Login as ${role} error:`, err);
      return null;
    }
  };

  // Prefer admin — gets higher-privilege session
  const adminToken = await tryLogin(cfg.adminPassword, 'admin');
  if (adminToken) {
    console.log('[Neko] Logged in as admin ✅');
    return { token: adminToken, role: 'admin' };
  }

  const userToken = await tryLogin(cfg.userPassword, 'user');
  if (userToken) {
    console.log('[Neko] Logged in as user ✅');
    return { token: userToken, role: 'user' };
  }

  throw new Error('[Neko] Failed to authenticate with either admin or user credentials');
}

// ---------------------------------------------------------------------------
// Screenshot-polling MJPEG stream
// ---------------------------------------------------------------------------

export interface NekoStreamOptions {
  /** Frames per second to target. Default: 15. Note: Neko screenshot endpoint
   *  is not a realtime feed — higher rates increase CPU/network but may not
   *  yield distinct frames faster than the Neko VNC refresh rate. */
  fps?: number;
  /** Whether to stop when the PassThrough is destroyed. */
  signal?: AbortSignal;
}

/**
 * Creates a PassThrough stream that emits MJPEG data by continuously
 * polling the Neko `/api/screenshot` endpoint.
 *
 * The caller should pipe this into an FFmpeg process:
 *
 * ```
 * ffmpeg -f mjpeg -r 15 -i pipe:0 ...
 * ```
 *
 * @param cfg  Neko configuration (URL + creds).
 * @param token Session token from `nekoLogin`.
 * @param opts  Stream options.
 * @returns A PassThrough stream emitting raw MJPEG frames with boundary headers.
 */
export function createNekoMjpegStream(
  cfg: NekoConfig,
  token: string,
  opts: NekoStreamOptions = {},
): PassThrough {
  const fps = opts.fps ?? 15;
  const intervalMs = Math.round(1000 / fps);
  const stream = new PassThrough();

  let running = true;
  let failCount = 0;
  const MAX_FAILS = 10;

  // Handle abort signal
  opts.signal?.addEventListener('abort', () => {
    running = false;
    stream.end();
  });

  // Handle stream close
  stream.on('close', () => {
    running = false;
  });

  stream.on('error', (err) => {
    console.error('[Neko] MJPEG stream error:', err.message);
    running = false;
  });

  // Write MJPEG stream header
  // FFmpeg understands raw MJPEG with Content-Type boundaries
  stream.write(`--${MJPEG_BOUNDARY}\r\n`);

  const screenshotUrl = `${cfg.url}/api/screenshot`;

  const fetchFrame = async (): Promise<void> => {
    if (!running || stream.destroyed) return;

    try {
      const res = await fetch(screenshotUrl, {
        headers: {
          Cookie: `NEKO_SESSION=${token}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        console.warn(`[Neko] Screenshot fetch failed — HTTP ${res.status}`);
        failCount++;
        if (failCount >= MAX_FAILS && !stream.destroyed) {
          stream.destroy(new Error(`Neko screenshot endpoint repeatedly failing (${MAX_FAILS} times)`));
        }
        return;
      }

      const arrayBuffer = await res.arrayBuffer();
      const frame = Buffer.from(arrayBuffer);

      if (!frame.length) return;

      failCount = 0; // Reset on success

      if (!stream.destroyed) {
        // Write MJPEG frame with boundary
        stream.write(
          `Content-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
        );
        stream.write(frame);
        stream.write(`\r\n--${MJPEG_BOUNDARY}\r\n`);
      }
    } catch (err: any) {
      if (running && !stream.destroyed) {
        failCount++;
        console.warn('[Neko] Frame fetch error:', err?.message ?? err);
        if (failCount >= MAX_FAILS) {
          stream.destroy(new Error('Neko stream failed — too many consecutive errors'));
        }
      }
    }
  };

  // Start polling loop
  const poll = async (): Promise<void> => {
    const start = Date.now();
    await fetchFrame();
    const elapsed = Date.now() - start;
    const delay = Math.max(0, intervalMs - elapsed);

    if (running && !stream.destroyed) {
      setTimeout(poll, delay);
    }
  };

  // Kick off — small initial delay to let the stream pipe be established
  setTimeout(poll, 100);

  return stream;
}

// ---------------------------------------------------------------------------
// Convenience: build the FFmpeg args for a Neko MJPEG stream
// ---------------------------------------------------------------------------

/**
 * Returns FFmpeg arguments to consume the Neko MJPEG stream from stdin.
 *
 * Usage:
 *   const args = buildNekoFfmpegArgs(fps, width, height, bitrate, frameRate);
 *   const ffmpeg = spawn('ffmpeg', args);
 *   nekoMjpegStream.pipe(ffmpeg.stdin);
 */
export function buildNekoFfmpegArgs(
  sourceFps: number,
  width: number,
  height: number,
  bitrate: number,
  outputFrameRate: number,
): string[] {
  const gopSize = outputFrameRate * 2;

  return [
    '-hide_banner',
    '-loglevel', 'error',
    // Input: MJPEG frames from stdin
    '-f', 'mjpeg',
    '-r', String(sourceFps),
    '-i', 'pipe:0',
    // No audio from Neko screenshot stream — generate silent audio
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    // Video encoding
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-preset', 'superfast',
    '-profile:v', 'high',
    '-level', '4.2',
    '-tune', 'zerolatency',
    '-bf', '0',           // No B-frames — required for Discord streaming
    '-pix_fmt', 'yuv420p',
    '-r', String(outputFrameRate),
    '-g', String(gopSize),
    '-keyint_min', String(gopSize),
    '-b:v', `${bitrate}k`,
    '-maxrate', `${bitrate}k`,
    '-bufsize', `${bitrate * 2}k`,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    // Silent audio
    '-c:a', 'libopus',
    '-b:a', '64k',
    '-ar', '48000',
    '-ac', '2',
    // Output NUT format for discord-video-stream
    '-vsync', 'cfr',
    '-map_metadata', '-1',
    '-f', 'nut',
    '-',
  ];
}
