// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildTrimConcatFilter } from '../electron/main/export/filter-builder';
import {
  buildExportArgs,
  getRangesDuration,
  parseFfmpegOutTimeSec,
} from '../electron/main/export/ffmpeg-export';

describe('buildExportArgs', () => {
  it('maps synchronized audio/video outputs and progress pipe', () => {
    const graph = buildTrimConcatFilter(
      [{ startSec: 0, endSec: 5 }],
      true,
    );

    const args = buildExportArgs(
      'input.mp4',
      'temp.mp4',
      graph,
      true,
    );

    expect(args).toContain('[outv]');
    expect(args).toContain('[outa]');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args).toContain('pipe:1');
    expect(args.at(-1)).toBe('temp.mp4');
  });

  it('omits audio encoding for video-only media', () => {
    const graph = buildTrimConcatFilter(
      [{ startSec: 0, endSec: 5 }],
      false,
    );
    const args = buildExportArgs('input.mp4', 'temp.mp4', graph, false);

    expect(args).not.toContain('aac');
    expect(args).not.toContain('[outa]');
  });
});

describe('parseFfmpegOutTimeSec', () => {
  it('parses microsecond progress values', () => {
    expect(parseFfmpegOutTimeSec('out_time_us=2500000')).toBe(2.5);
  });

  it('parses HH:MM:SS progress values', () => {
    expect(parseFfmpegOutTimeSec('out_time=00:01:02.500000')).toBe(62.5);
  });

  it('ignores unrelated progress lines', () => {
    expect(parseFfmpegOutTimeSec('progress=continue')).toBeNull();
  });
});

describe('getRangesDuration', () => {
  it('sums keep range duration', () => {
    expect(
      getRangesDuration([
        { startSec: 0, endSec: 3 },
        { startSec: 5, endSec: 8.5 },
      ]),
    ).toBe(6.5);
  });
});
