// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { FreezeParser } from '../electron/main/freeze/freeze-parser';
import { buildFreezeDetectArgs } from '../electron/main/freeze/freeze-detector';

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

describe('buildFreezeDetectArgs', () => {
  it('builds deterministic ffmpeg freezedetect arguments', () => {
    const args = buildFreezeDetectArgs('C:\\Videos\\demo.mp4', {
      noise: 0.003,
      minDurationSec: 2,
    });

    expect(args).toContain('freezedetect=n=0.003:d=2');
    expect(args).toContain('C:\\Videos\\demo.mp4');
    expect(args).toContain('0:v:0');
  });
});
