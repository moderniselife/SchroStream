import { Streamer, prepareStream, playStream, Utils } from '@dank074/discord-video-stream';
import { Client } from 'discord.js-selfbot-v13';
import { EmbedBuilder } from 'discord.js';
import { spawn, execSync, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { MediaItem } from '../types/index.js';
import config from '../config.js';
import plexClient from '../plex/client.js';
import { updateWatchDeck } from '../data/watch-deck.js';
import { popQueue, peekQueue } from '../data/queue.js';
import { popMusicQueue, isAutoplayEnabled, setLastPlayedVideoId, addToMusicQueue } from '../data/music-queue.js';
import { startVoiceListener, stopVoiceListener } from '../voice/python-listener.js';
import { startVoiceReceiver, stopVoiceReceiver } from '../voice/receiver.js';
import { getNextEpisode } from '../plex/library.js';
import { DAVESession } from '@snazzah/davey';


/**
 * Normalize H264 3-byte NALU start codes (00 00 01) to 4-byte (00 00 00 01).
 * 
 * davey's process_frame_h264() converts all start codes to 4-byte internally,
 * but its output buffer is sized based on the INPUT frame length. If the input
 * has 3-byte start codes, the expansion causes a buffer overflow panic at
 * encryptor.rs:193. By normalizing BEFORE encryption, no expansion occurs.
 */
function normalizeH264StartCodes(frame: Buffer): Buffer {
  // Find all NALU boundaries - look for 00 00 01 sequences
  // that aren't already preceded by 00 (making them 00 00 00 01)
  const positions: number[] = [];
  for (let i = 0; i < frame.length - 2; i++) {
    if (frame[i] === 0 && frame[i + 1] === 0 && frame[i + 2] === 1) {
      // Check if this is already a 4-byte code (preceded by 00)
      if (i > 0 && frame[i - 1] === 0) {
        // Already 4-byte (00 00 00 01), skip
        continue;
      }
      positions.push(i);
    }
  }

  // If no 3-byte start codes found, return original frame
  if (positions.length === 0) {
    return frame;
  }

  // Build a new buffer with 4-byte start codes
  const newSize = frame.length + positions.length; // each conversion adds 1 byte
  const result = Buffer.allocUnsafe(newSize);
  let srcPos = 0;
  let dstPos = 0;

  for (const pos of positions) {
    // Copy bytes before this start code
    if (pos > srcPos) {
      frame.copy(result, dstPos, srcPos, pos);
      dstPos += pos - srcPos;
    }
    // Write 4-byte start code
    result[dstPos] = 0;
    result[dstPos + 1] = 0;
    result[dstPos + 2] = 0;
    result[dstPos + 3] = 1;
    dstPos += 4;
    srcPos = pos + 3; // skip original 3-byte start code
  }

  // Copy remaining bytes after last start code
  if (srcPos < frame.length) {
    frame.copy(result, dstPos, srcPos);
  }

  return result;
}

/**
 * DAVE Encryptor Frame Guard
 * 
 * The Rust encryptor in @snazzah/davey panics at encryptor.rs:193 with an
 * index-out-of-bounds when it receives frames that trigger bad memory access.
 * This happens with Plex HLS streams.
 *
 * Since Rust panics cannot be caught by JS try/catch, we monkey-patch the
 * DAVESession prototype to validate frame sizes BEFORE calling into Rust.
 *
 * CRITICAL: We must use ESM `import` (not createRequire) to get the SAME
 * module instance as discord-video-stream. Node.js ESM and CJS caches are
 * separate — createRequire would patch a different copy of DAVESession.
 */
(function installDaveFrameGuard() {
  try {
    const proto = DAVESession.prototype as any;

    // Guard encryptOpus (audio)
    const originalEncryptOpus = proto.encryptOpus;
    if (originalEncryptOpus && !proto._guardedEncryptOpus) {
      proto._guardedEncryptOpus = true;
      proto.encryptOpus = function(packet: Buffer): Buffer {
        if (!packet || !Buffer.isBuffer(packet) || packet.length === 0) {
          return packet || Buffer.alloc(0);
        }
        return originalEncryptOpus.call(this, packet);
      };
    }

    // Guard encrypt (video) — also normalizes H264 start codes
    const originalEncrypt = proto.encrypt;
    if (originalEncrypt && !proto._guardedEncrypt) {
      proto._guardedEncrypt = true;
      proto.encrypt = function(mediaType: number, codec: number, packet: Buffer): Buffer {
        if (!packet || !Buffer.isBuffer(packet) || packet.length === 0) {
          return packet || Buffer.alloc(0);
        }

        // BUG FIX: davey/encryptor.rs allocates the output buffer based on
        // the INPUT frame size (packet.len()), but process_frame_h264 converts
        // 3-byte NALU start codes (00 00 01) to 4-byte (00 00 00 01), expanding
        // the reconstructed frame. If the frame has many NALUs, the expansion
        // causes the supplemental data to overflow the buffer, panicking at
        // encryptor.rs:193 (split_at_mut on a too-small slice).
        //
        // Fix: normalize all 3-byte start codes to 4-byte BEFORE calling encrypt.
        // This way, process_frame_h264 sees all 4-byte start codes and doesn't
        // expand anything, so reconstructed_frame_size == frame_size.
        const H264_CODEC = 4;
        if (codec === H264_CODEC && packet.length > 4) {
          packet = normalizeH264StartCodes(packet);
        }

        return originalEncrypt.call(this, mediaType, codec, packet);
      };
    }

    console.log('[DAVE] Frame guard installed on DAVESession prototype (ESM)');
  } catch (err) {
    console.error('[DAVE] Failed to install frame guard:', err);
  }
})();

// NVENC GPU transcoding support - cached at startup
let nvencSupported: boolean | null = null;

function checkNVENCSupport(): boolean {
  // Return cached result if available
  if (nvencSupported !== null) {
    return nvencSupported;
  }
  
  // If GPU transcoding is disabled in config, skip all checks
  if (!config.stream.gpuTranscoding) {
    console.log('[VideoStreamer] GPU transcoding disabled via config');
    nvencSupported = false;
    return false;
  }
  
  try {
    // Check if NVIDIA GPU is available
    try {
      execSync('nvidia-smi --query-gpu=name --format=csv,noheader,nounits', { encoding: 'utf-8', stdio: 'pipe' });
      console.log('[VideoStreamer] NVIDIA GPU detected');
    } catch {
      console.warn('[VideoStreamer] NVIDIA GPU not detected or nvidia-smi not available');
      nvencSupported = false;
      return false;
    }
    
    // Check FFmpeg NVENC encoder support
    try {
      const result = execSync('ffmpeg -encoders 2>&1 | grep h264_nvenc', { encoding: 'utf-8', stdio: 'pipe' });
      if (result.includes('h264_nvenc')) {
        console.log('[VideoStreamer] FFmpeg NVENC support confirmed');
        nvencSupported = true;
        return true;
      }
    } catch {
      // grep returns non-zero if no match
    }
    
    console.warn('[VideoStreamer] FFmpeg does not have NVENC support');
    nvencSupported = false;
    return false;
  } catch (error) {
    console.warn('[VideoStreamer] Could not verify NVENC support:', (error as Error).message);
    nvencSupported = false;
    return false;
  }
}

// Initialize NVENC check on module load
setTimeout(() => {
  const hasNvenc = checkNVENCSupport();
  console.log(`[VideoStreamer] GPU transcoding: ${hasNvenc ? 'ENABLED (NVENC)' : 'DISABLED (CPU fallback)'}`);
}, 1000);

// Playback history file path
const HISTORY_FILE = join(process.cwd(), 'data', 'playback-history.json');

export interface VideoStreamSession {
  guildId: string;
  channelId: string;
  mediaItem: MediaItem;
  streamUrl: string;
  isPaused: boolean;
  isStopping: boolean; // Flag to track intentional stop (pause/seek)
  isPlaying: boolean; // Flag to track if stream actually started playing
  startedAt: number;
  currentTime: number;
  duration: number;
  volume: number;
  speed: number; // Playback speed multiplier (1.0 = normal, 1.5 = 1.5x, etc.)
  ffmpegCommand: any | null;
  pauseFFmpegCommand: any | null; // FFmpeg process for frozen frame during pause
  userId?: string;
  isExternal?: boolean; // Flag for external streams (YouTube, URLs)
  audioUrl?: string; // Separate audio URL for YouTube streams
  sessionId?: string; // Plex transcode session ID for reuse
  messageId?: string; // Discord message ID for embed updates
  textChannelId?: string; // Discord text channel ID for embed updates
  mediaUdp?: Awaited<ReturnType<import('@dank074/discord-video-stream').Streamer['joinVoice']>>;
  isMusic?: boolean; // Flag for music visualizer mode
  musicAudioPath?: string; // Path to audio file for music mode
  musicThumbnailPath?: string; // Path to thumbnail image for music mode
  musicArtist?: string; // Artist name for music overlay
  subtitlePath?: string; // Path to .srt subtitle file to burn in
}

// Store playback positions for resume functionality (ratingKey -> position in ms)
interface PlaybackHistoryEntry {
  position: number;
  updatedAt: number;
  title?: string;
}

let playbackHistory: Map<string, PlaybackHistoryEntry> = new Map();

// Status update timer
let statusUpdateTimer: NodeJS.Timeout | null = null;

// Function to set initial bot statuses (without position for Discord auto-tracking)
async function setInitialBotStatuses(session: VideoStreamSession): Promise<void> {
  try {
    // Format title based on media type
    let titleText = session.mediaItem.title;
    if (session.mediaItem.type === 'show' && session.mediaItem.parentIndex && session.mediaItem.index) {
      // TV show: "Show Name S01E02"
      titleText = `${session.mediaItem.grandparentTitle || session.mediaItem.title} S${String(session.mediaItem.parentIndex).padStart(2, '0')}E${String(session.mediaItem.index).padStart(2, '0')}`;
    } else if (session.mediaItem.type === 'episode') {
      // Individual episode: "Show Name S01E02: Episode Title"
      const showName = session.mediaItem.grandparentTitle || 'Unknown Show';
      const season = session.mediaItem.parentIndex || 0;
      const episode = session.mediaItem.index || 0;
      titleText = `${showName} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}: ${session.mediaItem.title}`;
    }
    // For movies, just use the title as-is
    
    // Update controller bot status (without position for Discord auto-tracking)
    const { getControllerBot } = await import('../controller/bot.js');
    const controllerBot = getControllerBot();
    if (controllerBot?.user) {
      await controllerBot.user.setPresence({
        status: 'online',
        activities: [{
          name: titleText,
          type: 0 // PLAYING
        }]
      });
    }
    
    // Update selfbot status (without position for Discord auto-tracking)
    const { client } = await import('../bot/client.js');
    if (client?.user) {
      await client.user.setActivity(titleText, { type: 'PLAYING' });
    }
    
    console.log(`[Status] Initial: ${titleText}`);
  } catch (error) {
    console.error('[Status] Failed to set initial bot statuses:', error);
  }
}

// Function to update bot statuses with position
async function updateBotStatuses(session: VideoStreamSession): Promise<void> {
  try {
    // Calculate current position
    const elapsed = Date.now() - session.startedAt;
    const currentPos = session.isPaused ? session.currentTime : session.currentTime + elapsed;
    
    // Format position as MM:SS / HH:MM:SS
    const formatTime = (ms: number): string => {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }
      return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
    };
    
    const currentPosStr = formatTime(currentPos);
    const durationStr = session.duration ? formatTime(session.duration) : 'Live';
    
    // Format title based on media type
    let titleText = session.mediaItem.title;
    if (session.mediaItem.type === 'show' && session.mediaItem.parentIndex && session.mediaItem.index) {
      // TV show: "Show Name S01E02"
      titleText = `${session.mediaItem.grandparentTitle || session.mediaItem.title} S${String(session.mediaItem.parentIndex).padStart(2, '0')}E${String(session.mediaItem.index).padStart(2, '0')}`;
    } else if (session.mediaItem.type === 'episode') {
      // Individual episode: "Show Name S01E02: Episode Title"
      const showName = session.mediaItem.grandparentTitle || 'Unknown Show';
      const season = session.mediaItem.parentIndex || 0;
      const episode = session.mediaItem.index || 0;
      titleText = `${showName} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}: ${session.mediaItem.title}`;
    }
    // For movies, just use the title as-is
    
    const statusText = `${titleText} (${currentPosStr}${session.duration ? '/' + durationStr : ''})`;
    
    // Update controller bot status (with position)
    const { getControllerBot } = await import('../controller/bot.js');
    const controllerBot = getControllerBot();
    if (controllerBot?.user) {
      await controllerBot.user.setPresence({
        status: 'online',
        activities: [{
          name: statusText,
          type: 0 // PLAYING
        }]
      });
    }
    
    // Update selfbot status (with position)
    const { client } = await import('../bot/client.js');
    if (client?.user) {
      await client.user.setActivity(statusText, { type: 'PLAYING' });
    }
    
    console.log(`[Status] Updated: ${statusText}`);
  } catch (error) {
    console.error('[Status] Failed to update bot statuses:', error);
  }
}

