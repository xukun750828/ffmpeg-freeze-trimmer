import { resolveFfmpegPath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import type { DetectionOptions, FreezeInterval } from './types';

export interface SilenceInterval {
  startSec: number;
  endSec: number;
}

export function parseSilenceIntervals(
  lines: readonly string[],
  durationSec: number,
): SilenceInterval[] {
  const intervals: SilenceInterval[] = [];
  let pendingStart: number | null = null;

  for (const line of lines) {
    const startMatch = /silence_start:\s*([0-9.]+)/.exec(line);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }

    const endMatch = /silence_end:\s*([0-9.]+)/.exec(line);
    if (endMatch && pendingStart !== null) {
      const endSec = Number(endMatch[1]);
      if (Number.isFinite(endSec) && endSec > pendingStart) {
        intervals.push({ startSec: pendingStart, endSec });
      }
      pendingStart = null;
    }
  }

  if (pendingStart !== null && durationSec > pendingStart) {
    intervals.push({ startSec: pendingStart, endSec: durationSec });
  }

  return intervals;
}

export function filterFreezesBySilence(
  freezes: readonly FreezeInterval[],
  silences: readonly SilenceInterval[],
  minOverlapSec: number,
): FreezeInterval[] {
  return freezes.filter((freeze) =>
    silences.some((silence) => {
      const overlap = Math.max(
        0,
        Math.min(freeze.endSec, silence.endSec) -
          Math.max(freeze.startSec, silence.startSec),
      );
      return overlap >= Math.min(minOverlapSec, freeze.durationSec);
    }),
  );
}

export async function detectSilenceInRange(
  inputPath: string,
  rangeStartSec: number,
  rangeEndSec: number,
  options: DetectionOptions,
  signal?: AbortSignal,
): Promise<SilenceInterval[]> {
  const durationSec = Math.max(0, rangeEndSec - rangeStartSec);
  if (durationSec <= 0) return [];

  const stderrLines: string[] = [];
  const result = await runProcess(
    resolveFfmpegPath(),
    [
      '-hide_banner',
      '-nostats',
      '-ss',
      rangeStartSec.toFixed(6),
      '-t',
      durationSec.toFixed(6),
      '-i',
      inputPath,
      '-map',
      '0:a:0',
      '-af',
      `silencedetect=noise=-35dB:d=${Math.max(0.1, options.minDurationSec)}`,
      '-vn',
      '-f',
      'null',
      '-',
    ],
    {
      signal,
      onStderrLine: (line) => stderrLines.push(line),
    },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'SILENCE_DETECTION_FAILED');
  }

  return parseSilenceIntervals(stderrLines, durationSec).map((interval) => ({
    startSec: interval.startSec + rangeStartSec,
    endSec: interval.endSec + rangeStartSec,
  }));
}
