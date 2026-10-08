import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TimeRange } from './types';

export const SMART_RENDER_AUDIO_CHUNK_SEC = 30 * 60;
export const SMART_RENDER_AUDIO_CONCURRENCY = 4;

export interface SmartRenderAudioSegment {
  path: string;
  durationSec: number;
}

function formatTimestamp(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function escapeConcatPath(inputPath: string): string {
  const normalized = path.resolve(inputPath).replace(/\\/g, '/');
  return normalized.replace(/'/g, "'\\''");
}

export function splitAudioKeepRanges(
  keepRanges: TimeRange[],
  chunkSec = SMART_RENDER_AUDIO_CHUNK_SEC,
): TimeRange[] {
  if (!Number.isFinite(chunkSec) || chunkSec <= 0) {
    throw new Error('INVALID_AUDIO_CHUNK_DURATION');
  }

  const chunks: TimeRange[] = [];

  for (const range of keepRanges) {
    let cursor = range.startSec;
    while (cursor < range.endSec - 1e-6) {
      const endSec = Math.min(range.endSec, cursor + chunkSec);
      chunks.push({ startSec: cursor, endSec });
      cursor = endSec;
    }
  }

  return chunks;
}

export function buildSmartRenderAudioSegmentArgs(
  inputPath: string,
  outputPath: string,
  range: TimeRange,
): string[] {
  const durationSec = Math.max(0, range.endSec - range.startSec);

  return [
    '-y',
    '-hide_banner',
    '-ss',
    formatTimestamp(range.startSec),
    '-i',
    inputPath,
    '-t',
    formatTimestamp(durationSec),
    '-vn',
    '-c:a',
    'aac',
    '-aac_coder',
    'fast',
    '-b:a',
    '192k',
    '-muxdelay',
    '0',
    '-f',
    'mpegts',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ];
}

export function buildSmartRenderAudioConcatScript(
  segments: SmartRenderAudioSegment[],
): string {
  if (segments.length === 0) throw new Error('NO_AUDIO_SEGMENTS');

  const lines = ['ffconcat version 1.0'];

  for (const segment of segments) {
    const duration = formatTimestamp(segment.durationSec);
    lines.push(`file '${escapeConcatPath(segment.path)}'`);
    lines.push('inpoint 0');
    lines.push(`outpoint ${duration}`);
    lines.push(`duration ${duration}`);
  }

  return `${lines.join('\n')}\n`;
}

export async function writeSmartRenderAudioConcatFile(
  concatPath: string,
  segments: SmartRenderAudioSegment[],
): Promise<void> {
  await writeFile(
    concatPath,
    buildSmartRenderAudioConcatScript(segments),
    'utf8',
  );
}

export function buildSmartRenderAudioConcatArgs(
  concatPath: string,
  outputPath: string,
): string[] {
  return [
    '-y',
    '-hide_banner',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-map',
    '0:a:0',
    '-vn',
    '-c:a',
    'copy',
    '-bsf:a',
    'aac_adtstoasc',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ];
}

export function buildSmartRenderMuxArgs(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): string[] {
  return [
    '-y',
    '-hide_banner',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c',
    'copy',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ];
}
