import { MediaUdp } from '@dank074/discord-video-stream';
import { createWriteStream, WriteStream } from 'fs';
import { join } from 'path';
import { processVoiceAudio } from './python-listener.js';

export class VoiceAudioReceiver {
  private guildId: string;
  private mediaUdp: MediaUdp | null = null;
  private audioStream: WriteStream | null = null;
  private isRecording: boolean = false;
  private silenceTimer: NodeJS.Timeout | null = null;
  private audioBuffer: Buffer[] = [];
  private bufferStartTime: number = 0;
  private originalHandleIncoming: ((buf: unknown) => void) | null = null;
  
  constructor(guildId: string) {
    this.guildId = guildId;
  }
  
  start(mediaUdp: MediaUdp): void {
    this.mediaUdp = mediaUdp;
    this.isRecording = true;
    this.bufferStartTime = Date.now();
    
    console.log(`[VoiceAudioReceiver] Started listening for voice in guild ${this.guildId}`);
    
    // Override the handleIncoming method to capture audio
    this.originalHandleIncoming = mediaUdp.handleIncoming.bind(mediaUdp);
    mediaUdp.handleIncoming = (buf: unknown) => {
      // Debug: Log incoming packets
      console.log(`[VoiceAudioReceiver] Received packet: ${typeof buf}, size: ${Buffer.isBuffer(buf) ? buf.length : 'N/A'}`);
      
      // Call original handler first
      if (this.originalHandleIncoming) {
        this.originalHandleIncoming(buf);
      }
      
      // Process audio if recording
      if (this.isRecording && Buffer.isBuffer(buf)) {
        this.processAudio(buf);
      }
    };
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
    
    // Restore original handler
    if (this.mediaUdp && this.originalHandleIncoming) {
      this.mediaUdp.handleIncoming = this.originalHandleIncoming;
    }
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    // Flush any remaining audio
    if (this.audioBuffer.length > 0) {
      this.flushBuffer();
    }
    
    if (this.audioStream) {
      this.audioStream.end();
      this.audioStream = null;
    }
    
    console.log(`[VoiceAudioReceiver] Stopped listening for voice in guild ${this.guildId}`);
  }
  
  cleanup(): void {
    this.stop();
    this.mediaUdp = null;
  }
}

// Map of active receivers per guild
const receivers = new Map<string, VoiceAudioReceiver>();

export function startVoiceReceiver(guildId: string, mediaUdp: MediaUdp): void {
  // Stop any existing receiver
  stopVoiceReceiver(guildId);
  
  console.log(`[VoiceReceiver] Starting voice receiver for guild ${guildId}`);
  const audioReceiver = new VoiceAudioReceiver(guildId);
  audioReceiver.start(mediaUdp);
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
