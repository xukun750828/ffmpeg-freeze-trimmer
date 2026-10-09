import { describe, expect, it } from 'vitest';
import {
  findIntervalBoundaryJumpTarget,
  measureTimeRangeUnion,
  mergeTimeRanges,
} from './time-ranges';

describe('time range union', () => {
  it('merges overlapping and adjacent removal ranges', () => {
    expect(
      mergeTimeRanges([
        { startSec: 12.4, endSec: 18.2 },
        { startSec: 14, endSec: 20 },
        { startSec: 21, endSec: 22 },
        { startSec: 22.0005, endSec: 23 },
      ]),
    ).toEqual([
      { startSec: 12.4, endSec: 20 },
      { startSec: 21, endSec: 23 },
    ]);
  });

  it('measures union duration without double-counting overlap', () => {
    expect(
      measureTimeRangeUnion([
        { startSec: 12.4, endSec: 18.2 },
        { startSec: 14, endSec: 20 },
      ]),
    ).toBeCloseTo(7.6, 6);
  });

  it('uses gap boundaries before entering the adjacent interval', () => {
    const ranges = [
      { startSec: 12.4, endSec: 18.2 },
      { startSec: 31.1, endSec: 38.5 },
    ];

    expect(findIntervalBoundaryJumpTarget(ranges, 25, -1, 0.02)).toBeCloseTo(
      18.2,
      6,
    );
    expect(
      findIntervalBoundaryJumpTarget(ranges, 18.2, -1, 0.02),
    ).toBeCloseTo(12.4, 6);

    expect(findIntervalBoundaryJumpTarget(ranges, 25, 1, 0.02)).toBeCloseTo(
      31.1,
      6,
    );
    expect(
      findIntervalBoundaryJumpTarget(ranges, 31.1, 1, 0.02),
    ).toBeCloseTo(38.5, 6);
  });

  it('preserves the existing interval-to-interval repeated jump behavior', () => {
    const ranges = [
      { startSec: 12.4, endSec: 18.2 },
      { startSec: 31.1, endSec: 38.5 },
    ];

    expect(findIntervalBoundaryJumpTarget(ranges, 15, -1, 0.02)).toBeCloseTo(
      12.4,
      6,
    );
    expect(
      findIntervalBoundaryJumpTarget(ranges, 31.1, -1, 0.02),
    ).toBeCloseTo(12.4, 6);

    expect(findIntervalBoundaryJumpTarget(ranges, 35, 1, 0.02)).toBeCloseTo(
      38.5,
      6,
    );
    expect(
      findIntervalBoundaryJumpTarget(ranges, 18.2, 1, 0.02),
    ).toBeCloseTo(38.5, 6);
  });

  it('merges overlapping visible candidates before calculating gaps', () => {
    const ranges = [
      { startSec: 10, endSec: 20 },
      { startSec: 15, endSec: 25 },
      { startSec: 40, endSec: 50 },
    ];

    expect(findIntervalBoundaryJumpTarget(ranges, 30, -1, 0.02)).toBeCloseTo(
      25,
      6,
    );
    expect(findIntervalBoundaryJumpTarget(ranges, 30, 1, 0.02)).toBeCloseTo(
      40,
      6,
    );
  });
});
