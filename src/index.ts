import { startBot } from './bot/client.js';
import plexClient from './plex/client.js';
import { getVideoStreamer, leaveAllVoiceChannels } from './stream/video-streamer.js';
import config from './config.js';
import { initControllerBot } from './controller/bot.js';

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║         SchroStream v1.0.0            ║');
  console.log('║   Discord Plex Streaming Self-Bot     ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');

  console.log('[Startup] Checking Plex connection...');
  const plexConnected = await plexClient.testConnection();

  if (!plexConnected) {
    console.error('[Startup] ❌ Failed to connect to Plex server');
    console.error(`[Startup] URL: ${config.plex.url}`);
    process.exit(1);
  }

  console.log('[Startup] ✓ Plex server connected');

  // Clean up any stale Plex transcode sessions from previous runs
  await plexClient.cleanupOldSessions();

  const libraries = await plexClient.getLibraries();
  console.log(`[Startup] Found ${libraries.length} libraries:`);
  libraries.forEach((lib) => {
    console.log(`  - ${lib.title} (${lib.type})`);
  });

  console.log('');
  console.log('[Startup] Starting Discord selfbot...');
  await startBot();

  // Start controller bot if configured
  if (config.discord.botToken) {
    console.log('[Startup] Starting controller bot...');
    await initControllerBot();
  } else {
    console.log('[Startup] No BOT_TOKEN configured, skipping controller bot');
    console.log('[Startup] Add BOT_TOKEN and BOT_CLIENT_ID to enable slash commands');
  }
}

// Graceful shutdown handler
async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Shutdown] Received ${signal}, cleaning up...`);
  
  try {
    // Leave all voice channels first
    leaveAllVoiceChannels();
    
    // Stop any active streams
    try {
      const streamer = getVideoStreamer();
      if (streamer) {
        const sessions = streamer.getAllSessions();
        for (const guildId of sessions) {
          await streamer.stopStream(guildId);
        }
      }
    } catch {
      // Streamer might not be initialized
    }
    
    // Clean up Plex sessions
    await plexClient.cleanupOldSessions();
    
    console.log('[Shutdown] Cleanup complete');
  } catch (error) {
    console.error('[Shutdown] Error during cleanup:', error);
  }
  
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((error) => {
  console.error('[Fatal Error]', error);
  process.exit(1);
});
