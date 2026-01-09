import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import config from '../config.js';
import { getVideoStreamer } from '../stream/video-streamer.js';

// Vosk model path - download from https://alphacephei.com/vosk/models
const MODEL_PATH = config.voice.modelPath || '/app/vosk-model';
const WAKE_WORD = config.voice.wakeWord;

interface VoiceCommand {
  action: string;
  value?: string | number;
}

// Parse voice command from transcribed text
function parseCommand(text: string): VoiceCommand | null {
  const lowerText = text.toLowerCase().trim();
  
  // Check for wake word
  if (!lowerText.includes(WAKE_WORD)) {
    return null;
  }
  
  // Extract command after wake word
  const wakeIndex = lowerText.indexOf(WAKE_WORD);
  const commandPart = lowerText.slice(wakeIndex + WAKE_WORD.length).trim();
  
  // Pause/Play commands
  if (commandPart.includes('pause') || commandPart.includes('stop playing')) {
    return { action: 'pause' };
  }
  
  if (commandPart.includes('play') || commandPart.includes('resume') || commandPart.includes('start')) {
    return { action: 'resume' };
  }
  
  if (commandPart.includes('stop')) {
    return { action: 'stop' };
  }
  
  // Speed commands
  const speedMatch = commandPart.match(/speed\s*(\d+\.?\d*)\s*x?/i);
  if (speedMatch) {
    return { action: 'speed', value: parseFloat(speedMatch[1]) };
  }
  
  if (commandPart.includes('faster') || commandPart.includes('speed up')) {
    return { action: 'speed_up' };
  }
  
  if (commandPart.includes('slower') || commandPart.includes('slow down')) {
    return { action: 'speed_down' };
  }
  
  if (commandPart.includes('normal speed') || commandPart.includes('regular speed')) {
    return { action: 'speed', value: 1 };
  }
  
  // Seek commands
  const forwardMatch = commandPart.match(/(?:skip|forward|fast forward)\s*(\d+)?\s*(?:seconds?|sec|s)?/i);
  if (forwardMatch) {
    const seconds = forwardMatch[1] ? parseInt(forwardMatch[1]) : 30;
    return { action: 'forward', value: seconds };
  }
  
  const backMatch = commandPart.match(/(?:back|backward|rewind)\s*(\d+)?\s*(?:seconds?|sec|s)?/i);
  if (backMatch) {
    const seconds = backMatch[1] ? parseInt(backMatch[1]) : 30;
    return { action: 'back', value: seconds };
  }
  
  // Volume commands
  const volumeMatch = commandPart.match(/volume\s*(\d+)/i);
  if (volumeMatch) {
    return { action: 'volume', value: parseInt(volumeMatch[1]) };
  }
  
  if (commandPart.includes('mute')) {
    return { action: 'volume', value: 0 };
  }
  
  if (commandPart.includes('unmute') || commandPart.includes('un mute')) {
    return { action: 'volume', value: 100 };
  }
  
  return null;
}

// Execute a voice command
async function executeCommand(guildId: string, command: VoiceCommand): Promise<string> {
  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(guildId);
  
  if (!session && command.action !== 'stop') {
    return 'Nothing is playing';
  }
  
  switch (command.action) {
    case 'pause':
      await videoStreamer.pauseStream(guildId);
      return 'Paused';
      
    case 'resume':
      if (session?.isPaused) {
        await videoStreamer.resumeStream(guildId);
        return 'Resumed';
      }
      return 'Already playing';
      
    case 'stop':
      await videoStreamer.stopStream(guildId);
      return 'Stopped';
      
    case 'speed':
      if (typeof command.value === 'number') {
        await videoStreamer.setSpeed(guildId, command.value);
        return `Speed set to ${command.value}x`;
      }
      break;
      
    case 'speed_up':
      const currentSpeed = videoStreamer.getSpeed(guildId);
      const newSpeedUp = Math.min(currentSpeed + 0.25, 3);
      await videoStreamer.setSpeed(guildId, newSpeedUp);
      return `Speed set to ${newSpeedUp}x`;
      
    case 'speed_down':
      const currSpeed = videoStreamer.getSpeed(guildId);
      const newSpeedDown = Math.max(currSpeed - 0.25, 0.5);
      await videoStreamer.setSpeed(guildId, newSpeedDown);
      return `Speed set to ${newSpeedDown}x`;
      
    case 'forward':
      if (typeof command.value === 'number') {
        const currentTime = videoStreamer.getCurrentTime(guildId);
        const newTime = currentTime + (command.value * 1000);
        await videoStreamer.seekStream(guildId, newTime);
        return `Skipped forward ${command.value} seconds`;
      }
      break;
      
    case 'back':
      if (typeof command.value === 'number') {
        const currentTime = videoStreamer.getCurrentTime(guildId);
        const newTime = Math.max(0, currentTime - (command.value * 1000));
        await videoStreamer.seekStream(guildId, newTime);
        return `Skipped back ${command.value} seconds`;
      }
      break;
      
    case 'volume':
      if (typeof command.value === 'number') {
        await videoStreamer.setVolume(guildId, command.value);
        return `Volume set to ${command.value}%`;
      }
      break;
  }
  
  return 'Unknown command';
}

