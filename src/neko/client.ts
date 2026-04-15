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
  /** Whether NVENC GPU encoding is available — passed from video-streamer. */
  useGpu: boolean;
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

export function getNekoConfig(useGpu = false): NekoConfig {
  return {
    url: (process.env.NEKO_URL ?? 'http://localhost:8090').replace(/\/$/, ''),
    userPassword: process.env.NEKO_USER_PASSWORD ?? 'neko',
    adminPassword: process.env.NEKO_ADMIN_PASSWORD ?? 'admin',
    rtmpPort: parseInt(process.env.NEKO_RTMP_PORT ?? '1935', 10),
    rtmpHost: process.env.NEKO_RTMP_HOST ?? '127.0.0.1',
    useGpu,
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
    throw new Error(`[Neko] Failed to start broadcast (HTTP ${res.status}): ${body}`);
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
 * Order of operations (order matters — do NOT rearrange):
 *   1. Stop any existing Neko broadcast (prevents 422 race condition).
 *   2. Spawn FFmpeg in -listen 1 RTMP mode.
 *   3. Wait for FFmpeg to bind the RTMP port.
 *   4. Start the Neko broadcast → Neko connects to our FFmpeg listener.
 *
 * Why stop-first?
 *   FFmpeg's -listen 1 exits as soon as its single client disconnects.
 *   If we handled 422 by stopping AFTER spawning FFmpeg, Neko would
 *   reconnect and our FFmpeg would already be dead (exited on the old
 *   client disconnect). Stop first → guaranteed live FFmpeg on connect.
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
  const useGpu = cfg.useGpu;

  const rtmpUrl = `rtmp://${cfg.rtmpHost}:${cfg.rtmpPort}/live/neko`;
  const listenUrl = `rtmp://0.0.0.0:${cfg.rtmpPort}/live/neko`;

  console.log(`[Neko] RTMP listener → ${listenUrl}`);
  console.log(`[Neko] Neko will broadcast to → ${rtmpUrl}`);
  console.log(`[Neko] Encoder: ${useGpu ? 'NVENC (GPU)' : 'libx264 (CPU)'}`);

  //
  // ── FFmpeg arg strategy ──────────────────────────────────────────────────
  //
  // Problem: Neko encodes H.264 internally and pushes RTMP to us. If we
  // re-encode again on the CPU we get double-encode latency.
  //
  // Fix:
  //   1. Bust RTMP buffering with -fflags nobuffer / -flags low_delay.
  //   2. Use GPU (NVENC) where available — GPU encode adds <5ms vs 50–200ms
  //      CPU. p1 preset = fastest/lowest latency.
  //   3. CPU fallback: ultrafast + zerolatency. Despite the note elsewhere
  //      about bitrate spikes, for a live virtual desktop where latency
  //      matters more than encode efficiency, ultrafast is correct.
  //   4. Halve bufsize (1× rather than 2× bitrate) — smaller encoder buffer
  //      means frames reach Discord sooner.
  //
  const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

  const videoArgs: string[] = useGpu ? [
    // ── NVENC path — matches YouTube streaming config exactly ───────────
    '-c:v', 'h264_nvenc',
    '-preset', 'p4',          // p4 = medium quality/speed balance (same as YouTube)
    '-profile:v', 'high',
    '-level', '4.2',          // Level 4.2 for Discord compatibility
    '-tune', 'll',            // Low latency tuning
    '-rc', 'cbr',             // Constant bitrate for stable streaming
    '-bf', '0',               // No B-frames — required for Discord streaming
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-g', String(gopSize),
    '-keyint_min', String(gopSize),
    '-b:v', `${bitrate}k`,
    '-maxrate', `${bitrate}k`,
    '-bufsize', `${bitrate * 2}k`,
    '-vf', scaleFilter,
  ] : [
    // ── CPU path ─────────────────────────────────────────────────────────
    '-c:v', 'libx264',
    '-preset', 'ultrafast',   // ultrafast: lowest CPU encode latency
    '-tune', 'zerolatency',
    '-bf', '0',               // No B-frames
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-g', String(gopSize),
    '-keyint_min', String(gopSize),
    '-b:v', `${bitrate}k`,
    '-maxrate', `${bitrate}k`,
    '-bufsize', `${bitrate}k`, // 1× bitrate — less buffering = lower latency
    '-vf', scaleFilter,
  ];

  const ffmpegArgs: string[] = [
    '-hide_banner',
    '-loglevel', 'warning',

    // ── Reduce RTMP input latency ───────────────────────────────────────
    '-fflags', 'nobuffer',       // Don't queue demuxed packets — safe for RTMP

    // ── RTMP listener ──────────────────────────────────────────────────
    '-listen', '1',
    '-timeout', '30000000',      // 30s for Neko to connect (microseconds)
    '-f', 'flv',
    '-i', listenUrl,

    // ── Video ──────────────────────────────────────────────────────────
    ...videoArgs,

    // ── Audio: AAC-in-FLV (from Neko) → Opus (for Discord) ────────────
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-frame_duration', '20',     // 20ms Opus frames

    // ── Output ─────────────────────────────────────────────────────────
    '-vsync', 'cfr',
    '-map_metadata', '-1',
    '-f', 'nut',
    '-',
  ];

  // ── Step 1: Stop any existing Neko broadcast BEFORE spawning FFmpeg ──
  // This prevents the race condition where:
  //   a) Neko is still broadcasting to the old RTMP address
  //   b) We spawn FFmpeg and get 422 → kill old broadcast → FFmpeg exits
  //   c) Neko retries → port 1935 now closed → GStreamer pipeline fails
  // By stopping first, FFmpeg is guaranteed to be alive when Neko connects.
  console.log('[Neko] Clearing any existing Neko broadcast...');
  await stopNekoBroadcast(cfg, token);
  // Give Neko's GStreamer pipeline a moment to fully tear down
  await new Promise(resolve => setTimeout(resolve, 600));

  // ── Step 2: Spawn FFmpeg RTMP listener ────────────────────────────────
  console.log('[Neko] Spawning FFmpeg RTMP listener (low-latency mode)...');
  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stderr.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (!msg) return;
    if (msg.includes('error') || msg.includes('Error') || msg.includes('Invalid') || msg.includes('drop')) {
      console.error('[FFmpeg/Neko]', msg);
    } else if (config.stream.showFFmpegLogs || msg.includes('rtmp') || msg.includes('connected') || msg.includes('fps=')) {
      console.log('[FFmpeg/Neko]', msg);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('[Neko] FFmpeg spawn error:', err.message);
  });

  // ── Step 3: Wait for FFmpeg to bind port ─────────────────────────────
  // FFmpeg needs a moment to create the RTMP server socket before Neko
  // tries to connect. 800ms is conservative but reliable.
  await new Promise(resolve => setTimeout(resolve, 800));

  // ── Step 4: Tell Neko to push to our listener ─────────────────────────
  // At this point: existing broadcast is stopped, FFmpeg is listening.
  // 422 should not occur. If it does, it's a genuine error.
  await startNekoBroadcast(cfg, token, rtmpUrl);
  console.log('[Neko] ✅ Neko broadcast started — waiting for GStreamer to connect...');

  const stop = async (): Promise<void> => {
    console.log('[Neko] Stopping broadcast session...');
    await stopNekoBroadcast(cfg, token);
    try {
      ffmpeg.kill('SIGKILL');
    } catch { /* already dead */ }
  };

  return { ffmpeg, stop };
}
