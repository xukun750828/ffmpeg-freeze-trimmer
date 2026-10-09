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
}

function buildNavigationRegions(
  ranges: readonly TimeRangeLike[],
  durationSec: number,
  frameDurationSec: number,
  epsilonSec: number,
): NavigationRegion[] {
  const merged = mergeTimeRanges(ranges, epsilonSec);
  if (merged.length === 0) return [];

  const regions: NavigationRegion[] = [];

  merged.forEach((range, index) => {
    regions.push({
      kind: 'interval',
      startSec: range.startSec,
      endSec: range.endSec,
    });

    const next = merged[index + 1];
    if (!next) return;

    const gapStartSec = Math.min(
      durationSec,
      range.endSec + frameDurationSec,
    );
    const gapEndSec = Math.max(
      0,
      next.startSec - frameDurationSec,
    );

    if (gapEndSec + epsilonSec >= gapStartSec) {
      regions.push({
        kind: 'gap',
        startSec: gapStartSec,
        endSec: gapEndSec,
      });
    }
  });

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

  const merged = mergeTimeRanges(ranges, epsilonSec);
  if (merged.length === 0) {
    return direction < 0 ? 0 : durationSec;
  }

  const regions = buildNavigationRegions(
    merged,
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
      currentSec > region.startSec + epsilonSec &&
      currentSec < region.endSec - epsilonSec;

    if (direction < 0) {
      if (inside || atEnd) {
        return region.startSec;
      }

      if (atStart) {
        return index > 0 ? regions[index - 1].startSec : null;
      }
    } else {
      if (inside || atStart) {
        return region.endSec;
      }

      if (atEnd) {
        return index + 1 < regions.length ? regions[index + 1].endSec : null;
      }
    }
  }

  const firstInterval = merged[0];
  if (currentSec < firstInterval.startSec - epsilonSec) {
    return direction < 0 ? 0 : firstInterval.endSec;
  }

  const lastInterval = merged.at(-1);
  if (lastInterval && currentSec > lastInterval.endSec + epsilonSec) {
    return direction < 0 ? lastInterval.startSec : durationSec;
  }

  for (let index = 0; index < merged.length - 1; index += 1) {
    const previous = merged[index];
    const next = merged[index + 1];

    if (
      currentSec > previous.endSec + epsilonSec &&
      currentSec < next.startSec - epsilonSec
    ) {
      const gapStartSec = previous.endSec + safeFrameDurationSec;
      const gapEndSec = next.startSec - safeFrameDurationSec;

      if (direction < 0) {
        return Math.max(
          0,
          Math.min(durationSec, gapStartSec),
        );
      }

      return Math.max(
        0,
        Math.min(durationSec, gapEndSec),
      );
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
