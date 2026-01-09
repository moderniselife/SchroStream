import { spawn, ChildProcess } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import config from '../config.js';
import { getVideoStreamer } from '../stream/video-streamer.js';

interface VoiceCommand {
  action: string;
  value?: string | number;
}

// Parse voice command from transcribed text
function parseCommand(text: string): VoiceCommand | null {
  const lowerText = text.toLowerCase().trim();
  
  // Check for wake word
  if (!lowerText.includes(config.voice.wakeWord)) {
    return null;
  }
  
  // Extract command after wake word
  const wakeIndex = lowerText.indexOf(config.voice.wakeWord);
  const commandPart = lowerText.slice(wakeIndex + config.voice.wakeWord.length).trim();
  
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

// Python speech recognition listener
export class PythonVoiceListener {
  private guildId: string;
  private isListening: boolean = false;
  private pythonProcess: ChildProcess | null = null;
  private audioBuffer: Buffer[] = [];
  private silenceTimeout: NodeJS.Timeout | null = null;
  private tempAudioPath: string;
  
  constructor(guildId: string) {
    this.guildId = guildId;
    this.tempAudioPath = `/tmp/voice_${guildId}.wav`;
  }
  
  async initialize(): Promise<boolean> {
    if (!config.voice.enabled) {
      console.log('[PythonVoiceListener] Voice commands disabled');
      return false;
    }
    
    // Check if Python and speech_recognition are available
    try {
      const checkPython = spawn('python3', ['-c', 'import speech_recognition; print("OK")']);
      await new Promise((resolve, reject) => {
        checkPython.on('close', (code) => {
          if (code === 0) resolve(true);
          else reject(new Error('Python or speech_recognition not available'));
        });
        checkPython.on('error', reject);
      });
    } catch (error) {
      console.error('[PythonVoiceListener] Python not available:', error);
      return false;
    }
    
    console.log(`[PythonVoiceListener] Initialized for guild ${this.guildId}`);
    console.log(`[PythonVoiceListener] Wake word: "${config.voice.wakeWord}"`);
    return true;
  }
  
  // Process incoming audio data
  processAudio(audioData: Buffer): void {
    if (!this.isListening) return;
    
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
    if (this.audioBuffer.length === 0) return;
    
    const fullBuffer = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    
    // Skip if buffer is too small (likely noise)
    if (fullBuffer.length < 1000) {
      console.log(`[PythonVoiceListener] Buffer too small (${fullBuffer.length} bytes), skipping`);
      return;
    }
    
    try {
      const fs = await import('fs');
      const opusPath = this.tempAudioPath.replace('.wav', '.opus');
      const wavPath = this.tempAudioPath;
      
      // Write raw opus data to file
      fs.writeFileSync(opusPath, fullBuffer);
      
      // Convert Opus to WAV using FFmpeg
      // Discord audio is 48kHz stereo Opus
      const converted = await this.convertOpusToWav(opusPath, wavPath);
      
      if (!converted) {
        console.log('[PythonVoiceListener] Failed to convert audio');
        try { fs.unlinkSync(opusPath); } catch {}
        return;
      }
      
      // Clean up opus file
      try { fs.unlinkSync(opusPath); } catch {}
      
      // Use Python to transcribe
      const transcription = await this.transcribeAudio();
      if (transcription) {
        console.log(`[PythonVoiceListener] Heard: "${transcription}"`);
        
        const command = parseCommand(transcription);
        if (command) {
          console.log(`[PythonVoiceListener] Command: ${command.action}`, command.value || '');
          const response = await executeCommand(this.guildId, command);
          console.log(`[PythonVoiceListener] Response: ${response}`);
        }
      }
      
      // Clean up temp file
      try {
        fs.unlinkSync(wavPath);
      } catch {
        // Ignore cleanup errors
      }
    } catch (error) {
      console.error('[PythonVoiceListener] Error processing audio:', error);
    }
  }
  
  private convertOpusToWav(opusPath: string, wavPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      // Discord sends raw Opus frames at 48kHz stereo
      // FFmpeg can decode this to WAV
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-f', 's16le',           // Input format: signed 16-bit little-endian PCM
        '-ar', '48000',          // Input sample rate: 48kHz
        '-ac', '2',              // Input channels: stereo
        '-i', opusPath,          // Input file
        '-ar', '16000',          // Output sample rate: 16kHz (better for speech recognition)
        '-ac', '1',              // Output channels: mono
        wavPath                   // Output file
      ]);
      
      ffmpeg.stderr.on('data', (data) => {
        // FFmpeg outputs to stderr, ignore unless debugging
        // console.log('[FFmpeg]', data.toString());
      });
      
      ffmpeg.on('close', (code) => {
        resolve(code === 0);
      });
      
      ffmpeg.on('error', (error) => {
        console.error('[PythonVoiceListener] FFmpeg error:', error);
        resolve(false);
      });
    });
  }
  
  private transcribeAudio(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const python = spawn('python3', ['-c', `
import speech_recognition as sr
import sys

try:
    r = sr.Recognizer()
    with sr.AudioFile("${this.tempAudioPath}") as source:
        audio = r.record(source, duration=5)
        text = r.recognize_google(audio)
        print(text)
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
      `]);
      
      let output = '';
      python.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      python.stderr.on('data', (data) => {
        console.error('[PythonVoiceListener] Transcription error:', data.toString());
      });
      
      python.on('close', (code) => {
        if (code === 0) {
          const text = output.trim();
          if (text && text !== 'ERROR: ' && !text.startsWith('ERROR:')) {
            resolve(text);
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
  }
  
  start(): void {
    this.isListening = true;
    console.log(`[PythonVoiceListener] Started listening for guild ${this.guildId}`);
  }
  
  stop(): void {
    this.isListening = false;
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
    }
    this.audioBuffer = [];
    console.log(`[PythonVoiceListener] Stopped listening for guild ${this.guildId}`);
  }
  
  cleanup(): void {
    this.stop();
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }
}

// Map of active voice listeners per guild
const listeners = new Map<string, PythonVoiceListener>();

export async function startVoiceListener(guildId: string): Promise<boolean> {
  if (listeners.has(guildId)) {
    return true; // Already listening
  }
  
  const listener = new PythonVoiceListener(guildId);
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

export function getVoiceListener(guildId: string): PythonVoiceListener | undefined {
  return listeners.get(guildId);
}

export function processVoiceAudio(guildId: string, audioData: Buffer): void {
  const listener = listeners.get(guildId);
  if (listener) {
    listener.processAudio(audioData);
  }
}
