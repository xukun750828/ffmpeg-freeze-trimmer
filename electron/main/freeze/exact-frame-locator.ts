import { resolveFfmpegPath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import { detectAudioSubIntervals } from './silence-detector';
import type {
  ExactFrameMatch,
  ExactFrameMatchRequest,
} from './types';

const INITIAL_SCAN_RADIUS_SEC = 5;
const MAX_SCAN_EXPANSIONS = 18;

export interface FrameHashSample {
  startSec: number;
  endSec: number;
  hash: string;
}

interface ParsedFrameMd5 {
  timeBaseSec: number;
  frames: Array<{
    pts: number;
    duration: number;
    hash: string;
  }>;
}

export function buildFrameMd5Args(
  inputPath: string,
  startSec: number,
  durationSec?: number,
  maxFrames?: number,
): string[] {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    startSec.toFixed(6),
  ];

  if (durationSec !== undefined) {
    args.push('-t', Math.max(0, durationSec).toFixed(6));
  }

  args.push('-i', inputPath, '-map', '0:v:0');

  if (maxFrames !== undefined) {
    args.push('-frames:v', String(maxFrames));
  }

  args.push('-f', 'framemd5', '-');
  return args;
}

export function parseFrameMd5(output: string): ParsedFrameMd5 {
  let timeBaseSec = 0;
  const frames: ParsedFrameMd5['frames'] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const timeBaseMatch = /^#tb\s+\d+:\s*(\d+)\/(\d+)$/.exec(line);
    if (timeBaseMatch) {
      const numerator = Number(timeBaseMatch[1]);
      const denominator = Number(timeBaseMatch[2]);
      if (
        Number.isFinite(numerator) &&
        Number.isFinite(denominator) &&
        denominator > 0
      ) {
        timeBaseSec = numerator / denominator;
      }
      continue;
    }

    if (line.startsWith('#')) continue;

    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 6) continue;

    const pts = Number(parts[2]);
    const duration = Number(parts[3]);
    const hash = parts[5];

    if (
      Number.isFinite(pts) &&
      Number.isFinite(duration) &&
      duration > 0 &&
      /^[0-9a-f]+$/i.test(hash)
    ) {
      frames.push({ pts, duration, hash: hash.toLowerCase() });
    }
  }

  if (!Number.isFinite(timeBaseSec) || timeBaseSec <= 0) {
    throw new Error('FRAME_MD5_INVALID_TIMEBASE');
  }

  return { timeBaseSec, frames };
}

async function runFrameMd5(
  inputPath: string,
  startSec: number,
  durationSec: number | undefined,
  maxFrames: number | undefined,
  signal?: AbortSignal,
): Promise<ParsedFrameMd5> {
  const result = await runProcess(
    resolveFfmpegPath(),
    buildFrameMd5Args(inputPath, startSec, durationSec, maxFrames),
    { signal },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'EXACT_FRAME_SCAN_FAILED');
  }

  return parseFrameMd5(result.stdout);
}

async function readAnchorHash(
  inputPath: string,
  anchorSec: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const parsed = await runFrameMd5(
    inputPath,
    anchorSec,
    undefined,
    1,
    signal,
  );

  return parsed.frames[0]?.hash ?? null;
}

async function scanWindowHashes(
  inputPath: string,
  windowStartSec: number,
  windowEndSec: number,
  signal?: AbortSignal,
): Promise<FrameHashSample[]> {
  const durationSec = Math.max(0, windowEndSec - windowStartSec);
  if (durationSec <= 0) return [];

  const parsed = await runFrameMd5(
    inputPath,
    windowStartSec,
    durationSec,
    undefined,
    signal,
  );

  return parsed.frames.map((frame) => {
    const startSec = windowStartSec + frame.pts * parsed.timeBaseSec;
    return {
      startSec,
      endSec: startSec + frame.duration * parsed.timeBaseSec,
      hash: frame.hash,
    };
  });
}

export function findContiguousAnchorHashRange(
  frames: readonly FrameHashSample[],
  anchorSec: number,
  anchorHash: string,
): {
  startSec: number;
  endSec: number;
  touchesLeftEdge: boolean;
  touchesRightEdge: boolean;
} | null {
  if (frames.length === 0) return null;

  let anchorIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  frames.forEach((frame, index) => {
    if (frame.hash !== anchorHash) return;
    const distance = Math.abs(frame.startSec - anchorSec);
    if (distance < bestDistance) {
      bestDistance = distance;
      anchorIndex = index;
    }
  });

  if (anchorIndex < 0) {
    return null;
  }

  let leftIndex = anchorIndex;
  let rightIndex = anchorIndex;

  while (
    leftIndex > 0 &&
    frames[leftIndex - 1].hash === anchorHash
  ) {
    leftIndex -= 1;
  }

  while (
    rightIndex + 1 < frames.length &&
    frames[rightIndex + 1].hash === anchorHash
  ) {
    rightIndex += 1;
  }

  return {
    startSec: frames[leftIndex].startSec,
    endSec: frames[rightIndex].endSec,
    touchesLeftEdge: leftIndex === 0,
    touchesRightEdge: rightIndex === frames.length - 1,
  };
}

export async function locateExactFrameMatch(
  request: ExactFrameMatchRequest,
  signal?: AbortSignal,
): Promise<ExactFrameMatch | null> {
  const anchorSec = Math.max(
    0,
    Math.min(request.durationSec, request.currentTimeSec),
  );

  const anchorHash = await readAnchorHash(
    request.path,
    anchorSec,
    signal,
  );

  if (!anchorHash) {
    return null;
  }

  let radiusSec = INITIAL_SCAN_RADIUS_SEC;
  let matchedRange:
    | {
        startSec: number;
        endSec: number;
        touchesLeftEdge: boolean;
        touchesRightEdge: boolean;
      }
    | null = null;

  for (let attempt = 0; attempt < MAX_SCAN_EXPANSIONS; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('PROCESS_ABORTED');
    }

    const windowStartSec = Math.max(0, anchorSec - radiusSec);
    const windowEndSec = Math.min(
      request.durationSec,
      anchorSec + radiusSec,
    );

    const frames = await scanWindowHashes(
      request.path,
      windowStartSec,
      windowEndSec,
      signal,
    );

    const range = findContiguousAnchorHashRange(
      frames,
      anchorSec,
      anchorHash,
    );

    if (!range) {
      return null;
    }

    matchedRange = range;

    const needsMoreLeft =
      range.touchesLeftEdge && windowStartSec > 0;
    const needsMoreRight =
      range.touchesRightEdge && windowEndSec < request.durationSec;

    if (!needsMoreLeft && !needsMoreRight) {
      break;
    }

    if (windowStartSec <= 0 && windowEndSec >= request.durationSec) {
      break;
    }

    radiusSec *= 2;
  }

  if (!matchedRange) {
    return null;
  }

  const startSec = Math.max(0, matchedRange.startSec);
  const endSec = Math.min(request.durationSec, matchedRange.endSec);

  if (endSec <= startSec) {
    return null;
  }

  const audioSubIntervals = await detectAudioSubIntervals(
    request.path,
    startSec,
    endSec,
    request.hasAudio,
    signal,
  );

  return {
    anchorSec,
    startSec,
    endSec,
    durationSec: endSec - startSec,
    audioSubIntervals,
  };
}