// Function to clear bot statuses
async function clearBotStatuses(): Promise<void> {
  try {
    // Clear controller bot status
    const { getControllerBot } = await import('../controller/bot.js');
    const controllerBot = getControllerBot();
    if (controllerBot?.user) {
      await controllerBot.user.setPresence({
        status: 'online',
        activities: [{
          name: '/help for commands',
          type: 2 // LISTENING
        }]
      });
    }
    
    // Clear selfbot status
    const { client } = await import('../bot/client.js');
    if (client?.user) {
      await client.user.setActivity(undefined);
    }
    
    console.log('[Status] Cleared bot statuses');
  } catch (error) {
    console.error('[Status] Failed to clear bot statuses:', error);
  }
}

// Start status update timer
function startStatusUpdateTimer(session: VideoStreamSession): void {
  // Clear existing timer
  if (statusUpdateTimer) {
    clearInterval(statusUpdateTimer);
  }
  
  // Set initial status without position (for Discord auto-tracking)
  setInitialBotStatuses(session);
  
  // Update with position every 15 seconds
  statusUpdateTimer = setInterval(() => {
    updateBotStatuses(session);
    updateEmbedMessage(session);
  }, 15000);
}

// Stop status update timer
function stopStatusUpdateTimer(): void {
  if (statusUpdateTimer) {
    clearInterval(statusUpdateTimer);
    statusUpdateTimer = null;
    clearBotStatuses();
  }
}

// Load playback history from disk
function loadPlaybackHistory(): void {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = readFileSync(HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      playbackHistory = new Map(Object.entries(parsed));
      console.log(`[PlaybackHistory] Loaded ${playbackHistory.size} entries from disk`);
    }
  } catch (error) {
    console.error('[PlaybackHistory] Failed to load:', error);
    playbackHistory = new Map();
  }
}

// Save playback history to disk
function persistPlaybackHistory(): void {
  try {
    // Ensure data directory exists
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      console.log('[PlaybackHistory] Created data directory');
    }
    
    const obj = Object.fromEntries(playbackHistory);
    writeFileSync(HISTORY_FILE, JSON.stringify(obj, null, 2));
    console.log(`[PlaybackHistory] Saved ${playbackHistory.size} entries to disk`);
  } catch (error) {
    console.error('[PlaybackHistory] Failed to save:', error);
  }
}

// Initialize on module load
loadPlaybackHistory();

// Update the embed message with current progress
async function updateEmbedMessage(session: VideoStreamSession): Promise<void> {
  if (!session.messageId || !session.textChannelId) return;
  
  try {
    // Import here to avoid circular dependency
    const { getControllerBot } = await import('../controller/bot.js');
    const controllerBot = getControllerBot();
    if (!controllerBot) return;
    
    const channel = controllerBot.channels.cache.get(session.textChannelId);
    if (!channel || !('messages' in channel)) return;
    
    const message = await channel.messages.fetch(session.messageId);
    if (!message || !message.editable) return;
    
    // Calculate current position
    const elapsed = Date.now() - session.startedAt;
    const currentPos = session.isPaused ? session.currentTime : session.currentTime + elapsed;
    const progress = Math.min((currentPos / session.duration) * 100, 100);
    
    // Format position as MM:SS / HH:MM:SS
    const formatTime = (ms: number): string => {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }
      return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
    };
    
    const currentFormatted = formatTime(currentPos);
    const totalFormatted = formatTime(session.duration);
    const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
    
    // Update embed
    const embed = message.embeds[0];
    if (embed) {
      // Create new embed with updated description
      const updatedEmbed = new EmbedBuilder({
        title: embed.title || undefined,
        url: embed.url || undefined,
        description: `**${session.mediaItem.title}**\n\n${progressBar} ${progress.toFixed(1)}%\n📍 ${currentFormatted} / ${totalFormatted}`,
        color: embed.color || undefined,
        thumbnail: embed.thumbnail || undefined,
        image: embed.image || undefined,
        footer: embed.footer || undefined,
        timestamp: embed.timestamp || undefined,
        fields: embed.fields || undefined,
        author: embed.author || undefined
      });
      
      // Update pause/play button
      const components = message.components;
      if (components.length > 0 && 'components' in components[0]) {
        const actionRow = components[0] as any;
        const pauseButton = actionRow.components.find((c: any) => c.customId === 'ctrl_pause');
        if (pauseButton) {
          pauseButton.setLabel(session.isPaused ? '▶️ Resume' : '⏸️ Pause');
          pauseButton.setEmoji(session.isPaused ? '▶️' : '⏸️');
        }
      }
      
      await message.edit({ embeds: [updatedEmbed], components });
    }
  } catch (error) {
    // Silently ignore errors - embed might have been deleted
  }
}

export function getPlaybackPosition(ratingKey: string): number | null {
  const history = playbackHistory.get(ratingKey);
  if (!history) return null;
  // Expire after 7 days
  if (Date.now() - history.updatedAt > 7 * 24 * 60 * 60 * 1000) {
    playbackHistory.delete(ratingKey);
    persistPlaybackHistory();
    return null;
  }
  return history.position;
}

export function savePlaybackPosition(ratingKey: string, position: number, title?: string): void {
  // Don't save if position is less than 30 seconds (likely a failed/aborted stream)
  if (position < 30000) {
    console.log(`[PlaybackHistory] Skipping save for ${ratingKey} - position too small: ${position}ms`);
    return;
  }
  console.log(`[PlaybackHistory] Saving ${ratingKey} at position ${position}ms`);
  playbackHistory.set(ratingKey, { position, updatedAt: Date.now(), title });
  persistPlaybackHistory();
}

export function clearPlaybackPosition(ratingKey: string): void {
  playbackHistory.delete(ratingKey);
  persistPlaybackHistory();
}

// Helper to kill all FFmpeg processes for a session
function killSessionFFmpeg(session: VideoStreamSession): void {
  if (session.ffmpegCommand) {
    try {
      session.ffmpegCommand.kill('SIGKILL');
      console.log('[VideoStreamer] Killed main FFmpeg process');
    } catch {
      // Ignore kill errors
    }
    session.ffmpegCommand = null;
  }
  
  if (session.pauseFFmpegCommand) {
    try {
      session.pauseFFmpegCommand.kill('SIGKILL');
      console.log('[VideoStreamer] Killed pause FFmpeg process');
    } catch {
      // Ignore kill errors
    }
    session.pauseFFmpegCommand = null;
  }


}

class VideoStreamer {
  public streamer: Streamer;
  private sessions: Map<string, VideoStreamSession> = new Map();

  constructor(client: Client) {
    this.streamer = new Streamer(client);
  }

  get client(): Client {
    return this.streamer.client;
  }

  getSession(guildId: string): VideoStreamSession | null {
    return this.sessions.get(guildId) || null;
  }

  isStreaming(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  private extractVideoId(url: string): string | null {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  getActiveSessions(): VideoStreamSession[] {
    return Array.from(this.sessions.values());
  }

  private async playNextInQueue(guildId: string, channelId: string, userId?: string, lastPlayedItem?: MediaItem): Promise<void> {
    // Check if the last played item was a music track - use the music queue + autoplay
    if (lastPlayedItem && lastPlayedItem.type === 'music') {
      const lastMusicItem = lastPlayedItem as import('../types/index.js').MusicMediaItem;

      // Track the last played video ID for recommendations
      const lastVideoId = this.extractVideoId(lastMusicItem.url);
      if (lastVideoId) {
        setLastPlayedVideoId(guildId, lastVideoId);
      }

      // Try next track from music queue first
      const nextTrack = popMusicQueue(guildId);
      if (nextTrack) {
        console.log(`[VideoStreamer] Music queue: auto-playing "${nextTrack.title}" by ${nextTrack.artist}`);
        try {
          const { downloadYouTubeMusic, findDownloadedMusicByUrl } = await import('../youtube/music-downloader.js');

          // Check cache first
          let downloaded = findDownloadedMusicByUrl(nextTrack.url);
          if (!downloaded) {
            console.log(`[VideoStreamer] Downloading next track: ${nextTrack.title}`);
            downloaded = await downloadYouTubeMusic(nextTrack.url);
          }

          if (!downloaded) {
            console.error(`[VideoStreamer] Failed to download next track: ${nextTrack.title}`);
            await this.playNextInQueue(guildId, channelId, userId, lastPlayedItem);
            return;
          }

          const mediaItem: import('../types/index.js').MusicMediaItem = {
            ratingKey: `music-${Date.now()}`,
            key: nextTrack.url,
            title: downloaded.title,
            artist: downloaded.artist,
            type: 'music',
            duration: downloaded.duration,
            thumb: downloaded.thumbnailUrl,
            url: nextTrack.url,
            audioPath: downloaded.audioPath,
            thumbnailPath: downloaded.thumbnailPath,
          };

          await this.startMusicStream(
            guildId, channelId, mediaItem,
            downloaded.audioPath, downloaded.thumbnailPath,
            downloaded.artist, userId, 0
          );
          return;
        } catch (err) {
          console.error('[VideoStreamer] Error auto-playing next music track:', err);
          await this.playNextInQueue(guildId, channelId, userId, lastPlayedItem);
          return;
        }
      }

      // Music queue empty - fetch autoplay recommendations if enabled
      if (lastVideoId && isAutoplayEnabled(guildId)) {
        console.log(`[VideoStreamer] Music queue empty, fetching recommendations for ${lastVideoId}`);
        try {
          const { getMusicRecommendations } = await import('../youtube/music-downloader.js');
          const recommendations = await getMusicRecommendations(lastVideoId, 5);
          if (recommendations.length > 0) {
            // Queue the rest, play the first
            addToMusicQueue(guildId, recommendations.slice(1));
            const firstRec = recommendations[0];
            console.log(`[VideoStreamer] Autoplay: "${firstRec.title}" by ${firstRec.artist}`);

            const { downloadYouTubeMusic, findDownloadedMusicByUrl } = await import('../youtube/music-downloader.js');
            let downloaded = findDownloadedMusicByUrl(firstRec.url);
            if (!downloaded) {
              downloaded = await downloadYouTubeMusic(firstRec.url);
            }

            if (downloaded) {
              const mediaItem: import('../types/index.js').MusicMediaItem = {
                ratingKey: `music-${Date.now()}`,
                key: firstRec.url,
                title: downloaded.title,
                artist: downloaded.artist,
                type: 'music',
                duration: downloaded.duration,
                thumb: downloaded.thumbnailUrl,
                url: firstRec.url,
                audioPath: downloaded.audioPath,
                thumbnailPath: downloaded.thumbnailPath,
              };
              await this.startMusicStream(
                guildId, channelId, mediaItem,
                downloaded.audioPath, downloaded.thumbnailPath,
                downloaded.artist, userId, 0
              );
              return;
            }
          }
        } catch (err) {
          console.error('[VideoStreamer] Error fetching autoplay recommendations:', err);
        }
      }

      console.log('[VideoStreamer] Music queue exhausted and no recommendations, stopping.');
      stopStatusUpdateTimer();
      return;
    }

    // Check if the last played item was a Plex TV episode - auto-play next episode
    if (lastPlayedItem && lastPlayedItem.type === 'episode') {
      console.log('[VideoStreamer] Last played was a Plex episode, checking for next episode...');
      
      try {
        const nextEpisode = await getNextEpisode(lastPlayedItem);
        
        if (nextEpisode) {
          const seasonNum = nextEpisode.parentIndex || 0;
          const episodeNum = nextEpisode.index || 0;
          const showName = nextEpisode.grandparentTitle || 'Unknown Show';
          
          console.log(`[VideoStreamer] Auto-playing next episode: ${showName} S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')} - ${nextEpisode.title}`);
          
          // Get stream URL for next episode
          const streamInfo = await plexClient.getDirectStreamUrl(nextEpisode.ratingKey);
          if (streamInfo) {
            // Clear saved position for next episode (start from beginning)
            clearPlaybackPosition(nextEpisode.ratingKey);
            
            // Start streaming the next episode
            await this.startStream(guildId, channelId, nextEpisode, streamInfo.url, 0, userId);
            return;
          } else {
            console.error('[VideoStreamer] Could not get stream URL for next episode');
          }
        } else {
          console.log('[VideoStreamer] No more episodes in this series');
        }
      } catch (error) {
        console.error('[VideoStreamer] Error getting next episode:', error);
      }
    }
    
    // Fall back to queue
    const nextItem = popQueue();
    if (!nextItem) {
      console.log('[VideoStreamer] Queue is empty, playback stopped');
      // Stop status updater when queue is empty
      stopStatusUpdateTimer();
      return;
    }

    console.log(`[VideoStreamer] Auto-playing next in queue: ${nextItem.title}`);

    try {
      // Handle YouTube queue items
      if (nextItem.type === 'youtube') {
        console.log('[VideoStreamer] Next item is YouTube video');
        
        // Create media item from queue entry
        const mediaItem: MediaItem = {
          ratingKey: nextItem.ratingKey,
          key: nextItem.ratingKey,
          title: nextItem.title,
          type: 'youtube',
          duration: nextItem.duration || 0,
          url: nextItem.url || '',
          filePath: nextItem.filePath,
          uploader: nextItem.uploader,
          viewCount: nextItem.viewCount,
          uploadDate: nextItem.uploadDate,
        };
        
        // Check if file exists
        if (nextItem.filePath) {
          const { existsSync } = await import('fs');
          if (existsSync(nextItem.filePath)) {
            await this.startLocalFile(guildId, channelId, mediaItem, nextItem.filePath, userId);
            return;
          }
        }
        
        // If no file, try to download
        if (nextItem.url) {
          console.log('[VideoStreamer] YouTube file not found, needs download. Skipping for now.');
          // Skip to next item - downloading should be handled by the controller
          await this.playNextInQueue(guildId, channelId, userId);
          return;
        }
        
        console.error('[VideoStreamer] YouTube item has no file or URL');
        await this.playNextInQueue(guildId, channelId, userId);
        return;
      }

      // Handle external stream queue items
      if (nextItem.type === 'external') {
        console.log('[VideoStreamer] Next item is external stream');
        
        if (!nextItem.url) {
          console.error('[VideoStreamer] External item has no URL');
          await this.playNextInQueue(guildId, channelId, userId);
          return;
        }
        
        const mediaItem: MediaItem = {
          ratingKey: nextItem.ratingKey,
          key: nextItem.ratingKey,
          title: nextItem.title,
          type: 'external',
          duration: nextItem.duration || 0,
          url: nextItem.url,
          streamType: nextItem.streamType,
        };
        
        await this.startExternalStream(guildId, channelId, mediaItem, nextItem.url, userId);
        return;
      }

      // Handle Plex items (movie, episode, etc.)
      const mediaItem = await plexClient.getMetadata(nextItem.ratingKey);
      if (!mediaItem) {
        console.error('[VideoStreamer] Could not find media item in Plex');
        // Try next item in queue
        await this.playNextInQueue(guildId, channelId, userId);
        return;
      }

      // Get stream URL
      const streamInfo = await plexClient.getDirectStreamUrl(nextItem.ratingKey);
      if (!streamInfo) {
        console.error('[VideoStreamer] Could not get stream URL');
        // Try next item in queue
        await this.playNextInQueue(guildId, channelId, userId);
        return;
      }

      // Check for saved position
      const savedPosition = getPlaybackPosition(nextItem.ratingKey);
      const startPosition = (savedPosition && savedPosition > 30000) ? savedPosition : 0;

      // Start streaming the next item
      await this.startStream(guildId, channelId, mediaItem, streamInfo.url, startPosition, userId);
    } catch (error) {
      console.error('[VideoStreamer] Error playing next in queue:', error);
      // Try next item in queue
      await this.playNextInQueue(guildId, channelId, userId);
    }
  }

  async startStream(
    guildId: string,
    channelId: string,
    mediaItem: MediaItem,
    streamUrl: string,
    startTimeMs = 0,
    userId?: string
  ): Promise<void> {
    await this.stopStream(guildId);

    // Always leave and rejoin voice to properly reset Discord Go Live stream
    // This ensures the Go Live connection is fresh, especially when transitioning between episodes
    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {
      // Ignore errors - may already be disconnected
    }
    
    // Delay to let Discord register the disconnect before rejoining
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('[VideoStreamer] Joining voice channel for stream...');
    const joinTimeout = 15000; // 15 seconds
    await Promise.race([
      this.streamer.joinVoice(guildId, channelId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`joinVoice timed out after ${joinTimeout / 1000}s`)), joinTimeout)
      ),
    ]);

