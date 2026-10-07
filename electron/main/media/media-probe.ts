import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { MediaInfo } from './types';

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

interface FfprobePayload {
  format?: {
    duration?: string;
  };
  streams?: FfprobeStream[];
}

function parseFraction(value?: string): number {
  if (!value) return 0;

  const [numeratorText, denominatorText] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

export function parseFfprobeOutput(filePath: string, stdout: string): MediaInfo {
  let payload: FfprobePayload;

  try {
    payload = JSON.parse(stdout) as FfprobePayload;
  } catch {
    throw new Error('FFPROBE_INVALID_JSON');
  }

  const streams = payload.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video) {
    throw new Error('FFPROBE_NO_VIDEO_STREAM');
  }

  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const durationSec = Number(payload.format?.duration);

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('FFPROBE_INVALID_DURATION');
  }

  const fps =
    parseFraction(video.avg_frame_rate) ||
    parseFraction(video.r_frame_rate);

  return {
    path: filePath,
    durationSec,
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    fps,
    videoCodec: video.codec_name ?? 'unknown',
    audioCodec: audio?.codec_name,
    hasAudio: Boolean(audio),
  };
}

async function validateInputPath(filePath: string): Promise<void> {
  if (path.extname(filePath).toLowerCase() !== '.mp4') {
    throw new Error('UNSUPPORTED_MEDIA');
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error('FILE_NOT_FOUND');
  }
}

export async function probeMedia(filePath: string): Promise<MediaInfo> {
  await validateInputPath(filePath);

  const executable = process.env.FFPROBE_PATH || 'ffprobe';
  const args = [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  return new Promise<MediaInfo>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', () => {
      reject(new Error('FFPROBE_FAILED'));
    });

    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || 'FFPROBE_FAILED'));
        return;
      }

      try {
        resolve(parseFfprobeOutput(filePath, stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}
