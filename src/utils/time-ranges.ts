export interface TimeRangeLike {
  startSec: number;
  endSec: number;
}

export function mergeTimeRanges(
  ranges: readonly TimeRangeLike[],
  epsilonSec = 0.001,
): TimeRangeLike[] {
  const sorted = ranges
    .filter(
      (range) =>
        Number.isFinite(range.startSec) &&
        Number.isFinite(range.endSec) &&
        range.endSec > range.startSec,
    )
    .map((range) => ({
      startSec: range.startSec,
      endSec: range.endSec,
    }))
    .sort((a, b) => a.startSec - b.startSec);

  const merged: TimeRangeLike[] = [];

  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.startSec > previous.endSec + epsilonSec) {
      merged.push({ ...range });
      continue;
    }

    previous.endSec = Math.max(previous.endSec, range.endSec);
  }

  return merged;
}

export function measureTimeRangeUnion(
  ranges: readonly TimeRangeLike[],
): number {
  return mergeTimeRanges(ranges).reduce(
    (sum, range) => sum + (range.endSec - range.startSec),
    0,
  );
}
