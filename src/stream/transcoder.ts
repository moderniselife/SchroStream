import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { Readable, PassThrough } from 'stream';
import type { TranscodeOptions } from '../types/index.js';
import config from '../config.js';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

export interface TranscodeStream {
  videoStream: PassThrough;
  audioStream: PassThrough;
  command: ffmpeg.FfmpegCommand;
  kill: () => void;
}

export function createTranscodeStream(
  inputUrl: string,
  options: TranscodeOptions = {},
  startTime = 0
): TranscodeStream {
  const {
    width = 1920,
    height = 1080,
    videoBitrate = config.stream.maxBitrate,
    audioBitrate = config.stream.audioBitrate,
    fps = 30,
  } = options;

  const videoStream = new PassThrough();
  const audioStream = new PassThrough();

  const command = ffmpeg(inputUrl)
    .inputOptions([
      '-re',
      '-ss', startTime.toString(),
    ])
    .outputOptions([
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.1',
      '-b:v', `${videoBitrate}k`,
      '-maxrate', `${videoBitrate}k`,
      '-bufsize', `${videoBitrate * 2}k`,
      '-r', fps.toString(),
      `-vf`, `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      '-c:a', 'libopus',
      '-b:a', `${audioBitrate}k`,
      '-ar', '48000',
      '-ac', '2',
      '-f', 'mpegts',
      '-',
    ])
    .on('start', (cmd) => {
      console.log('[Transcoder] Started:', cmd);
    })
    .on('error', (err, stdout, stderr) => {
      if (!err.message.includes('SIGKILL')) {
        console.error('[Transcoder] Error:', err.message);
      }
    })
    .on('end', () => {
      console.log('[Transcoder] Finished');
      videoStream.end();
      audioStream.end();
    });

  const outputStream = command.pipe() as PassThrough;
  outputStream.pipe(videoStream);

  return {
    videoStream,
    audioStream,
    command,
    kill: () => {
      command.kill('SIGKILL');
    },
  };
}

export function createAudioOnlyStream(
  inputUrl: string,
  startTime = 0
): { stream: Readable; command: ffmpeg.FfmpegCommand; kill: () => void } {
  const audioStream = new PassThrough();

  const command = ffmpeg(inputUrl)
    .inputOptions(['-ss', startTime.toString()])
    .outputOptions([
      '-map', '0:a:0',
      '-c:a', 'libopus',
      '-b:a', `${config.stream.audioBitrate}k`,
      '-ar', '48000',
      '-ac', '2',
      '-f', 'opus',
      '-',
    ])
    .on('start', (cmd) => {
      console.log('[Transcoder Audio] Started:', cmd);
    })
    .on('error', (err) => {
      if (!err.message.includes('SIGKILL')) {
        console.error('[Transcoder Audio] Error:', err.message);
      }
    })
    .on('end', () => {
      console.log('[Transcoder Audio] Finished');
      audioStream.end();
    });

  const outputStream = command.pipe() as PassThrough;
  outputStream.pipe(audioStream);

  return {
    stream: audioStream,
    command,
    kill: () => {
      command.kill('SIGKILL');
    },
  };
}

export function probeMedia(inputUrl: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputUrl, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

export default {
  createTranscodeStream,
  createAudioOnlyStream,
  probeMedia,
};
