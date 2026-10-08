// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  filterFreezesBySilence,
  parseSilenceIntervals,
} from '../electron/main/freeze/silence-detector';

describe('silence detector helpers', () => {
  it('parses complete and trailing silence intervals', () => {
    const intervals = parseSilenceIntervals(
      [
        '[silencedetect] silence_start: 2.5',
        '[silencedetect] silence_end: 5.75 | silence_duration: 3.25',
        '[silencedetect] silence_start: 9',
      ],
      12,
    );

    expect(intervals).toEqual([
      { startSec: 2.5, endSec: 5.75 },
      { startSec: 9, endSec: 12 },
    ]);
  });

  it('keeps only freeze intervals with enough silence overlap', () => {
    const freezes = [
      {
        id: 'freeze-0001',
        startSec: 10,
        endSec: 14,
        durationSec: 4,
        selectedForRemoval: false,
      },
      {
        id: 'freeze-0002',
        startSec: 20,
        endSec: 24,
        durationSec: 4,
        selectedForRemoval: false,
      },
    ];

    const result = filterFreezesBySilence(
      freezes,
      [
        { startSec: 9.5, endSec: 13.5 },
        { startSec: 22.5, endSec: 24 },
      ],
      2,
    );

    expect(result.map((interval) => interval.id)).toEqual(['freeze-0001']);
  });
});
