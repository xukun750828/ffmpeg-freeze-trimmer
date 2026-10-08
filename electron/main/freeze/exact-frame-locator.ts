import { resolveFfmpegPath } from '../ffmpeg-paths';
import {
  runProcess,
  runProcessBinary,
} from '../process/process-runner';
import { detectAudioSubIntervals } from './silence-detector';
import type {
  ExactFrameMatch,
  ExactFrameMatchRequest,
  VisualChangeLevel,
} from './types';

const INITIAL_SCAN_RADIUS_SEC = 5;
const MAX_SCAN_EXPANSIONS = 18;

const SIMILARITY_WIDTH = 160;
const SIMILARITY_HEIGHT = 90;
const SIMILARITY_FRAME_BYTES = SIMILARITY_WIDTH * SIMILARITY_HEIGHT;
const SIMILARITY_SAMPLE_FPS = 30;
const COARSE_INITIAL_STEP_SEC = 1;
const COARSE_MAX_PROBES = 32;
const BINARY_TARGET_WINDOW_SEC = 0.75;
const REFINE_PADDING_SEC = 0.35;
const EDGE_PROBE_EPSILON_SEC = 1 / SIMILARITY_SAMPLE_FPS;

export const VISUAL_CHANGE_THRESHOLDS: Record<VisualChangeLevel, number> = {
  exact: 0,
  'very-low': 0.00005,
  low: 0.0002,
  standard: 0.0005,
  relaxed: 0.0008,
  'very-relaxed': 0.001,
};

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

interface LocatedVisualRange {
  startSec: number;
  endSec: number;
}

export function getVisualChangeThreshold(
  level: VisualChangeLevel,
): number {
  return VISUAL_CHANGE_THRESHOLDS[level];
}

export function normalizedMeanAbsoluteDifference(
  anchor: Uint8Array,
  candidate: Uint8Array,
): number {
  if (anchor.length !== candidate.length || anchor.length === 0) {
    throw new Error('FRAME_COMPARISON_SIZE_MISMATCH');
  }

  let sum = 0;
  for (let index = 0; index < anchor.length; index += 1) {
    sum += Math.abs(anchor[index] - candidate[index]);
  }

  return sum / (anchor.length * 255);
}

export function isFrameWithinVisualThreshold(
  anchor: Uint8Array,
  candidate: Uint8Array,
  threshold: number,
): boolean {
  if (anchor.length !== candidate.length || anchor.length === 0) {
    return false;
  }

  const maxDifferenceSum = threshold * anchor.length * 255;
  let sum = 0;

  for (let index = 0; index < anchor.length; index += 1) {
    sum += Math.abs(anchor[index] - candidate[index]);
    if (sum > maxDifferenceSum) {
      return false;
    }
  }

  return true;
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

async function locateExactMd5Range(
  request: ExactFrameMatchRequest,
  signal?: AbortSignal,
): Promise<LocatedVisualRange | null> {
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

  return {
    startSec: matchedRange.startSec,
    endSec: matchedRange.endSec,
  };
}

function buildNormalizedRawFrameArgs(
  inputPath: string,
  startSec: number,
  durationSec?: number,
  maxFrames?: number,
  sampleFps?: number,
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

  const filters: string[] = [];
  if (sampleFps !== undefined) {
    filters.push(`fps=${sampleFps}`);
  }
  filters.push(
    `scale=${SIMILARITY_WIDTH}:${SIMILARITY_HEIGHT}:flags=area`,
    'format=gray',
  );

  args.push('-vf', filters.join(','));

  if (maxFrames !== undefined) {
    args.push('-frames:v', String(maxFrames));
  }

  args.push('-f', 'rawvideo', '-pix_fmt', 'gray', '-');
  return args;
}

async function readNormalizedAnchorFrame(
  inputPath: string,
  anchorSec: number,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  const result = await runProcessBinary(
    resolveFfmpegPath(),
    buildNormalizedRawFrameArgs(
      inputPath,
      anchorSec,
      undefined,
      1,
      undefined,
    ),
    { signal },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'VISUAL_FRAME_SCAN_FAILED');
  }

  if (result.stdout.length < SIMILARITY_FRAME_BYTES) {
    return null;
  }

  return result.stdout.subarray(0, SIMILARITY_FRAME_BYTES);
}

