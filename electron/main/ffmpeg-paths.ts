import { existsSync } from 'node:fs';
import path from 'node:path';

type ElectronProcess = NodeJS.Process & {
  resourcesPath?: string;
};

function resolveBundledBinary(fileName: string): string | null {
  const resourcesPath = (process as ElectronProcess).resourcesPath;
  if (!resourcesPath) return null;

  const candidate = path.join(resourcesPath, 'bin', fileName);
  return existsSync(candidate) ? candidate : null;
}

export function resolveFfmpegPath(): string {
  return (
    process.env.FFMPEG_PATH ||
    resolveBundledBinary('ffmpeg.exe') ||
    'ffmpeg'
  );
}

export function resolveFfprobePath(): string {
  return (
    process.env.FFPROBE_PATH ||
    resolveBundledBinary('ffprobe.exe') ||
    'ffprobe'
  );
}
