import { describe, expect, it } from 'vitest';
import {
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
});
