import dgram from 'dgram';
import { networkInterfaces, hostname } from 'os';
import { createHash } from 'crypto';

// Generate a stable UUID-like identifier based on hostname
function generateMachineId(): string {
  const hash = createHash('md5').update(hostname() + 'plex-cast').digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

const GDM_PORT = 32412;
const GDM_MULTICAST_ADDR = '239.0.0.250';

export interface PlexPlayerConfig {
  name: string;
  port: number;
  machineIdentifier: string;
  product: string;
  version: string;
  deviceClass: 'pc' | 'stb' | 'tv' | 'phone' | 'tablet';
}

export class PlexGDMServer {
  private socket: dgram.Socket | null = null;
  private config: PlexPlayerConfig;
  private localIP: string;
  private running = false;
  private advertiseInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<PlexPlayerConfig> = {}, explicitIP?: string) {
    this.config = {
      name: config.name || 'SchroStream',
      port: config.port || 32500,
      machineIdentifier: config.machineIdentifier || generateMachineId(),
      product: config.product || 'SchroStream Discord Streamer',
      version: config.version || '1.0.0',
      deviceClass: config.deviceClass || 'stb',
    };
    this.localIP = explicitIP || process.env.SERVER_IP || this.getLocalIP();
    console.log(`[PlexGDM] Using IP: ${this.localIP}`);
  }

  private getLocalIP(): string {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) {
          return alias.address;
        }
      }
    }
    return '127.0.0.1';
  }

  getIP(): string {
    return this.localIP;
  }

  getMachineIdentifier(): string {
    return this.config.machineIdentifier;
  }

  getPort(): number {
    return this.config.port;
  }

  private buildResponse(): string {
    const lines = [
      'HTTP/1.0 200 OK',
      'Content-Type: plex/media-player',
      `Name: ${this.config.name}`,
      `Host: ${this.localIP}`,
      `Port: ${this.config.port}`,
      `Product: ${this.config.product}`,
      'Protocol: plex',
      'Protocol-Version: 1',
      'Protocol-Capabilities: timeline,playback,navigation,playqueues',
      `Resource-Identifier: ${this.config.machineIdentifier}`,
      `Version: ${this.config.version}`,
      `Device-Class: ${this.config.deviceClass}`,
    ];
    return lines.join('\r\n') + '\r\n';
  }

  private buildHello(): string {
    const lines = [
      'HELLO * HTTP/1.0',
      'Content-Type: plex/media-player',
      `Name: ${this.config.name}`,
      `Host: ${this.localIP}`,
      `Port: ${this.config.port}`,
      `Product: ${this.config.product}`,
      'Protocol: plex',
      'Protocol-Version: 1',
      'Protocol-Capabilities: timeline,playback,navigation,playqueues',
      `Resource-Identifier: ${this.config.machineIdentifier}`,
      `Version: ${this.config.version}`,
      `Device-Class: ${this.config.deviceClass}`,
    ];
    return lines.join('\r\n') + '\r\n';
  }

  async start(): Promise<void> {
    if (this.running) return;

    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.error('[PlexGDM] Socket error:', err.message);
        this.stop();
        reject(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        const message = msg.toString();
        
        if (message.includes('M-SEARCH')) {
          console.log(`[PlexGDM] Received M-SEARCH from ${rinfo.address}:${rinfo.port}`);
          console.log(`[PlexGDM] Search content: ${message.trim().split('\n')[0]}`);
          
          const response = Buffer.from(this.buildResponse());
          this.socket?.send(response, 0, response.length, rinfo.port, rinfo.address, (err) => {
            if (err) {
              console.error('[PlexGDM] Error sending response:', err.message);
            } else {
              console.log(`[PlexGDM] Sent response to ${rinfo.address}:${rinfo.port} (Player at ${this.localIP}:${this.config.port})`);
            }
          });
        }
      });

      this.socket.bind(GDM_PORT, () => {
        try {
          this.socket?.addMembership(GDM_MULTICAST_ADDR);
          console.log(`[PlexGDM] Listening on ${GDM_MULTICAST_ADDR}:${GDM_PORT}`);
          
          // Send initial HELLO broadcast
          this.sendHello();
          
          // Periodically send HELLO to announce presence
          this.advertiseInterval = setInterval(() => {
            this.sendHello();
          }, 30000); // Every 30 seconds
          
          this.running = true;
          resolve();
        } catch (err) {
          console.error('[PlexGDM] Failed to join multicast group:', err);
          reject(err);
        }
      });
    });
  }

  private sendHello(): void {
    if (!this.socket) return;
    
    const hello = Buffer.from(this.buildHello());
    this.socket.send(hello, 0, hello.length, GDM_PORT, GDM_MULTICAST_ADDR, (err) => {
      if (err) {
        console.error('[PlexGDM] Error sending HELLO:', err.message);
      } else {
        console.log('[PlexGDM] Sent HELLO broadcast');
      }
    });
  }

  stop(): void {
    if (this.advertiseInterval) {
      clearInterval(this.advertiseInterval);
      this.advertiseInterval = null;
    }
    
    if (this.socket) {
      try {
        this.socket.dropMembership(GDM_MULTICAST_ADDR);
      } catch (e) {
        // Ignore errors when dropping membership
      }
      this.socket.close();
      this.socket = null;
    }
    
    this.running = false;
    console.log('[PlexGDM] Server stopped');
  }
}
