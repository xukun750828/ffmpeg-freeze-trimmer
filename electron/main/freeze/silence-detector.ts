import { resolveFfmpegPath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import type {
  AudioSubInterval,
  DetectionOptions,
  FreezeInterval,
} from './types';

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

export function buildAudioSubIntervals(
  rangeStartSec: number,
  rangeEndSec: number,
  silences: readonly SilenceInterval[],
): AudioSubInterval[] {
  const start = Math.max(0, rangeStartSec);
  const end = Math.max(start, rangeEndSec);
  if (end <= start) return [];

  const normalizedSilences = silences
    .map((interval) => ({
      startSec: Math.max(start, interval.startSec),
      endSec: Math.min(end, interval.endSec),
    }))
    .filter((interval) => interval.endSec > interval.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  const merged: SilenceInterval[] = [];
  for (const interval of normalizedSilences) {
    const current = merged.at(-1);
    if (!current || interval.startSec > current.endSec + 0.001) {
      merged.push({ ...interval });
      continue;
    }
    current.endSec = Math.max(current.endSec, interval.endSec);
  }

  const segments: AudioSubInterval[] = [];
  let cursor = start;
  let nextId = 1;

  const pushSegment = (
    segmentStart: number,
    segmentEnd: number,
    audioPresence: AudioSubInterval['audioPresence'],
  ) => {
    if (segmentEnd - segmentStart <= 0.001) return;
    segments.push({
      id: `audio-${String(nextId).padStart(4, '0')}`,
      startSec: segmentStart,
      endSec: segmentEnd,
      durationSec: segmentEnd - segmentStart,
      audioPresence,
    });
    nextId += 1;
  };

  for (const silence of merged) {
    if (silence.startSec > cursor) {
      pushSegment(cursor, silence.startSec, 'sound');
    }
    pushSegment(silence.startSec, silence.endSec, 'silence');
    cursor = Math.max(cursor, silence.endSec);
  }

  if (cursor < end) {
    pushSegment(cursor, end, 'sound');
  }

  return segments;
}

export async function detectAudioSubIntervals(
  inputPath: string,
  rangeStartSec: number,
  rangeEndSec: number,
  hasAudio: boolean,
  signal?: AbortSignal,
): Promise<AudioSubInterval[]> {
  if (rangeEndSec <= rangeStartSec) return [];

  if (!hasAudio) {
    return [
      {
        id: 'audio-0001',
        startSec: rangeStartSec,
        endSec: rangeEndSec,
        durationSec: rangeEndSec - rangeStartSec,
        audioPresence: 'silence',
      },
    ];
  }

  const durationSec = rangeEndSec - rangeStartSec;
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
      'silencedetect=noise=-40dB:d=0.25',
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

  const silences = parseSilenceIntervals(stderrLines, durationSec).map(
    (interval) => ({
      startSec: interval.startSec + rangeStartSec,
      endSec: interval.endSec + rangeStartSec,
    }),
  );

  return buildAudioSubIntervals(rangeStartSec, rangeEndSec, silences);
}
