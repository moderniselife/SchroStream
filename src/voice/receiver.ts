import { 
  joinVoiceChannel, 
  VoiceConnectionStatus, 
  entersState,
  getVoiceConnection,
  EndBehaviorType
} from '@discordjs/voice';
import { createWriteStream, WriteStream } from 'fs';
import { join } from 'path';
import { processVoiceAudio } from './python-listener.js';
import type { Client, VoiceBasedChannel } from 'discord.js-selfbot-v13';
// Note: @discordjs/opus may need to be installed for Opus decoding

// Store the Discord client reference
let discordClient: Client | null = null;

export function setDiscordClient(client: Client): void {
  discordClient = client;
  console.log('[VoiceReceiver] Discord client set');
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
    if (!discordClient) {
      console.error('[VoiceAudioReceiver] Discord client not set!');
      return;
    }
    
    this.isRecording = true;
    this.bufferStartTime = Date.now();
    
    console.log(`[VoiceAudioReceiver] Starting voice receiver for guild ${this.guildId}, channel ${this.channelId}`);
    
    try {
      // Get the voice channel
      const guild = discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error('[VoiceAudioReceiver] Guild not found');
        return;
      }
      
      const channel = guild.channels.cache.get(this.channelId) as VoiceBasedChannel;
      if (!channel) {
        console.error('[VoiceAudioReceiver] Channel not found');
        return;
      }
      
      // Check if there's already a voice connection
      let connection = getVoiceConnection(this.guildId);
      
      if (!connection) {
        // Create a new voice connection using @discordjs/voice
        console.log('[VoiceAudioReceiver] Creating new voice connection...');
        connection = joinVoiceChannel({
          channelId: this.channelId,
          guildId: this.guildId,
          adapterCreator: guild.voiceAdapterCreator as any,
          selfDeaf: false,
          selfMute: true,
        });
        
        // Wait for connection to be ready
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        console.log('[VoiceAudioReceiver] Voice connection ready');
      } else {
        console.log('[VoiceAudioReceiver] Using existing voice connection');
      }
      
      // Get the voice receiver
      const receiver = connection.receiver;
      
      // Listen for speaking events
      receiver.speaking.on('start', (userId) => {
        console.log(`[VoiceAudioReceiver] User ${userId} started speaking`);
        
        // Subscribe to user's audio stream
        const audioStream = receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 2000,
          },
        });
        
        // Collect audio data
        const chunks: Buffer[] = [];
        
        audioStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        
        audioStream.on('end', () => {
          console.log(`[VoiceAudioReceiver] User ${userId} stopped speaking, collected ${chunks.length} chunks`);
          
          if (chunks.length > 0) {
            const fullBuffer = Buffer.concat(chunks);
            this.processAudio(fullBuffer);
          }
        });
        
        audioStream.on('error', (error) => {
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
