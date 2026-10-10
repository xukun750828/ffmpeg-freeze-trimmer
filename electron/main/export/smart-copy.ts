import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveFfprobePath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import type { TimeRange } from './types';

const KEYFRAME_PROBE_RADIUS_SEC = 12;
const KEYFRAME_PROBE_CONCURRENCY = 4;

export interface SmartCopyBoundaryProbe {
  boundarySec: number;
  keyframeSec: number | null;
}

export interface SmartCopyAnalysis {
  eligible: boolean;
  probes: SmartCopyBoundaryProbe[];
}

export function getInternalCutBoundaries(
  removeRanges: TimeRange[],
  durationSec: number,
): number[] {
  const values = new Set<number>();

  for (const range of removeRanges) {
    if (range.startSec > 0 && range.startSec < durationSec) {
      values.add(range.startSec);
    }
    if (range.endSec > 0 && range.endSec < durationSec) {
      values.add(range.endSec);
    }
  }

  return [...values].sort((a, b) => a - b);
}

export function getKeyframeToleranceSec(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 0.02;
  return Math.max(0.002, Math.min(0.05, 0.55 / fps));
}

export function parseKeyframeTimes(stdout: string): number[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.split(',')[0]?.trim() ?? '')
    .filter((value) => value.length > 0)
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

export function isTimeAtKeyframe(
  targetSec: number,
  keyframeTimes: number[],
  toleranceSec: number,
): boolean {
  return keyframeTimes.some(
    (keyframeSec) => Math.abs(keyframeSec - targetSec) <= toleranceSec,
  );
}

export function findMatchingKeyframe(
  targetSec: number,
  keyframeTimes: readonly number[],
  toleranceSec: number,
): number | null {
  let nearest: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const keyframeSec of keyframeTimes) {
    const distance = Math.abs(keyframeSec - targetSec);
    if (distance <= toleranceSec && distance < nearestDistance) {
      nearest = keyframeSec;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function formatTimestamp(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function escapeConcatPath(inputPath: string): string {
  const normalized = path.resolve(inputPath).replace(/\\/g, '/');
  return normalized.replace(/'/g, "'\\''");
}

export function buildSmartCopyConcatScript(
  inputPath: string,
  keepRanges: TimeRange[],
): string {
  const escapedPath = escapeConcatPath(inputPath);
  const lines = ['ffconcat version 1.0'];

  for (const range of keepRanges) {
    lines.push(`file '${escapedPath}'`);
    if (range.startSec > 0) {
      lines.push(`inpoint ${formatTimestamp(range.startSec)}`);
    }
    lines.push(`outpoint ${formatTimestamp(range.endSec)}`);
  }

  return `${lines.join('\n')}\n`;
}

async function probeKeyframesNear(
  inputPath: string,
  targetSec: number,
  signal: AbortSignal,
): Promise<number[]> {
  const startSec = Math.max(0, targetSec - KEYFRAME_PROBE_RADIUS_SEC);
  const durationSec = KEYFRAME_PROBE_RADIUS_SEC * 2;
  const result = await runProcess(
    resolveFfprobePath(),
    [
      '-v',
      'error',
      '-skip_frame',
      'nokey',
      '-select_streams',
      'v:0',
      '-read_intervals',
      `${formatTimestamp(startSec)}%+${formatTimestamp(durationSec)}`,
      '-show_entries',
      'frame=best_effort_timestamp_time',
      '-of',
      'csv=p=0',
      inputPath,
    ],
    { signal },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'KEYFRAME_PROBE_FAILED');
  }

  return parseKeyframeTimes(result.stdout);
}

export async function analyzeSmartCopyEligibility(
  inputPath: string,
  removeRanges: TimeRange[],
  durationSec: number,
  fps: number,
  signal: AbortSignal,
): Promise<SmartCopyAnalysis> {
  const boundaries = getInternalCutBoundaries(removeRanges, durationSec);
  if (boundaries.length === 0) {
    return { eligible: true, probes: [] };
  }

  const toleranceSec = getKeyframeToleranceSec(fps);
  const probes = new Array<SmartCopyBoundaryProbe>(boundaries.length);

  for (let offset = 0; offset < boundaries.length; offset += KEYFRAME_PROBE_CONCURRENCY) {
    const batch = boundaries.slice(offset, offset + KEYFRAME_PROBE_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (boundarySec) => {
        const keyframes = await probeKeyframesNear(inputPath, boundarySec, signal);
        return {
          boundarySec,
          keyframeSec: findMatchingKeyframe(
            boundarySec,
            keyframes,
            toleranceSec,
          ),
        } satisfies SmartCopyBoundaryProbe;
      }),
    );

    batchResults.forEach((probe, batchIndex) => {
      probes[offset + batchIndex] = probe;
    });
  }

  return {
    eligible: probes.every((probe) => probe.keyframeSec !== null),
    probes,
  };
}

export async function canUseSmartCopy(
  inputPath: string,
  removeRanges: TimeRange[],
  durationSec: number,
  fps: number,
  signal: AbortSignal,
): Promise<boolean> {
  return (
    await analyzeSmartCopyEligibility(
      inputPath,
      removeRanges,
      durationSec,
      fps,
      signal,
    )
  ).eligible;
}

export async function writeSmartCopyConcatFile(
  concatPath: string,
  inputPath: string,
  keepRanges: TimeRange[],
): Promise<void> {
  await writeFile(
    concatPath,
    buildSmartCopyConcatScript(inputPath, keepRanges),
    'utf8',
  );
}
