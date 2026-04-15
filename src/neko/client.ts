/**
 * @file src/neko/client.ts
 * @description Neko instance client — auto-login + RTMP broadcast capture.
 *
 * Strategy (v3 WebRTC → RTMP → Discord):
 *   1. Authenticate via POST /api/login (probes v3 and v2 payload formats).
 *   2. Spawn FFmpeg in RTMP listener mode on a local port.
 *   3. Call Neko's broadcast API (POST /api/room/broadcast/start) so Neko
 *      pushes its internal WebRTC stream (video + audio) to our FFmpeg listener.
 *   4. Re-encode the incoming FLV/RTMP stream → H.264/Opus NUT for Discord.
 *
 * This gives us full realtime video AND audio (no screenshot polling).
 *
 * Environment variables:
 *   NEKO_URL              — Neko base URL         (default: http://localhost:8090)
 *   NEKO_USER_PASSWORD    — multiuser password     (default: neko)
 *   NEKO_ADMIN_PASSWORD   — admin password         (default: admin)
 *   NEKO_RTMP_PORT        — local RTMP listen port (default: 1935)
 *   NEKO_RTMP_HOST        — IP Neko should push to (default: 127.0.0.1)
 *                           Set this to the host's LAN IP if Neko and
 *                           SchroStream are in separate Docker networks.
 */

import { spawn, type ChildProcess } from 'child_process';
import config from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NekoLoginResult {
  /** Session JWT / opaque token returned by the Neko server. */
  token: string;
  /** Role of the authenticated session. */
  role: 'user' | 'admin';
}

export interface NekoConfig {
  url: string;
  userPassword: string;
  adminPassword: string;
  /** Local port for FFmpeg to listen for Neko's RTMP broadcast. */
  rtmpPort: number;
  /**
   * Hostname/IP that Neko should connect to when broadcasting.
   * Defaults to 127.0.0.1 (works when both services share host networking).
   * Override with NEKO_RTMP_HOST if needed.
   */
  rtmpHost: string;
}

