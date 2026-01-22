import dgram from 'dgram';
import os from 'os';
import { EventEmitter } from 'events';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

export interface SSDPConfig {
  deviceName: string;
  uuid: string;
  port: number;
  friendlyName: string;
}

/**
 * SSDP (Simple Service Discovery Protocol) server for DIAL device discovery.
 * This allows YouTube and other Cast-enabled apps to discover SchroStream as a cast target.
 */
export class SSDPServer extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private config: SSDPConfig;
  private isRunning = false;
  private localIp: string;

  constructor(config: SSDPConfig) {
    super();
    this.config = config;
    this.localIp = this.getLocalIP();
  }

  private getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      
      for (const info of iface) {
        // Skip internal and non-IPv4 addresses
        if (info.internal || info.family !== 'IPv4') continue;
        // Prefer non-docker/virtual interfaces
        if (!name.includes('docker') && !name.includes('veth') && !name.includes('br-')) {
          return info.address;
        }
      }
    }
    // Fallback to localhost
    return '127.0.0.1';
  }

  private buildSearchResponse(searchTarget: string): string {
    const location = `http://${this.localIp}:${this.config.port}/ssdp/device-desc.xml`;
    const applicationUrl = `http://${this.localIp}:${this.config.port}/apps`;
    const usn = `uuid:${this.config.uuid}`;
    
    return [
      'HTTP/1.1 200 OK',
      `CACHE-CONTROL: max-age=1800`,
      `DATE: ${new Date().toUTCString()}`,
      `EXT:`,
      `LOCATION: ${location}`,
      `SERVER: SchroStream/1.0 UPnP/1.1 DIAL/2.2`,
      `ST: ${searchTarget}`,
      `USN: ${usn}::${searchTarget}`,
      `APPLICATION-URL: ${applicationUrl}`,
      `BOOTID.UPNP.ORG: 1`,
      `CONFIGID.UPNP.ORG: 1`,
      `WAKEUP: MAC=${this.getMacAddress()};Timeout=10`,
      '',
      '',
    ].join('\r\n');
  }

  private getMacAddress(): string {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      if (!iface) continue;
      for (const info of iface) {
        if (!info.internal && info.mac && info.mac !== '00:00:00:00:00:00') {
          return info.mac.toUpperCase().replace(/:/g, '');
        }
      }
    }
    return '000000000000';
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[SSDP] Server already running');
      return;
    }

    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        console.error('[SSDP] Socket error:', err);
        this.emit('error', err);
        if (!this.isRunning) {
          reject(err);
        }
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.on('listening', () => {
        const address = this.socket!.address();
        console.log(`[SSDP] Listening on ${address.address}:${address.port}`);
        
        try {
          // Join multicast group
          this.socket!.addMembership(SSDP_ADDRESS);
          console.log(`[SSDP] Joined multicast group ${SSDP_ADDRESS}`);
          
          this.isRunning = true;
          this.emit('started');
          resolve();
        } catch (err) {
          console.error('[SSDP] Failed to join multicast group:', err);
          reject(err);
        }
      });

      // Bind to SSDP port
      this.socket.bind(SSDP_PORT, () => {
        console.log(`[SSDP] Bound to port ${SSDP_PORT}`);
      });
    });
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    const message = msg.toString();
    
    // Only handle M-SEARCH requests
    if (!message.startsWith('M-SEARCH')) return;
    
    // Log M-SEARCH requests
    const lines = message.split('\n');
    const firstLine = lines[0].trim();
    const stLine = lines.find(l => l.toUpperCase().startsWith('ST:'))?.trim();
    console.log(`[SSDP] Received M-SEARCH from ${rinfo.address}:${rinfo.port}`);
    console.log(`[SSDP]   ${firstLine}`);
    if (stLine) console.log(`[SSDP]   ${stLine}`);
    
    // Parse the search target (ST header)
    const stMatch = message.match(/ST:\s*(.+?)(?:\r\n|\r|\n)/i);
    const mxMatch = message.match(/MX:\s*(.+?)(?:\r\n|\r|\n)/i);
    
    if (!stMatch) {
      console.log(`[SSDP] M-SEARCH missing ST header`);
      return;
    }
    
    const searchTarget = stMatch[1].trim();
    const mx = mxMatch ? mxMatch[1].trim() : '3';
    
    // Respond to DIAL-related searches
    const dialTargets = [
      'urn:dial-multiscreen-org:service:dial:1',
      'urn:dial-multiscreen-org:device:dial:1',
      'ssdp:all',
      'upnp:rootdevice',
      'dial:1',  // Some clients use shortened form
      'urn:dial-multiscreen-org:service:dial',
      'urn:dial-multiscreen-org:device:dial',
    ];
    
    if (dialTargets.includes(searchTarget)) {
      console.log(`[SSDP] ✓ Responding to DIAL search "${searchTarget}"`);
      
      // Add random delay (0-1s) to prevent network congestion
      const delay = Math.random() * 1000;
      setTimeout(() => {
        const response = this.buildSearchResponse(searchTarget);
        console.log(`[SSDP] Sending DIAL response with APPLICATION-URL: http://${this.localIp}:${this.config.port}/apps`);
        this.socket!.send(response, 0, response.length, rinfo.port, rinfo.address, (err) => {
          if (err) {
            console.error('[SSDP] Failed to send response:', err);
          } else {
            console.log(`[SSDP] ✓ Sent DIAL response to ${rinfo.address}:${rinfo.port}`);
          }
        });
      }, delay);
    } else {
      // For malformed searches like "239.255.255.250:1900", still respond with DIAL info
      if (searchTarget.includes('239.255.255.250') || searchTarget.includes('1900')) {
        console.log(`[SSDP] ✓ Responding to malformed search "${searchTarget}" as DIAL device`);
        const delay = Math.random() * 1000;
        setTimeout(() => {
          this.sendResponse('urn:dial-multiscreen-org:service:dial:1', rinfo);
          console.log(`[SSDP] ✓ Sent DIAL response to ${rinfo.address}:${rinfo.port}`);
        }, delay);
      } else {
        console.log(`[SSDP] ✗ Ignoring non-DIAL target: "${searchTarget}"`);
      }
    }
  }

  private sendResponse(searchTarget: string, rinfo: dgram.RemoteInfo): void {
    if (!this.socket) return;
    
    // For ssdp:all, respond with DIAL target
    const responseTarget = searchTarget === 'ssdp:all' || searchTarget === 'upnp:rootdevice'
      ? 'urn:dial-multiscreen-org:service:dial:1'
      : searchTarget;
    
    const response = this.buildSearchResponse(responseTarget);
    const responseBuffer = Buffer.from(response);
    
    this.socket.send(responseBuffer, 0, responseBuffer.length, rinfo.port, rinfo.address, (err) => {
      if (err) {
        console.error('[SSDP] Failed to send response:', err);
      }
      // Success is logged in the caller
    });
  }

  stop(): void {
    if (this.socket) {
      try {
        this.socket.dropMembership(SSDP_ADDRESS);
      } catch {
        // Ignore errors when dropping membership
      }
      this.socket.close();
      this.socket = null;
    }
    this.isRunning = false;
    console.log('[SSDP] Server stopped');
  }

  getIP(): string {
    return this.localIp;
  }
}

export default SSDPServer;
