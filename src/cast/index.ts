import { Express, Request, Response } from 'express';
import { join } from 'path';
import YouTubeCastReceiver from 'yt-cast-receiver';
import { SchroStreamPlayer } from './player.js';
import { InMemoryDataStore } from './datastore.js';
import config from '../config.js';

let receiver: YouTubeCastReceiver | null = null;

/**
 * Initialize the YouTube Cast receiver using yt-cast-receiver library
 */
export async function initCastReceiver(app: Express, port: number): Promise<void> {
  // Check if cast is enabled
  const castEnabled = process.env.CAST_ENABLED?.toLowerCase() === 'true';
  if (!castEnabled) {
    console.log('[Cast] Cast receiver disabled (set CAST_ENABLED=true to enable)');
    
    // Still mount the SPA catch-all
    app.get('/{*path}', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(join(process.cwd(), 'public', 'index.html'));
    });
    return;
  }

  const deviceName = process.env.CAST_DEVICE_NAME || 'SchroStream';
  const friendlyName = process.env.CAST_FRIENDLY_NAME || 'SchroStream (Bob)';

  console.log('[Cast] Initializing YouTube Cast receiver...');
  console.log(`[Cast] Device name: ${friendlyName}`);

  // Create the player implementation
  const player = new SchroStreamPlayer();

  // Create custom data store to avoid node-persist issues in Docker
  const dataStore = new InMemoryDataStore();

  // Create the receiver instance
  receiver = new YouTubeCastReceiver(player, {
    device: {
      name: friendlyName,
      screenName: `YouTube on ${friendlyName}`,
      brand: 'SchroStream',
      model: 'Discord Media Streamer',
    },
    dial: {
      port: 8008, // Use a separate port for DIAL (8008 is common for Chromecast)
      corsAllowOrigins: true,
      bindToAddresses: ['192.168.1.124'], // Bind to server's IP
    },
    dataStore: dataStore as any, // Use in-memory store
    logLevel: 'debug',
  });

  // Set up event handlers
  receiver.on('senderConnect', (sender: { name: string }) => {
    console.log(`[Cast] ✓ Sender connected: ${sender.name}`);
  });

  receiver.on('senderDisconnect', (sender: { name: string }, implicit: boolean) => {
    console.log(`[Cast] Sender disconnected: ${sender.name} (implicit: ${implicit})`);
  });

  receiver.on('error', (error: Error) => {
    console.error('[Cast] Error:', error);
  });

  // Start the receiver
  try {
    await receiver.start();
    console.log(`[Cast] ✓ YouTube Cast receiver started`);
    console.log(`[Cast] ✓ Device discoverable as "${friendlyName}"`);
  } catch (error) {
    console.error('[Cast] Failed to start receiver:', error);
  }

  // Mount the SPA catch-all AFTER Cast routes
  app.get('/{*path}', (req: Request, res: Response) => {
    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/ytcr/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(join(process.cwd(), 'public', 'index.html'));
  });
}

/**
 * Stop the Cast receiver
 */
export async function stopCastReceiver(): Promise<void> {
  if (receiver) {
    try {
      await receiver.stop();
      console.log('[Cast] Receiver stopped');
    } catch (error) {
      console.error('[Cast] Error stopping receiver:', error);
    }
    receiver = null;
  }
}

export { receiver };
