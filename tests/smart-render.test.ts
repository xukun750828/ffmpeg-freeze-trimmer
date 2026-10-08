// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildSmartRenderConcatArgs,
  buildSmartRenderConcatScript,
  buildSmartRenderEncodeArgs,
  getFrameAlignedCopyDurationSec,
  parseSmartRenderCodecParams,
  parseSmartRenderFrames,
  planSmartRenderRange,
} from '../electron/main/export/smart-render';

const params = {
  videoBitrate: 1_411_342,
  videoTimescale: 30_000,
  hasBFrames: 0,
  nominalFps: 30,
  pixelFormat: 'yuv420p',
};

describe('smart render planning', () => {
  it('parses source codec parameters needed for compatible boundary encoding', () => {
    expect(
      parseSmartRenderCodecParams(
        JSON.stringify({
          streams: [
            {
              codec_name: 'h264',
              bit_rate: '1411342',
              time_base: '1/30000',
              has_b_frames: 0,
              r_frame_rate: '30/1',
              pix_fmt: 'yuv420p',
            },
          ],
        }),
      ),
    ).toEqual(params);
  });

  it('rejects unsupported or incomplete codec parameters', () => {
    expect(
      parseSmartRenderCodecParams(
        JSON.stringify({
          streams: [{ codec_name: 'hevc', bit_rate: '1000000' }],
        }),
      ),
    ).toBeNull();
  });

  it('parses frame timestamps and keyframe flags', () => {
    expect(
      parseSmartRenderFrames(
        '0,996.766633\n1,996.800000\r\n0,996.833300\n',
      ),
    ).toEqual([
      { keyframe: false, timeSec: 996.766633 },
      { keyframe: true, timeSec: 996.8 },
      { keyframe: false, timeSec: 996.8333 },
    ]);
  });

  it('copies directly when the keep range already starts on a keyframe', () => {
    expect(
      planSmartRenderRange(
        { startSec: 996.8, endSec: 1000 },
        [
          { keyframe: true, timeSec: 996.8 },
          { keyframe: false, timeSec: 996.8333 },
        ],
        30,
      ),
    ).toEqual({
      mode: 'copy',
      range: { startSec: 996.8, endSec: 1000 },
    });
  });

  it('encodes only the prefix before the next keyframe', () => {
    expect(
      planSmartRenderRange(
        { startSec: 995.123, endSec: 1000.456 },
        [
          { keyframe: false, timeSec: 995.1 },
          { keyframe: false, timeSec: 996.766633 },
          { keyframe: true, timeSec: 996.8 },
          { keyframe: false, timeSec: 996.8333 },
        ],
        30,
      ),
    ).toEqual({
      mode: 'hybrid',
      range: { startSec: 995.123, endSec: 1000.456 },
      encodeEndSec: 996.8,
      encodeFrameCount: 1,
      copyStartSec: 996.8,
    });
  });

  it('encodes the whole short keep range when no usable keyframe exists inside it', () => {
    expect(
      planSmartRenderRange(
        { startSec: 995.123, endSec: 996.7 },
        [
          { keyframe: false, timeSec: 995.1 },
          { keyframe: true, timeSec: 996.8 },
        ],
        30,
      ).mode,
    ).toBe('encode');
  });
});

it('rounds direct-copy concat duration up to a whole video frame', () => {
  expect(getFrameAlignedCopyDurationSec(306.366633, 599.111, 30)).toBeCloseTo(292.7666667);
});

describe('smart render ffmpeg plans', () => {
  it('builds a mixed concat plan containing tiny encoded files and direct source ranges', () => {
    const script = buildSmartRenderConcatScript([
      {
        kind: 'file',
        path: 'C:\\temp\\prefix.mp4',
        durationSec: 1.677,
      },
      {
        kind: 'source',
        path: 'C:\\video\\input.mp4',
        startSec: 996.8,
        endSec: 1000.456,
        durationSec: getFrameAlignedCopyDurationSec(996.8, 1000.456, 30),
      },
    ]);

    expect(script).toContain("file 'C:/temp/prefix.mp4'");
    expect(script).toContain("file 'C:/video/input.mp4'");
    expect(script).toContain('inpoint 996.8');
    expect(script).toContain('outpoint 1000.456');
    expect(script).not.toContain('duration ');
  });

  it('keeps the source codec timing characteristics on encoded boundary prefixes', () => {
    const args = buildSmartRenderEncodeArgs(
      'input.mp4',
      'prefix.mp4',
      995.123,
      996.766633,
      params,
      true,
    );

    expect(args).toContain('libx264');
    expect(args).toContain('1411342');
    expect(args).toContain('-bf');
    expect(args).toContain('0');
    expect(args).toContain('-c:a');
    expect(args).toContain('copy');
    expect(args).toContain('-video_track_timescale');
    expect(args).toContain('30000');
  });

  it('concatenates the hybrid plan without re-encoding the final output', () => {
    const args = buildSmartRenderConcatArgs(
      'plan.ffconcat',
      'output.mp4',
      params,
      true,
    );

    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).toContain('30000');
    expect(args).toContain('pipe:1');
  });
});
