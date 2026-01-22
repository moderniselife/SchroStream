import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';

export interface DIALConfig {
  deviceName: string;
  uuid: string;
  friendlyName: string;
  manufacturer: string;
  modelName: string;
}

export interface YouTubePlayRequest {
  videoId: string;
  listId?: string;
  currentTime?: number;
  currentIndex?: number;
}

/**
 * DIAL (Discovery and Launch) REST API implementation.
 * This allows YouTube and other Cast-enabled apps to launch and control apps on SchroStream.
 */
export class DIALServer extends EventEmitter {
  private config: DIALConfig;
  private router: Router;
  private localIp: string;
  private port: number;
  
  // App states
  private apps: Map<string, {
    state: 'stopped' | 'running' | 'hidden';
    pid?: string;
    additionalData?: Record<string, string>;
  }> = new Map();

  constructor(config: DIALConfig, localIp: string, port: number) {
    super();
    this.config = config;
    this.localIp = localIp;
    this.port = port;
    this.router = Router();
    
    // Handle OPTIONS for CORS preflight
    this.router.options('*', (req: Request, res: Response) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(200).send();
    });
    
    // Initialize YouTube app as stopped
    this.apps.set('YouTube', { state: 'stopped' });
    
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Device description XML (UPnP device descriptor)
    this.router.get('/ssdp/device-desc.xml', (req: Request, res: Response) => {
      console.log(`[DIAL] Device description requested from ${req.ip}`);
      
      const xml = this.buildDeviceDescription();
      res.set('Content-Type', 'application/xml');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Application-URL', `http://${this.localIp}:${this.port}/apps`);
      res.send(xml);
    });
    
    // Test endpoint for debugging
    this.router.get('/cast-test', (req: Request, res: Response) => {
      console.log(`[DIAL] Cast test endpoint accessed from ${req.ip}`);
      res.json({
        message: 'SchroStream Cast Receiver is running',
        deviceName: this.config.friendlyName,
        localIp: this.localIp,
        port: this.port,
        deviceDescUrl: `http://${this.localIp}:${this.port}/ssdp/device-desc.xml`,
        appsUrl: `http://${this.localIp}:${this.port}/apps`,
      });
    });

    // DIAL Application Resource (list available apps)
    this.router.get('/apps', (req: Request, res: Response) => {
      console.log('[DIAL] Apps list requested');
      res.set('Content-Type', 'application/xml');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(this.buildAppsListXml());
    });

    // Get YouTube app state
    this.router.get('/apps/YouTube', (req: Request, res: Response) => {
      console.log('[DIAL] YouTube app state requested');
      
      const app = this.apps.get('YouTube');
      const state = app?.state || 'stopped';
      
      console.log(`[DIAL] Current YouTube state: ${state}`);
      
      res.set('Content-Type', 'application/xml');
      res.set('Access-Control-Allow-Origin', '*');
      
      const xml = this.buildAppStateXml('YouTube', state, app?.additionalData);
      console.log(`[DIAL] Sending app state XML:\n${xml}`);
      res.send(xml);
    });

