// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildTrimConcatFilter } from '../electron/main/export/filter-builder';

describe('buildTrimConcatFilter', () => {
  const keepRanges = [
    { startSec: 0, endSec: 12.4 },
    { startSec: 18.2, endSec: 31.1 },
  ];

  it('builds synchronized video/audio trim chains', () => {
    const graph = buildTrimConcatFilter(keepRanges, true);

    expect(graph.filterComplex).toContain(
      '[0:v:0]trim=start=0:end=12.4,setpts=PTS-STARTPTS[v0]',
    );
    expect(graph.filterComplex).toContain(
      '[0:a:0]atrim=start=18.2:end=31.1,asetpts=PTS-STARTPTS[a1]',
    );
    expect(graph.filterComplex).toContain(
      '[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]',
    );
    expect(graph.videoOutputLabel).toBe('[outv]');
    expect(graph.audioOutputLabel).toBe('[outa]');
  });

  it('builds a video-only concat chain', () => {
    const graph = buildTrimConcatFilter(keepRanges, false);

    expect(graph.filterComplex).not.toContain('atrim');
    expect(graph.filterComplex).toContain(
      '[v0][v1]concat=n=2:v=1:a=0[outv]',
    );
    expect(graph.audioOutputLabel).toBeUndefined();
  });

  it('rejects an export that would keep no media', () => {
    expect(() => buildTrimConcatFilter([], true)).toThrow('NO_KEEP_RANGE');
  });
});
