import { startBot } from './bot/client.js';
import plexClient from './plex/client.js';
import config from './config.js';

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

  const libraries = await plexClient.getLibraries();
  console.log(`[Startup] Found ${libraries.length} libraries:`);
  libraries.forEach((lib) => {
    console.log(`  - ${lib.title} (${lib.type})`);
  });

  console.log('');
  console.log('[Startup] Starting Discord bot...');
  await startBot();
}

main().catch((error) => {
  console.error('[Fatal Error]', error);
  process.exit(1);
});