export interface NekoBroadcastSession {
  /** The spawned FFmpeg process consuming the RTMP stream. */
  ffmpeg: ChildProcess;
  /** Call this to stop the broadcast and kill FFmpeg cleanly. */
  stop: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getNekoConfig(): NekoConfig {
  return {
    url: (process.env.NEKO_URL ?? 'http://localhost:8090').replace(/\/$/, ''),
    userPassword: process.env.NEKO_USER_PASSWORD ?? 'neko',
    adminPassword: process.env.NEKO_ADMIN_PASSWORD ?? 'admin',
    rtmpPort: parseInt(process.env.NEKO_RTMP_PORT ?? '1935', 10),
    rtmpHost: process.env.NEKO_RTMP_HOST ?? '127.0.0.1',
  };
}

// ---------------------------------------------------------------------------
// Auth — probes Neko v2 (secret) and v3 (username+password) payload shapes
// ---------------------------------------------------------------------------

export async function nekoLogin(cfg: NekoConfig): Promise<NekoLoginResult> {
  console.log(`[Neko] Attempting login at ${cfg.url}/api/login`);

  const attempt = async (
    payload: Record<string, string>,
    label: string,
  ): Promise<string | null> => {
    const bodyStr = JSON.stringify(payload);
    console.log(`[Neko] Trying ${label} → POST /api/login  body=${bodyStr}`);

    let res: Response;
    try {
      res = await fetch(`${cfg.url}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        signal: AbortSignal.timeout(8000),
      });
    } catch (err: any) {
      console.warn(`[Neko] Network error on ${label}:`, err?.message ?? err);
      return null;
    }

    const status = res.status;
    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    const contentType = res.headers.get('content-type') ?? '';
    console.log(`[Neko] ${label} → HTTP ${status}  content-type=${contentType}  set-cookie=${setCookieHeader.substring(0, 80)}`);

    const rawBody = await res.text();
    console.log(`[Neko] ${label} → body=${rawBody.substring(0, 300)}`);

    if (!res.ok) {
      console.warn(`[Neko] ${label} failed — HTTP ${status}`);
      return null;
    }

    // Token extraction — check cookie first, then JSON body
    const cookieMatch = setCookieHeader.match(/NEKO_SESSION=([^;]+)/);
    if (cookieMatch) {
      console.log(`[Neko] ${label} — token found in Set-Cookie`);
      return cookieMatch[1];
    }

    let parsed: any = {};
    try { parsed = JSON.parse(rawBody); } catch { /* not JSON */ }

    const token = parsed?.token ?? parsed?.id ?? parsed?.session ?? null;
    if (token) {
      console.log(`[Neko] ${label} — token found in JSON body`);
      return String(token);
    }

    console.warn(`[Neko] ${label} — HTTP ${status} but no token in response — body: ${rawBody}`);
    return null;
  };

  const strategies: Array<{ payload: Record<string, string>; label: string }> = [
    { payload: { username: 'admin', password: cfg.adminPassword }, label: 'v3 admin (username+password)' },
    { payload: { secret: cfg.adminPassword },                      label: 'v2 admin (secret)' },
    { payload: { username: 'user',  password: cfg.userPassword },  label: 'v3 user (username+password)' },
    { payload: { username: '',      password: cfg.userPassword },  label: 'v3 user (empty username)' },
    { payload: { secret: cfg.userPassword },                       label: 'v2 user (secret)' },
  ];

  for (const { payload, label } of strategies) {
    const token = await attempt(payload, label);
    if (token) {
      const role: NekoLoginResult['role'] = label.includes('admin') ? 'admin' : 'user';
      console.log(`[Neko] ✅ Authenticated as ${role} via: ${label}`);
      return { token, role };
    }
  }

  throw new Error(
    `[Neko] All login strategies exhausted.\n` +
    `  URL: ${cfg.url}\n` +
    `  NEKO_ADMIN_PASSWORD length: ${cfg.adminPassword.length}\n` +
    `  NEKO_USER_PASSWORD  length: ${cfg.userPassword.length}\n`,
  );
}

// ---------------------------------------------------------------------------
// Broadcast API helpers
// ---------------------------------------------------------------------------

/**
 * Probe which broadcast path Neko's API uses.
 * Neko v3 uses /api/room/broadcast/start in most builds.
 */
async function probeBroadcastPath(cfg: NekoConfig, token: string): Promise<string> {
  const candidates = [
    `${cfg.url}/api/room/broadcast/start`,
    `${cfg.url}/api/broadcast/start`,
  ];

  for (const path of candidates) {
    try {
      // Send a dry-run OPTIONS probe (no body) to check if path exists
      const res = await fetch(path, {
        method: 'OPTIONS',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      // 200, 204, 405 (Method Not Allowed) all mean the path exists
      if (res.status !== 404) {
        console.log(`[Neko] Broadcast path: ${path} (HTTP ${res.status})`);
        return path;
      }
    } catch {
      // network error — skip
    }
  }

  // Default fallback
  console.warn('[Neko] Could not probe broadcast path — defaulting to /api/room/broadcast/start');
  return `${cfg.url}/api/room/broadcast/start`;
}

/** POST to Neko's broadcast/start endpoint. */
async function startNekoBroadcast(
  cfg: NekoConfig,
  token: string,
  rtmpUrl: string,
): Promise<void> {
  const path = await probeBroadcastPath(cfg, token);
  console.log(`[Neko] Starting broadcast → ${path}  rtmp=${rtmpUrl}`);

  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url: rtmpUrl }),
    signal: AbortSignal.timeout(8000),
  });

  const body = await res.text();
  console.log(`[Neko] Broadcast start → HTTP ${res.status}  body=${body.substring(0, 200)}`);

  if (!res.ok) {
    throw new Error(
      `[Neko] Failed to start broadcast (HTTP ${res.status}): ${body}`,
    );
  }
}

/** POST to Neko's broadcast/stop endpoint — best effort. */
async function stopNekoBroadcast(cfg: NekoConfig, token: string): Promise<void> {
  const stopPaths = [
    `${cfg.url}/api/room/broadcast/stop`,
    `${cfg.url}/api/broadcast/stop`,
  ];

  for (const path of stopPaths) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok || res.status === 404) {
        console.log(`[Neko] Broadcast stopped via ${path}`);
        return;
      }
    } catch {
      // Ignore — we're shutting down anyway
    }
  }
}

// ---------------------------------------------------------------------------
// Main: Start the RTMP broadcast session
// ---------------------------------------------------------------------------

/**
 * Starts a Neko RTMP broadcast session and returns the FFmpeg child process
 * whose stdout carries NUT-formatted video+audio for Discord.
 *
 * Steps:
 *   1. Spawn FFmpeg in `-listen 1` RTMP mode (waits for Neko to connect).
 *   2. Call Neko's broadcast/start API so it pushes WebRTC → RTMP → our FFmpeg.
 *   3. Return the FFmpeg process + a stop() function for cleanup.
 *
 * @param cfg   Neko config (URL, passwords, RTMP port/host).
 * @param token Session token from nekoLogin().
 */
export async function startNekoBroadcastSession(
  cfg: NekoConfig,
  token: string,
): Promise<NekoBroadcastSession> {
  const height = config.stream.defaultQuality;
  const width = Math.round(height * (16 / 9));
  const bitrate = config.stream.maxBitrate;
  const fps = config.stream.frameRate;
  const gopSize = fps * 2;

  const rtmpUrl = `rtmp://${cfg.rtmpHost}:${cfg.rtmpPort}/live/neko`;
  const listenUrl = `rtmp://0.0.0.0:${cfg.rtmpPort}/live/neko`;

  console.log(`[Neko] RTMP listener → ${listenUrl}`);
  console.log(`[Neko] Neko will broadcast to → ${rtmpUrl}`);

  // Build FFmpeg args — listen for RTMP then re-encode for Discord
  const ffmpegArgs: string[] = [
    '-hide_banner',
    '-loglevel', 'warning',   // Show warnings/errors but not info spam

    // RTMP listener input — FFmpeg blocks here until Neko connects
    '-listen', '1',
    '-timeout', '30000000',   // 30s in microseconds — time for Neko to connect
    '-f', 'flv',
    '-i', listenUrl,

    // Video: re-encode to H.264 for Discord compatibility
    '-c:v', 'libx264',
    '-preset', 'superfast',   // superfast = low CPU, low latency
    '-profile:v', 'high',
    '-level', '4.2',
    '-tune', 'zerolatency',
    '-bf', '0',               // No B-frames — required for RTP/Discord streaming
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-g', String(gopSize),
    '-keyint_min', String(gopSize),
    '-b:v', `${bitrate}k`,
    '-maxrate', `${bitrate}k`,
    '-bufsize', `${bitrate * 2}k`,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,

    // Audio: Neko's WebRTC audio (Opus) arrives as AAC-in-FLV — re-encode to Opus for Discord
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',

    // Output NUT for discord-video-stream
    '-vsync', 'cfr',
    '-map_metadata', '-1',
    '-f', 'nut',
    '-',
  ];

  console.log('[Neko] Spawning FFmpeg RTMP listener...');
  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stderr.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (!msg) return;
    if (msg.includes('error') || msg.includes('Error') || msg.includes('Invalid')) {
      console.error('[FFmpeg/Neko]', msg);
    } else if (config.stream.showFFmpegLogs || msg.includes('rtmp') || msg.includes('flv') || msg.includes('connected')) {
      console.log('[FFmpeg/Neko]', msg);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('[Neko] FFmpeg spawn error:', err.message);
  });

  // Small delay to let FFmpeg bind the RTMP port before telling Neko to connect
  await new Promise(resolve => setTimeout(resolve, 800));

  // Trigger Neko to broadcast to us
  await startNekoBroadcast(cfg, token, rtmpUrl);

  console.log('[Neko] Waiting for Neko to connect to RTMP listener...');

  const stop = async (): Promise<void> => {
    console.log('[Neko] Stopping broadcast session...');
    await stopNekoBroadcast(cfg, token);
    try {
      ffmpeg.kill('SIGKILL');
    } catch { /* already dead */ }
  };

  return { ffmpeg, stop };
}