    // Launch YouTube app (POST with video URL params)
    this.router.post('/apps/YouTube', (req: Request, res: Response) => {
      console.log('[DIAL] YouTube app launch requested');
      console.log('[DIAL] Content-Type:', req.headers['content-type']);
      console.log('[DIAL] Body:', req.body);
      
      // Parse the launch data (URL-encoded form data)
      let videoId: string | undefined;
      let listId: string | undefined;
      let currentTime = 0;
      let currentIndex = 0;
      
      // Handle both URL-encoded and raw body
      const bodyStr = typeof req.body === 'string' ? req.body : 
                      typeof req.body === 'object' ? new URLSearchParams(req.body as Record<string, string>).toString() : '';
      
      // YouTube sends data as URL-encoded: v=VIDEO_ID&t=TIME&list=PLAYLIST_ID
      if (bodyStr) {
        const params = new URLSearchParams(bodyStr);
        videoId = params.get('v') || params.get('videoId') || undefined;
        listId = params.get('list') || params.get('listId') || undefined;
        const timeParam = params.get('t') || params.get('currentTime');
        if (timeParam) currentTime = parseInt(timeParam, 10) || 0;
        const indexParam = params.get('index') || params.get('currentIndex');
        if (indexParam) currentIndex = parseInt(indexParam, 10) || 0;
        
        // Check for pairing code
        const pairingCode = params.get('pairingCode');
        if (pairingCode) {
          console.log(`[DIAL] Received pairing code: ${pairingCode}`);
          // For now, accept any pairing code
          // In a real implementation, you might want to validate this
        }
      }
      
      // Also check query params (some clients send data this way)
      if (!videoId && req.query.v) {
        videoId = req.query.v as string;
      }
      
      console.log(`[DIAL] YouTube launch params - videoId: ${videoId}, listId: ${listId}, time: ${currentTime}`);
      
      // Generate a unique instance ID
      const instanceId = generateUUID().substring(0, 8);
      
      // Update app state
      this.apps.set('YouTube', {
        state: 'running',
        pid: instanceId,
        additionalData: {
          videoId: videoId || '',
          listId: listId || '',
        },
      });
      
      // Emit event for the video streamer to handle
      if (videoId) {
        const playRequest: YouTubePlayRequest = {
          videoId,
          listId,
          currentTime,
          currentIndex,
        };
        
        console.log(`[DIAL] Emitting youtube-play event for video: ${videoId}`);
        this.emit('youtube-play', playRequest);
      } else {
        console.log('[DIAL] YouTube app launched without video ID (app-only launch)');
        this.emit('youtube-launch');
      }
      
      // Respond with 201 Created and the instance URL
      res.status(201);
      res.set('Location', `http://${this.localIp}:${this.port}/apps/YouTube/${instanceId}`);
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.send();
    });

    // Get running YouTube app instance
    this.router.get('/apps/YouTube/:instanceId', (req: Request, res: Response) => {
      const { instanceId } = req.params;
      const app = this.apps.get('YouTube');
      
      if (!app || app.state === 'stopped' || app.pid !== instanceId) {
        return res.status(404).send('App instance not found');
      }
      
      res.set('Content-Type', 'application/xml');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(this.buildAppStateXml('YouTube', app.state, app.additionalData));
    });
    
    // Update YouTube app instance (PUT for video data)
    this.router.put('/apps/YouTube/:instanceId', (req: Request, res: Response) => {
      const { instanceId } = req.params;
      const app = this.apps.get('YouTube');
      
      console.log(`[DIAL] YouTube app update requested for instance: ${instanceId}`);
      console.log(`[DIAL] Content-Type:`, req.headers['content-type']);
      console.log(`[DIAL] Body:`, req.body);
      
      if (!app || app.state === 'stopped' || app.pid !== instanceId) {
        return res.status(404).send('App instance not found');
      }
      
      // Parse the update data (URL-encoded form data)
      const bodyStr = typeof req.body === 'string' ? req.body : '';
      if (bodyStr) {
        const params = new URLSearchParams(bodyStr);
        const videoId = params.get('v') || params.get('videoId') || undefined;
        const listId = params.get('list') || params.get('listId') || undefined;
        const timeParam = params.get('t') || params.get('currentTime');
        const currentTime = timeParam ? parseInt(timeParam, 10) || 0 : 0;
        
        if (videoId) {
          console.log(`[DIAL] Received video via PUT: ${videoId}`);
          
          // Update app state
          this.apps.set('YouTube', {
            state: 'running',
            pid: instanceId,
            additionalData: {
              videoId,
              listId: listId || '',
            },
          });
          
          // Emit event for the video streamer to handle
          const playRequest: YouTubePlayRequest = {
            videoId,
            listId,
            currentTime,
            currentIndex: 0,
          };
          
          console.log(`[DIAL] Emitting youtube-play event for video: ${videoId}`);
          this.emit('youtube-play', playRequest);
        }
      }
      
      res.set('Access-Control-Allow-Origin', '*');
      res.status(200).send();
    });

