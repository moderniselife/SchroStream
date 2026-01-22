import { Express } from 'express';
import { PlexGDMServer } from './gdm.js';
import { PlexPlayerServer, PlayMediaRequest } from './player-server.js';
import { getVideoStreamer } from '../stream/video-streamer.js';
import { plexClient } from '../plex/client.js';
import { client as selfbotClient } from '../bot/client.js';
import { TextChannel } from 'discord.js-selfbot-v13';
import config from '../config.js';

let gdmServer: PlexGDMServer | null = null;
let playerServer: PlexPlayerServer | null = null;

export async function initPlexCastReceiver(app: Express): Promise<void> {
  const plexCastEnabled = process.env.PLEX_CAST_ENABLED?.toLowerCase() === 'true';
  
  if (!plexCastEnabled) {
    console.log('[PlexCast] Plex Cast receiver disabled');
    return;
  }

  const playerName = process.env.PLEX_CAST_NAME || 'SchroStream (Bob)';
  const playerPort = parseInt(process.env.PLEX_CAST_PORT || '32500');
  const serverIP = process.env.SERVER_IP || '192.168.1.124'; // Use same IP as YouTube Cast

  console.log('[PlexCast] Initializing Plex Cast receiver...');
  console.log(`[PlexCast] Player name: ${playerName}`);
  console.log(`[PlexCast] Server IP: ${serverIP}`);

  // Create GDM server for discovery
  gdmServer = new PlexGDMServer({
    name: playerName,
    port: playerPort,
    product: 'SchroStream Discord Streamer',
    deviceClass: 'stb',
  }, serverIP);

  // Create player server for handling commands
  playerServer = new PlexPlayerServer(gdmServer.getMachineIdentifier(), playerName);

  // Handle playMedia events
  playerServer.on('playMedia', async (request: PlayMediaRequest) => {
    console.log('[PlexCast] ========================================');
    console.log('[PlexCast] Received playMedia request');
    console.log('[PlexCast] Key:', request.key);
    console.log('[PlexCast] Server:', `${request.protocol}://${request.address}:${request.port}`);
    
    try {
      await handlePlayMedia(request);
    } catch (error) {
      console.error('[PlexCast] Error handling playMedia:', error);
    }
  });

  // Handle stop events
  playerServer.on('stop', async () => {
    console.log('[PlexCast] Stop requested');
    try {
      const guildId = config.discord.webGuildId;
      if (guildId) {
        const streamer = getVideoStreamer();
        await streamer.stopStream(guildId);
      }
    } catch (error) {
      console.error('[PlexCast] Error stopping:', error);
    }
  });

  // Mount player routes
  app.use('/player', playerServer.getRouter());
  app.use('/', playerServer.getRouter()); // Also mount at root for /resources

  // Start GDM server
  try {
    await gdmServer.start();
    console.log(`[PlexCast] ✓ Plex Cast receiver started`);
    console.log(`[PlexCast] ✓ Player discoverable as "${playerName}"`);
    console.log(`[PlexCast] ✓ GDM listening on port 32412`);
    console.log(`[PlexCast] ✓ Player API on port ${playerPort}`);
  } catch (error) {
    console.error('[PlexCast] Failed to start GDM server:', error);
  }
}

