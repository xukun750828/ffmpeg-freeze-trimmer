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

export function findIntervalBoundaryJumpTarget(
  ranges: readonly TimeRangeLike[],
  currentSec: number,
  direction: -1 | 1,
  epsilonSec = 0.001,
): number | null {
  const merged = mergeTimeRanges(ranges, epsilonSec);
  if (merged.length === 0 || !Number.isFinite(currentSec)) {
    return null;
  }

  const isNear = (value: number, target: number) =>
    Math.abs(value - target) <= epsilonSec;

  for (let index = 0; index < merged.length; index += 1) {
    const range = merged[index];
    const atStart = isNear(currentSec, range.startSec);
    const atEnd = isNear(currentSec, range.endSec);
    const inside =
      currentSec > range.startSec + epsilonSec &&
      currentSec < range.endSec - epsilonSec;

    if (direction < 0) {
      if (inside || atEnd) {
        return range.startSec;
      }

      if (atStart) {
        return index > 0 ? merged[index - 1].startSec : null;
      }
    } else {
      if (inside || atStart) {
        return range.endSec;
      }

      if (atEnd) {
        return index + 1 < merged.length ? merged[index + 1].endSec : null;
      }
    }
  }

  if (direction < 0) {
    for (let index = merged.length - 2; index >= 0; index -= 1) {
      const previous = merged[index];
      const next = merged[index + 1];

      if (
        currentSec > previous.endSec + epsilonSec &&
        currentSec < next.startSec - epsilonSec
      ) {
        return previous.endSec;
      }
    }

    const last = merged.at(-1);
    if (last && currentSec > last.endSec + epsilonSec) {
      return last.startSec;
    }

    return null;
  }

  for (let index = 1; index < merged.length; index += 1) {
    const previous = merged[index - 1];
    const next = merged[index];

    if (
      currentSec > previous.endSec + epsilonSec &&
      currentSec < next.startSec - epsilonSec
    ) {
      return next.startSec;
    }
  }

  const first = merged[0];
  if (currentSec < first.startSec - epsilonSec) {
    return first.endSec;
  }

  return null;
}

export function measureTimeRangeUnion(
  ranges: readonly TimeRangeLike[],
): number {
  return mergeTimeRanges(ranges).reduce(
    (sum, range) => sum + (range.endSec - range.startSec),
    0,
  );
}
