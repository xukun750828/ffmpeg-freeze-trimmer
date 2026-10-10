import path from 'node:path';
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
    '-fps_mode',
    'passthrough',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    tempOutputPath,
  );

  return args;
}

function escapeConcatPath(inputPath: string): string {
  const normalized = path.resolve(inputPath).replace(/\\/g, '/');
  return normalized.replace(/'/g, "'\\''");
}

export function buildPreciseReencodeConcatScript(
  inputPath: string,
  keepRanges: readonly TimeRange[],
): string {
  const escapedPath = escapeConcatPath(inputPath);
  const lines = ['ffconcat version 1.0'];

  for (const range of keepRanges) {
    const durationSec = Math.max(0, range.endSec - range.startSec);
    if (durationSec <= 0) continue;

    lines.push(`file '${escapedPath}'`);
    if (range.startSec > 0) {
      lines.push(`inpoint ${formatTimestamp(range.startSec)}`);
    }
    lines.push(`outpoint ${formatTimestamp(range.endSec)}`);
    lines.push(`duration ${formatTimestamp(durationSec)}`);
  }

  return `${lines.join('\n')}\n`;
}

export function buildPreciseReencodeArgs(
  concatPath: string,
  outputPath: string,
  hasAudio: boolean,
): string[] {
  const args = [
    '-y',
    '-hide_banner',
    '-f',
    'concat',
    '-safe',
    '0',
    '-segment_time_metadata',
    '1',
    '-i',
    concatPath,
    '-map',
    '0:v:0',
  ];

  if (hasAudio) {
    args.push('-map', '0:a:0?');
  }

  args.push(
    '-vf',
    'select=concatdec_select,setpts=PTS-STARTPTS',
  );

  if (hasAudio) {
    args.push(
      '-af',
      'aselect=concatdec_select,asetpts=PTS-STARTPTS',
    );
  }

  args.push(
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-fps_mode',
    'passthrough',
  );

  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }

  args.push(
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
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