    // Stop YouTube app instance
    this.router.delete('/apps/YouTube/:instanceId', (req: Request, res: Response) => {
      const { instanceId } = req.params;
      const app = this.apps.get('YouTube');
      
      console.log(`[DIAL] YouTube stop requested for instance: ${instanceId}`);
      
      if (app && app.pid === instanceId) {
        this.apps.set('YouTube', { state: 'stopped' });
        this.emit('youtube-stop');
      }
      
      res.status(200).send();
    });

    // Handle CORS preflight for cast clients
    this.router.options('/apps/YouTube', (req: Request, res: Response) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.status(200).send();
    });

    // Additional YouTube DIAL endpoints
    
    // Receive queue/playlist updates
    this.router.post('/apps/YouTube/queue', (req: Request, res: Response) => {
      console.log('[DIAL] YouTube queue update:', req.body);
      
      // Parse queue data
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      this.emit('youtube-queue', bodyStr);
      
      res.status(200).send();
    });
  }

  private buildDeviceDescription(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:r="urn:restful-tv-org:schemas:upnp-dd">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>urn:dial-multiscreen-org:device:dial:1</deviceType>
    <friendlyName>${escapeXml(this.config.friendlyName)}</friendlyName>
    <manufacturer>${escapeXml(this.config.manufacturer)}</manufacturer>
    <modelName>${escapeXml(this.config.modelName)}</modelName>
    <UDN>uuid:${this.config.uuid}</UDN>
    <serviceList>
      <service>
        <serviceType>urn:dial-multiscreen-org:service:dial:1</serviceType>
        <serviceId>urn:dial-multiscreen-org:serviceId:dial</serviceId>
        <SCPDURL>/ssdp/notfound.xml</SCPDURL>
        <controlURL>/ssdp/notfound.xml</controlURL>
        <eventSubURL>/ssdp/notfound.xml</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`;
  }

  private buildAppsListXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<apps xmlns="urn:dial-multiscreen-org:schemas:dial">
  <app>
    <name>YouTube</name>
    <options allowStop="true"/>
  </app>
</apps>`;
  }

  private buildAppStateXml(
    appName: string, 
    state: 'stopped' | 'running' | 'hidden',
    additionalData?: Record<string, string>
  ): string {
    let additionalDataXml = '';
    if (additionalData) {
      const entries = Object.entries(additionalData)
        .filter(([_, v]) => v)
        .map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`)
        .join('\n      ');
      if (entries) {
        additionalDataXml = `\n    <additionalData>\n      ${entries}\n    </additionalData>`;
      }
    }
    
    const runningLink = state === 'running' && this.apps.get(appName)?.pid
      ? `\n    <link rel="run" href="run"/>`
      : '';
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<service xmlns="urn:dial-multiscreen-org:schemas:dial" dialVer="2.2">
  <name>${escapeXml(appName)}</name>
  <options allowStop="true"/>
  <state>${state}</state>${runningLink}${additionalDataXml}
</service>`;
  }

  getRouter(): Router {
    return this.router;
  }

  // Update the YouTube app state (called when playback starts/stops)
  setYouTubeState(state: 'stopped' | 'running' | 'hidden', videoId?: string): void {
    const currentApp = this.apps.get('YouTube');
    this.apps.set('YouTube', {
      state,
      pid: state === 'running' ? (currentApp?.pid || generateUUID().substring(0, 8)) : undefined,
      additionalData: videoId ? { videoId } : undefined,
    });
    console.log(`[DIAL] YouTube app state updated to: ${state}`);
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default DIALServer;