async function readNormalizedWindowFrames(
  inputPath: string,
  startSec: number,
  durationSec: number,
  signal?: AbortSignal,
  sampleFps = SIMILARITY_SAMPLE_FPS,
): Promise<Buffer> {
  const result = await runProcessBinary(
    resolveFfmpegPath(),
    buildNormalizedRawFrameArgs(
      inputPath,
      startSec,
      durationSec,
      undefined,
      sampleFps,
    ),
    { signal },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'VISUAL_FRAME_SCAN_FAILED');
  }

  return result.stdout;
}

type SimilarityBoundaryDirection = 'left' | 'right';

export interface SimilarityBoundaryBracket {
  matchedSec: number;
  differentSec: number | null;
  edgeSec: number | null;
  probeCount: number;
}

async function readNormalizedFrameAt(
  inputPath: string,
  timeSec: number,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  return readNormalizedAnchorFrame(inputPath, timeSec, signal);
}

export async function findExponentialSimilarityBracket(
  anchorSec: number,
  durationSec: number,
  direction: SimilarityBoundaryDirection,
  isSimilarAt: (timeSec: number) => Promise<boolean>,
): Promise<SimilarityBoundaryBracket> {
  const sign = direction === 'left' ? -1 : 1;
  let matchedSec = anchorSec;
  let stepSec = COARSE_INITIAL_STEP_SEC;
  let probeCount = 0;

  for (let attempt = 0; attempt < COARSE_MAX_PROBES; attempt += 1) {
    const rawCandidate = anchorSec + sign * stepSec;
    const hitEdge =
      direction === 'left'
        ? rawCandidate <= 0
        : rawCandidate >= durationSec;

    const candidateSec =
      direction === 'left'
        ? Math.max(0, rawCandidate)
        : Math.min(
            Math.max(0, durationSec - EDGE_PROBE_EPSILON_SEC),
            rawCandidate,
          );

    const similar = await isSimilarAt(candidateSec);
    probeCount += 1;

    if (!similar) {
      return {
        matchedSec,
        differentSec: candidateSec,
        edgeSec: null,
        probeCount,
      };
    }

    matchedSec = candidateSec;

    if (hitEdge) {
      return {
        matchedSec,
        differentSec: null,
        edgeSec: direction === 'left' ? 0 : durationSec,
        probeCount,
      };
    }

    stepSec *= 2;
  }

  return {
    matchedSec,
    differentSec: null,
    edgeSec: direction === 'left' ? 0 : durationSec,
    probeCount,
  };
}

export async function narrowSimilarityBoundaryBracket(
  bracket: SimilarityBoundaryBracket,
  isSimilarAt: (timeSec: number) => Promise<boolean>,
  targetWindowSec = BINARY_TARGET_WINDOW_SEC,
): Promise<SimilarityBoundaryBracket> {
  if (bracket.differentSec === null) {
    return bracket;
  }

  let matchedSec = bracket.matchedSec;
  let differentSec = bracket.differentSec;
  let probeCount = bracket.probeCount;

  while (Math.abs(differentSec - matchedSec) > targetWindowSec) {
    const midpoint = (matchedSec + differentSec) / 2;
    const similar = await isSimilarAt(midpoint);
    probeCount += 1;

    if (similar) {
      matchedSec = midpoint;
    } else {
      differentSec = midpoint;
    }
  }

  return {
    matchedSec,
    differentSec,
    edgeSec: null,
    probeCount,
  };
}

