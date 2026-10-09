// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { FreezeParser } from '../electron/main/freeze/freeze-parser';
import {
  applyRefinementAssignments,
  buildFastFreezeDetectArgs,
  buildFreezeDetectArgs,
  buildRefineFreezeDetectArgs,
  buildRefinementWindows,
  getFastScanProfile,
  mapWithConcurrency,
  matchRefinementBoundaries,
  mergeOverlappingFreezeIntervals,
} from '../electron/main/freeze/freeze-detector';

describe('FreezeParser', () => {
  it('parses multiple complete freeze intervals', () => {
    const parser = new FreezeParser();

    parser.pushLine('[freezedetect] lavfi.freezedetect.freeze_start: 12.4');
    parser.pushLine('[freezedetect] lavfi.freezedetect.freeze_duration: 5.8');
    parser.pushLine('[freezedetect] lavfi.freezedetect.freeze_end: 18.2');
    parser.pushLine('[freezedetect] lavfi.freezedetect.freeze_start: 31.1');
    parser.pushLine('[freezedetect] lavfi.freezedetect.freeze_duration: 7.4');
    parser.pushLine('[freezedetect] lavfi.freezedetect.freeze_end: 38.5');

    expect(parser.finish(60)).toEqual([
      {
        id: 'freeze-0001',
        startSec: 12.4,
        endSec: 18.2,
        durationSec: 5.799999999999999,
        selectedForRemoval: false,
      },
      {
        id: 'freeze-0002',
        startSec: 31.1,
        endSec: 38.5,
        durationSec: 7.399999999999999,
        selectedForRemoval: false,
      },
    ]);
  });

  it('closes a trailing freeze interval at media duration', () => {
    const parser = new FreezeParser();

    parser.pushLine('[freezedetect] lavfi.freezedetect.freeze_start: 55.25');
    parser.pushLine('[freezedetect] lavfi.freezedetect.freeze_duration: 4.75');

    const [interval] = parser.finish(60);

    expect(interval.startSec).toBe(55.25);
    expect(interval.endSec).toBe(60);
    expect(interval.durationSec).toBe(4.75);
  });

  it('ignores unrelated stderr lines', () => {
    const parser = new FreezeParser();
    parser.pushLine('frame= 100 fps=0.0 q=-0.0');
    expect(parser.finish(10)).toEqual([]);
  });
});

