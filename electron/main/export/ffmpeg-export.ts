import type { FilterGraph } from './filter-builder';
import type { TimeRange } from './types';

function formatTimestamp(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function buildExportArgs(
  inputPath: string,
  tempOutputPath: string,
  graph: FilterGraph,
  hasAudio: boolean,
): string[] {
  const args = [
    '-y',
    '-hide_banner',
    '-i',
    inputPath,
    '-filter_complex',
    graph.filterComplex,
    '-map',
    graph.videoOutputLabel,
  ];

  if (hasAudio && graph.audioOutputLabel) {
    args.push('-map', graph.audioOutputLabel);
  }

  args.push(
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
  );

  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }

  args.push(
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    tempOutputPath,
  );

  return args;
}

export function parseFfmpegOutTimeSec(line: string): number | null {
  if (line.startsWith('out_time_us=')) {
    const value = Number(line.slice('out_time_us='.length));
    return Number.isFinite(value) ? value / 1_000_000 : null;
  }

  if (line.startsWith('out_time_ms=')) {
    const value = Number(line.slice('out_time_ms='.length));
    return Number.isFinite(value) ? value / 1_000_000 : null;
  }

  if (line.startsWith('out_time=')) {
    const value = line.slice('out_time='.length);
    const match = value.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (!match) return null;

    return (
      Number(match[1]) * 3600 +
      Number(match[2]) * 60 +
      Number(match[3])
    );
  }

  return null;
}

export function getRangesDuration(ranges: TimeRange[]): number {
  return ranges.reduce(
    (sum, range) => sum + Math.max(0, range.endSec - range.startSec),
    0,
  );
}

export function makeFilterTimestamp(value: number): string {
  return formatTimestamp(value);
}
