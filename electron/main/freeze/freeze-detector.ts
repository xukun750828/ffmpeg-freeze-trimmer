import { resolveFfmpegPath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import { FreezeParser } from './freeze-parser';
import type { DetectionOptions, FreezeInterval } from './types';

const FAST_SCAN_THRESHOLD_SEC = 30;
const FAST_SCAN_HEIGHT = 360;
const REFINE_MARGIN_SEC = 1.25;
const REFINE_WINDOW_MERGE_GAP_SEC = 0.5;
const MAX_REFINEMENT_WINDOW_SEC = 12;
const REFINE_MATCH_TOLERANCE_SEC = 2.5;

export interface FastScanProfile {
  fps: number;
  height: number;
}

type BoundaryKind = 'start' | 'end';

export interface RefinementBoundaryRef {
  candidateIndex: number;
  kind: BoundaryKind;
  targetSec: number;
}

export interface RefinementWindow {
  startSec: number;
  endSec: number;
  boundaries: RefinementBoundaryRef[];
}

interface CandidateRefinement {
  startSec?: number;
  endSec?: number;
  confirmed: boolean;
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

function closestBoundary(
  intervals: FreezeInterval[],
  kind: BoundaryKind,
  targetSec: number,
): number | undefined {
  const values = intervals.map((interval) =>
    kind === 'start' ? interval.startSec : interval.endSec,
  );

  let closest: number | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const value of values) {
    const distance = Math.abs(value - targetSec);
    if (distance < closestDistance) {
      closest = value;
      closestDistance = distance;
    }
  }

  if (closest === undefined || closestDistance > REFINE_MATCH_TOLERANCE_SEC) {
    return undefined;
  }

  return closest;
}

function buildRawRefinementWindows(
  candidates: FreezeInterval[],
  mediaDurationSec: number,
  options: DetectionOptions,
): RefinementWindow[] {
  const boundarySpanSec = options.minDurationSec + REFINE_MARGIN_SEC;
  const windows: RefinementWindow[] = [];

  candidates.forEach((candidate, candidateIndex) => {
    const startWindowStart = Math.max(0, candidate.startSec - REFINE_MARGIN_SEC);
    const startWindowEnd = Math.min(
      mediaDurationSec,
      candidate.startSec + boundarySpanSec,
    );

    windows.push({
      startSec: startWindowStart,
      endSec: startWindowEnd,
      boundaries: [
        {
          candidateIndex,
          kind: 'start',
          targetSec: candidate.startSec,
        },
      ],
    });

    const endWindowStart = Math.max(
      0,
      candidate.endSec - boundarySpanSec,
    );
    const endWindowEnd = Math.min(
      mediaDurationSec,
      candidate.endSec + REFINE_MARGIN_SEC,
    );

    windows.push({
      startSec: endWindowStart,
      endSec: endWindowEnd,
      boundaries: [
        {
          candidateIndex,
          kind: 'end',
          targetSec: candidate.endSec,
        },
      ],
    });
  });

  return windows.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

export function buildRefinementWindows(
  candidates: FreezeInterval[],
  mediaDurationSec: number,
  options: DetectionOptions,
): RefinementWindow[] {
  const raw = buildRawRefinementWindows(candidates, mediaDurationSec, options);
  const merged: RefinementWindow[] = [];

  for (const window of raw) {
    const current = merged.at(-1);
    if (!current) {
      merged.push({
        startSec: window.startSec,
        endSec: window.endSec,
        boundaries: [...window.boundaries],
      });
      continue;
    }

    const mergedEnd = Math.max(current.endSec, window.endSec);
    const mergedDuration = mergedEnd - current.startSec;
    const closeEnough =
      window.startSec <= current.endSec + REFINE_WINDOW_MERGE_GAP_SEC;

    if (closeEnough && mergedDuration <= MAX_REFINEMENT_WINDOW_SEC) {
      current.endSec = mergedEnd;
      current.boundaries.push(...window.boundaries);
      continue;
    }

    merged.push({
      startSec: window.startSec,
      endSec: window.endSec,
      boundaries: [...window.boundaries],
    });
  }

  return merged;
}

async function refineCandidatesByMergedWindows(
  inputPath: string,
  mediaDurationSec: number,
  candidates: FreezeInterval[],
  options: DetectionOptions,
  signal?: AbortSignal,
): Promise<FreezeInterval[]> {
  const refinements: CandidateRefinement[] = candidates.map(() => ({
    confirmed: false,
  }));
  const windows = buildRefinementWindows(
    candidates,
    mediaDurationSec,
    options,
  );

  for (const window of windows) {
    if (signal?.aborted) {
      throw new Error('PROCESS_ABORTED');
    }

    const durationSec = window.endSec - window.startSec;
    if (durationSec <= 0) {
      continue;
    }

    const local = await runDetectionPass(
      buildRefineFreezeDetectArgs(
        inputPath,
        window.startSec,
        durationSec,
        options,
      ),
      durationSec,
      signal,
    );
    const global = globalizeIntervals(local, window.startSec);

    for (const boundary of window.boundaries) {
      const refinedBoundary = closestBoundary(
        global,
        boundary.kind,
        boundary.targetSec,
      );

      if (refinedBoundary === undefined) {
        continue;
      }

      const refinement = refinements[boundary.candidateIndex];
      refinement.confirmed = true;

      if (boundary.kind === 'start') {
        refinement.startSec = refinedBoundary;
      } else {
        refinement.endSec = refinedBoundary;
      }
    }
  }

  const refined: FreezeInterval[] = [];

  candidates.forEach((candidate, index) => {
    const refinement = refinements[index];
    if (!refinement.confirmed) {
      return;
    }

    const startSec = refinement.startSec ?? candidate.startSec;
    const endSec = refinement.endSec ?? candidate.endSec;

    if (
      !Number.isFinite(startSec) ||
      !Number.isFinite(endSec) ||
      endSec <= startSec
    ) {
      return;
    }

    refined.push({
      ...candidate,
      startSec,
      endSec,
      durationSec: endSec - startSec,
    });
  });

  return refined;
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

  const refined = await refineCandidatesByMergedWindows(
    inputPath,
    mediaDurationSec,
    candidates,
    options,
    signal,
  );

  return renumberIntervals(refined);
}