async function refineSimilarityBoundary(
  request: ExactFrameMatchRequest,
  anchorFrame: Uint8Array,
  threshold: number,
  direction: SimilarityBoundaryDirection,
  bracket: SimilarityBoundaryBracket,
  signal?: AbortSignal,
): Promise<number> {
  if (bracket.edgeSec !== null) {
    return bracket.edgeSec;
  }

  if (bracket.differentSec === null) {
    return direction === 'left' ? 0 : request.durationSec;
  }

  const lowSec = Math.max(
    0,
    Math.min(bracket.matchedSec, bracket.differentSec) -
      REFINE_PADDING_SEC,
  );
  const highSec = Math.min(
    request.durationSec,
    Math.max(bracket.matchedSec, bracket.differentSec) +
      REFINE_PADDING_SEC,
  );

  const buffer = await readNormalizedWindowFrames(
    request.path,
    lowSec,
    Math.max(0, highSec - lowSec),
    signal,
    SIMILARITY_SAMPLE_FPS,
  );

  const frameCount = Math.floor(
    buffer.length / SIMILARITY_FRAME_BYTES,
  );
  if (frameCount <= 0) {
    return bracket.matchedSec;
  }

  const frameDurationSec = 1 / SIMILARITY_SAMPLE_FPS;
  const isMatch = (index: number) =>
    isFrameWithinVisualThreshold(
      anchorFrame,
      getFrameFromBuffer(buffer, index),
      threshold,
    );

  if (direction === 'left') {
    let index = frameCount - 1;

    while (index >= 0 && !isMatch(index)) {
      index -= 1;
    }

    if (index < 0) {
      return bracket.matchedSec;
    }

    while (index > 0 && isMatch(index - 1)) {
      index -= 1;
    }

    return Math.max(0, lowSec + index * frameDurationSec);
  }

  let index = 0;

  while (index < frameCount && !isMatch(index)) {
    index += 1;
  }

  if (index >= frameCount) {
    return bracket.matchedSec;
  }

  while (index + 1 < frameCount && isMatch(index + 1)) {
    index += 1;
  }

  return Math.min(
    request.durationSec,
    lowSec + (index + 1) * frameDurationSec,
  );
}

async function locateSimilarityBoundary(
  request: ExactFrameMatchRequest,
  anchorFrame: Uint8Array,
  threshold: number,
  direction: SimilarityBoundaryDirection,
  signal?: AbortSignal,
): Promise<number> {
  const anchorSec = Math.max(
    0,
    Math.min(request.durationSec, request.currentTimeSec),
  );

  const similarityCache = new Map<string, boolean>();

  const isSimilarAt = async (timeSec: number) => {
    if (signal?.aborted) {
      throw new Error('PROCESS_ABORTED');
    }

    const clampedSec = Math.max(
      0,
      Math.min(
        Math.max(0, request.durationSec - EDGE_PROBE_EPSILON_SEC),
        timeSec,
      ),
    );
    const key = clampedSec.toFixed(6);
    const cached = similarityCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const frame = await readNormalizedFrameAt(
      request.path,
      clampedSec,
      signal,
    );
    const similar =
      frame !== null &&
      isFrameWithinVisualThreshold(
        anchorFrame,
        frame,
        threshold,
      );

    similarityCache.set(key, similar);
    return similar;
  };

  const coarse = await findExponentialSimilarityBracket(
    anchorSec,
    request.durationSec,
    direction,
    isSimilarAt,
  );
  const narrowed = await narrowSimilarityBoundaryBracket(
    coarse,
    isSimilarAt,
  );

  return refineSimilarityBoundary(
    request,
    anchorFrame,
    threshold,
    direction,
    narrowed,
    signal,
  );
}

function getFrameFromBuffer(
  buffer: Buffer,
  index: number,
): Uint8Array {
  const offset = index * SIMILARITY_FRAME_BYTES;
  return buffer.subarray(
    offset,
    offset + SIMILARITY_FRAME_BYTES,
  );
}

