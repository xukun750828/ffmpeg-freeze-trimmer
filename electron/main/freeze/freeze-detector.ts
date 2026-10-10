import { stat } from 'node:fs/promises';
import { resolveFfmpegPath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import { FreezeParser } from './freeze-parser';
import {
  detectSilenceInRange,
  filterFreezesBySilence,
  type SilenceInterval,
} from './silence-detector';
import type { DetectionOptions, DirectedDetectionRequest, FreezeInterval } from './types';

const FAST_SCAN_THRESHOLD_SEC = 30;
const FAST_SCAN_HEIGHT = 360;
const REFINE_MARGIN_SEC = 1.25;
const REFINE_WINDOW_MERGE_GAP_SEC = 0.5;
const MAX_REFINEMENT_WINDOW_SEC = 12;
const REFINE_MATCH_TOLERANCE_SEC = 2.5;
const REFINEMENT_CONCURRENCY = 4;
const DIRECTED_SEARCH_CHUNK_SEQUENCE_SEC = [30, 60, 120, 300] as const;
const DIRECTED_SEARCH_MIN_CONTEXT_SEC = 5;
const DIRECTED_REFINEMENT_GUARD = 2;
const DIRECTED_REFINEMENT_BATCH_MIN = 4;
const DIRECTED_CACHE_MAX_ENTRIES = 64;

interface CachedVisualScan {
  intervals: FreezeInterval[];
  precise: boolean;
}

const directedVisualScanCache = new Map<string, CachedVisualScan>();
const directedSilenceCache = new Map<string, SilenceInterval[]>();

function getCachedValue<T>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function setCachedValue<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > DIRECTED_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function getInputCacheIdentity(inputPath: string): Promise<string> {
  try {
    const info = await stat(inputPath);
    return `${inputPath}\u0000${info.size}\u0000${info.mtimeMs}`;
  } catch {
    return inputPath;
  }
}

function cloneFreezeIntervals(intervals: readonly FreezeInterval[]): FreezeInterval[] {
  return intervals.map((interval) => ({ ...interval }));
}

function cloneSilenceIntervals(intervals: readonly SilenceInterval[]): SilenceInterval[] {
  return intervals.map((interval) => ({ ...interval }));
}

export function getDirectedSearchChunkSec(iteration: number): number {
  const safeIndex = Math.max(0, Math.floor(iteration));
  return DIRECTED_SEARCH_CHUNK_SEQUENCE_SEC[
    Math.min(safeIndex, DIRECTED_SEARCH_CHUNK_SEQUENCE_SEC.length - 1)
  ];
}

export function orderDirectedCandidates(
  candidates: readonly FreezeInterval[],
  originSec: number,
  direction: DirectedDetectionRequest['direction'],
): FreezeInterval[] {
  if (direction === 'forward') {
    return candidates
      .filter((interval) => interval.endSec > originSec)
      .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)
      .map((interval) => ({ ...interval }));
  }

  return candidates
    .filter((interval) => interval.startSec < originSec)
    .sort((a, b) => b.endSec - a.endSec || b.startSec - a.startSec)
    .map((interval) => ({ ...interval }));
}

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
}

export interface RefinedBoundaryAssignment {
  candidateIndex: number;
  kind: BoundaryKind;
  value: number;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('INVALID_CONCURRENCY');
  }

  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker()),
  );

  return results;
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

