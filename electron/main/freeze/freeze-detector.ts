import { resolveFfmpegPath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import { FreezeParser } from './freeze-parser';
import type { DetectionOptions, FreezeInterval } from './types';

const FAST_SCAN_THRESHOLD_SEC = 30;
const FAST_SCAN_HEIGHT = 360;
const REFINE_MARGIN_SEC = 1.25;

export interface FastScanProfile {
  fps: number;
  height: number;
}

export function getFastScanProfile(options: DetectionOptions): FastScanProfile {
  const fps = Math.min(
    8,
    Math.max(1, Math.ceil(4 / Math.max(options.minDurationSec, 0.5))),
  );

  return {
    fps,
    height: FAST_SCAN_HEIGHT,
  };
}

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

export function buildFastFreezeDetectArgs(
  inputPath: string,
  options: DetectionOptions,
): string[] {
  const profile = getFastScanProfile(options);

  return [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-vf',
    [
      `fps=${profile.fps}`,
      `scale=-2:${profile.height}:flags=fast_bilinear`,
      `freezedetect=n=${options.noise}:d=${options.minDurationSec}`,
    ].join(','),
    '-an',
    '-f',
    'null',
    '-',
  ];
}

export function buildRefineFreezeDetectArgs(
  inputPath: string,
  startSec: number,
  durationSec: number,
  options: DetectionOptions,
): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-ss',
    startSec.toFixed(6),
    '-t',
    durationSec.toFixed(6),
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

async function runDetectionPass(
  args: string[],
  parserDurationSec: number,
  signal?: AbortSignal,
): Promise<FreezeInterval[]> {
  const parser = new FreezeParser();
  const executable = resolveFfmpegPath();

  const result = await runProcess(executable, args, {
    signal,
    onStderrLine: (line) => parser.pushLine(line),
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'FREEZE_DETECTION_FAILED');
  }

  return parser.finish(parserDurationSec);
}

function globalizeIntervals(
  intervals: FreezeInterval[],
  offsetSec: number,
): FreezeInterval[] {
  return intervals.map((interval) => ({
    ...interval,
    startSec: interval.startSec + offsetSec,
    endSec: interval.endSec + offsetSec,
  }));
}

function closestByStart(
  intervals: FreezeInterval[],
  targetSec: number,
): FreezeInterval | undefined {
  return [...intervals].sort(
    (a, b) =>
      Math.abs(a.startSec - targetSec) - Math.abs(b.startSec - targetSec),
  )[0];
}

function closestByEnd(
  intervals: FreezeInterval[],
  targetSec: number,
): FreezeInterval | undefined {
  return [...intervals].sort(
    (a, b) =>
      Math.abs(a.endSec - targetSec) - Math.abs(b.endSec - targetSec),
  )[0];
}

async function refineCandidate(
  inputPath: string,
  mediaDurationSec: number,
  candidate: FreezeInterval,
  options: DetectionOptions,
  signal?: AbortSignal,
): Promise<FreezeInterval | null> {
  const boundarySpanSec = options.minDurationSec + REFINE_MARGIN_SEC;
  const startWindowStart = Math.max(0, candidate.startSec - REFINE_MARGIN_SEC);
  const startWindowEnd = Math.min(
    mediaDurationSec,
    candidate.startSec + boundarySpanSec,
  );
  const endWindowStart = Math.max(
    0,
    candidate.endSec - boundarySpanSec,
  );
  const endWindowEnd = Math.min(
    mediaDurationSec,
    candidate.endSec + REFINE_MARGIN_SEC,
  );

  let startMatches: FreezeInterval[];
  let endMatches: FreezeInterval[];

  if (endWindowStart <= startWindowEnd) {
    const combinedStart = Math.min(startWindowStart, endWindowStart);
    const combinedEnd = Math.max(startWindowEnd, endWindowEnd);
    const local = await runDetectionPass(
      buildRefineFreezeDetectArgs(
        inputPath,
        combinedStart,
        combinedEnd - combinedStart,
        options,
      ),
      combinedEnd - combinedStart,
      signal,
    );

    const global = globalizeIntervals(local, combinedStart);
    startMatches = global;
    endMatches = global;
  } else {
    const [startLocal, endLocal] = await Promise.all([
      runDetectionPass(
        buildRefineFreezeDetectArgs(
          inputPath,
          startWindowStart,
          startWindowEnd - startWindowStart,
          options,
        ),
        startWindowEnd - startWindowStart,
        signal,
      ),
      runDetectionPass(
        buildRefineFreezeDetectArgs(
          inputPath,
          endWindowStart,
          endWindowEnd - endWindowStart,
          options,
        ),
        endWindowEnd - endWindowStart,
        signal,
      ),
    ]);

    startMatches = globalizeIntervals(startLocal, startWindowStart);
    endMatches = globalizeIntervals(endLocal, endWindowStart);
  }

  const startMatch = closestByStart(startMatches, candidate.startSec);
  const endMatch = closestByEnd(endMatches, candidate.endSec);

  // The low-resolution pass can produce false positives after downscaling.
  // Require at least one original-resolution boundary window to confirm it.
  if (!startMatch && !endMatch) {
    return null;
  }

  const startSec = startMatch?.startSec ?? candidate.startSec;
  const endSec = endMatch?.endSec ?? candidate.endSec;

  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    return null;
  }

  return {
    ...candidate,
    startSec,
    endSec,
    durationSec: endSec - startSec,
  };
}

function renumberIntervals(intervals: FreezeInterval[]): FreezeInterval[] {
  return intervals
    .filter((interval) => interval.endSec > interval.startSec)
    .sort((a, b) => a.startSec - b.startSec)
    .map((interval, index) => ({
      ...interval,
      id: `freeze-${String(index + 1).padStart(4, '0')}`,
      durationSec: interval.endSec - interval.startSec,
      selectedForRemoval: false,
    }));
}

export async function detectFreezes(
  inputPath: string,
  mediaDurationSec: number,
  options: DetectionOptions,
  signal?: AbortSignal,
): Promise<FreezeInterval[]> {
  if (mediaDurationSec < FAST_SCAN_THRESHOLD_SEC) {
    return runDetectionPass(
      buildFreezeDetectArgs(inputPath, options),
      mediaDurationSec,
      signal,
    );
  }

  const candidates = await runDetectionPass(
    buildFastFreezeDetectArgs(inputPath, options),
    mediaDurationSec,
    signal,
  );

  if (candidates.length === 0) {
    return [];
  }

  const refined: FreezeInterval[] = [];

  // Refine sequentially to avoid multiple full-resolution decoders competing
  // for CPU and disk on long media files.
  for (const candidate of candidates) {
    if (signal?.aborted) {
      throw new Error('PROCESS_ABORTED');
    }

    const interval = await refineCandidate(
      inputPath,
      mediaDurationSec,
      candidate,
      options,
      signal,
    );

    if (interval) {
      refined.push(interval);
    }
  }

  return renumberIntervals(refined);
}
