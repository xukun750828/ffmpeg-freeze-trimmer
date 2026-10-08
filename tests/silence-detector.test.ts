// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildAudioSubIntervals,
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

  it('partitions a parent range into alternating sound and silence sub-intervals', () => {
    const result = buildAudioSubIntervals(
      10,
      20,
      [
        { startSec: 12, endSec: 14 },
        { startSec: 16, endSec: 18 },
      ],
    );

    expect(result).toEqual([
      {
        id: 'audio-0001',
        startSec: 10,
        endSec: 12,
        durationSec: 2,
        audioPresence: 'sound',
      },
      {
        id: 'audio-0002',
        startSec: 12,
        endSec: 14,
        durationSec: 2,
        audioPresence: 'silence',
      },
      {
        id: 'audio-0003',
        startSec: 14,
        endSec: 16,
        durationSec: 2,
        audioPresence: 'sound',
      },
      {
        id: 'audio-0004',
        startSec: 16,
        endSec: 18,
        durationSec: 2,
        audioPresence: 'silence',
      },
      {
        id: 'audio-0005',
        startSec: 18,
        endSec: 20,
        durationSec: 2,
        audioPresence: 'sound',
      },
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