export function matchRefinementBoundaries(
  intervals: FreezeInterval[],
  boundaries: RefinementBoundaryRef[],
): RefinedBoundaryAssignment[] {
  const assignments: RefinedBoundaryAssignment[] = [];

  for (const kind of ['start', 'end'] as const) {
    const refs = boundaries
      .map((boundary, refIndex) => ({ boundary, refIndex }))
      .filter(({ boundary }) => boundary.kind === kind);
    const values = intervals.map((interval) =>
      kind === 'start' ? interval.startSec : interval.endSec,
    );

    const pairs: Array<{
      refIndex: number;
      valueIndex: number;
      distance: number;
    }> = [];

    for (const { boundary, refIndex } of refs) {
      values.forEach((value, valueIndex) => {
        const distance = Math.abs(value - boundary.targetSec);
        if (distance <= REFINE_MATCH_TOLERANCE_SEC) {
          pairs.push({ refIndex, valueIndex, distance });
        }
      });
    }

    pairs.sort((a, b) => a.distance - b.distance);

    const usedRefs = new Set<number>();
    const usedValues = new Set<number>();

    for (const pair of pairs) {
      if (usedRefs.has(pair.refIndex) || usedValues.has(pair.valueIndex)) {
        continue;
      }

      const boundary = boundaries[pair.refIndex];
      assignments.push({
        candidateIndex: boundary.candidateIndex,
        kind,
        value: values[pair.valueIndex],
      });
      usedRefs.add(pair.refIndex);
      usedValues.add(pair.valueIndex);
    }
  }

  return assignments;
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

async function refineWindow(
  inputPath: string,
  window: RefinementWindow,
  options: DetectionOptions,
  signal?: AbortSignal,
): Promise<RefinedBoundaryAssignment[]> {
  if (signal?.aborted) {
    throw new Error('PROCESS_ABORTED');
  }

  const durationSec = window.endSec - window.startSec;
  if (durationSec <= 0) {
    return [];
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

  return matchRefinementBoundaries(global, window.boundaries);
}

export function applyRefinementAssignments(
  candidates: readonly FreezeInterval[],
  assignments: readonly RefinedBoundaryAssignment[],
): FreezeInterval[] {
  const refinements: CandidateRefinement[] = candidates.map(() => ({}));

  for (const assignment of assignments) {
    const refinement = refinements[assignment.candidateIndex];
    if (!refinement) continue;

    if (assignment.kind === 'start') {
      refinement.startSec = assignment.value;
    } else {
      refinement.endSec = assignment.value;
    }
  }

  const refined: FreezeInterval[] = [];

  candidates.forEach((candidate, index) => {
    const refinement = refinements[index];
    const startSec = refinement.startSec;
    const endSec = refinement.endSec;

    if (
      startSec === undefined ||
      endSec === undefined ||
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

async function refineCandidatesByMergedWindows(
  inputPath: string,
  mediaDurationSec: number,
  candidates: FreezeInterval[],
  options: DetectionOptions,
  signal?: AbortSignal,
): Promise<FreezeInterval[]> {
  const windows = buildRefinementWindows(
    candidates,
    mediaDurationSec,
    options,
  );

  const windowResults = await mapWithConcurrency(
    windows,
    REFINEMENT_CONCURRENCY,
    (window) => refineWindow(inputPath, window, options, signal),
  );

  return applyRefinementAssignments(
    candidates,
    windowResults.flat(),
  );
}

export function mergeOverlappingFreezeIntervals(
  intervals: FreezeInterval[],
): FreezeInterval[] {
  const sorted = intervals
    .filter((interval) => interval.endSec > interval.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  const merged: FreezeInterval[] = [];

  for (const interval of sorted) {
    const current = merged.at(-1);

    if (!current || interval.startSec >= current.endSec) {
      merged.push({ ...interval });
      continue;
    }

    current.endSec = Math.max(current.endSec, interval.endSec);
    current.durationSec = current.endSec - current.startSec;
  }

  return merged;
}

function renumberIntervals(intervals: FreezeInterval[]): FreezeInterval[] {
  return mergeOverlappingFreezeIntervals(intervals).map((interval, index) => ({
    ...interval,
    id: `freeze-${String(index + 1).padStart(4, '0')}`,
    durationSec: interval.endSec - interval.startSec,
    selectedForRemoval: false,
  }));
}

function buildFastRangeFreezeDetectArgs(
  inputPath: string,
  rangeStartSec: number,
  rangeEndSec: number,
  options: DetectionOptions,
): string[] {
  const profile = getFastScanProfile(options);
  const durationSec = Math.max(0, rangeEndSec - rangeStartSec);

  return [
    '-hide_banner',
    '-nostats',
    '-ss',
    rangeStartSec.toFixed(6),
    '-t',
    durationSec.toFixed(6),
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

function buildDirectedVisualCacheKey(
  cacheIdentity: string,
  startSec: number,
  endSec: number,
  options: DetectionOptions,
): string {
  return [
    cacheIdentity,
    startSec.toFixed(6),
    endSec.toFixed(6),
    options.noise.toFixed(8),
    options.minDurationSec.toFixed(6),
  ].join('|');
}

function buildDirectedSilenceCacheKey(
  cacheIdentity: string,
  startSec: number,
  endSec: number,
  options: DetectionOptions,
): string {
  return [
    cacheIdentity,
    'silence',
    startSec.toFixed(6),
    endSec.toFixed(6),
    options.minDurationSec.toFixed(6),
  ].join('|');
}

async function detectDirectedVisualScan(
  inputPath: string,
  mediaDurationSec: number,
  rangeStartSec: number,
  rangeEndSec: number,
  options: DetectionOptions,
  cacheIdentity: string,
  signal?: AbortSignal,
): Promise<CachedVisualScan> {
  const startSec = Math.max(0, Math.min(mediaDurationSec, rangeStartSec));
  const endSec = Math.max(startSec, Math.min(mediaDurationSec, rangeEndSec));
  const rangeDurationSec = endSec - startSec;
  if (rangeDurationSec <= 0) {
    return { intervals: [], precise: true };
  }

  const cacheKey = buildDirectedVisualCacheKey(
    cacheIdentity,
    startSec,
    endSec,
    options,
  );
  const cached = getCachedValue(directedVisualScanCache, cacheKey);
  if (cached) {
    return {
      precise: cached.precise,
      intervals: cloneFreezeIntervals(cached.intervals),
    };
  }

  let scan: CachedVisualScan;
  if (rangeDurationSec < FAST_SCAN_THRESHOLD_SEC) {
    const local = await runDetectionPass(
      buildRefineFreezeDetectArgs(
        inputPath,
        startSec,
        rangeDurationSec,
        options,
      ),
      rangeDurationSec,
      signal,
    );
    scan = {
      precise: true,
      intervals: renumberIntervals(globalizeIntervals(local, startSec)),
    };
  } else {
    const local = await runDetectionPass(
      buildFastRangeFreezeDetectArgs(
        inputPath,
        startSec,
        endSec,
        options,
      ),
      rangeDurationSec,
      signal,
    );
    scan = {
      precise: false,
      intervals: renumberIntervals(globalizeIntervals(local, startSec)),
    };
  }

  setCachedValue(directedVisualScanCache, cacheKey, {
    precise: scan.precise,
    intervals: cloneFreezeIntervals(scan.intervals),
  });
  return scan;
}

async function detectVisualFreezesInRange(
  inputPath: string,
  mediaDurationSec: number,
  rangeStartSec: number,
  rangeEndSec: number,
  options: DetectionOptions,
  signal?: AbortSignal,
): Promise<FreezeInterval[]> {
  const startSec = Math.max(0, Math.min(mediaDurationSec, rangeStartSec));
  const endSec = Math.max(startSec, Math.min(mediaDurationSec, rangeEndSec));
  const rangeDurationSec = endSec - startSec;

  if (rangeDurationSec <= 0) {
    return [];
  }

  if (rangeDurationSec < FAST_SCAN_THRESHOLD_SEC) {
    const local = await runDetectionPass(
      buildRefineFreezeDetectArgs(
        inputPath,
        startSec,
        rangeDurationSec,
        options,
      ),
      rangeDurationSec,
      signal,
    );

    return renumberIntervals(globalizeIntervals(local, startSec));
  }

  const localCandidates = await runDetectionPass(
    buildFastRangeFreezeDetectArgs(
      inputPath,
      startSec,
      endSec,
      options,
    ),
    rangeDurationSec,
    signal,
  );

  if (localCandidates.length === 0) {
    return [];
  }

  const candidates = globalizeIntervals(localCandidates, startSec);
  const refined = await refineCandidatesByMergedWindows(
    inputPath,
    mediaDurationSec,
    candidates,
    options,
    signal,
  );

  return renumberIntervals(refined);
}

async function getDirectedSilencesInRange(
  inputPath: string,
  rangeStartSec: number,
  rangeEndSec: number,
  options: DetectionOptions,
  cacheIdentity: string,
  signal?: AbortSignal,
): Promise<SilenceInterval[]> {
  const cacheKey = buildDirectedSilenceCacheKey(
    cacheIdentity,
    rangeStartSec,
    rangeEndSec,
    options,
  );
  const cached = getCachedValue(directedSilenceCache, cacheKey);
  if (cached) return cloneSilenceIntervals(cached);

  const silences = await detectSilenceInRange(
    inputPath,
    rangeStartSec,
    rangeEndSec,
    options,
    signal,
  );
  setCachedValue(
    directedSilenceCache,
    cacheKey,
    cloneSilenceIntervals(silences),
  );
  return silences;
}

export function filterCandidatesByPotentialSilence(
  candidates: readonly FreezeInterval[],
  silences: readonly SilenceInterval[],
  toleranceSec = REFINE_MATCH_TOLERANCE_SEC,
): FreezeInterval[] {
  return candidates
    .filter((candidate) =>
      silences.some(
        (silence) =>
          silence.endSec > candidate.startSec - toleranceSec &&
          silence.startSec < candidate.endSec + toleranceSec,
      ),
    )
    .map((candidate) => ({ ...candidate }));
}

async function applyAudioConfirmation(
  inputPath: string,
  rangeStartSec: number,
  rangeEndSec: number,
  visualIntervals: FreezeInterval[],
  request: DirectedDetectionRequest,
  signal?: AbortSignal,
  cacheIdentity?: string,
): Promise<FreezeInterval[]> {
  if (
    visualIntervals.length === 0 ||
    request.options.hasBackgroundSound ||
    !request.hasAudio
  ) {
    return visualIntervals;
  }

  const silences = cacheIdentity
    ? await getDirectedSilencesInRange(
        inputPath,
        rangeStartSec,
        rangeEndSec,
        request.options,
        cacheIdentity,
        signal,
      )
    : await detectSilenceInRange(
        inputPath,
        rangeStartSec,
        rangeEndSec,
        request.options,
        signal,
      );

  return filterFreezesBySilence(
    visualIntervals,
    silences,
    request.options.minDurationSec,
  );
}

async function detectDirectedConfirmedInRange(
  request: DirectedDetectionRequest,
  rangeStartSec: number,
  rangeEndSec: number,
  cacheIdentity: string,
  signal?: AbortSignal,
): Promise<FreezeInterval[]> {
  const requiresSilence =
    !request.options.hasBackgroundSound && request.hasAudio;
  const scanPromise = detectDirectedVisualScan(
    request.path,
    request.durationSec,
    rangeStartSec,
    rangeEndSec,
    request.options,
    cacheIdentity,
    signal,
  );
  const silencePromise = requiresSilence
    ? getDirectedSilencesInRange(
        request.path,
        rangeStartSec,
        rangeEndSec,
        request.options,
        cacheIdentity,
        signal,
      )
    : Promise.resolve<SilenceInterval[] | undefined>(undefined);

  const [scan, precomputedSilences] = await Promise.all([
    scanPromise,
    silencePromise,
  ]);

  if (scan.intervals.length === 0) return [];

  let candidates = scan.intervals;

  if (requiresSilence) {
    const silences = precomputedSilences ?? [];
    if (silences.length === 0) return [];
    candidates = filterCandidatesByPotentialSilence(
      candidates,
      silences,
    );
    if (candidates.length === 0) return [];
  }

  if (scan.precise) {
    return precomputedSilences
      ? filterFreezesBySilence(
          candidates,
          precomputedSilences,
          request.options.minDurationSec,
        )
      : candidates;
  }

  const ordered = orderDirectedCandidates(
    candidates,
    request.currentTimeSec,
    request.direction,
  );
  if (ordered.length === 0) return [];

  const desiredConfirmedCount = Math.min(
    ordered.length,
    request.maxIntervals + DIRECTED_REFINEMENT_GUARD,
  );
  let nextIndex = 0;
  let confirmed: FreezeInterval[] = [];
  let batchSize = Math.max(
    DIRECTED_REFINEMENT_BATCH_MIN,
    request.maxIntervals + DIRECTED_REFINEMENT_GUARD,
  );

  while (nextIndex < ordered.length) {
    const batch = ordered.slice(nextIndex, nextIndex + batchSize);
    nextIndex += batch.length;

    const refined = await refineCandidatesByMergedWindows(
      request.path,
      request.durationSec,
      batch,
      request.options,
      signal,
    );

    if (refined.length > 0) {
      const confirmedBatch = precomputedSilences
        ? filterFreezesBySilence(
            refined,
            precomputedSilences,
            request.options.minDurationSec,
          )
        : refined;
      confirmed = mergeOverlappingFreezeIntervals([
        ...confirmed,
        ...confirmedBatch,
      ]);
    }

    const enough = selectDirectedIntervals(confirmed, {
      ...request,
      maxIntervals: desiredConfirmedCount,
    }).length >= desiredConfirmedCount;
    if (enough) break;

    batchSize = Math.max(DIRECTED_REFINEMENT_BATCH_MIN, request.maxIntervals);
  }

  return confirmed;
}

function selectDirectedIntervals(
  intervals: FreezeInterval[],
  request: DirectedDetectionRequest,
): FreezeInterval[] {
  const origin = request.currentTimeSec;
  const merged = mergeOverlappingFreezeIntervals(intervals);

  if (request.direction === 'forward') {
    return renumberIntervals(
      merged
        .filter((interval) => interval.endSec > origin)
        .sort((a, b) => a.startSec - b.startSec)
        .slice(0, request.maxIntervals),
    );
  }

  const nearest = merged
    .filter((interval) => interval.startSec < origin)
    .sort((a, b) => b.endSec - a.endSec)
    .slice(0, request.maxIntervals)
    .sort((a, b) => a.startSec - b.startSec);

  return renumberIntervals(nearest);
}

export async function detectFreezesDirected(
  request: DirectedDetectionRequest,
  signal?: AbortSignal,
): Promise<FreezeInterval[]> {
  const origin = Math.max(
    0,
    Math.min(request.durationSec, request.currentTimeSec),
  );
  const contextSec = Math.max(
    DIRECTED_SEARCH_MIN_CONTEXT_SEC,
    request.options.minDurationSec + REFINE_MARGIN_SEC + 1,
  );
  const cacheIdentity = await getInputCacheIdentity(request.path);

  let cursor = origin;
  let collected: FreezeInterval[] = [];
  let searchIteration = 0;

  while (
    request.direction === 'forward'
      ? cursor < request.durationSec
      : cursor > 0
  ) {
    if (signal?.aborted) {
      throw new Error('PROCESS_ABORTED');
    }

    const chunkSec = getDirectedSearchChunkSec(searchIteration);
    searchIteration += 1;

    const rangeStartSec =
      request.direction === 'forward'
        ? Math.max(0, cursor - contextSec)
        : Math.max(0, cursor - chunkSec);

    const rangeEndSec =
      request.direction === 'forward'
        ? Math.min(request.durationSec, cursor + chunkSec)
        : Math.min(request.durationSec, cursor + contextSec);

    const confirmed = await detectDirectedConfirmedInRange(
      request,
      rangeStartSec,
      rangeEndSec,
      cacheIdentity,
      signal,
    );

    // A freeze touching the unexplored edge may still continue into the next
    // chunk. Defer it until the overlapping next chunk so we do not return a
    // truncated boundary just because the chunk ended.
    const stableConfirmed = confirmed.filter((interval) => {
      if (
        request.direction === 'forward' &&
        rangeEndSec < request.durationSec
      ) {
        return interval.endSec < rangeEndSec - 0.25;
      }

      if (request.direction === 'backward' && rangeStartSec > 0) {
        return interval.startSec > rangeStartSec + 0.25;
      }

      return true;
    });

    collected = mergeOverlappingFreezeIntervals([
      ...collected,
      ...stableConfirmed,
    ]);

    const selected = selectDirectedIntervals(collected, request);
    if (selected.length >= request.maxIntervals) {
      return selected;
    }

    if (request.direction === 'forward') {
      if (rangeEndSec >= request.durationSec) {
        break;
      }
      cursor = rangeEndSec;
    } else {
      if (rangeStartSec <= 0) {
        break;
      }
      cursor = rangeStartSec;
    }
  }

  return selectDirectedIntervals(collected, request);
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