async function handlePlayMedia(request: PlayMediaRequest): Promise<void> {
  const guildId = config.discord.webGuildId || '';
  const channelId = config.discord.webChannelId || '';
  const userId = config.discord.webUserId || '';

  if (!guildId || !channelId) {
    console.error('[PlexCast] Missing guild or channel ID in config');
    return;
  }

  // Extract rating key from the key path
  // Key format: /library/metadata/12345
  const ratingKeyMatch = request.key.match(/\/library\/metadata\/(\d+)/);
  if (!ratingKeyMatch) {
    console.error('[PlexCast] Could not extract rating key from:', request.key);
    return;
  }
  const ratingKey = ratingKeyMatch[1];

  console.log(`[PlexCast] Rating key: ${ratingKey}`);

  // Get text channel for progress updates
  const textChannel = await getNotificationChannel(guildId);
  let progressMessage: any = null;

  try {
    // Get media info from Plex
    console.log('[PlexCast] Getting media info from Plex...');
    const mediaInfo = await plexClient.getMetadata(ratingKey);
    
    if (!mediaInfo) {
      console.error('[PlexCast] Could not get media info for rating key:', ratingKey);
      return;
    }

    const mediaTitle = mediaInfo.title || 'Unknown Media';
    const mediaDuration = mediaInfo.duration || 0;

    console.log(`[PlexCast] Media: ${mediaTitle}`);
    console.log(`[PlexCast] Duration: ${mediaDuration}ms`);

    // Send initial notification
    if (textChannel) {
      progressMessage = await textChannel.send(
        `📺 **Plex Cast Received**\n` +
        `🎬 **${mediaTitle}**\n\n` +
        `⏳ *Getting stream URL...*`
      );
    }

    // Get stream URL from Plex
    console.log('[PlexCast] Getting stream URL...');
    const streamInfo = await plexClient.getDirectStreamUrl(ratingKey);
    
    if (!streamInfo) {
      console.error('[PlexCast] Could not get stream URL');
      if (progressMessage) {
        await progressMessage.edit(
          `📺 **Plex Cast - Failed**\n` +
          `❌ Could not get stream URL from Plex`
        ).catch(() => {});
      }
      return;
    }

    console.log('[PlexCast] Got stream URL');

    // Update message
    if (progressMessage) {
      await progressMessage.edit(
        `📺 **Plex Cast - Starting Stream**\n` +
        `🎬 **${mediaTitle}**\n\n` +
        `🎬 *Starting playback...*`
      ).catch(() => {});
    }

    // Create media item
    const mediaItem = {
      ratingKey: ratingKey,
      key: request.key,
      title: mediaTitle,
      type: mediaInfo.type as 'movie' | 'episode' | 'show',
      duration: mediaDuration,
      thumb: mediaInfo.thumb,
      grandparentTitle: mediaInfo.grandparentTitle,
      parentTitle: mediaInfo.parentTitle,
      index: mediaInfo.index,
      parentIndex: mediaInfo.parentIndex,
    };

    // Start streaming
    const streamer = getVideoStreamer();
    await streamer.startStream(
      guildId,
      channelId,
      mediaItem,
      streamInfo.url,
      request.offset || 0,
      userId
    );

    console.log(`[PlexCast] ✓ Started playing: ${mediaTitle}`);

    // Update player state
    if (playerServer) {
      playerServer.setPlaying(ratingKey, mediaDuration);
    }

    // Update message to show now playing
    if (progressMessage) {
      const durationStr = formatDuration(mediaDuration);
      let description = `🎬 **${mediaTitle}**`;
      
      if (mediaInfo.grandparentTitle) {
        description = `📺 **${mediaInfo.grandparentTitle}**\n` +
          `🎬 S${mediaInfo.parentIndex || 0}E${mediaInfo.index || 0}: ${mediaTitle}`;
      }

      await progressMessage.edit(
        `📺 **Plex Cast - Now Playing**\n` +
        `${description}\n\n` +
        `⏱️ Duration: ${durationStr}\n` +
        `📡 Source: Direct stream from Plex`
      ).catch(() => {});
    }

  } catch (error) {
    console.error('[PlexCast] Error in handlePlayMedia:', error);
    if (progressMessage) {
      await progressMessage.edit(
        `📺 **Plex Cast - Error**\n` +
        `❌ ${error instanceof Error ? error.message : 'Unknown error'}`
      ).catch(() => {});
    }
  }
}

async function getNotificationChannel(guildId: string): Promise<TextChannel | null> {
  try {
    const guild = selfbotClient.guilds.cache.get(guildId);
    if (!guild) return null;

    let textChannel: TextChannel | undefined;

    // Check for configured notification channel (reuse Cast channel)
    const notificationChannelId = process.env.CAST_NOTIFICATION_CHANNEL_ID;
    if (notificationChannelId) {
      textChannel = guild.channels.cache.get(notificationChannelId) as TextChannel | undefined;
    }

    // Fallback to first available text channel
    if (!textChannel) {
      textChannel = guild.channels.cache.find(
        (ch) => ch.type === 'GUILD_TEXT' && ch.permissionsFor(selfbotClient.user!)?.has('SEND_MESSAGES')
      ) as TextChannel | undefined;
    }

    return textChannel || null;
  } catch (error) {
    console.error('[PlexCast] Failed to get notification channel:', error);
    return null;
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function stopPlexCastReceiver(): void {
  if (gdmServer) {
    gdmServer.stop();
    gdmServer = null;
  }
  playerServer = null;
  console.log('[PlexCast] Receiver stopped');
}