// Voice listener class
export class VoiceListener {
  private guildId: string;
  private isListening: boolean = false;
  private audioBuffer: Buffer[] = [];
  private silenceTimeout: NodeJS.Timeout | null = null;
  private model: any = null;
  private recognizer: any = null;
  
  constructor(guildId: string) {
    this.guildId = guildId;
  }
  
  async initialize(): Promise<boolean> {
    if (!config.voice.enabled) {
      console.log('[VoiceListener] Voice commands disabled');
      return false;
    }
    
    if (!existsSync(MODEL_PATH)) {
      console.error(`[VoiceListener] Vosk model not found at ${MODEL_PATH}`);
      console.error('[VoiceListener] Download a model from https://alphacephei.com/vosk/models');
      console.error('[VoiceListener] Recommended: vosk-model-small-en-us-0.15 (40MB)');
      return false;
    }
    
    try {
      const vosk = await import('vosk');
      vosk.setLogLevel(-1); // Disable vosk logs
      
      this.model = new vosk.Model(MODEL_PATH);
      this.recognizer = new vosk.Recognizer({ model: this.model, sampleRate: 48000 });
      
      console.log(`[VoiceListener] Initialized for guild ${this.guildId}`);
      console.log(`[VoiceListener] Wake word: "${WAKE_WORD}"`);
      return true;
    } catch (error) {
      console.error('[VoiceListener] Failed to initialize:', error);
      return false;
    }
  }
  
  // Process incoming audio data
  processAudio(audioData: Buffer): void {
    if (!this.isListening || !this.recognizer) return;
    
    // Convert to proper format if needed (Discord sends opus, we need PCM)
    this.audioBuffer.push(audioData);
    
    // Reset silence timeout
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }
    
    // After 1.5 seconds of silence, process the buffer
    this.silenceTimeout = setTimeout(() => {
      this.processBuffer();
    }, 1500);
  }
  
  private async processBuffer(): Promise<void> {
    if (this.audioBuffer.length === 0 || !this.recognizer) return;
    
    const fullBuffer = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    
    try {
      // Feed audio to recognizer
      if (this.recognizer.acceptWaveform(fullBuffer)) {
        const result = JSON.parse(this.recognizer.result());
        if (result.text) {
          console.log(`[VoiceListener] Heard: "${result.text}"`);
          
          const command = parseCommand(result.text);
          if (command) {
            console.log(`[VoiceListener] Command: ${command.action}`, command.value || '');
            const response = await executeCommand(this.guildId, command);
            console.log(`[VoiceListener] Response: ${response}`);
          }
        }
      } else {
        // Partial result
        const partial = JSON.parse(this.recognizer.partialResult());
        if (partial.partial && partial.partial.includes(WAKE_WORD)) {
          console.log(`[VoiceListener] Partial (wake word detected): "${partial.partial}"`);
        }
      }
    } catch (error) {
      console.error('[VoiceListener] Error processing audio:', error);
    }
  }
  
  start(): void {
    this.isListening = true;
    console.log(`[VoiceListener] Started listening for guild ${this.guildId}`);
  }
  
  stop(): void {
    this.isListening = false;
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }
    this.audioBuffer = [];
    console.log(`[VoiceListener] Stopped listening for guild ${this.guildId}`);
  }
  
  cleanup(): void {
    this.stop();
    if (this.recognizer) {
      this.recognizer.free();
      this.recognizer = null;
    }
    if (this.model) {
      this.model.free();
      this.model = null;
    }
  }
}

// Map of active voice listeners per guild
const listeners = new Map<string, VoiceListener>();

export async function startVoiceListener(guildId: string): Promise<boolean> {
  if (listeners.has(guildId)) {
    return true; // Already listening
  }
  
  const listener = new VoiceListener(guildId);
  const initialized = await listener.initialize();
  
  if (initialized) {
    listeners.set(guildId, listener);
    listener.start();
    return true;
  }
  
  return false;
}

export function stopVoiceListener(guildId: string): void {
  const listener = listeners.get(guildId);
  if (listener) {
    listener.cleanup();
    listeners.delete(guildId);
  }
}

export function getVoiceListener(guildId: string): VoiceListener | undefined {
  return listeners.get(guildId);
}

export function processVoiceAudio(guildId: string, audioData: Buffer): void {
  const listener = listeners.get(guildId);
  if (listener) {
    listener.processAudio(audioData);
  }
}
