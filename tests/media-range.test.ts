// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { parseByteRange } from '../electron/main/media/byte-range';

describe('parseByteRange', () => {
  it('parses open-ended byte ranges', () => {
    expect(parseByteRange('bytes=100-', 1000)).toEqual({
      start: 100,
      end: 999,
    });
  });

  it('parses bounded byte ranges', () => {
    expect(parseByteRange('bytes=100-199', 1000)).toEqual({
      start: 100,
      end: 199,
    });
  });

  it('parses suffix byte ranges', () => {
    expect(parseByteRange('bytes=-100', 1000)).toEqual({
      start: 900,
      end: 999,
    });
  });

  it('clamps the requested end to the file size', () => {
    expect(parseByteRange('bytes=950-1200', 1000)).toEqual({
      start: 950,
      end: 999,
    });
  });

  it('rejects invalid or multi-range requests', () => {
    expect(parseByteRange('bytes=100-99', 1000)).toBeNull();
    expect(parseByteRange('bytes=100-200,300-400', 1000)).toBeNull();
    expect(parseByteRange('bytes=1000-', 1000)).toBeNull();
  });
});