describe('freeze detection argument builders', () => {
  const options = {
    noise: 0.003,
    minDurationSec: 2,
  };

  it('builds deterministic precise ffmpeg freezedetect arguments', () => {
    const args = buildFreezeDetectArgs('C:\\Videos\\demo.mp4', options);

    expect(args).toContain('freezedetect=n=0.003:d=2');
    expect(args).toContain('C:\\Videos\\demo.mp4');
    expect(args).toContain('0:v:0');
  });

  it('uses 2 fps and 360p for the default fast profile', () => {
    expect(getFastScanProfile(options)).toEqual({
      fps: 2,
      height: 360,
    });

    const args = buildFastFreezeDetectArgs('C:\\Videos\\demo.mp4', options);
    const filter = args[args.indexOf('-vf') + 1];

    expect(filter).toContain('fps=2');
    expect(filter).toContain('scale=-2:360:flags=fast_bilinear');
    expect(filter).toContain('freezedetect=n=0.003:d=2');
  });

  it('raises fast-scan fps for short freeze thresholds', () => {
    expect(
      getFastScanProfile({
        noise: 0.003,
        minDurationSec: 0.5,
      }).fps,
    ).toBe(8);
  });

  it('builds a bounded precise refinement window', () => {
    const args = buildRefineFreezeDetectArgs(
      'C:\\Videos\\demo.mp4',
      120.25,
      6.5,
      options,
    );

    expect(args.slice(0, 8)).toEqual([
      '-hide_banner',
      '-nostats',
      '-ss',
      '120.250000',
      '-t',
      '6.500000',
      '-i',
      'C:\\Videos\\demo.mp4',
    ]);
    expect(args).toContain('freezedetect=n=0.003:d=2');
  });

  it('merges overlapping boundary refinement windows across nearby candidates', () => {
    const candidates = [
      {
        id: 'freeze-0001',
        startSec: 10,
        endSec: 14,
        durationSec: 4,
        selectedForRemoval: false,
      },
      {
        id: 'freeze-0002',
        startSec: 15,
        endSec: 18,
        durationSec: 3,
        selectedForRemoval: false,
      },
    ];

    const windows = buildRefinementWindows(candidates, 60, options);

    expect(windows.length).toBeLessThan(4);
    expect(windows.flatMap((window) => window.boundaries)).toHaveLength(4);
    expect(
      windows.every((window) => window.endSec - window.startSec <= 12),
    ).toBe(true);
  });

  it('keeps distant boundaries separate instead of decoding a long static span', () => {
    const candidates = [
      {
        id: 'freeze-0001',
        startSec: 5,
        endSec: 300,
        durationSec: 295,
        selectedForRemoval: false,
      },
    ];

    const windows = buildRefinementWindows(candidates, 360, options);

    expect(windows).toHaveLength(2);
    expect(windows[0].endSec - windows[0].startSec).toBeLessThan(6);
    expect(windows[1].endSec - windows[1].startSec).toBeLessThan(6);
  });

  it('does not reuse one precise boundary for two nearby coarse candidates', () => {
    const precise = [
      {
        id: 'freeze-0001',
        startSec: 10,
        endSec: 20,
        durationSec: 10,
        selectedForRemoval: false,
      },
    ];

    const assignments = matchRefinementBoundaries(precise, [
      { candidateIndex: 0, kind: 'start', targetSec: 10.2 },
      { candidateIndex: 1, kind: 'start', targetSec: 11.9 },
    ]);

    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toEqual({
      candidateIndex: 0,
      kind: 'start',
      value: 10,
    });
  });

  it('accepts a refined candidate only when both start and end boundaries are confirmed', () => {
    const candidates = [
      {
        id: 'freeze-0001',
        startSec: 10,
        endSec: 20,
        durationSec: 10,
        selectedForRemoval: false,
      },
      {
        id: 'freeze-0002',
        startSec: 30,
        endSec: 40,
        durationSec: 10,
        selectedForRemoval: false,
      },
    ];

    const result = applyRefinementAssignments(candidates, [
      { candidateIndex: 0, kind: 'start', value: 10.1 },
      { candidateIndex: 0, kind: 'end', value: 19.9 },
      { candidateIndex: 1, kind: 'end', value: 39.8 },
    ]);

    expect(result).toEqual([
      {
        ...candidates[0],
        startSec: 10.1,
        endSec: 19.9,
        durationSec: 9.799999999999999,
      },
    ]);
  });

  it('merges only overlapping refined intervals and keeps adjacent intervals separate', () => {
    const merged = mergeOverlappingFreezeIntervals([
      {
        id: 'a',
        startSec: 10,
        endSec: 15,
        durationSec: 5,
        selectedForRemoval: false,
      },
      {
        id: 'b',
        startSec: 14,
        endSec: 18,
        durationSec: 4,
        selectedForRemoval: false,
      },
      {
        id: 'c',
        startSec: 18,
        endSec: 20,
        durationSec: 2,
        selectedForRemoval: false,
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].startSec).toBe(10);
    expect(merged[0].endSec).toBe(18);
    expect(merged[1].startSec).toBe(18);
    expect(merged[1].endSec).toBe(20);
  });

  it('limits concurrent refinement workers and preserves result order', async () => {
    let active = 0;
    let peakActive = 0;

    const results = await mapWithConcurrency(
      [0, 1, 2, 3, 4, 5, 6, 7],
      4,
      async (value) => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5 + (7 - value)));
        active -= 1;
        return value * 10;
      },
    );

    expect(peakActive).toBeLessThanOrEqual(4);
    expect(peakActive).toBeGreaterThan(1);
    expect(results).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
  });
});
