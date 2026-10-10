// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildSmartCopyConcatScript,
  findMatchingKeyframe,
  getInternalCutBoundaries,
  getKeyframeToleranceSec,
  isTimeAtKeyframe,
  parseKeyframeTimes,
} from '../electron/main/export/smart-copy';

describe('smart copy planning', () => {
  it('collects only internal cut boundaries', () => {
    expect(
      getInternalCutBoundaries(
        [
          { startSec: 0, endSec: 5 },
          { startSec: 10, endSec: 20 },
          { startSec: 25, endSec: 30 },
        ],
        30,
      ),
    ).toEqual([5, 10, 20, 25]);
  });

  it('uses about half a frame as keyframe tolerance', () => {
    expect(getKeyframeToleranceSec(30)).toBeCloseTo(0.55 / 30);
    expect(getKeyframeToleranceSec(0)).toBe(0.02);
  });

  it('parses ffprobe keyframe timestamps', () => {
    expect(
      parseKeyframeTimes('991.766633\n996.800000\r\ninvalid\n'),
    ).toEqual([991.766633, 996.8]);
  });

  it('accepts a boundary only when a keyframe is close enough', () => {
    expect(isTimeAtKeyframe(996.8, [991.766633, 996.8], 0.02)).toBe(true);
    expect(isTimeAtKeyframe(996.75, [996.8], 0.02)).toBe(false);
  });

  it('returns the nearest matching keyframe for reuse by smart render', () => {
    expect(findMatchingKeyframe(996.8, [996.79, 996.8, 996.81], 0.02)).toBe(996.8);
    expect(findMatchingKeyframe(996.75, [996.8], 0.02)).toBeNull();
  });

  it('builds a direct concat plan without intermediate media files', () => {
    const script = buildSmartCopyConcatScript(
      'C:\\video\\input.mp4',
      [
        { startSec: 0, endSec: 5 },
        { startSec: 10, endSec: 20 },
      ],
    );

    expect(script).toContain('ffconcat version 1.0');
    expect(script).toContain("file 'C:/video/input.mp4'");
    expect(script).toContain('outpoint 5');
    expect(script).toContain('inpoint 10');
    expect(script).toContain('outpoint 20');
  });
});