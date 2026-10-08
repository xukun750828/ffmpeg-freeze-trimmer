// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  findContiguousAnchorHashRange,
  parseFrameMd5,
} from '../electron/main/freeze/exact-frame-locator';

describe('exact frame locator helpers', () => {
  it('parses framemd5 timebase and frame hashes', () => {
    const parsed = parseFrameMd5([
      '#format: frame checksums',
      '#tb 0: 1/30',
      '0, 0, 0, 1, 3110400, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0, 1, 1, 1, 3110400, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ].join('\n'));

    expect(parsed.timeBaseSec).toBeCloseTo(1 / 30, 8);
    expect(parsed.frames).toEqual([
      {
        pts: 0,
        duration: 1,
        hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      {
        pts: 1,
        duration: 1,
        hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    ]);
  });

  it('finds only the contiguous copies of the anchor frame hash', () => {
    const range = findContiguousAnchorHashRange(
      [
        { startSec: 9.9, endSec: 10.0, hash: 'other' },
        { startSec: 10.0, endSec: 10.1, hash: 'anchor' },
        { startSec: 10.1, endSec: 10.2, hash: 'anchor' },
        { startSec: 10.2, endSec: 10.3, hash: 'anchor' },
        { startSec: 10.3, endSec: 10.4, hash: 'changed' },
        { startSec: 10.4, endSec: 10.5, hash: 'anchor' },
      ],
      10.15,
      'anchor',
    );

    expect(range).toEqual({
      startSec: 10.0,
      endSec: 10.3,
      touchesLeftEdge: false,
      touchesRightEdge: false,
    });
  });
});
