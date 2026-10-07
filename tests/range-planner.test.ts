// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildKeepRanges,
  createExportPlan,
  normalizeRemoveRanges,
} from '../electron/main/export/range-planner';

describe('normalizeRemoveRanges', () => {
  it('sorts, clamps, drops invalid ranges, and merges overlap/adjacency', () => {
    expect(
      normalizeRemoveRanges(
        [
          { startSec: 18, endSec: 25 },
          { startSec: -5, endSec: 3 },
          { startSec: 10, endSec: 15 },
          { startSec: 14.5, endSec: 19 },
          { startSec: 24.9995, endSec: 30 },
          { startSec: 40, endSec: 35 },
          { startSec: 95, endSec: 110 },
        ],
        100,
      ),
    ).toEqual([
      { startSec: 0, endSec: 3 },
      { startSec: 10, endSec: 30 },
      { startSec: 95, endSec: 100 },
    ]);
  });
});

describe('buildKeepRanges', () => {
  it('returns the whole media when there are no removal ranges', () => {
    expect(buildKeepRanges([], 60)).toEqual([{ startSec: 0, endSec: 60 }]);
  });

  it('handles removal at the beginning', () => {
    expect(buildKeepRanges([{ startSec: 0, endSec: 5 }], 20)).toEqual([
      { startSec: 5, endSec: 20 },
    ]);
  });

  it('handles removal at the end', () => {
    expect(buildKeepRanges([{ startSec: 15, endSec: 20 }], 20)).toEqual([
      { startSec: 0, endSec: 15 },
    ]);
  });

  it('handles multiple middle removals', () => {
    expect(
      buildKeepRanges(
        [
          { startSec: 5, endSec: 10 },
          { startSec: 20, endSec: 25 },
        ],
        30,
      ),
    ).toEqual([
      { startSec: 0, endSec: 5 },
      { startSec: 10, endSec: 20 },
      { startSec: 25, endSec: 30 },
    ]);
  });

  it('returns no keep ranges when the entire media is removed', () => {
    expect(buildKeepRanges([{ startSec: 0, endSec: 30 }], 30)).toEqual([]);
  });
});

describe('createExportPlan', () => {
  it('calculates expected output duration', () => {
    const plan = createExportPlan(
      [
        { startSec: 12.4, endSec: 18.2 },
        { startSec: 31.1, endSec: 38.5 },
      ],
      60,
    );

    expect(plan.outputDurationSec).toBeCloseTo(46.8, 6);
    expect(plan.keepRanges).toHaveLength(3);
  });
});