    // Wait for voice connection to be fully ready and verify it
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!this.streamer.voiceConnection) {
      throw new Error('Voice connection is not established after joinVoice');
    }
    console.log('[VideoStreamer] Successfully joined voice channel');


    const session: VideoStreamSession = {
      guildId,
      channelId,
      mediaItem,
      streamUrl,
      isPaused: false,
      isStopping: false,
      isPlaying: false,
      startedAt: Date.now(),
      currentTime: startTimeMs,
      duration: mediaItem.duration || 0,
      volume: 100,
      speed: 1,
      ffmpegCommand: null,
      pauseFFmpegCommand: null,
      userId,
      isExternal: mediaItem.type === 'channel', // Treat Live TV channels as external streams
    };

    this.sessions.set(guildId, session);
    
    // Note: status update timer is started later, once the stream actually begins playing

    // Play Live TV channels as external streams to skip Plex transcoding
    if (mediaItem.type === 'channel') {
      console.log('[VideoStreamer] Playing Live TV channel as external stream');
      await this.playExternalStream(session, startTimeMs);
    } else {
      await this.playVideoStream(session, startTimeMs);
    }
  }

  async startLocalFile(
    guildId: string,
    channelId: string,
    mediaItem: MediaItem,
    filePath: string,
    userId?: string,
    startTimeMs = 0,
    subtitlePath?: string
  ): Promise<void> {
    console.log(`[VideoStreamer] startLocalFile called: guild=${guildId} channel=${channelId} file=${filePath}`);
    await this.stopStream(guildId);

    // Always leave and rejoin voice to properly reset Discord Go Live stream
    // This ensures the Go Live connection is fresh (matches startStream pattern)
    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {
      // Ignore errors - may already be disconnected
    }

    // Delay to let Discord register the disconnect before rejoining
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('[VideoStreamer] Joining voice channel for local file...');
    // Wrap joinVoice in a timeout to prevent hanging indefinitely
    const joinTimeout = 15000; // 15 seconds
    const mediaUdp = await Promise.race([
      this.streamer.joinVoice(guildId, channelId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`joinVoice timed out after ${joinTimeout / 1000}s`)), joinTimeout)
      ),
    ]);

    // Wait for voice connection to be fully ready and verify it
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!this.streamer.voiceConnection) {
      throw new Error('Voice connection is not established after joinVoice');
    }
    console.log('[VideoStreamer] Successfully joined voice channel');

    // Undeafen the bot to receive voice commands
    const guild = this.client.guilds.cache.get(guildId);
    if (guild) {
      guild.shard?.send({
        op: 4,
        d: {
          guild_id: guildId,
          channel_id: channelId,
          self_mute: false,
          self_deaf: false,
        }
      });
      console.log('[VideoStreamer] Bot undeafened - can now hear voice commands');
    }

    // Start voice listener if enabled
    if (config.voice.enabled) {
      await startVoiceListener(guildId);
    }

    const session: VideoStreamSession = {
      guildId,
      channelId,
      mediaItem,
      streamUrl: filePath, // Use file path as stream URL
      isPaused: false,
      isStopping: false,
      isPlaying: false,
      startedAt: Date.now(),
      currentTime: startTimeMs,
      duration: mediaItem.duration || 0,
      volume: 100,
      speed: 1,
      ffmpegCommand: null,
      pauseFFmpegCommand: null,
      userId,
      isExternal: true, // Treat local files as external streams
      audioUrl: undefined,
      subtitlePath,
      mediaUdp,
    };

    this.sessions.set(guildId, session);
    
    // Start status update timer
    startStatusUpdateTimer(session);

    // Start voice receiver if enabled
    if (config.voice.enabled) {
      startVoiceReceiver(guildId, channelId);
    }

    await this.playLocalFile(session, startTimeMs);
  }

  async startExternalStream(
    guildId: string,
    channelId: string,
    mediaItem: MediaItem,
    streamUrl: string,
    userId?: string,
    audioUrl?: string | null,
    subtitlePath?: string
  ): Promise<void> {
    console.log(`[VideoStreamer] startExternalStream called: guild=${guildId} channel=${channelId}`);
    await this.stopStream(guildId);

    // Always leave and rejoin voice to properly reset Discord Go Live stream
    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {
      // Ignore errors - may already be disconnected
    }

    // Delay to let Discord register the disconnect before rejoining
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('[VideoStreamer] Joining voice channel for external stream...');
    const joinTimeout = 15000; // 15 seconds
    const mediaUdp = await Promise.race([
      this.streamer.joinVoice(guildId, channelId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`joinVoice timed out after ${joinTimeout / 1000}s`)), joinTimeout)
      ),
    ]);

    // Wait for voice connection to be fully ready and verify it
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!this.streamer.voiceConnection) {
      throw new Error('Voice connection is not established after joinVoice');
    }
    console.log('[VideoStreamer] Successfully joined voice channel');


    // Undeafen the bot to receive voice commands
    // Send voice state update through Discord client
    const guild = this.client.guilds.cache.get(guildId);
    if (guild) {
      // Update voice state to undeafen
      guild.shard?.send({
        op: 4,
        d: {
          guild_id: guildId,
          channel_id: channelId,
          self_mute: false,
          self_deaf: false,
        }
      });
      console.log('[VideoStreamer] Bot undeafened - can now hear voice commands');
    }

    // Extract session ID from stream URL
    const urlObj = new URL(streamUrl);
    const sessionId = urlObj.searchParams.get('X-Plex-Session-Identifier') || 
                    urlObj.searchParams.get('session') || undefined;

    // Auto-download subtitles for YouTube URLs if not already provided
    let resolvedSubtitlePath = subtitlePath;
    const isYouTubeUrl = streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be') ||
                         (mediaItem as any).url?.includes('youtube.com') || (mediaItem as any).url?.includes('youtu.be');
    if (!resolvedSubtitlePath && isYouTubeUrl) {
      const ytUrl = (mediaItem as any).url || streamUrl;
      if (ytUrl.includes('youtube.com') || ytUrl.includes('youtu.be')) {
        try {
          const { downloadYouTubeSubtitles } = await import('../youtube/downloader.js');
          resolvedSubtitlePath = await downloadYouTubeSubtitles(ytUrl) ?? undefined;
          if (resolvedSubtitlePath) {
            console.log('[VideoStreamer] Auto-downloaded subtitles for YouTube stream:', resolvedSubtitlePath);
          }
        } catch (e) {
          console.warn('[VideoStreamer] Failed to auto-download subtitles:', e);
        }
      }
    }

    const session: VideoStreamSession = {
      guildId,
      channelId,
      mediaItem,
      streamUrl,
      isPaused: false,
      isStopping: false,
      isPlaying: false,
      startedAt: Date.now(),
      currentTime: 0,
      duration: mediaItem.duration || 0,
      volume: 100,
      speed: 1,
      ffmpegCommand: null,
      pauseFFmpegCommand: null,
      userId,
      isExternal: true,
      audioUrl: audioUrl || undefined,
      subtitlePath: resolvedSubtitlePath,
      sessionId,
      mediaUdp,
    };

    this.sessions.set(guildId, session);
    
    // Start status update timer
    startStatusUpdateTimer(session);

    // Start voice receiver if enabled
    if (config.voice.enabled) {
      startVoiceReceiver(guildId, channelId);
    }

    this.playExternalStream(session);
  }

  private async playLocalFile(session: VideoStreamSession, startTimeMs: number = 0): Promise<void> {
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));
    
    console.log(`[VideoStreamer] Encoding local file at ${width}x${height} (quality: ${height}p)`);

    try {
      const startTimeSec = Math.floor(startTimeMs / 1000);
      console.log('[VideoStreamer] Playing local file:', session.streamUrl);
      if (startTimeSec > 0) {
        console.log(`[VideoStreamer] Starting local file at ${startTimeSec}s`);
      }

      const volumeMultiplier = (session.volume / 100).toFixed(2);

      // Build FFmpeg args for local file input
      // Use multi-threaded decoding for CPU-intensive codecs like AV1
      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        '-threads', '0', // Auto-detect thread count for decoding (uses all cores)
        '-filter_threads', '0', // Multi-threaded filtering
        '-thread_queue_size', '512', // Larger queue to prevent buffer underruns
      ];

      ffmpegArgs.push('-i', session.streamUrl);

      // Add seek AFTER input for better compatibility with processed videos
      if (startTimeSec > 0) {
        // Validate seek position against video duration
        if (session.duration && startTimeSec > session.duration) {
          console.log(`[VideoStreamer] Seek position ${startTimeSec}s exceeds video duration ${session.duration}s, seeking to end`);
          ffmpegArgs.push('-ss', Math.max(0, session.duration - 5).toString()); // Seek to 5s before end
        } else {
          ffmpegArgs.push('-ss', startTimeSec.toString());
        }
      }

      // Video and audio output settings - maximum compatibility for processed videos
      // Force re-encoding to ensure H.264 compatibility with Discord
      // AV1 and other codecs are not supported by Discord video streaming
      
      // Adjust bitrate based on quality for optimal encoding
      const qualityBitrate = height >= 1080 ? config.stream.maxBitrate : 
                            height >= 720 ? Math.floor(config.stream.maxBitrate * 0.6) :
                            Math.floor(config.stream.maxBitrate * 0.4);
      
      const useGPU = checkNVENCSupport();

      // Build subtitle burn-in filter segment if a .srt file is available
      // FFmpeg subtitles filter needs colons and backslashes escaped in the path
      const subtitleFilter = (() => {
        if (!session.subtitlePath || !existsSync(session.subtitlePath)) return '';
        const escapedPath = session.subtitlePath
          .replace(/\\/g, '/')
          .replace(/:/g, '\\:');
        console.log(`[VideoStreamer] Burning subtitles from: ${session.subtitlePath}`);
        return `,subtitles='${escapedPath}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,MarginV=20'`;
      })();
      
      if (useGPU) {
        // NVIDIA NVENC GPU encoding - offloads encoding to GPU, much lower CPU usage
        // Note: Using software decode + NVENC encode (simpler & more compatible than full hwaccel)
        console.log(`[VideoStreamer] Using NVIDIA NVENC for H.264 encoding at ${qualityBitrate}k bitrate`);
        const gopSize = config.stream.frameRate * 2; // GOP = 2 seconds
        ffmpegArgs.push(
          '-map', '0:v:0', // Explicit first video stream only (skip PNG thumbnails)
          '-map', '0:a:0', // Explicit first audio stream only
          '-c:v', 'h264_nvenc',
          '-preset', 'p4', // p4 = medium quality/speed balance for streaming
          '-profile:v', 'high',
          '-level', '4.2', // Level 4.2 for better compatibility
          '-tune', 'll', // Low latency for streaming
          '-rc', 'cbr', // Constant bitrate for stable streaming
          '-bf', '0', // No B-frames - required for RTP/Discord streaming
          '-pix_fmt', 'yuv420p',
          '-r', String(config.stream.frameRate),
          '-g', String(gopSize),
          '-keyint_min', String(gopSize), // Match keyint_min to GOP size
          '-b:v', `${qualityBitrate}k`,
          '-maxrate', `${qualityBitrate}k`,
          '-bufsize', `${qualityBitrate * 2}k`,
          '-vf', session.speed !== 1
            ? `setpts=PTS/${session.speed},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`
            : `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`,
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-ar', '48000',
          '-ac', '2',
          '-af', session.speed !== 1
            ? `volume=${volumeMultiplier},atempo=${session.speed}`
            : `volume=${volumeMultiplier}`,
          '-vsync', 'cfr', // Force constant frame rate - Discord drops frames with VFR
          '-map_metadata', '-1', // Strip metadata to avoid NUT demuxer warnings
          '-f', 'nut',
          '-'
        );
      } else {
        // CPU encoding fallback (libx264)
        console.log(`[VideoStreamer] Using CPU encoding (libx264) at ${qualityBitrate}k bitrate`);
        const gopSize = config.stream.frameRate * 2; // GOP = 2 seconds (60 frames at 30fps)
        
        // NOTE: Do NOT use ultrafast - it causes bitrate spikes and stuttering!
        ffmpegArgs.push(
          '-map', '0:v:0', // Explicit first video stream only (skip PNG thumbnails)
          '-map', '0:a:0', // Explicit first audio stream only
          '-c:v', 'libx264',
          '-preset', 'superfast', // superfast prevents bitrate spikes (ultrafast causes stutter!)
          '-profile:v', 'high',
          '-level', '4.2',
          '-tune', 'zerolatency',
          '-bf', '0', // No B-frames - required for RTP/Discord streaming
          '-pix_fmt', 'yuv420p',
          '-r', String(config.stream.frameRate),
          '-g', String(gopSize),
          '-keyint_min', String(gopSize), // Match keyint_min to GOP size
          '-b:v', `${qualityBitrate}k`,
          '-maxrate', `${qualityBitrate}k`,
          '-bufsize', `${qualityBitrate * 2}k`,
          '-vf', session.speed !== 1
            ? `setpts=PTS/${session.speed},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`
            : `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`,
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-ar', '48000',
          '-ac', '2',
          '-af', session.speed !== 1
            ? `volume=${volumeMultiplier},atempo=${session.speed}`
            : `volume=${volumeMultiplier}`,
          '-vsync', 'cfr', // Force constant frame rate - Discord drops frames with VFR
          '-map_metadata', '-1', // Strip metadata to avoid NUT demuxer warnings
          '-f', 'nut',
          '-'
        );
      }

      if (session.speed !== 1) {
        console.log(`[VideoStreamer] Playing at ${session.speed}x speed`);
      }
      console.log('[VideoStreamer] Starting FFmpeg for local file...');
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      session.ffmpegCommand = ffmpeg;

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        // Always show errors, but only show other logs if enabled
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Fatal')) {
          console.error('[FFmpeg]', msg);
        } else if (msg.includes('codec_id') && msg.includes('225')) {
          // AV1 codec detected - log why we need to re-encode
          console.warn('[FFmpeg] AV1 codec detected - re-encoding required for Discord compatibility');
        } else if (msg.includes('frame=') && msg.includes('fps=')) {
          // Debug frame processing to detect video freezing
          if (config.stream.showFFmpegLogs) {
            console.log('[FFmpeg]', msg.trim());
          }
        } else if (msg.includes('dropping') || msg.includes('delay')) {
          // Log frame drops or delays which could cause freezing
          console.warn('[FFmpeg] Frame issue:', msg.trim());
        } else if (config.stream.showFFmpegLogs && !msg.includes('size=')) {
          console.error('[FFmpeg]', msg);
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('[VideoStreamer] FFmpeg spawn error:', err.message);
      });

      ffmpeg.on('exit', (code) => {
        // If we're intentionally stopping (seek/pause/stop), don't do anything
        if (session.isStopping) {
          console.log('[VideoStreamer] FFmpeg exited during intentional stop (code:', code, ')');
          return;
        }
        
        if (code !== 0 && code !== null) {
          console.log('[VideoStreamer] FFmpeg exited with code:', code);
          if (code === 255 && startTimeSec > 0) {
            console.error('[VideoStreamer] FFmpeg exit code 255 - seek error, retrying without seek');
            // Retry without seek if it was a seek failure
            setTimeout(() => {
              console.log('[VideoStreamer] Retrying local file playback from start');
              this.playLocalFile(session, 0);
            }, 1000);
          }
        } else if (code === 0) {
          // FFmpeg exited normally (video finished)
          console.log('[VideoStreamer] FFmpeg exited normally - video finished');
          console.log('[VideoStreamer] Local file playback finished');
          const finishedMediaItem = session.mediaItem;
          killSessionFFmpeg(session); // Kill any lingering FFmpeg processes
          this.sessions.delete(session.guildId);
          
          // Auto-play next episode (for Plex TV) or next item in queue
          this.playNextInQueue(session.guildId, session.channelId, session.userId, finishedMediaItem);
        }
      });

      console.log('[VideoStreamer] Starting Go Live stream (local file)...');
      
      session.isPlaying = true;
      session.startedAt = Date.now();
      
      if (session.userId) {
        updateWatchDeck(session.mediaItem, 0, session.userId);
      }

      // Register stream for web viewing
      const { registerWebStream } = await import('../web/server.js');
      registerWebStream(session.guildId, session, session.streamUrl);

      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
        format: 'nut',
      });

      // Only handle completion if not intentionally stopping (seek/pause/stop)
      if (!session.isStopping) {
        console.log('[VideoStreamer] Local file playback finished (stream ended)');
        // Note: actual cleanup happens in FFmpeg exit handler
      }
    } catch (error) {
      if (!session.isStopping && error instanceof Error && !error.message.includes('abort')) {
        console.error('[VideoStreamer] Local file error:', error);
      }
    }
  }

  private async playExternalStream(session: VideoStreamSession, startTimeMs: number = 0): Promise<void> {
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));
    let streamlinkProcess: ReturnType<typeof spawn> | null = null;

    try {
      const startTimeSec = Math.floor(startTimeMs / 1000);
      console.log('[VideoStreamer] External stream URL:', session.streamUrl.substring(0, 100) + '...');
      if (session.audioUrl) {
        console.log('[VideoStreamer] Separate audio URL:', session.audioUrl.substring(0, 100) + '...');
      }
      if (startTimeSec > 0) {
        console.log(`[VideoStreamer] Starting external stream at ${startTimeSec}s`);
      }

      const volumeMultiplier = (session.volume / 100).toFixed(2);

      // Check if this is a problematic stream that needs streamlink
      const needsStreamlink = session.streamUrl.includes('.json') || 
                              session.streamUrl.includes('.svg') || 
                              session.streamUrl.includes('.php') ||
                              session.streamUrl.includes('.txt') ||
                              session.streamUrl.includes('.js');

      let ffmpegArgs: string[];

      if (needsStreamlink) {
        console.log('[VideoStreamer] Using custom HLS fetcher for problematic stream...');
        
        // Use custom HLS fetcher that downloads segments directly
        const { createHLSFetcherProcess } = await import('./hls-fetcher.js');
        streamlinkProcess = createHLSFetcherProcess(session.streamUrl);

        // Build FFmpeg args to read MPEG-TS from stdin
        ffmpegArgs = [
          '-hide_banner',
          '-loglevel', 'error',
          '-threads', '0', // Multi-threaded decoding
          '-filter_threads', '0', // Multi-threaded filtering
          '-f', 'mpegts', // Raw MPEG-TS input
          '-i', 'pipe:0', // Read from stdin
        ];
      } else {
        // Build FFmpeg args - handle separate audio stream for YouTube
        ffmpegArgs = [
          '-hide_banner',
          '-loglevel', 'error',
          '-threads', '0', // Multi-threaded decoding
          '-filter_threads', '0', // Multi-threaded filtering
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
        ];
        
        // Add seek before input for better performance
        if (startTimeSec > 0) {
          ffmpegArgs.push('-ss', startTimeSec.toString());
        }
        
        ffmpegArgs.push('-i', session.streamUrl);
      }

      // Add separate audio input if provided (YouTube separates video/audio)
      if (session.audioUrl) {
        ffmpegArgs.push(
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
        );
        
        // Add seek for audio too
        if (startTimeSec > 0) {
          ffmpegArgs.push('-ss', startTimeSec.toString());
        }
        
        ffmpegArgs.push('-i', session.audioUrl);
      }

      // Map video from first input, audio from second (or first if no separate audio)
      const useGPU = checkNVENCSupport();
      const gopSize = config.stream.frameRate * 2; // GOP = 2 seconds

      // Build subtitle burn-in filter for external streams
      const subtitleFilter = (() => {
        if (!session.subtitlePath || !existsSync(session.subtitlePath)) return '';
        const escapedPath = session.subtitlePath
          .replace(/\\/g, '/')
          .replace(/:/g, '\\:');
        console.log(`[VideoStreamer] Burning subtitles from: ${session.subtitlePath}`);
        return `,subtitles='${escapedPath}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,MarginV=20'`;
      })();
      
      if (useGPU) {
        // NVIDIA NVENC GPU encoding for external streams
        console.log(`[VideoStreamer] Using NVIDIA NVENC for external stream encoding`);
        ffmpegArgs.push(
          '-map', '0:v:0',
          '-map', session.audioUrl ? '1:a:0' : '0:a:0',
          '-c:v', 'h264_nvenc',
          '-preset', 'p4', // p4 = medium quality/speed balance
          '-profile:v', 'high',
          '-level', '4.2',
          '-tune', 'll', // Low latency
          '-rc', 'cbr',
          '-bf', '0', // No B-frames - required for RTP/Discord streaming
          '-pix_fmt', 'yuv420p',
          '-r', String(config.stream.frameRate),
          '-g', String(gopSize),
          '-keyint_min', String(gopSize), // Match keyint_min to GOP size
          '-b:v', `${config.stream.maxBitrate}k`,
          '-maxrate', `${config.stream.maxBitrate}k`,
          '-bufsize', `${config.stream.maxBitrate * 2}k`,
          '-vf', session.speed !== 1
            ? `setpts=PTS/${session.speed},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`
            : `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`,
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-ar', '48000',
          '-ac', '2',
          '-af', session.speed !== 1
            ? `volume=${volumeMultiplier},atempo=${session.speed}`
            : `volume=${volumeMultiplier}`,
          '-vsync', 'cfr', // Force constant frame rate - Discord drops frames with VFR
          '-map_metadata', '-1', // Strip metadata to avoid NUT demuxer warnings
          '-f', 'nut',
          '-'
        );
      } else {
        // CPU encoding fallback
        console.log(`[VideoStreamer] Using CPU encoding for external stream`);
        ffmpegArgs.push(
          '-map', '0:v:0',
          '-map', session.audioUrl ? '1:a:0' : '0:a:0',
          '-c:v', 'libx264',
          '-preset', 'superfast', // superfast prevents bitrate spikes (ultrafast causes stutter!)
          '-profile:v', 'high',
          '-level', '4.2',
          '-tune', 'zerolatency',
          '-bf', '0', // No B-frames - required for RTP/Discord streaming
          '-pix_fmt', 'yuv420p',
          '-r', String(config.stream.frameRate),
          '-g', String(gopSize),
          '-keyint_min', String(gopSize), // Match keyint_min to GOP size
          '-b:v', `${config.stream.maxBitrate}k`,
          '-maxrate', `${config.stream.maxBitrate}k`,
          '-bufsize', `${config.stream.maxBitrate * 2}k`,
          '-vf', session.speed !== 1
            ? `setpts=PTS/${session.speed},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`
            : `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${subtitleFilter}`,
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-ar', '48000',
          '-ac', '2',
          '-af', session.speed !== 1
            ? `volume=${volumeMultiplier},atempo=${session.speed}`
            : `volume=${volumeMultiplier}`,
          '-vsync', 'cfr', // Force constant frame rate - Discord drops frames with VFR
          '-map_metadata', '-1', // Strip metadata to avoid NUT demuxer warnings
          '-f', 'nut',
          '-'
        );
      }

      if (session.speed !== 1) {
        console.log(`[VideoStreamer] Playing external stream at ${session.speed}x speed`);
      }
      console.log('[VideoStreamer] Starting FFmpeg for external stream...');
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      session.ffmpegCommand = ffmpeg;

      // If using streamlink, pipe its output to FFmpeg
      if (streamlinkProcess) {
        if (streamlinkProcess.stdout) {
          streamlinkProcess.stdout.pipe(ffmpeg.stdin);
        }
        
        if (streamlinkProcess.stderr) {
          streamlinkProcess.stderr.on('data', (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) {
              console.log(msg); // Show all HLS fetcher output
            }
          });
        }
        
        streamlinkProcess.on('error', (err: Error) => {
          console.error('[VideoStreamer] Streamlink spawn error:', err.message);
        });
        
        streamlinkProcess.on('exit', (code: number | null) => {
          if (code !== 0 && code !== null) {
            console.log('[VideoStreamer] Streamlink exited with code:', code);
          }
        });
      }

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        // Always show errors, but only show other logs if enabled
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Fatal')) {
          console.error('[FFmpeg]', msg);
        } else if (config.stream.showFFmpegLogs && !msg.includes('frame=') && !msg.includes('size=')) {
          console.error('[FFmpeg]', msg);
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('[VideoStreamer] FFmpeg spawn error:', err.message);
      });

      ffmpeg.on('exit', (code) => {
        // If we're intentionally stopping (seek/pause/stop), don't do anything
        if (session.isStopping) {
          console.log('[VideoStreamer] FFmpeg (external) exited during intentional stop (code:', code, ')');
          return;
        }
        
        if (code !== 0 && code !== null) {
          console.log('[VideoStreamer] FFmpeg exited with code:', code);
        } else if (code === 0) {
          console.log('[VideoStreamer] External playback finished (FFmpeg exit)');
          const finishedMediaItem = session.mediaItem;
          killSessionFFmpeg(session); // Kill any lingering FFmpeg processes
          this.sessions.delete(session.guildId);
          this.playNextInQueue(session.guildId, session.channelId, session.userId, finishedMediaItem);
        }
      });

      console.log('[VideoStreamer] Starting Go Live stream (external)...');
      
      session.isPlaying = true;
      session.startedAt = Date.now();
      
      if (session.userId) {
        updateWatchDeck(session.mediaItem, 0, session.userId);
      }

      // Register stream for web viewing
      const { registerWebStream } = await import('../web/server.js');
      registerWebStream(session.guildId, session, session.streamUrl);

      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
        format: 'nut',
      });

      // Clean up streamlink process if it exists
      if (streamlinkProcess && !streamlinkProcess.killed) {
        streamlinkProcess.kill();
      }
      
      // Only log if not intentionally stopping (seek/pause/stop)
      if (!session.isStopping) {
        console.log('[VideoStreamer] External playback finished (stream ended)');
        // Note: actual cleanup happens in FFmpeg exit handler
      }
    } catch (error) {
      if (!session.isStopping && error instanceof Error && !error.message.includes('abort')) {
        console.error('[VideoStreamer] External stream error:', error);
      }
      
      // Clean up streamlink process on error
      if (streamlinkProcess && !streamlinkProcess.killed) {
        streamlinkProcess.kill();
      }
    }
  }

  private async playVideoStream(session: VideoStreamSession, startTimeMs = 0, isResume = false): Promise<void> {
    const startTimeSec = Math.floor(startTimeMs / 1000);
    
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));

    try {
      // For Live TV channels, use the existing stream URL directly
      let freshStreamInfo;
      if (session.mediaItem.type === 'channel') {
        console.log('[VideoStreamer] Using Live TV channel URL directly');
        freshStreamInfo = { url: session.streamUrl };
      } else if (isResume && session.streamUrl) {
        // On resume, try to reuse existing stream URL first (transcode might still be running)
        console.log('[VideoStreamer] Resuming with existing stream URL...');
        freshStreamInfo = { url: session.streamUrl };
      } else {
        // Get a fresh stream URL for new playback
        console.log('[VideoStreamer] Getting fresh stream URL...');
        freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
        if (!freshStreamInfo) {
          throw new Error('Failed to get stream URL from Plex');
        }
        
        // Update session with fresh URL and extract session ID
        session.streamUrl = freshStreamInfo.url;
        const urlObj = new URL(freshStreamInfo.url);
        session.sessionId = urlObj.searchParams.get('X-Plex-Session-Identifier') || 
                          urlObj.searchParams.get('session') || undefined;
        
        console.log('[VideoStreamer] Fresh Stream URL:', session.streamUrl.substring(0, 100) + '...');
      }
      
      // Initialize Plex session by fetching the m3u8 first
      // This tells Plex to start the transcode session
      console.log('[VideoStreamer] Initializing Plex transcode session...');
      let initResponse = await fetch(session.streamUrl, {
        headers: {
          'Accept': '*/*',
          'X-Plex-Client-Identifier': config.plex.clientIdentifier,
          'X-Plex-Product': 'Plex Web',
          'X-Plex-Version': '4.0',
          'X-Plex-Platform': 'Chrome',
          'X-Plex-Device': 'Linux',
        }
      });
      
      // If we get a 400 error, try stopping existing sessions and retry
      if (!initResponse.ok && initResponse.status === 400) {
        console.log('[VideoStreamer] Got 400 error, cleaning up existing sessions and retrying...');
        await plexClient.stopTranscodeSession();
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Get a fresh URL after cleanup
        freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
        if (freshStreamInfo) {
          session.streamUrl = freshStreamInfo.url;
          const urlObj = new URL(freshStreamInfo.url);
          session.sessionId = urlObj.searchParams.get('X-Plex-Session-Identifier') || 
                            urlObj.searchParams.get('session') || undefined;
        }
        
        // Retry initialization
        initResponse = await fetch(session.streamUrl, {
          headers: {
            'Accept': '*/*',
            'X-Plex-Client-Identifier': config.plex.clientIdentifier,
            'X-Plex-Product': 'Plex Web',
            'X-Plex-Version': '4.0',
            'X-Plex-Platform': 'Chrome',
            'X-Plex-Device': 'Linux',
          }
        });
      }
      
      if (!initResponse.ok) {
        throw new Error(`Failed to initialize Plex session: ${initResponse.status} ${initResponse.statusText}`);
      }
      
      const m3u8Content = await initResponse.text();
      console.log('[VideoStreamer] Session initialized, m3u8:', m3u8Content.substring(0, 200));
      
      // Extract the actual stream URL from m3u8 (it's relative)
      const lines = m3u8Content.split('\n');
      const streamPath = lines.find(l => l.endsWith('.m3u8') && !l.startsWith('#'));
      
      let actualStreamUrl = session.streamUrl;
      if (streamPath) {
        // Convert relative path to absolute URL
        const baseUrl = session.streamUrl.split('?')[0].replace('/start.m3u8', '');
        actualStreamUrl = `${config.plex.url}/video/:/transcode/universal/${streamPath}?X-Plex-Token=${config.plex.token}`;
        console.log('[VideoStreamer] Using stream URL:', actualStreamUrl.substring(0, 100) + '...');
      }

      // Build headers string for FFmpeg
      const headers = [
        'Accept: */*',
        'X-Plex-Client-Identifier: ' + config.plex.clientIdentifier,
        'X-Plex-Product: Plex Web',
        'X-Plex-Version: 4.0',
        'X-Plex-Platform: Chrome',
        'X-Plex-Device: Linux',
        'X-Plex-Token: ' + config.plex.token,
      ].join('\r\n') + '\r\n';

      // Plex already transcodes to H264 at our target resolution/bitrate,
      // so we just copy the video stream and only re-encode audio to Opus.
      // This eliminates the CPU-intensive double-encode that causes frame drops.
      const volumeMultiplier = (session.volume / 100).toFixed(2);

      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        // HTTP headers for Plex
        '-headers', headers,
        // HLS input options
        '-reconnect', '1',
        '-reconnect_streamed', '1', 
        '-reconnect_delay_max', '5',
        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,hls',
      ];

      if (startTimeSec > 0) {
        ffmpegArgs.push('-ss', startTimeSec.toString());
      }

      ffmpegArgs.push(
        '-i', actualStreamUrl,
        // Explicit stream selection
        '-map', '0:v:0',
        '-map', '0:a:0',
        // Video: copy directly from Plex (already H264 at target resolution)
        '-c:v', 'copy',
        // Audio: re-encode to Opus for Discord
        '-af', `volume=${volumeMultiplier}`,
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2',
        // Output format
        '-map_metadata', '-1',
        '-f', 'nut',
        'pipe:1'
      );

      console.log('[VideoStreamer] Starting FFmpeg with HLS input...');
      
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      session.ffmpegCommand = ffmpeg;

      ffmpeg.stderr.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('frame=')) {
          console.error('[FFmpeg]', msg);
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('[VideoStreamer] FFmpeg spawn error:', err.message);
      });

      ffmpeg.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.log('[VideoStreamer] FFmpeg exited with code:', code);
        }
      });

      console.log('[VideoStreamer] Starting Go Live stream...');
      
      // Mark as actually playing now and start status updates
      session.isPlaying = true;
      startStatusUpdateTimer(session);
      session.startedAt = Date.now(); // Reset start time to when stream actually begins
      
      // Update watch deck
      if (session.userId) {
        updateWatchDeck(session.mediaItem, startTimeMs, session.userId);
      }

      // Register stream for web viewing (web will do its own transcode)
      const { registerWebStream } = await import('../web/server.js');
      registerWebStream(session.guildId, session, actualStreamUrl);

      // Pass the FFmpeg stdout stream to playStream
      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
        format: 'nut',
      });

      console.log('[VideoStreamer] Playback finished');
      // Only delete session if not intentionally stopped (pause/seek)
      if (!session.isStopping) {
        // Save position for resume later (only if actually played)
        if (session.isPlaying) {
          savePlaybackPosition(session.mediaItem.ratingKey, this.getCurrentTime(session.guildId));
        }
        const finishedMediaItem = session.mediaItem;
        killSessionFFmpeg(session); // Kill any lingering FFmpeg processes
        this.sessions.delete(session.guildId);
        
        // Auto-play next episode (for Plex TV) or next item in queue
        await this.playNextInQueue(session.guildId, session.channelId, session.userId, finishedMediaItem);
      }
    } catch (error) {
      // Only log error if not intentionally stopped
      if (!session.isStopping && error instanceof Error && !error.message.includes('abort')) {
        console.error('[VideoStreamer] Stream error:', error);
      }
      // Only delete session if not intentionally stopped
      if (!session.isStopping) {
        // Only save position if stream actually played
        if (session.isPlaying) {
          savePlaybackPosition(session.mediaItem.ratingKey, this.getCurrentTime(session.guildId));
        }
        killSessionFFmpeg(session); // Kill any lingering FFmpeg processes
        this.sessions.delete(session.guildId);
      }
    }
  }

  async stopStream(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);

    if (session) {
      // Get current position BEFORE stopping anything
      const currentPosition = session.isPlaying ? this.getCurrentTime(guildId) : 0;
      console.log(`[VideoStreamer] Stopping stream, position: ${currentPosition}ms, isPlaying: ${session.isPlaying}`);
      
      // Stop voice listener if running
      if (config.voice.enabled) {
        stopVoiceListener(guildId);
        stopVoiceReceiver(guildId);
      }
      
      // Stop Plex transcode FIRST (before killing FFmpeg) - only for Plex streams
      if (!session.isExternal) {
        // Send timeline update to Plex with stopped state
        await plexClient.updateTimeline(
          session.mediaItem.ratingKey,
          'stopped',
          currentPosition,
          session.duration
        );
        await plexClient.stopTranscodeSession(session.sessionId);
      }
      
      // Kill all FFmpeg processes
      killSessionFFmpeg(session);

      // Save position AFTER stopping (only if actually played)
      if (session.isPlaying && currentPosition > 0) {
        savePlaybackPosition(session.mediaItem.ratingKey, currentPosition);
      }

      // Unregister from web server
      const { unregisterWebStream } = await import('../web/server.js');
      unregisterWebStream(guildId);

      // Remove session
      this.sessions.delete(guildId);
      
      // Stop status update timer
      stopStatusUpdateTimer();
    }

    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {
      // Ignore disconnect errors
    }
  }

  async seekStream(guildId: string, timeMs: number): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    // Check if stream has already ended
    if (!session.isPlaying && !session.isPaused) {
      console.log('[VideoStreamer] Cannot seek - stream not active');
      return false;
    }

    // For external streams (YouTube, URLs), use FFmpeg -ss for seeking
    // But check if it's actually a local file first
    const isLocalFile = session.streamUrl.startsWith('/') || session.streamUrl.startsWith('./') || session.streamUrl.includes('downloads/');
    
    if (session.isExternal && !isLocalFile) {
      console.log(`[VideoStreamer] Seeking external stream to ${Math.floor(timeMs / 1000)}s`);
      session.currentTime = timeMs;
      session.startedAt = Date.now();
      session.isStopping = true;

      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGTERM');
        } catch {
          // Ignore
        }
      }

      // Stop the current stream
      try {
        this.streamer.stopStream();
      } catch {
        // Ignore
      }

      // Wait for FFmpeg to stop
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Note: We're already in the voice channel, no need to rejoin
      await this.playExternalStream(session, timeMs);
      
      // Wait for old demuxer to fully close before clearing isStopping
      // This prevents the old stream's "end of stream" from triggering cleanup
      await new Promise(resolve => setTimeout(resolve, 4000));
      session.isStopping = false;
      return true;
    }

    // For local files (including music), use appropriate player
    if (isLocalFile) {
      console.log(`[VideoStreamer] Seeking local file to ${Math.floor(timeMs / 1000)}s`);
      session.currentTime = timeMs;
      session.startedAt = Date.now();
      session.isStopping = true;

      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGTERM');
        } catch {
          // Ignore
        }
      }

      // Stop the current stream
      try {
        this.streamer.stopStream();
      } catch {
        // Ignore
      }

      // Wait for FFmpeg to stop
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Note: We're already in the voice channel, no need to rejoin
      if (session.isMusic) {
        await this.playMusicVisualizer(session, timeMs);
      } else {
        await this.playLocalFile(session, timeMs);
      }
      
      // Wait for old demuxer to fully close before clearing isStopping
      // This prevents the old stream's "end of stream" from triggering cleanup
      await new Promise(resolve => setTimeout(resolve, 4000));
      session.isStopping = false;
      return true;
    }

    // For Plex streams: Try HLS offset seeking first (no new session needed)
    // Note: This only works if we already have an active session URL (not start.m3u8)
    if (session.sessionId && timeMs > 0 && session.streamUrl.includes('/session/')) {
      console.log('[VideoStreamer] Using HLS offset seeking with existing session');
      
      // Use the existing session URL and add offset parameter
      const url = new URL(session.streamUrl);
      url.searchParams.set('offset', String(timeMs));
      
      session.currentTime = timeMs;
      session.startedAt = Date.now();
      session.isStopping = true;
      
      // Kill current FFmpeg
      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGTERM');
        } catch {
          // Ignore
        }
      }
      
      // Stop Discord stream
      try {
        this.streamer.stopStream();
      } catch {
        // Ignore
      }
      
      // Wait for FFmpeg to stop
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Restart with the offset URL directly (don't call playVideoStream which would create new session)
      session.isStopping = false;
      
      // Build FFmpeg args directly with the offset URL
      const height = config.stream.defaultQuality;
      const width = Math.round(height * (16 / 9));
      const volumeMultiplier = (session.volume / 100).toFixed(2);
      const frameRate = config.stream.frameRate;
      const gopSize = frameRate * 2;
      
      const headers = [
        'Accept: */*',
        'X-Plex-Client-Identifier: ' + config.plex.clientIdentifier,
        'X-Plex-Product: Plex Web',
        'X-Plex-Version: 4.0',
        'X-Plex-Platform: Chrome',
        'X-Plex-Device: Linux',
        'X-Plex-Token: ' + config.plex.token,
      ].join('\r\n') + '\r\n';
      
      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        '-headers', headers,
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,hls',
        '-i', url.toString(),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-bf', '0', // No B-frames - required for RTP/Discord streaming
        '-b:v', `${config.stream.maxBitrate}k`,
        '-maxrate', `${Math.round(config.stream.maxBitrate * 1.5)}k`,
        '-bufsize', `${config.stream.maxBitrate * 2}k`,
        '-vf', `scale=${width}:${height}`,
        '-r', frameRate.toString(),
        '-g', gopSize.toString(),
        '-pix_fmt', 'yuv420p',
        '-af', `volume=${volumeMultiplier},speechnorm=e=6:r=0.001:l=1`,
        '-c:a', 'libopus',
        '-b:a', '320k',
        '-ar', '48000',
        '-ac', '2',
        '-map_metadata', '-1', // Strip metadata to avoid NUT demuxer warnings
        '-f', 'nut',
        'pipe:1'
      ];
      
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      session.ffmpegCommand = ffmpeg;
      
      ffmpeg.stderr.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('frame=')) {
          console.error('[FFmpeg]', msg);
        }
      });
      
      ffmpeg.on('error', (err) => {
        console.error('[VideoStreamer] FFmpeg spawn error:', err.message);
      });
      
      ffmpeg.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.log('[VideoStreamer] FFmpeg exited with code:', code);
        }
      });
      
      session.isPlaying = true;
      session.startedAt = Date.now();
      
      // Register for web viewing
      const { registerWebStream } = await import('../web/server.js');
      registerWebStream(session.guildId, session, url.toString());
      
      // Start streaming
      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
        format: 'nut',
      });
      
      return true;
    }

    // Fallback: create new Plex session
    console.log('[VideoStreamer] Creating new Plex session for seek');
    session.currentTime = timeMs;
    session.startedAt = Date.now();
    session.isStopping = true;

    if (session.ffmpegCommand) {
      try {
        session.ffmpegCommand.kill('SIGTERM');
      } catch {
        // Ignore
      }
    }

    // Stop the current stream first
    try {
      this.streamer.stopStream();
    } catch {
      // Ignore
    }

    // Wait a bit for FFmpeg to fully stop
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
    if (freshStreamInfo) {
      session.streamUrl = freshStreamInfo.url;
      // Extract new session ID
      const urlObj = new URL(freshStreamInfo.url);
      session.sessionId = urlObj.searchParams.get('X-Plex-Session-Identifier') || 
                        urlObj.searchParams.get('session') || undefined;
    }
    
    await this.playVideoStream(session, timeMs);
    
    // Wait for old demuxer to fully close before clearing isStopping
    await new Promise(resolve => setTimeout(resolve, 4000));
    session.isStopping = false;
    return true;
  }

  async pauseStream(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    if (!session.isPaused) {
      session.currentTime = this.getCurrentTime(guildId);
      session.isPaused = true;
      session.isStopping = true; // Mark as intentional stop

      console.log(`[VideoStreamer] Pausing at position ${session.currentTime}ms`);

      // Capture the current frame before killing FFmpeg
      const pauseFramePath = `/tmp/pause_frame_${guildId}.png`;
      await this.captureFrame(session, pauseFramePath);

      // Kill the video FFmpeg process
      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGKILL');
        } catch {
          // Ignore
        }
        session.ffmpegCommand = null;
      }

      // Save position for later resume
      savePlaybackPosition(session.mediaItem.ratingKey, session.currentTime);

      // Start frozen frame stream to keep Discord stream alive
      await this.startPauseStream(session, pauseFramePath);
      
      // Update status to show paused
      const { getControllerBot } = await import('../controller/bot.js');
      const controllerBot = getControllerBot();
      if (controllerBot?.user) {
        const mediaItem = session.mediaItem as any;
        const titleText = mediaItem.grandparentTitle 
          ? `${mediaItem.grandparentTitle} - ${session.mediaItem.title}`
          : session.mediaItem.title;
        await controllerBot.user.setPresence({
          status: 'idle',
          activities: [{
            name: `⏸️ ${titleText} (Paused)`,
            type: 0
          }]
        });
      }
    }

    return true;
  }

  // Capture a frame from Plex at the current position using photo/transcode API
  private async captureFrame(session: VideoStreamSession, outputPath: string): Promise<boolean> {
    const { existsSync, writeFileSync } = await import('fs');
    
    try {
      const positionSec = Math.floor(session.currentTime / 1000);
      const height = config.stream.defaultQuality;
      const width = Math.round(height * (16 / 9));
      
      console.log(`[VideoStreamer] Capturing frame at ${positionSec}s using Plex photo API`);
      
      // Use Plex's photo/transcode API to get a frame at the specific timestamp
      // This generates a thumbnail/preview image at the given time offset
      const photoUrl = `${config.plex.url}/photo/:/transcode?` + new URLSearchParams({
        'width': String(width),
        'height': String(height),
        'minSize': '1',
        'upscale': '1',
        'url': `/library/metadata/${session.mediaItem.ratingKey}/thumb?time=${positionSec}`,
        'X-Plex-Token': config.plex.token,
      }).toString();
      
      const response = await fetch(photoUrl);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        writeFileSync(outputPath, Buffer.from(buffer));
        
        if (existsSync(outputPath)) {
          console.log('[VideoStreamer] Frame captured successfully via Plex API');
          return true;
        }
      } else {
        console.log(`[VideoStreamer] Plex photo API returned ${response.status}`);
      }
    } catch (error) {
      console.log('[VideoStreamer] Frame capture failed, will use solid color:', error);
    }
    return false;
  }

  private async startPauseStream(session: VideoStreamSession, framePath?: string): Promise<void> {
    const { existsSync } = await import('fs');
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));

    // Check if we have a captured frame to use
    const hasFrame = framePath && existsSync(framePath);

    // Format the current timestamp
    const formatTime = (ms: number): string => {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }
      return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
    };

    const currentTimeStr = formatTime(session.currentTime);

    // Generate a "Paused" screen using FFmpeg
    const mediaItem = session.mediaItem as any;
    const titleText = mediaItem.grandparentTitle 
      ? `${mediaItem.grandparentTitle}\\n${session.mediaItem.title}`
      : session.mediaItem.title;
    
    const escapedTitle = titleText.replace(/'/g, "\\'").replace(/:/g, "\\:");
    const escapedTime = currentTimeStr.replace(/'/g, "\\'");

    // Leave and rejoin voice to properly reset Discord Go Live stream
    // This ensures the pause screen displays correctly
    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {
      // Ignore errors - may already be disconnected
    }
    
    // Brief delay to let Discord register the disconnect
    await new Promise(resolve => setTimeout(resolve, 300));
    
    await this.streamer.joinVoice(session.guildId, session.channelId);


    // Build FFmpeg args - use captured frame if available, otherwise solid color
    let ffmpegArgs: string[];
    if (hasFrame) {
      // Use captured frame as background with PAUSED text overlay
      ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-loop', '1', // Loop the image
        '-re', // Real-time output
        '-i', framePath,
        '-f', 'lavfi',
        '-i', 'anullsrc=r=48000:cl=stereo', // Silent audio
        '-vf', `scale=${width}:${height},drawtext=text='PAUSED':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2-60:boxcolor=black@0.5:box=1:boxborderw=10,drawtext=text='${escapedTime}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2+20`,
      ];
    } else {
      // Fallback to solid color background
      ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-re', // Real-time output
        '-f', 'lavfi',
        '-i', `color=c=#1a1a2e:s=${width}x${height}:r=${config.stream.frameRate}`,
        '-f', 'lavfi',
        '-i', 'anullsrc=r=48000:cl=stereo', // Silent audio
        '-vf', `drawtext=text='PAUSED':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2-90:boxcolor=black@0.5:box=1:boxborderw=10,drawtext=text='${escapedTime}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2-20,drawtext=text='${escapedTitle}':fontcolor=gray:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2+50`,
      ];
    }

    // Common encoding options
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-bf', '0', // No B-frames - required for RTP/Discord streaming
      '-pix_fmt', 'yuv420p',
      '-r', String(config.stream.frameRate),
      '-g', '50',
      '-b:v', '500k',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '2',
      '-map_metadata', '-1', // Strip metadata to avoid NUT demuxer warnings
      '-f', 'nut',
      '-'
    );

    console.log('[VideoStreamer] Starting pause stream (frozen frame)...');
    console.log('[VideoStreamer] Pause FFmpeg args:', ffmpegArgs.join(' '));
    const pauseFFmpeg = spawn('ffmpeg', ffmpegArgs);
    session.pauseFFmpegCommand = pauseFFmpeg;

    pauseFFmpeg.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log('[FFmpeg Pause]', msg);
      }
    });

    pauseFFmpeg.on('error', (err) => {
      console.error('[VideoStreamer] Pause FFmpeg spawn error:', err.message);
    });

    pauseFFmpeg.on('exit', (code) => {
      if (code !== 0 && code !== null && session.isPaused) {
        console.log('[VideoStreamer] Pause FFmpeg exited with code:', code);
      }
    });

    // Stream the pause screen to Discord
    try {
      await playStream(pauseFFmpeg.stdout, this.streamer, {
        type: 'go-live',
        format: 'nut',
      });
    } catch (error) {
      // Expected when we kill it on resume
      if (session.isPaused) {
        console.log('[VideoStreamer] Pause stream ended');
      }
    }
  }

  private async showLoadingScreen(guildId: string, channelId: string, nextEpisode: MediaItem): Promise<void> {
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));

    // Build episode info text
    const episodeItem = nextEpisode as any;
    const showName = episodeItem.grandparentTitle || 'Unknown Show';
    const seasonNum = episodeItem.parentIndex || 0;
    const episodeNum = episodeItem.index || 0;
    const episodeTitle = nextEpisode.title;
    
    const headerText = 'Loading Next Episode...';
    const showText = showName.replace(/'/g, "\\'").replace(/:/g, "\\:");
    const episodeText = `S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')} - ${episodeTitle}`.replace(/'/g, "\\'").replace(/:/g, "\\:");

    console.log(`[VideoStreamer] Showing loading screen for: ${showName} S${seasonNum}E${episodeNum}`);

    // Stop current stream and leave voice to properly reset Discord connection
    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {
      // Ignore errors
    }

    // Wait a moment for Discord to register the disconnect
    await new Promise(resolve => setTimeout(resolve, 500));

    // Rejoin voice channel with fresh connection
    await this.streamer.joinVoice(guildId, channelId);


    // Use platform-appropriate font path
    const isLinux = process.platform === 'linux';
    const fontPath = isLinux 
      ? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
      : '/System/Library/Fonts/Helvetica.ttc';

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'error',
      '-re',
      '-f', 'lavfi',
      '-i', `color=c=#1a1a2e:s=${width}x${height}:r=${config.stream.frameRate}`,
      '-f', 'lavfi',
      '-i', 'anullsrc=r=48000:cl=stereo',
      '-vf', `drawtext=fontfile=${fontPath}:text='${headerText}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2-100,drawtext=fontfile=${fontPath}:text='${showText}':fontcolor=orange:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2,drawtext=fontfile=${fontPath}:text='${episodeText}':fontcolor=gray:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2+60`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-bf', '0', // No B-frames - required for RTP/Discord streaming
      '-pix_fmt', 'yuv420p',
      '-r', String(config.stream.frameRate),
      '-g', '50',
      '-b:v', '1000k',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '2',
      '-t', '30', // Max 30 seconds - should be killed sooner by startStream
      '-map_metadata', '-1', // Strip metadata to avoid NUT demuxer warnings
      '-f', 'nut',
      '-'
    ];

    const loadingFFmpeg = spawn('ffmpeg', ffmpegArgs);

    loadingFFmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        console.error('[FFmpeg Loading]', msg);
      }
    });

    loadingFFmpeg.on('error', (err) => {
      console.error('[VideoStreamer] Loading FFmpeg spawn error:', err.message);
    });

    // Stream the loading screen to Discord (non-blocking - will be killed by startStream)
    playStream(loadingFFmpeg.stdout, this.streamer, {
      type: 'go-live',
      format: 'nut',
    }).catch(() => {
      // Expected when killed by startStream
    });

    // Give the loading screen a moment to start streaming
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('[VideoStreamer] Loading screen started, preparing next episode...');
  }

  async resumeStream(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session || !session.isPaused) return false;

    console.log(`[VideoStreamer] Resuming from position ${session.currentTime}ms`);

    // Kill the pause FFmpeg process
    if (session.pauseFFmpegCommand) {
      try {
        session.pauseFFmpegCommand.kill('SIGKILL');
      } catch {
        // Ignore
      }
      session.pauseFFmpegCommand = null;
    }

    // Leave and rejoin voice to properly reset Discord Go Live stream
    // This is needed because pause screen did a leave/rejoin
    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {
      // Ignore errors - may already be disconnected
    }
    
    // Brief delay to let Discord register the disconnect
    await new Promise(resolve => setTimeout(resolve, 300));
    
    await this.streamer.joinVoice(session.guildId, session.channelId);


    session.isPaused = false;
    session.isStopping = false;
    session.startedAt = Date.now();

    // Check if this is a local file
    const isLocalFile = session.streamUrl.startsWith('/') || session.streamUrl.startsWith('./') || session.streamUrl.includes('downloads/');

    // Start status update timer
    startStatusUpdateTimer(session);

    // Resume from saved position - pass isResume=true for Plex to reuse existing transcode
    if (session.isMusic) {
      await this.playMusicVisualizer(session, session.currentTime);
    } else if (isLocalFile) {
      await this.playLocalFile(session, session.currentTime);
    } else if (session.isExternal) {
      await this.playExternalStream(session, session.currentTime);
    } else {
      await this.playVideoStream(session, session.currentTime, true); // isResume = true
    }
    
    return true;
  }

  getCurrentTime(guildId: string): number {
    const session = this.sessions.get(guildId);
    if (!session) return 0;

    if (session.isPaused) {
      return session.currentTime;
    }

    const elapsed = Date.now() - session.startedAt;
    return session.currentTime + elapsed;
  }

  getProgress(guildId: string): { current: number; total: number; percentage: number } {
    const session = this.sessions.get(guildId);
    if (!session) {
      return { current: 0, total: 0, percentage: 0 };
    }

    const current = this.getCurrentTime(guildId);
    const total = session.duration;
    const percentage = total > 0 ? (current / total) * 100 : 0;

    return { current, total, percentage };
  }

  getAllSessions(): string[] {
    return [...this.sessions.keys()];
  }

  async setVolume(guildId: string, volume: number): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    const oldVolume = session.volume;
    session.volume = Math.max(0, Math.min(200, volume));
    
    // If currently playing (not paused), restart stream at current position with new volume
    if (!session.isPaused && session.ffmpegCommand) {
      const currentTime = this.getCurrentTime(guildId);
      console.log(`[VideoStreamer] Volume changing from ${oldVolume}% to ${session.volume}%, restarting at ${Math.floor(currentTime / 1000)}s...`);
      
      session.currentTime = currentTime;
      session.isStopping = true;
      
      try {
        session.ffmpegCommand.kill('SIGKILL');
      } catch {
        // Ignore
      }
      
      // Wait for FFmpeg to stop
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get fresh stream URL for Plex streams only
      if (!session.isExternal && session.mediaItem.type !== 'channel') {
        try {
          const freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
          if (freshStreamInfo) {
            session.streamUrl = freshStreamInfo.url;
          }
        } catch (error) {
          console.error('[VideoStreamer] Error getting fresh Plex stream URL:', error);
        }
      }
      
      session.isStopping = false;
      session.startedAt = Date.now();
      
      // Check if this is a local file or external stream
      const isLocalFile = session.streamUrl.startsWith('/') || session.streamUrl.startsWith('./') || session.streamUrl.includes('downloads/');
      
      try {
        if (session.isMusic) {
          await this.playMusicVisualizer(session, currentTime);
        } else if (isLocalFile) {
          await this.playLocalFile(session, currentTime);
        } else if (session.isExternal) {
          await this.playExternalStream(session, currentTime);
        } else {
          await this.playVideoStream(session, currentTime);
        }
        // Wait for old demuxer to fully close before clearing isStopping
        await new Promise(resolve => setTimeout(resolve, 4000));
        session.isStopping = false;
        console.log(`[VideoStreamer] Volume change completed - now at ${session.volume}%`);
      } catch (error) {
        console.error('[VideoStreamer] Failed to restart stream after volume change:', error);
        // Clean up on failure
        killSessionFFmpeg(session);
        this.sessions.delete(guildId);
        return false;
      }
    } else {
      console.log(`[VideoStreamer] Volume set to ${session.volume}% (will apply on resume)`);
    }
    
    return true;
  }

  async setSpeed(guildId: string, speed: number): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    // Clamp speed between 0.5x and 3x
    const oldSpeed = session.speed;
    session.speed = Math.max(0.5, Math.min(3, speed));
    
    // If currently playing (not paused), restart stream at current position with new speed
    if (!session.isPaused && session.ffmpegCommand) {
      const currentTime = this.getCurrentTime(guildId);
      console.log(`[VideoStreamer] Speed changing from ${oldSpeed}x to ${session.speed}x, restarting at ${Math.floor(currentTime / 1000)}s...`);
      
      session.currentTime = currentTime;
      session.isStopping = true;
      
      try {
        session.ffmpegCommand.kill('SIGKILL');
      } catch {
        // Ignore
      }
      
      // Stop current stream
      try {
        this.streamer.stopStream();
      } catch {
        // Ignore
      }
      
      // Wait for FFmpeg to stop
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Note: We're already in the voice channel, no need to rejoin
      // The bot stays connected after stopStream()
      
      session.startedAt = Date.now();
      
      // Check if this is a local file
      const isLocalFile = session.streamUrl.startsWith('/') || session.streamUrl.startsWith('./') || session.streamUrl.includes('downloads/');
      
      try {
        if (session.isMusic) {
          await this.playMusicVisualizer(session, currentTime);
        } else if (isLocalFile) {
          await this.playLocalFile(session, currentTime);
        } else if (session.isExternal) {
          await this.playExternalStream(session, currentTime);
        } else {
          await this.playVideoStream(session, currentTime);
        }
        // Wait for old demuxer to fully close before clearing isStopping
        await new Promise(resolve => setTimeout(resolve, 4000));
        session.isStopping = false;
        console.log(`[VideoStreamer] Speed change completed - now playing at ${speed}x`);
      } catch (error) {
        console.error('[VideoStreamer] Failed to restart stream after speed change:', error);
        // Clean up on failure
        killSessionFFmpeg(session);
        this.sessions.delete(guildId);
        return false;
      }
    } else {
      console.log(`[VideoStreamer] Speed set to ${session.speed}x (will apply on resume)`);
    }
    
    return true;
  }

  getSpeed(guildId: string): number {
    const session = this.sessions.get(guildId);
    return session?.speed || 1;
  }

  setEmbedMessage(guildId: string, messageId: string, channelId: string): void {
    const session = this.sessions.get(guildId);
    if (session) {
      session.messageId = messageId;
      session.textChannelId = channelId;
    }
  }

  async startMusicStream(
    guildId: string,
    channelId: string,
    mediaItem: MediaItem,
    audioPath: string,
    thumbnailPath: string,
    artist: string,
    userId?: string,
    startTimeMs = 0
  ): Promise<void> {
    console.log(`[VideoStreamer] startMusicStream called: guild=${guildId} channel=${channelId}`);
    await this.stopStream(guildId);

    // Always leave and rejoin voice to properly reset Discord Go Live stream
    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {
      // Ignore errors - may already be disconnected
    }

    // Delay to let Discord register the disconnect before rejoining
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('[VideoStreamer] Joining voice channel for music stream...');
    const joinTimeout = 15000; // 15 seconds
    const mediaUdp = await Promise.race([
      this.streamer.joinVoice(guildId, channelId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`joinVoice timed out after ${joinTimeout / 1000}s`)), joinTimeout)
      ),
    ]);

    // Wait for voice connection to be fully ready and verify it
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!this.streamer.voiceConnection) {
      throw new Error('Voice connection is not established after joinVoice');
    }
    console.log('[VideoStreamer] Successfully joined voice channel');


    // Undeafen the bot
    const guild = this.client.guilds.cache.get(guildId);
    if (guild) {
      guild.shard?.send({
        op: 4,
        d: {
          guild_id: guildId,
          channel_id: channelId,
          self_mute: false,
          self_deaf: false,
        }
      });
    }

    // Start voice listener if enabled
    if (config.voice.enabled) {
      await startVoiceListener(guildId);
    }

    const session: VideoStreamSession = {
      guildId,
      channelId,
      mediaItem,
      streamUrl: audioPath,
      isPaused: false,
      isStopping: false,
      isPlaying: false,
      startedAt: Date.now(),
      currentTime: startTimeMs,
      duration: mediaItem.duration || 0,
      volume: 100,
      speed: 1,
      ffmpegCommand: null,
      pauseFFmpegCommand: null,
      userId,
      isExternal: true,
      isMusic: true,
      musicAudioPath: audioPath,
      musicThumbnailPath: thumbnailPath,
      musicArtist: artist,
      mediaUdp,
    };

    this.sessions.set(guildId, session);

    // Start status update timer
    startStatusUpdateTimer(session);

    // Start voice receiver if enabled
    if (config.voice.enabled) {
      startVoiceReceiver(guildId, channelId);
    }

    await this.playMusicVisualizer(session, startTimeMs);
  }

  private async playMusicVisualizer(session: VideoStreamSession, startTimeMs = 0): Promise<void> {
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));

    try {
      const startTimeSec = Math.floor(startTimeMs / 1000);
      const audioPath = session.musicAudioPath || session.streamUrl;
      const thumbnailPath = session.musicThumbnailPath || '';
      const title = session.mediaItem.title || 'Unknown Track';
      const artist = session.musicArtist || 'Unknown Artist';
      const totalDurationSec = Math.max(1, Math.floor((session.duration || 1) / 1000));

      console.log(`[VideoStreamer] Starting music visualizer: "${title}" by ${artist}`);
      if (startTimeSec > 0) {
        console.log(`[VideoStreamer] Starting music at ${startTimeSec}s`);
      }

      const volumeMultiplier = (session.volume / 100).toFixed(2);

      // Escape special characters for FFmpeg drawtext
      const escapeFFmpegText = (text: string): string => {
        return text
          .replace(/\\/g, '\\\\\\\\')
          .replace(/'/g, "'\\\\\\''")
          .replace(/:/g, '\\:')
          .replace(/%/g, '%%')
          .replace(/\[/g, '\\[')
          .replace(/\]/g, '\\]')
          .replace(/;/g, '\\;');
      };

      const escapedTitle = escapeFFmpegText(title);
      const escapedArtist = escapeFFmpegText(artist);

      // Format total duration as MM:SS or HH:MM:SS
      const formatDurationStr = (secs: number): string => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return `${h}\\:${String(m).padStart(2, '0')}\\:${String(s).padStart(2, '0')}`;
        return `${m}\\:${String(s).padStart(2, '0')}`;
      };
      const totalTimeStr = formatDurationStr(totalDurationSec);

      // Use platform-appropriate font path
      const isLinux = process.platform === 'linux';
      const fontFile = isLinux
        ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
        : '/System/Library/Fonts/Helvetica.ttc';
      const fontFileRegular = isLinux
        ? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
        : '/System/Library/Fonts/Helvetica.ttc';

      // Check if font files exist, use fontfamily fallback if not
      const { existsSync: fsExists } = await import('fs');
      const useFontFile = fsExists(fontFile);

      // Build the font option string
      const fontBold = useFontFile ? `fontfile=${fontFile}` : 'font=Sans';
      const fontRegular = useFontFile ? `fontfile=${fontFileRegular}` : 'font=Sans';

      // Art dimensions - centered, slightly above middle
      const artSize = Math.round(height * 0.35); // 35% of height
      const artX = Math.round((width - artSize) / 2);
      const artY = Math.round(height * 0.15);

      // Text positions - below the art
      const titleY = artY + artSize + Math.round(height * 0.05);
      const artistY = titleY + Math.round(height * 0.05);

      // Progress bar dimensions
      const barWidth = Math.round(width * 0.45);
      const barX = Math.round((width - barWidth) / 2);
      const barY = artistY + Math.round(height * 0.07);
      const barHeight = 6;

      // Time text positions
      const timeY = barY + barHeight + Math.round(height * 0.015);

      // Rainbow orb audio visualizer dimensions
      const orbSize = Math.round(height * 0.65); // 65% of screen height
      const orbX = Math.round((width - orbSize) / 2);
      const orbY = Math.round((height - orbSize) / 2) - Math.round(height * 0.05);

      // Build complex filter graph for the music visualizer
      // Input 0: thumbnail image (looped, for album art)
      // Input 1: audio file
      const filterComplex = [
        // Split audio: one for visualizer, one for output (with volume applied)
        `[1:a]volume=${volumeMultiplier},asplit=2[a_viz][a_out]`,

        // Audio-reactive rainbow orb using avectorscope (circular Lissajous pattern)
        `[a_viz]avectorscope=s=${orbSize}x${orbSize}:draw=line:scale=cbrt:rate=${config.stream.frameRate}:rc=2:gc=200:bc=100:rf=1:gf=1:bf=1[scope_raw]`,

        // Cycle hue for rainbow color effect
        `[scope_raw]hue=H=2*PI*t/8[scope_hue]`,

        // Create glow: duplicate, blur one copy heavily, blend with screen mode
        `[scope_hue]split[scope_sharp][scope_blur]`,
        `[scope_blur]boxblur=luma_radius=18:luma_power=3[scope_glow]`,
        `[scope_sharp][scope_glow]blend=all_mode=screen[orb]`,

        // Dark background
        `color=c=#0a0a14:s=${width}x${height}:r=${config.stream.frameRate}[bg_dark]`,

        // Overlay orb centered on dark background
        `[bg_dark][orb]overlay=${orbX}:${orbY}[bg]`,

        // Album art: scale to centered size (from thumbnail input)
        `[0:v]scale=${artSize}:${artSize}:force_original_aspect_ratio=decrease,pad=${artSize}:${artSize}:(ow-iw)/2:(oh-ih)/2:color=0x00000000[art]`,

        // Subtle shadow behind album art
        `color=c=black@0.4:s=${artSize + 16}x${artSize + 16}[shadow]`,

        // Compose: background + shadow + art
        `[bg][shadow]overlay=${artX - 8}:${artY - 8}[bgs]`,
        `[bgs][art]overlay=${artX}:${artY}[v1]`,

        // Song title (bold, white, centered)
        `[v1]drawtext=${fontBold}:text='${escapedTitle}':fontsize=${Math.round(height * 0.035)}:fontcolor=white:x=(w-text_w)/2:y=${titleY}[v2]`,

        // Artist name (regular, slightly transparent, centered)
        `[v2]drawtext=${fontRegular}:text='${escapedArtist}':fontsize=${Math.round(height * 0.025)}:fontcolor=white@0.65:x=(w-text_w)/2:y=${artistY}[v3]`,

        // Progress bar background (dim white track)
        `[v3]drawbox=x=${barX}:y=${barY}:w=${barWidth}:h=${barHeight}:color=white@0.15:t=fill[v4]`,

        // Progress bar fill (bright white, dynamic width based on time)
        `[v4]drawbox=x=${barX}:y=${barY}:w='min(${barWidth}\\,${barWidth}*t/${totalDurationSec})':h=${barHeight}:color=white@0.85:t=fill[v5]`,

        // Current time (left-aligned under progress bar)
        `[v5]drawtext=${fontRegular}:text='%{pts\\:hms}':fontsize=${Math.round(height * 0.018)}:fontcolor=white@0.5:x=${barX}:y=${timeY}[v6]`,

        // Total duration (right-aligned under progress bar)
        `[v6]drawtext=${fontRegular}:text='${totalTimeStr}':fontsize=${Math.round(height * 0.018)}:fontcolor=white@0.5:x=${barX + barWidth}-text_w:y=${timeY}[vout]`,
      ].join(';');

      // Build FFmpeg args
      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        '-loop', '1',           // Loop the thumbnail image
        '-i', thumbnailPath,    // Input 0: thumbnail (for album art)
      ];

      // Add seek to audio input if needed
      if (startTimeSec > 0) {
        ffmpegArgs.push('-ss', startTimeSec.toString());
      }

      ffmpegArgs.push(
        '-i', audioPath,        // Input 1: audio
        '-filter_complex', filterComplex,
        '-map', '[vout]',       // Use filtered video output
        '-map', '[a_out]',      // Use audio from filter graph (with volume applied)
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'animation',   // Optimize for animated content (rainbow orb)
        '-profile:v', 'high',
        '-level', '4.2',
        '-bf', '0', // No B-frames - required for RTP/Discord streaming
        '-pix_fmt', 'yuv420p',
        '-r', String(config.stream.frameRate),
        '-g', String(config.stream.frameRate * 2),
        '-b:v', '4000k',       // Higher bitrate for animated visualizer
        '-maxrate', '5000k',
        '-bufsize', '8000k',
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2',
        '-shortest',            // Stop when audio ends
        '-map_metadata', '-1', // Strip metadata to avoid NUT demuxer warnings
        '-f', 'nut',
        '-'
      );

      console.log('[VideoStreamer] Starting FFmpeg for music visualizer...');
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      session.ffmpegCommand = ffmpeg;

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Fatal')) {
          console.error('[FFmpeg Music]', msg);
        } else if (config.stream.showFFmpegLogs && !msg.includes('size=')) {
          console.error('[FFmpeg Music]', msg);
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('[VideoStreamer] Music FFmpeg spawn error:', err.message);
      });

      ffmpeg.on('exit', (code) => {
        if (session.isStopping) {
          console.log('[VideoStreamer] Music FFmpeg exited during intentional stop (code:', code, ')');
          return;
        }

        if (code === 0) {
          console.log('[VideoStreamer] Music playback finished');
          const finishedMediaItem = session.mediaItem;
          killSessionFFmpeg(session);
          this.sessions.delete(session.guildId);
          this.playNextInQueue(session.guildId, session.channelId, session.userId, finishedMediaItem);
        } else if (code !== null) {
          console.log('[VideoStreamer] Music FFmpeg exited with code:', code);
        }
      });

      console.log('[VideoStreamer] Starting Go Live stream (music visualizer)...');

      session.isPlaying = true;
      session.startedAt = Date.now();

      if (session.userId) {
        updateWatchDeck(session.mediaItem, 0, session.userId);
      }

      // Register stream for web viewing
      const { registerWebStream } = await import('../web/server.js');
      registerWebStream(session.guildId, session, audioPath);

      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
        format: 'nut',
      });

      if (!session.isStopping) {
        console.log('[VideoStreamer] Music visualizer playback finished (stream ended)');
      }
    } catch (error) {
      if (!session.isStopping && error instanceof Error && !error.message.includes('abort')) {
        console.error('[VideoStreamer] Music visualizer error:', error);
      }
    }
  }
}

