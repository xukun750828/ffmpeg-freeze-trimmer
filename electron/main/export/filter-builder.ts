import type { TimeRange } from './types';

function formatTimestamp(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export interface FilterGraph {
  filterComplex: string;
  videoOutputLabel: string;
  audioOutputLabel?: string;
}

export function buildTrimConcatFilter(
  keepRanges: TimeRange[],
  hasAudio: boolean,
): FilterGraph {
  if (keepRanges.length === 0) {
    throw new Error('NO_KEEP_RANGE');
  }

  const filters: string[] = [];
  const concatInputs: string[] = [];

  keepRanges.forEach((range, index) => {
    const start = formatTimestamp(range.startSec);
    const end = formatTimestamp(range.endSec);

    filters.push(
      `[0:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`,
    );
    concatInputs.push(`[v${index}]`);

    if (hasAudio) {
      filters.push(
        `[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`,
      );
      concatInputs.push(`[a${index}]`);
    }
  });

  if (hasAudio) {
    filters.push(
      `${concatInputs.join('')}concat=n=${keepRanges.length}:v=1:a=1[outv][outa]`,
    );

    return {
      filterComplex: filters.join(';'),
      videoOutputLabel: '[outv]',
      audioOutputLabel: '[outa]',
    };
  }

  filters.push(
    `${concatInputs.join('')}concat=n=${keepRanges.length}:v=1:a=0[outv]`,
  );

  return {
    filterComplex: filters.join(';'),
    videoOutputLabel: '[outv]',
  };
}
