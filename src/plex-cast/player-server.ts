import express, { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';

export interface PlaybackState {
  state: 'stopped' | 'playing' | 'paused' | 'buffering';
  time: number;
  duration: number;
  ratingKey?: string;
  key?: string;
  containerKey?: string;
  machineIdentifier?: string;
  address?: string;
  port?: number;
  protocol?: string;
  token?: string;
  volume: number;
  shuffle: boolean;
  repeat: number;
}

export interface PlayMediaRequest {
  key: string;
  offset?: number;
  machineIdentifier: string;
  address: string;
  port: number;
  protocol: string;
  token?: string;
  containerKey?: string;
  playQueueID?: string;
}

export class PlexPlayerServer extends EventEmitter {
  private router: Router;
  private machineIdentifier: string;
  private playerName: string;
  private state: PlaybackState;
  private subscribers: Map<string, { address: string; port: number; protocol: string; commandID: number }> = new Map();

  constructor(machineIdentifier: string, playerName: string) {
    super();
    this.machineIdentifier = machineIdentifier;
    this.playerName = playerName;
    this.router = Router();
    this.state = {
      state: 'stopped',
      time: 0,
      duration: 0,
      volume: 100,
      shuffle: false,
      repeat: 0,
    };
    this.setupRoutes();
  }

  getRouter(): Router {
    return this.router;
  }

  private setupRoutes(): void {
    // CORS middleware for Plex
    this.router.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', '*');
      res.header('Access-Control-Expose-Headers', 'X-Plex-Client-Identifier');
      res.header('X-Plex-Client-Identifier', this.machineIdentifier);
      
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Resources endpoint
    this.router.get('/resources', (req, res) => {
      console.log('[PlexPlayer] GET /resources');
      const xml = this.buildResourcesXml();
      res.type('application/xml').send(xml);
    });

    // Timeline poll endpoint
    this.router.get('/player/timeline/poll', (req, res) => {
      const wait = req.query.wait === '1';
      const commandID = parseInt(req.query.commandID as string) || 0;
      
      console.log(`[PlexPlayer] Timeline poll - wait: ${wait}, commandID: ${commandID}`);
      
      const xml = this.buildTimelineXml(commandID);
      res.type('application/xml').send(xml);
    });

    // Timeline subscribe endpoint
    this.router.get('/player/timeline/subscribe', (req, res) => {
      const clientId = req.headers['x-plex-client-identifier'] as string;
      const protocol = req.query.protocol as string || 'http';
      const port = parseInt(req.query.port as string) || 32400;
      const commandID = parseInt(req.query.commandID as string) || 0;
      
      console.log(`[PlexPlayer] Timeline subscribe - client: ${clientId}, port: ${port}`);
      
      if (clientId) {
        this.subscribers.set(clientId, {
          address: req.ip || '127.0.0.1',
          port,
          protocol,
          commandID,
        });
      }
      
      const xml = this.buildTimelineXml(commandID);
      res.type('application/xml').send(xml);
    });

    // Timeline unsubscribe endpoint
    this.router.get('/player/timeline/unsubscribe', (req, res) => {
      const clientId = req.headers['x-plex-client-identifier'] as string;
      
      console.log(`[PlexPlayer] Timeline unsubscribe - client: ${clientId}`);
      
      if (clientId) {
        this.subscribers.delete(clientId);
      }
      
      res.sendStatus(200);
    });

    // Playback: Play media
    this.router.get('/player/playback/playMedia', async (req, res) => {
      console.log('[PlexPlayer] ========================================');
      console.log('[PlexPlayer] playMedia request received');
      console.log('[PlexPlayer] Query params:', req.query);
      console.log('[PlexPlayer] Headers:', req.headers);
      
      const playRequest: PlayMediaRequest = {
        key: req.query.key as string,
        offset: parseInt(req.query.offset as string) || 0,
        machineIdentifier: req.query.machineIdentifier as string,
        address: req.query.address as string,
        port: parseInt(req.query.port as string) || 32400,
        protocol: req.query.protocol as string || 'http',
        token: req.query.token as string,
        containerKey: req.query.containerKey as string,
        playQueueID: req.query.playQueueID as string,
      };
      
      console.log('[PlexPlayer] Parsed play request:', playRequest);
      
      // Update state
      this.state.state = 'buffering';
      this.state.key = playRequest.key;
      this.state.containerKey = playRequest.containerKey;
      this.state.machineIdentifier = playRequest.machineIdentifier;
      this.state.address = playRequest.address;
      this.state.port = playRequest.port;
      this.state.protocol = playRequest.protocol;
      this.state.token = playRequest.token;
      this.state.time = playRequest.offset || 0;
      
      // Emit play event for handling
      this.emit('playMedia', playRequest);
      
      res.sendStatus(200);
    });

    // Playback: Stop
    this.router.get('/player/playback/stop', (req, res) => {
      console.log('[PlexPlayer] Stop playback');
      
      this.state.state = 'stopped';
      this.state.time = 0;
      this.state.duration = 0;
      
      this.emit('stop');
      res.sendStatus(200);
    });

    // Playback: Pause
    this.router.get('/player/playback/pause', (req, res) => {
      console.log('[PlexPlayer] Pause playback');
      
      if (this.state.state === 'playing') {
        this.state.state = 'paused';
        this.emit('pause');
      }
      
      res.sendStatus(200);
    });

    // Playback: Play (resume)
    this.router.get('/player/playback/play', (req, res) => {
      console.log('[PlexPlayer] Resume playback');
      
      if (this.state.state === 'paused') {
        this.state.state = 'playing';
        this.emit('resume');
      }
      
      res.sendStatus(200);
    });

    // Playback: Seek
    this.router.get('/player/playback/seekTo', (req, res) => {
      const offset = parseInt(req.query.offset as string) || 0;
      console.log(`[PlexPlayer] Seek to ${offset}ms`);
      
      this.state.time = offset;
      this.emit('seek', offset);
      
      res.sendStatus(200);
    });

    // Playback: Set parameters (volume, shuffle, repeat)
    this.router.get('/player/playback/setParameters', (req, res) => {
      if (req.query.volume !== undefined) {
        this.state.volume = parseInt(req.query.volume as string);
      }
      if (req.query.shuffle !== undefined) {
        this.state.shuffle = req.query.shuffle === '1';
      }
      if (req.query.repeat !== undefined) {
        this.state.repeat = parseInt(req.query.repeat as string);
      }
      
      console.log(`[PlexPlayer] Set parameters - volume: ${this.state.volume}, shuffle: ${this.state.shuffle}, repeat: ${this.state.repeat}`);
      
      res.sendStatus(200);
    });

    // Skip to next/previous
    this.router.get('/player/playback/skipNext', (req, res) => {
      console.log('[PlexPlayer] Skip next');
      this.emit('skipNext');
      res.sendStatus(200);
    });

    this.router.get('/player/playback/skipPrevious', (req, res) => {
      console.log('[PlexPlayer] Skip previous');
      this.emit('skipPrevious');
      res.sendStatus(200);
    });

    // Step forward/back
    this.router.get('/player/playback/stepForward', (req, res) => {
      console.log('[PlexPlayer] Step forward');
      this.emit('stepForward');
      res.sendStatus(200);
    });

    this.router.get('/player/playback/stepBack', (req, res) => {
      console.log('[PlexPlayer] Step back');
      this.emit('stepBack');
      res.sendStatus(200);
    });

    // Navigation commands (for completeness)
    this.router.get('/player/navigation/*', (req, res) => {
      console.log(`[PlexPlayer] Navigation: ${req.path}`);
      res.sendStatus(200);
    });

    // Mirror commands (for completeness)
    this.router.get('/player/mirror/*', (req, res) => {
      console.log(`[PlexPlayer] Mirror: ${req.path}`);
      res.sendStatus(200);
    });
  }

  private buildResourcesXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer>
  <Player 
    title="${this.playerName}"
    machineIdentifier="${this.machineIdentifier}"
    product="SchroStream"
    version="1.0.0"
    platform="Node.js"
    platformVersion="${process.version}"
    protocolVersion="1"
    protocolCapabilities="timeline,playback,navigation,playqueues"
    deviceClass="stb"
  />
</MediaContainer>`;
  }

  private buildTimelineXml(commandID: number): string {
    const controllable = 'volume,shuffle,repeat,skipPrevious,skipNext,seekTo,stepBack,stepForward,stop,playPause';
    
    let videoTimeline = '';
    let musicTimeline = '';
    let photoTimeline = '';
    
    if (this.state.state !== 'stopped' && this.state.key) {
      videoTimeline = `<Timeline 
        type="video" 
        state="${this.state.state}"
        time="${this.state.time}"
        duration="${this.state.duration}"
        key="${this.state.key}"
        ${this.state.containerKey ? `containerKey="${this.state.containerKey}"` : ''}
        ${this.state.ratingKey ? `ratingKey="${this.state.ratingKey}"` : ''}
        ${this.state.machineIdentifier ? `machineIdentifier="${this.state.machineIdentifier}"` : ''}
        ${this.state.address ? `address="${this.state.address}"` : ''}
        ${this.state.port ? `port="${this.state.port}"` : ''}
        ${this.state.protocol ? `protocol="${this.state.protocol}"` : ''}
        ${this.state.token ? `token="${this.state.token}"` : ''}
        volume="${this.state.volume}"
        controllable="${controllable}"
      />`;
    } else {
      videoTimeline = `<Timeline type="video" state="stopped" controllable="${controllable}" />`;
    }
    
    musicTimeline = `<Timeline type="music" state="stopped" controllable="${controllable}" />`;
    photoTimeline = `<Timeline type="photo" state="stopped" controllable="${controllable}" />`;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer location="navigation" commandID="${commandID}">
  ${videoTimeline}
  ${musicTimeline}
  ${photoTimeline}
</MediaContainer>`;
  }

  // Update state from external source
  updateState(updates: Partial<PlaybackState>): void {
    Object.assign(this.state, updates);
  }

  // Set playing state with media info
  setPlaying(ratingKey: string, duration: number): void {
    this.state.state = 'playing';
    this.state.ratingKey = ratingKey;
    this.state.duration = duration;
    this.state.time = 0;
  }

  // Update playback position
  updatePosition(time: number): void {
    this.state.time = time;
  }

  // Set stopped state
  setStopped(): void {
    this.state.state = 'stopped';
    this.state.time = 0;
    this.state.duration = 0;
    this.state.ratingKey = undefined;
    this.state.key = undefined;
  }
}
