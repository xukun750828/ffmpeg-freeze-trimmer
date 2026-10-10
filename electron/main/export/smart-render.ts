import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveFfprobePath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import type { SmartCopyBoundaryProbe } from './smart-copy';
import type { TimeRange } from './types';

const FRAME_PROBE_WINDOW_SEC = 20;
const FRAME_PROBE_MAX_WINDOW_SEC = 120;
export const SMART_RENDER_PROBE_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

function getFrameToleranceSec(nominalFps: number): number {
  const frameDurationSec = 1 / nominalFps;
  return Math.max(0.002, Math.min(0.05, frameDurationSec * 0.55));
}

function findKnownKeyframeStart(
  startSec: number,
  probes: readonly SmartCopyBoundaryProbe[],
  nominalFps: number,
): number | null {
  const toleranceSec = getFrameToleranceSec(nominalFps);
  const probe = probes.find(
    (item) =>
      item.keyframeSec !== null &&
      Math.abs(item.boundarySec - startSec) <= toleranceSec,
  );
  return probe?.keyframeSec ?? null;
}

export interface SmartRenderCodecParams {
  videoBitrate: number;
  videoTimescale: number;
  hasBFrames: number;
  nominalFps: number;
  pixelFormat?: string;
}

export interface SmartRenderFrame {
  keyframe: boolean;
  timeSec: number;
}

export type SmartRenderRangePlan =
  | {
      mode: 'copy';
      range: TimeRange;
    }
  | {
      mode: 'hybrid';
      range: TimeRange;
      encodeEndSec: number;
      encodeFrameCount: number;
      copyStartSec: number;
    }
  | {
      mode: 'encode';
      range: TimeRange;
      encodeFrameCount: number;
    };

export type SmartRenderConcatEntry =
  | {
      kind: 'source';
      path: string;
      startSec: number;
      endSec: number;
      durationSec: number;
    }
  | {
      kind: 'file';
      path: string;
      durationSec: number;
    };

function formatTimestamp(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function getFrameAlignedCopyDurationSec(
  startSec: number,
  endSec: number,
  nominalFps: number,
): number {
  const rawDurationSec = Math.max(0, endSec - startSec);
  if (!Number.isFinite(nominalFps) || nominalFps <= 0) {
    return rawDurationSec;
  }

  const frameCount = Math.max(
    1,
    Math.ceil(rawDurationSec * nominalFps - 1e-6),
  );
  return frameCount / nominalFps;
}

function parseFraction(value: string | undefined): number | null {
  if (!value) return null;
  const [numeratorRaw, denominatorRaw] = value.split('/');
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }

  return numerator / denominator;
}

export function parseSmartRenderCodecParams(
  stdout: string,
): SmartRenderCodecParams | null {
  try {
    const payload = JSON.parse(stdout) as {
      streams?: Array<{
        codec_name?: string;
        bit_rate?: string;
        time_base?: string;
        has_b_frames?: number;
        r_frame_rate?: string;
        pix_fmt?: string;
      }>;
    };

    const stream = payload.streams?.[0];
    if (!stream || stream.codec_name !== 'h264') return null;

    const videoBitrate = Number(stream.bit_rate);
    const nominalFps = parseFraction(stream.r_frame_rate);
    const timeBase = stream.time_base?.split('/') ?? [];
    const timeBaseNumerator = Number(timeBase[0]);
    const timeBaseDenominator = Number(timeBase[1]);

    if (
      !Number.isFinite(videoBitrate) ||
      videoBitrate <= 0 ||
      nominalFps === null ||
      nominalFps <= 0 ||
      timeBaseNumerator !== 1 ||
      !Number.isFinite(timeBaseDenominator) ||
      timeBaseDenominator <= 0
    ) {
      return null;
    }

    return {
      videoBitrate,
      videoTimescale: timeBaseDenominator,
      hasBFrames: Math.max(0, Number(stream.has_b_frames) || 0),
      nominalFps,
      pixelFormat: stream.pix_fmt,
    };
  } catch {
    return null;
  }
}

