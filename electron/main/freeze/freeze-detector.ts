import { runProcess } from '../process/process-runner';
import { FreezeParser } from './freeze-parser';
import type { DetectionOptions, FreezeInterval } from './types';

export function buildFreezeDetectArgs(
  inputPath: string,
  options: DetectionOptions,
): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-vf',
    `freezedetect=n=${options.noise}:d=${options.minDurationSec}`,
    '-an',
    '-f',
    'null',
    '-',
  ];
}

export async function detectFreezes(
  inputPath: string,
  mediaDurationSec: number,
  options: DetectionOptions,
  signal?: AbortSignal,
): Promise<FreezeInterval[]> {
  const parser = new FreezeParser();
  const executable = process.env.FFMPEG_PATH || 'ffmpeg';

  const result = await runProcess(
    executable,
    buildFreezeDetectArgs(inputPath, options),
    {
      signal,
      onStderrLine: (line) => parser.pushLine(line),
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'FREEZE_DETECTION_FAILED');
  }

  return parser.finish(mediaDurationSec);
}
