// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildSmartRenderAudioConcatArgs,
  buildSmartRenderAudioConcatScript,
  buildSmartRenderAudioSegmentArgs,
  buildSmartRenderMuxArgs,
  splitAudioKeepRanges,
} from '../electron/main/export/smart-render-audio';

describe('smart render audio planning', () => {
  it('splits long keep ranges into bounded chunks while preserving total duration', () => {
    const chunks = splitAudioKeepRanges(
      [
        { startSec: 0, endSec: 3700 },
        { startSec: 5000, endSec: 5100 },
      ],
      1800,
    );

    expect(chunks).toEqual([
      { startSec: 0, endSec: 1800 },
      { startSec: 1800, endSec: 3600 },
      { startSec: 3600, endSec: 3700 },
      { startSec: 5000, endSec: 5100 },
    ]);
    expect(
      chunks.reduce((sum, range) => sum + range.endSec - range.startSec, 0),
    ).toBe(3800);
  });

  it('encodes each audio chunk with the fast AAC coder into MPEG-TS', () => {
    const args = buildSmartRenderAudioSegmentArgs(
      'input.mp4',
      'segment.ts',
      { startSec: 1000.456, endSec: 1010 },
    );

    expect(args).toContain('-aac_coder');
    expect(args).toContain('fast');
    expect(args).toContain('-b:a');
    expect(args).toContain('192k');
    expect(args).toContain('-muxdelay');
    expect(args).toContain('mpegts');
    expect(args).toContain('9.544');
    expect(args.at(-1)).toBe('segment.ts');
  });

  it('pins concat timing to the intended duration of every encoded chunk', () => {
    const script = buildSmartRenderAudioConcatScript([
      { path: 'C:\\temp\\001.ts', durationSec: 5.123 },
      { path: 'C:\\temp\\002.ts', durationSec: 9.544 },
    ]);

    expect(script).toContain("file 'C:/temp/001.ts'");
    expect(script).toContain('outpoint 5.123');
    expect(script).toContain('duration 5.123');
    expect(script).toContain("file 'C:/temp/002.ts'");
    expect(script).toContain('outpoint 9.544');
    expect(script).toContain('duration 9.544');
  });

  it('concatenates encoded AAC chunks without re-encoding them', () => {
    const args = buildSmartRenderAudioConcatArgs(
      'audio.ffconcat',
      'audio.m4a',
    );

    expect(args).toContain('-c:a');
    expect(args).toContain('copy');
    expect(args).toContain('aac_adtstoasc');
    expect(args).toContain('pipe:1');
  });

  it('muxes smart-rendered video and audio with stream copy', () => {
    const args = buildSmartRenderMuxArgs(
      'video.mp4',
      'audio.m4a',
      'output.mp4',
    );

    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).toContain('0:v:0');
    expect(args).toContain('1:a:0');
  });
});
