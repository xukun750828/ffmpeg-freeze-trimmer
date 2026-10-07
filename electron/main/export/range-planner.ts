import type { ExportPlan, TimeRange } from './types';

const DEFAULT_EPSILON_SEC = 0.001;

export function normalizeRemoveRanges(
  ranges: TimeRange[],
  durationSec: number,
  epsilonSec = DEFAULT_EPSILON_SEC,
): TimeRange[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('INVALID_MEDIA_DURATION');
  }

  const normalized = ranges
    .filter(
      (range) =>
        Number.isFinite(range.startSec) &&
        Number.isFinite(range.endSec),
    )
    .map((range) => ({
      startSec: Math.min(durationSec, Math.max(0, range.startSec)),
      endSec: Math.min(durationSec, Math.max(0, range.endSec)),
    }))
    .filter((range) => range.endSec > range.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  const merged: TimeRange[] = [];

  for (const range of normalized) {
    const previous = merged.at(-1);

    if (!previous || range.startSec > previous.endSec + epsilonSec) {
      merged.push({ ...range });
      continue;
    }

    previous.endSec = Math.max(previous.endSec, range.endSec);
  }

  return merged;
}

export function buildKeepRanges(
  removeRanges: TimeRange[],
  durationSec: number,
): TimeRange[] {
  const normalized = normalizeRemoveRanges(removeRanges, durationSec);
  const keepRanges: TimeRange[] = [];
  let cursor = 0;

  for (const remove of normalized) {
    if (remove.startSec > cursor) {
      keepRanges.push({
        startSec: cursor,
        endSec: remove.startSec,
      });
    }

    cursor = Math.max(cursor, remove.endSec);
  }

  if (cursor < durationSec) {
    keepRanges.push({
      startSec: cursor,
      endSec: durationSec,
    });
  }

  return keepRanges;
}

export function createExportPlan(
  removeRanges: TimeRange[],
  durationSec: number,
): ExportPlan {
  const normalizedRemoves = normalizeRemoveRanges(removeRanges, durationSec);
  const keepRanges = buildKeepRanges(normalizedRemoves, durationSec);
  const outputDurationSec = keepRanges.reduce(
    (sum, range) => sum + (range.endSec - range.startSec),
    0,
  );

  return {
    removeRanges: normalizedRemoves,
    keepRanges,
    outputDurationSec,
  };
}
