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

interface NavigationRegion {
  kind: 'interval' | 'gap';
  startSec: number;
  endSec: number;
  matchStartSec: number;
  matchEndSec: number;
}

function buildNavigationRegions(
  ranges: readonly TimeRangeLike[],
  durationSec: number,
  frameDurationSec: number,
  epsilonSec: number,
): NavigationRegion[] {
  const merged = mergeTimeRanges(ranges, epsilonSec);
  if (merged.length === 0) {
    return [
      {
        kind: 'gap',
        startSec: 0,
        endSec: durationSec,
        matchStartSec: 0,
        matchEndSec: durationSec,
      },
    ];
  }

  const regions: NavigationRegion[] = [];
  const first = merged[0];
  const leftGapEndSec = first.startSec - frameDurationSec;

  if (leftGapEndSec >= -epsilonSec) {
    regions.push({
      kind: 'gap',
      startSec: 0,
      endSec: Math.max(0, leftGapEndSec),
      matchStartSec: 0,
      matchEndSec: first.startSec,
    });
  }

  merged.forEach((range, index) => {
    regions.push({
      kind: 'interval',
      startSec: range.startSec,
      endSec: range.endSec,
      matchStartSec: range.startSec,
      matchEndSec: range.endSec,
    });

    const next = merged[index + 1];
    if (!next) return;

    const gapStartSec = range.endSec + frameDurationSec;
    const gapEndSec = next.startSec - frameDurationSec;

    if (gapEndSec + epsilonSec >= gapStartSec) {
      regions.push({
        kind: 'gap',
        startSec: Math.min(durationSec, gapStartSec),
        endSec: Math.max(0, gapEndSec),
        matchStartSec: range.endSec,
        matchEndSec: next.startSec,
      });
    }
  });

  const last = merged.at(-1);
  if (last) {
    const rightGapStartSec = last.endSec + frameDurationSec;

    if (rightGapStartSec <= durationSec + epsilonSec) {
      regions.push({
        kind: 'gap',
        startSec: Math.min(durationSec, rightGapStartSec),
        endSec: durationSec,
        matchStartSec: last.endSec,
        matchEndSec: durationSec,
      });
    }
  }

  return regions;
}

export function findIntervalBoundaryJumpTarget(
  ranges: readonly TimeRangeLike[],
  currentSec: number,
  direction: -1 | 1,
  durationSec: number,
  frameDurationSec: number,
  epsilonSec = 0.001,
): number | null {
  if (
    !Number.isFinite(currentSec) ||
    !Number.isFinite(durationSec) ||
    durationSec < 0
  ) {
    return null;
  }

  const safeFrameDurationSec =
    Number.isFinite(frameDurationSec) && frameDurationSec > 0
      ? frameDurationSec
      : 0;

  const regions = buildNavigationRegions(
    ranges,
    durationSec,
    safeFrameDurationSec,
    epsilonSec,
  );

  const isNear = (value: number, target: number) =>
    Math.abs(value - target) <= epsilonSec;

  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    const atStart = isNear(currentSec, region.startSec);
    const atEnd = isNear(currentSec, region.endSec);
    const inside =
      currentSec > region.matchStartSec + epsilonSec &&
      currentSec < region.matchEndSec - epsilonSec;

    if (direction < 0) {
      if (atStart) {
        return index > 0 ? regions[index - 1].startSec : null;
      }

      if (inside || atEnd) {
        return region.startSec;
      }
    } else {
      if (atEnd) {
        return index + 1 < regions.length ? regions[index + 1].endSec : null;
      }

      if (inside || atStart) {
        return region.endSec;
      }
    }
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
