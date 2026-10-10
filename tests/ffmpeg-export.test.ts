// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildTrimConcatFilter } from '../electron/main/export/filter-builder';
import {
  buildExportArgs,
  buildPreciseReencodeArgs,
  buildPreciseReencodeConcatScript,
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

  it('uses timestamp passthrough for VFR-safe full reencode output', () => {
    const graph = buildTrimConcatFilter(
      [{ startSec: 0, endSec: 5 }],
      true,
    );
    const args = buildExportArgs('input.mp4', 'temp.mp4', graph, true);

    expect(args).toContain('-fps_mode');
    expect(args).toContain('passthrough');
  });

  it('builds a concat-demuxer plan that keeps each source range explicit', () => {
    const script = buildPreciseReencodeConcatScript('C:/media/input.mp4', [
      { startSec: 0, endSec: 5 },
      { startSec: 8.25, endSec: 12.75 },
    ]);

    expect(script).toContain('ffconcat version 1.0');
    expect(script.match(/file '/g)).toHaveLength(2);
    expect(script).toContain('outpoint 5');
    expect(script).toContain('duration 5');
    expect(script).toContain('inpoint 8.25');
    expect(script).toContain('outpoint 12.75');
    expect(script).toContain('duration 4.5');
  });

  it('uses concatdec_select and timestamp passthrough for robust VFR reencode', () => {
    const args = buildPreciseReencodeArgs(
      'ranges.ffconcat',
      'output.mp4',
      true,
    );

    expect(args).toContain('-segment_time_metadata');
    expect(args).toContain('select=concatdec_select,setpts=PTS-STARTPTS');
    expect(args).toContain('aselect=concatdec_select,asetpts=PTS-STARTPTS');
    expect(args).toContain('-fps_mode');
    expect(args).toContain('passthrough');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args).not.toContain('-filter_complex');
    expect(args.at(-1)).toBe('output.mp4');
  });});

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