function scanSimilarityChunkFromRight(
  buffer: Buffer,
  chunkStartSec: number,
  chunkEndSec: number,
  anchorFrame: Uint8Array,
  threshold: number,
): { boundarySec: number; allMatched: boolean } {
  const frameCount = Math.floor(
    buffer.length / SIMILARITY_FRAME_BYTES,
  );
  if (frameCount <= 0) {
    return { boundarySec: chunkEndSec, allMatched: false };
  }

  const frameDurationSec = 1 / SIMILARITY_SAMPLE_FPS;
  let boundarySec = chunkEndSec;

  for (let index = frameCount - 1; index >= 0; index -= 1) {
    const frame = getFrameFromBuffer(buffer, index);
    if (
      !isFrameWithinVisualThreshold(
        anchorFrame,
        frame,
        threshold,
      )
    ) {
      return { boundarySec, allMatched: false };
    }

    boundarySec = chunkStartSec + index * frameDurationSec;
  }

  return { boundarySec: chunkStartSec, allMatched: true };
}

function scanSimilarityChunkFromLeft(
  buffer: Buffer,
  chunkStartSec: number,
  chunkEndSec: number,
  anchorFrame: Uint8Array,
  threshold: number,
): { boundarySec: number; allMatched: boolean } {
  const frameCount = Math.floor(
    buffer.length / SIMILARITY_FRAME_BYTES,
  );
  if (frameCount <= 0) {
    return { boundarySec: chunkStartSec, allMatched: false };
  }

  const frameDurationSec = 1 / SIMILARITY_SAMPLE_FPS;
  let boundarySec = chunkStartSec;

  for (let index = 0; index < frameCount; index += 1) {
    const frame = getFrameFromBuffer(buffer, index);
    if (
      !isFrameWithinVisualThreshold(
        anchorFrame,
        frame,
        threshold,
      )
    ) {
      return { boundarySec, allMatched: false };
    }

    boundarySec = Math.min(
      chunkEndSec,
      chunkStartSec + (index + 1) * frameDurationSec,
    );
  }

  return { boundarySec: chunkEndSec, allMatched: true };
}

async function locateSimilarityRange(
  request: ExactFrameMatchRequest,
  threshold: number,
  signal?: AbortSignal,
): Promise<LocatedVisualRange | null> {
  const anchorSec = Math.max(
    0,
    Math.min(request.durationSec, request.currentTimeSec),
  );

  const anchorFrame = await readNormalizedAnchorFrame(
    request.path,
    anchorSec,
    signal,
  );

  if (!anchorFrame) {
    return null;
  }

  const [startSec, endSec] = await Promise.all([
    locateSimilarityBoundary(
      request,
      anchorFrame,
      threshold,
      'left',
      signal,
    ),
    locateSimilarityBoundary(
      request,
      anchorFrame,
      threshold,
      'right',
      signal,
    ),
  ]);

  const minimumDurationSec = 1 / SIMILARITY_SAMPLE_FPS;
  const normalizedStartSec = Math.max(
    0,
    Math.min(startSec, anchorSec),
  );
  let normalizedEndSec = Math.min(
    request.durationSec,
    Math.max(endSec, anchorSec),
  );

  if (normalizedEndSec <= normalizedStartSec) {
    normalizedEndSec = Math.min(
      request.durationSec,
      normalizedStartSec + minimumDurationSec,
    );
  }

  return {
    startSec: normalizedStartSec,
    endSec: normalizedEndSec,
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
  const threshold = getVisualChangeThreshold(
    request.visualChangeLevel,
  );

  const range =
    request.visualChangeLevel === 'exact'
      ? await locateExactMd5Range(request, signal)
      : await locateSimilarityRange(
          request,
          threshold,
          signal,
        );

  if (!range) {
    return null;
  }

  const startSec = Math.max(0, range.startSec);
  const endSec = Math.min(request.durationSec, range.endSec);

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
    visualChangeLevel: request.visualChangeLevel,
    maxNormalizedDifference: threshold,
    audioSubIntervals,
  };
}