export function parseSmartRenderFrames(stdout: string): SmartRenderFrame[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [keyframeRaw, timeRaw] = line.split(',');
      const timeSec = Number(timeRaw);
      if (!Number.isFinite(timeSec)) return [];

      return [
        {
          keyframe: keyframeRaw === '1',
          timeSec,
        },
      ];
    })
    .sort((left, right) => left.timeSec - right.timeSec);
}

export function planSmartRenderRange(
  range: TimeRange,
  frames: SmartRenderFrame[],
  nominalFps: number,
): SmartRenderRangePlan {
  const toleranceSec = getFrameToleranceSec(nominalFps);
  const timestampEpsilonSec = 1e-6;
  const countFramesUntil = (endSec: number) =>
    frames.filter(
      (frame) =>
        frame.timeSec >= range.startSec - timestampEpsilonSec &&
        frame.timeSec < endSec - timestampEpsilonSec,
    ).length;
  const encodeWholeRange = (): SmartRenderRangePlan => ({
    mode: 'encode',
    range,
    encodeFrameCount: countFramesUntil(range.endSec),
  });

  if (range.startSec <= toleranceSec) {
    return { mode: 'copy', range };
  }

  const exactKeyframe = frames.find(
    (frame) =>
      frame.keyframe &&
      Math.abs(frame.timeSec - range.startSec) <= toleranceSec,
  );

  if (exactKeyframe) {
    return {
      mode: 'copy',
      range: {
        startSec: exactKeyframe.timeSec,
        endSec: range.endSec,
      },
    };
  }

  const nextKeyframeIndex = frames.findIndex(
    (frame) =>
      frame.keyframe && frame.timeSec > range.startSec + toleranceSec,
  );

  if (nextKeyframeIndex < 0) {
    return encodeWholeRange();
  }

  const nextKeyframe = frames[nextKeyframeIndex];
  if (nextKeyframe.timeSec >= range.endSec - toleranceSec) {
    return encodeWholeRange();
  }

  const encodeEndSec = nextKeyframe.timeSec;

  if (encodeEndSec <= range.startSec) {
    return encodeWholeRange();
  }

  return {
    mode: 'hybrid',
    range,
    encodeEndSec,
    encodeFrameCount: countFramesUntil(nextKeyframe.timeSec),
    copyStartSec: nextKeyframe.timeSec,
  };
}

function escapeConcatPath(inputPath: string): string {
  const normalized = path.resolve(inputPath).replace(/\\/g, '/');
  return normalized.replace(/'/g, "'\\''");
}

export function buildSmartRenderConcatScript(
  entries: SmartRenderConcatEntry[],
): string {
  const lines = ['ffconcat version 1.0'];

  for (const entry of entries) {
    lines.push(`file '${escapeConcatPath(entry.path)}'`);

    if (entry.kind === 'source') {
      if (entry.startSec > 0) {
        lines.push(`inpoint ${formatTimestamp(entry.startSec)}`);
      }
      lines.push(`outpoint ${formatTimestamp(entry.endSec)}`);
    }

  }

  return `${lines.join('\n')}\n`;
}

export function buildSmartRenderEncodeArgs(
  inputPath: string,
  outputPath: string,
  startSec: number,
  endSec: number,
  params: SmartRenderCodecParams,
  hasAudio: boolean,
  frameCount?: number,
): string[] {
  const durationSec = Math.max(0, endSec - startSec);
  const args = [
    '-y',
    '-hide_banner',
    '-ss',
    formatTimestamp(startSec),
    '-i',
    inputPath,
    '-ss',
    '0',
    '-t',
    formatTimestamp(durationSec),
    '-map',
    '0:v:0',
    '-vf',
    'setpts=PTS-STARTPTS',
  ];

  if (hasAudio) {
    args.push('-map', '0:a:0?');
  }

  args.push(
    '-c:v',
    'libx264',
    '-b:v',
    Math.round(params.videoBitrate).toString(),
    '-bf',
    Math.round(params.hasBFrames).toString(),
  );

  if (params.pixelFormat) {
    args.push('-pix_fmt', params.pixelFormat);
  }

  if (frameCount !== undefined && Number.isFinite(frameCount) && frameCount > 0) {
    args.push('-frames:v', Math.floor(frameCount).toString());
  }

  if (hasAudio) {
    args.push('-c:a', 'copy');
  }

  args.push(
    '-video_track_timescale',
    Math.round(params.videoTimescale).toString(),
    '-fps_mode',
    'passthrough',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  );

  return args;
}

export function buildSmartRenderConcatArgs(
  concatPath: string,
  outputPath: string,
  params: SmartRenderCodecParams,
  hasAudio: boolean,
): string[] {
  const args = [
    '-y',
    '-hide_banner',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-map',
    '0:v:0',
  ];

  if (hasAudio) {
    args.push('-map', '0:a:0?');
  }

  args.push(
    '-c',
    'copy',
    '-video_track_timescale',
    Math.round(params.videoTimescale).toString(),
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  );

  return args;
}

export function buildSmartRenderConcatMuxArgs(
  concatPath: string,
  audioPath: string,
  outputPath: string,
  params: SmartRenderCodecParams,
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
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c',
    'copy',
    '-video_track_timescale',
    Math.round(params.videoTimescale).toString(),
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ];
}