let videoStreamerInstance: VideoStreamer | null = null;

export function initVideoStreamer(client: Client): VideoStreamer {
  videoStreamerInstance = new VideoStreamer(client);
  startIdleCleanup(); // Start periodic cleanup of orphaned FFmpeg processes
  return videoStreamerInstance;
}

export function getVideoStreamer(): VideoStreamer {
  if (!videoStreamerInstance) {
    throw new Error('VideoStreamer not initialized. Call initVideoStreamer first.');
  }
  return videoStreamerInstance;
}

export function leaveAllVoiceChannels(): void {
  if (videoStreamerInstance) {
    try {
      videoStreamerInstance.streamer.stopStream();
      videoStreamerInstance.streamer.leaveVoice();
      console.log('[VideoStreamer] Left all voice channels');
    } catch {
      // Ignore errors
    }
  }
}

// Periodic cleanup of orphaned FFmpeg processes when idle
let cleanupInterval: NodeJS.Timeout | null = null;

function killOrphanedFFmpegProcesses(): void {
  // Only run cleanup if we have no active sessions
  if (videoStreamerInstance && videoStreamerInstance.getActiveSessions().length === 0) {
    try {
      // Find FFmpeg processes started by our app (node process)
      // Use pkill to kill FFmpeg processes that are children of our node process
      const ppid = process.pid;
      
      // Get list of ffmpeg processes that are children of our process
      const result = execSync(`pgrep -P ${ppid} -x ffmpeg 2>/dev/null || true`, { encoding: 'utf-8' });
      const pids = result.trim().split('\n').filter((p: string) => p);
      
      if (pids.length > 0) {
        console.log(`[VideoStreamer] Found ${pids.length} orphaned FFmpeg process(es), killing...`);
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid, 10), 'SIGKILL');
            console.log(`[VideoStreamer] Killed orphaned FFmpeg process ${pid}`);
          } catch {
            // Process may have already exited
          }
        }
      }
    } catch (error) {
      // Silently ignore errors - pgrep might not be available
    }
  }
}

export function startIdleCleanup(): void {
  if (cleanupInterval) return;
  
  // Run cleanup every 60 seconds
  cleanupInterval = setInterval(() => {
    killOrphanedFFmpegProcesses();
  }, 60000);
  
  console.log('[VideoStreamer] Started idle FFmpeg cleanup (every 60s)');
}

export function stopIdleCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export default VideoStreamer;
