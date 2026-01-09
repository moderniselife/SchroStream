import { 
  joinVoiceChannel, 
  VoiceConnectionStatus, 
  entersState,
  getVoiceConnection,
  EndBehaviorType,
  VoiceConnection
} from '@discordjs/voice';
import { Client, GatewayIntentBits } from 'discord.js';
import { processVoiceAudio } from './python-listener.js';
import config from '../config.js';
import prism from 'prism-media';

// Separate bot client for voice listening (not the selfbot)
let voiceListenerBot: Client | null = null;
let voiceConnection: VoiceConnection | null = null;
let isInitialized = false;

async function initVoiceListenerBot(): Promise<boolean> {
  if (isInitialized && voiceListenerBot) return true;
  
  const botToken = config.discord.botToken;
  if (!botToken) {
    console.error('[VoiceReceiver] No BOT_TOKEN configured - voice commands disabled');
    console.error('[VoiceReceiver] Add BOT_TOKEN to .env for a separate bot to listen for voice commands');
    return false;
  }
  
  try {
    voiceListenerBot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });
    
    await voiceListenerBot.login(botToken);
    
    voiceListenerBot.once('ready', () => {
      console.log(`[VoiceReceiver] Voice listener bot ready: ${voiceListenerBot?.user?.tag}`);
    });
    
    // Wait for ready
    await new Promise<void>((resolve) => {
      if (voiceListenerBot?.isReady()) {
        resolve();
      } else {
        voiceListenerBot?.once('ready', () => resolve());
      }
    });
    
    isInitialized = true;
    console.log('[VoiceReceiver] Voice listener bot initialized successfully');
    return true;
  } catch (error) {
    console.error('[VoiceReceiver] Failed to initialize voice listener bot:', error);
    return false;
  }
}

export class VoiceAudioReceiver {
  private guildId: string;
  private channelId: string;
  private isRecording: boolean = false;
  private silenceTimer: NodeJS.Timeout | null = null;
  private audioBuffer: Buffer[] = [];
  private bufferStartTime: number = 0;
  
  constructor(guildId: string, channelId: string) {
    this.guildId = guildId;
    this.channelId = channelId;
    
  }
  
  async start(): Promise<void> {
    // Initialize the separate voice listener bot
    const initialized = await initVoiceListenerBot();
    if (!initialized || !voiceListenerBot) {
      console.error('[VoiceAudioReceiver] Voice listener bot not available');
      return;
    }
    
    this.isRecording = true;
    this.bufferStartTime = Date.now();
    
    console.log(`[VoiceAudioReceiver] Starting voice receiver for guild ${this.guildId}, channel ${this.channelId}`);
    
    try {
      // Get the guild from the voice listener bot
      const guild = voiceListenerBot.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error('[VoiceAudioReceiver] Guild not found - make sure the voice listener bot is in the server');
        return;
      }
      
      const channel = guild.channels.cache.get(this.channelId);
      if (!channel) {
        console.error('[VoiceAudioReceiver] Channel not found');
        return;
      }
      
      // Check if there's already a voice connection for this guild
      let connection = getVoiceConnection(this.guildId);
      
      if (!connection) {
        // Create a new voice connection using @discordjs/voice with the voice listener bot
        console.log('[VoiceAudioReceiver] Voice listener bot joining voice channel...');
        connection = joinVoiceChannel({
          channelId: this.channelId,
          guildId: this.guildId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: true,
        });
        
        voiceConnection = connection;
        
        // Wait for connection to be ready
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        console.log('[VoiceAudioReceiver] Voice listener bot connected and ready');
      } else {
        console.log('[VoiceAudioReceiver] Using existing voice connection');
      }
      
      // Get the voice receiver
      const receiver = connection.receiver;
      
      // Listen for speaking events
      receiver.speaking.on('start', (userId) => {
        console.log(`[VoiceAudioReceiver] User ${userId} started speaking`);
        
        // Subscribe to user's audio stream (returns Opus-encoded audio)
        const opusStream = receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 2000,
          },
        });
        
        // Decode Opus to PCM (s16le, 48kHz, stereo)
        const opusDecoder = new prism.opus.Decoder({
          rate: 48000,
          channels: 2,
          frameSize: 960, // 20ms at 48kHz
        });
        
        // Collect decoded PCM audio data
        const chunks: Buffer[] = [];
        
        // Pipe Opus stream through decoder
        opusStream.pipe(opusDecoder);
        
        opusDecoder.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        
        opusDecoder.on('end', () => {
          console.log(`[VoiceAudioReceiver] User ${userId} stopped speaking, collected ${chunks.length} PCM chunks`);
          
          if (chunks.length > 0) {
            const fullBuffer = Buffer.concat(chunks);
            console.log(`[VoiceAudioReceiver] Total PCM audio: ${fullBuffer.length} bytes (~${(fullBuffer.length / (48000 * 2 * 2)).toFixed(2)}s)`);
            this.processAudio(fullBuffer);
          }
        });
        
        opusDecoder.on('error', (error) => {
          console.error(`[VoiceAudioReceiver] Opus decoder error:`, error);
        });
        
        opusStream.on('error', (error) => {
          console.error(`[VoiceAudioReceiver] Audio stream error:`, error);
        });
      });
      
      receiver.speaking.on('end', (userId) => {
        console.log(`[VoiceAudioReceiver] User ${userId} stopped speaking (event)`);
      });
      
      console.log('[VoiceAudioReceiver] Voice receiver started, listening for speech...');
      
    } catch (error) {
      console.error('[VoiceAudioReceiver] Failed to start voice receiver:', error);
    }
  }
  
  private processAudio(audioData: Buffer): void {
    // Discord voice data is in Opus format, need to convert to PCM
    // For now, we'll buffer it and send to Python for processing
    this.audioBuffer.push(audioData);
    
    // Reset silence timer
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    
    // After 2 seconds of silence, process the buffer
    this.silenceTimer = setTimeout(() => {
      this.flushBuffer();
    }, 2000);
  }
  
  private flushBuffer(): void {
    if (this.audioBuffer.length === 0) return;
    
    const fullBuffer = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    
    // Send to Python voice listener for transcription
    processVoiceAudio(this.guildId, fullBuffer);
    
    console.log(`[VoiceAudioReceiver] Processed ${fullBuffer.length} bytes of audio`);
  }
  
  stop(): void {
    this.isRecording = false;
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    // Flush any remaining audio
    if (this.audioBuffer.length > 0) {
      this.flushBuffer();
    }
    
    console.log(`[VoiceAudioReceiver] Stopped listening for voice in guild ${this.guildId}`);
  }
  
  cleanup(): void {
    this.stop();
  }
}

// Map of active receivers per guild
const receivers = new Map<string, VoiceAudioReceiver>();

export function startVoiceReceiver(guildId: string, channelId: string): void {
  // Stop any existing receiver
  stopVoiceReceiver(guildId);
  
  console.log(`[VoiceReceiver] Starting voice receiver for guild ${guildId}`);
  const audioReceiver = new VoiceAudioReceiver(guildId, channelId);
  audioReceiver.start();
  receivers.set(guildId, audioReceiver);
  console.log(`[VoiceReceiver] Voice receiver started for guild ${guildId}`);
}

export function stopVoiceReceiver(guildId: string): void {
  const receiver = receivers.get(guildId);
  if (receiver) {
    receiver.cleanup();
    receivers.delete(guildId);
  }
}

export function getVoiceReceiver(guildId: string): VoiceAudioReceiver | undefined {
  return receivers.get(guildId);
}
