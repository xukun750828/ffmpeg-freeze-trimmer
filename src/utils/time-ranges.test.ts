import { describe, expect, it } from 'vitest';
import {
  findIntervalBoundaryJumpTarget,
  measureTimeRangeUnion,
  mergeTimeRanges,
} from './time-ranges';

const DURATION_SEC = 100;
const FRAME_SEC = 1 / 30;
const EPSILON_SEC = FRAME_SEC / 2;

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

  it('navigates an interval by its own boundary and then the adjacent gap boundary', () => {
    const ranges = [
      { startSec: 12.4, endSec: 18.2 },
      { startSec: 31.1, endSec: 38.5 },
      { startSec: 50, endSec: 60 },
    ];

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        35,
        -1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(31.1, 6);

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        31.1,
        -1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(18.2 + FRAME_SEC, 6);

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        35,
        1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(38.5, 6);

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        38.5,
        1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(50 - FRAME_SEC, 6);
  });

  it('navigates an internal gap by its frame-adjusted start/end then the adjacent interval boundary', () => {
    const ranges = [
      { startSec: 12.4, endSec: 18.2 },
      { startSec: 31.1, endSec: 38.5 },
    ];

    const gapStartSec = 18.2 + FRAME_SEC;
    const gapEndSec = 31.1 - FRAME_SEC;

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        25,
        -1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(gapStartSec, 6);

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        gapStartSec,
        -1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(12.4, 6);

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        25,
        1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(gapEndSec, 6);

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        gapEndSec,
        1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(38.5, 6);
  });

  it('jumps to timeline start/end when there are no visible intervals', () => {
    expect(
      findIntervalBoundaryJumpTarget(
        [],
        42,
        -1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBe(0);

    expect(
      findIntervalBoundaryJumpTarget(
        [],
        42,
        1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBe(DURATION_SEC);
  });

  it('merges overlapping visible candidates before calculating gaps', () => {
    const ranges = [
      { startSec: 10, endSec: 20 },
      { startSec: 15, endSec: 25 },
      { startSec: 40, endSec: 50 },
    ];

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        30,
        -1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(25 + FRAME_SEC, 6);

    expect(
      findIntervalBoundaryJumpTarget(
        ranges,
        30,
        1,
        DURATION_SEC,
        FRAME_SEC,
        EPSILON_SEC,
      ),
    ).toBeCloseTo(40 - FRAME_SEC, 6);
  });
});