export async function probeSmartRenderCodecParams(
  inputPath: string,
  signal: AbortSignal,
): Promise<SmartRenderCodecParams | null> {
  const result = await runProcess(
    resolveFfprobePath(),
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,bit_rate,time_base,has_b_frames,r_frame_rate,pix_fmt',
      '-of',
      'json',
      inputPath,
    ],
    { signal },
  );

  if (result.exitCode !== 0) return null;
  return parseSmartRenderCodecParams(result.stdout);
}

async function probeFrames(
  inputPath: string,
  startSec: number,
  endSec: number,
  signal: AbortSignal,
): Promise<SmartRenderFrame[]> {
  const probeStartSec = Math.max(0, startSec - 10);
  const result = await runProcess(
    resolveFfprobePath(),
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-read_intervals',
      `${formatTimestamp(probeStartSec)}%${formatTimestamp(endSec)}`,
      '-show_entries',
      'frame=key_frame,best_effort_timestamp_time',
      '-of',
      'csv=p=0',
      inputPath,
    ],
    { signal },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'SMART_RENDER_FRAME_PROBE_FAILED');
  }

  return parseSmartRenderFrames(result.stdout);
}

export async function planSmartRenderRanges(
  inputPath: string,
  keepRanges: TimeRange[],
  params: SmartRenderCodecParams,
  signal: AbortSignal,
  knownBoundaryProbes: readonly SmartCopyBoundaryProbe[] = [],
): Promise<SmartRenderRangePlan[]> {
  return mapWithConcurrency(
    keepRanges,
    SMART_RENDER_PROBE_CONCURRENCY,
    async (range) => {
      if (range.startSec <= 0) {
        return { mode: 'copy', range } satisfies SmartRenderRangePlan;
      }

      const knownKeyframeSec = findKnownKeyframeStart(
        range.startSec,
        knownBoundaryProbes,
        params.nominalFps,
      );
      if (knownKeyframeSec !== null) {
        return {
          mode: 'copy',
          range: {
            startSec: knownKeyframeSec,
            endSec: range.endSec,
          },
        } satisfies SmartRenderRangePlan;
      }

      const firstEndSec = Math.min(
        range.endSec,
        range.startSec + FRAME_PROBE_WINDOW_SEC,
      );
      let frames = await probeFrames(
        inputPath,
        range.startSec,
        firstEndSec,
        signal,
      );
      let plan = planSmartRenderRange(range, frames, params.nominalFps);

      if (
        plan.mode === 'encode' &&
        range.endSec > firstEndSec &&
        firstEndSec < range.startSec + FRAME_PROBE_MAX_WINDOW_SEC
      ) {
        const expandedEndSec = Math.min(
          range.endSec,
          range.startSec + FRAME_PROBE_MAX_WINDOW_SEC,
        );
        frames = await probeFrames(
          inputPath,
          range.startSec,
          expandedEndSec,
          signal,
        );
        plan = planSmartRenderRange(range, frames, params.nominalFps);
      }

      return plan;
    },
  );
}

export async function writeSmartRenderConcatFile(
  concatPath: string,
  entries: SmartRenderConcatEntry[],
): Promise<void> {
  await mkdir(path.dirname(concatPath), { recursive: true });
  await writeFile(
    concatPath,
    buildSmartRenderConcatScript(entries),
    'utf8',
  );
}
