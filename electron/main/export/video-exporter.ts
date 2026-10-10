import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveFfmpegPath, resolveFfprobePath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import { buildTrimConcatFilter } from './filter-builder';
import { buildExportArgs, parseFfmpegOutTimeSec } from './ffmpeg-export';
import { createExportPlan } from './range-planner';
import {
  analyzeSmartCopyEligibility,
  writeSmartCopyConcatFile,
  type SmartCopyBoundaryProbe,
} from './smart-copy';
import {
  buildSmartRenderAudioConcatArgs,
  buildSmartRenderAudioCopySegmentArgs,
  buildSmartRenderAudioSegmentArgs,
  SMART_RENDER_AUDIO_CONCURRENCY,
  SMART_RENDER_AUDIO_COPY_CONCURRENCY,
  SMART_RENDER_AUDIO_COPY_MAX_DRIFT_SEC,
  splitAudioKeepRanges,
  writeSmartRenderAudioConcatFile,
  type SmartRenderAudioSegment,
} from './smart-render-audio';
import {
  buildSmartRenderConcatArgs,
  buildSmartRenderConcatMuxArgs,
  buildSmartRenderEncodeArgs,
  getFrameAlignedCopyDurationSec,
  planSmartRenderRanges,
  probeSmartRenderCodecParams,
  writeSmartRenderConcatFile,
  type SmartRenderConcatEntry,
} from './smart-render';
import type {
  ExportFinishedEvent,
  ExportProgressEvent,
  ExportRequest,
  ExportStrategy,
} from './types';

interface ExportJob {
  id: string;
  abortController: AbortController;
}

interface SmartCopyAttempt {
  succeeded: boolean;
  boundaryProbes: SmartCopyBoundaryProbe[];
}

const SMART_RENDER_VIDEO_ENCODE_CONCURRENCY = 2;

type ProgressListener = (event: ExportProgressEvent) => void;
type FinishedListener = (event: ExportFinishedEvent) => void;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => path.resolve(value).toLowerCase();
  return normalize(left) === normalize(right);
}

function createTempOutputPath(outputPath: string, jobId: string): string {
  const directory = path.dirname(outputPath);
  const extension = path.extname(outputPath) || '.mp4';
  const basename = path.basename(outputPath, extension);
  return path.join(directory, `.${basename}.${jobId}.tmp${extension}`);
}

function createConcatPlanPath(tempOutputPath: string): string {
  return `${tempOutputPath}.ffconcat`;
}

function createSmartRenderWorkspace(tempOutputPath: string): string {
  return `${tempOutputPath}.smart-render`;
}

function buildSmartCopyArgs(
  concatPath: string,
  tempOutputPath: string,
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
    '-avoid_negative_ts',
    'make_zero',
    '-progress',
    'pipe:1',
    '-nostats',
    tempOutputPath,
  );

  return args;
}

function hasUnsafeTimestampWarnings(stderr: string): boolean {
  if (/dts .* out of order|packet corrupt/i.test(stderr)) return true;

  const warningRe =
    /non-monotonic dts[^;]*; previous:\s*(-?\d+), current:\s*(-?\d+); changing to\s*(-?\d+)/gi;
  let matched = false;
  let match: RegExpExecArray | null;

  while ((match = warningRe.exec(stderr)) !== null) {
    matched = true;
    const previous = Number(match[1]);
    const current = Number(match[2]);
    const changed = Number(match[3]);
    if (current !== previous || changed !== previous + 1) return true;
  }

  return /non-monotonic dts/i.test(stderr) && !matched;
}

async function validateOutputFile(filePath: string): Promise<void> {
  const outputStat = await stat(filePath);
  if (!outputStat.isFile() || outputStat.size <= 0) {
    throw new Error('EXPORT_EMPTY_OUTPUT');
  }
}

async function probeOutputDurationSec(
  filePath: string,
  signal: AbortSignal,
): Promise<number | null> {
  const result = await runProcess(
    resolveFfprobePath(),
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { signal },
  );

  if (result.exitCode !== 0) return null;
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) ? value : null;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    }),
  );
}

export class VideoExporter {
  private activeJob: ExportJob | null = null;

  start(
    request: ExportRequest,
    onProgress: ProgressListener,
    onFinished: FinishedListener,
  ): { jobId: string } {
    if (this.activeJob) {
      throw new Error('EXPORT_ALREADY_RUNNING');
    }

    if (samePath(request.inputPath, request.outputPath)) {
      throw new Error('OUTPUT_CANNOT_OVERWRITE_SOURCE');
    }

    if (path.extname(request.outputPath).toLowerCase() !== '.mp4') {
      throw new Error('OUTPUT_MUST_BE_MP4');
    }

    const plan = createExportPlan(request.removeRanges, request.durationSec);
    if (plan.keepRanges.length === 0 || plan.outputDurationSec <= 0) {
      throw new Error('NO_KEEP_RANGE');
    }

    const jobId = randomUUID();
    const abortController = new AbortController();
    const job: ExportJob = { id: jobId, abortController };
    this.activeJob = job;

    const tempOutputPath = createTempOutputPath(request.outputPath, jobId);

    void this.execute(
      job,
      request,
      tempOutputPath,
      plan.outputDurationSec,
      plan.keepRanges,
      plan.removeRanges,
      onProgress,
      onFinished,
    );

    return { jobId };
  }

  cancel(jobId: string): void {
    if (!this.activeJob || this.activeJob.id !== jobId) {
      return;
    }

    this.activeJob.abortController.abort();
  }

  private emitProgress(
    job: ExportJob,
    outTimeSec: number,
    expectedDurationSec: number,
    strategy: ExportStrategy,
    onProgress: ProgressListener,
    progressWindow: [number, number] = [0, 1],
  ): void {
    const rawProgress = Math.min(
      1,
      Math.max(0, outTimeSec / expectedDurationSec),
    );
    const [start, end] = progressWindow;

    onProgress({
      jobId: job.id,
      outTimeSec,
      progress: start + (end - start) * rawProgress,
      strategy,
    });
  }

  private async runFfmpeg(
    job: ExportJob,
    args: string[],
    expectedDurationSec: number,
    strategy: ExportStrategy,
    onProgress: ProgressListener,
    progressWindow: [number, number] = [0, 1],
  ) {
    return runProcess(resolveFfmpegPath(), args, {
      signal: job.abortController.signal,
      onStdoutLine: (line) => {
        const outTimeSec = parseFfmpegOutTimeSec(line);
        if (outTimeSec === null) return;

        this.emitProgress(
          job,
          outTimeSec,
          expectedDurationSec,
          strategy,
          onProgress,
          progressWindow,
        );
      },
    });
  }

  private async trySmartCopy(
    job: ExportJob,
    request: ExportRequest,
    tempOutputPath: string,
    expectedDurationSec: number,
    keepRanges: ReturnType<typeof createExportPlan>['keepRanges'],
    removeRanges: ReturnType<typeof createExportPlan>['removeRanges'],
    onProgress: ProgressListener,
  ): Promise<SmartCopyAttempt> {
    if (request.videoCodec.toLowerCase() !== 'h264') {
      return { succeeded: false, boundaryProbes: [] };
    }

    let boundaryProbes: SmartCopyBoundaryProbe[] = [];
    let eligible = false;

    try {
      const analysis = await analyzeSmartCopyEligibility(
        request.inputPath,
        removeRanges,
        request.durationSec,
        request.fps,
        job.abortController.signal,
      );
      eligible = analysis.eligible;
      boundaryProbes = analysis.probes;
    } catch (error) {
      if (
        job.abortController.signal.aborted ||
        (error instanceof Error && error.message === 'PROCESS_ABORTED')
      ) {
        throw error;
      }
      return { succeeded: false, boundaryProbes };
    }

    if (!eligible) return { succeeded: false, boundaryProbes };

    const concatPath = createConcatPlanPath(tempOutputPath);

    try {
      await writeSmartCopyConcatFile(
        concatPath,
        request.inputPath,
        keepRanges,
      );

      const result = await this.runFfmpeg(
        job,
        buildSmartCopyArgs(
          concatPath,
          tempOutputPath,
          request.hasAudio,
        ),
        expectedDurationSec,
        'smart-copy',
        onProgress,
      );

      if (
        result.exitCode !== 0 ||
        hasUnsafeTimestampWarnings(result.stderr)
      ) {
        await rm(tempOutputPath, { force: true }).catch(() => undefined);
        return { succeeded: false, boundaryProbes };
      }

      await validateOutputFile(tempOutputPath);
      return { succeeded: true, boundaryProbes };
    } finally {
      await rm(concatPath, { force: true }).catch(() => undefined);
    }
  }

  private async trySmartRenderAudioCopy(
    job: ExportJob,
    request: ExportRequest,
    workspace: string,
    audioPath: string,
    expectedDurationSec: number,
    keepRanges: ReturnType<typeof createExportPlan>['keepRanges'],
    onProgress: ProgressListener,
  ): Promise<boolean> {
    if (request.audioCodec?.toLowerCase() !== 'aac') {
      return false;
    }

    const segmentPaths: string[] = [];
    const concatPath = path.join(workspace, 'audio-copy.ffconcat');

    const cleanupFastAudio = async (): Promise<void> => {
      await Promise.all([
        rm(audioPath, { force: true }).catch(() => undefined),
        rm(concatPath, { force: true }).catch(() => undefined),
        ...segmentPaths.map((segmentPath) =>
          rm(segmentPath, { force: true }).catch(() => undefined),
        ),
      ]);
    };

    try {
      const segments = new Array<SmartRenderAudioSegment>(keepRanges.length);
      const progressSec = new Array<number>(keepRanges.length).fill(0);

      await runWithConcurrency(
        keepRanges,
        SMART_RENDER_AUDIO_COPY_CONCURRENCY,
        async (range, index) => {
          const segmentPath = path.join(
            workspace,
            `audio-copy-${String(index).padStart(4, '0')}.ts`,
          );
          segmentPaths.push(segmentPath);
          const durationSec = range.endSec - range.startSec;
          const result = await runProcess(
            resolveFfmpegPath(),
            buildSmartRenderAudioCopySegmentArgs(
              request.inputPath,
              segmentPath,
              range,
            ),
            {
              signal: job.abortController.signal,
              onStdoutLine: (line) => {
                const outTimeSec = parseFfmpegOutTimeSec(line);
                if (outTimeSec === null) return;
                progressSec[index] = Math.min(durationSec, outTimeSec);
                const completedSec = progressSec.reduce(
                  (sum, value) => sum + value,
                  0,
                );
                this.emitProgress(
                  job,
                  completedSec,
                  expectedDurationSec,
                  'smart-render',
                  onProgress,
                  [0, 0.05],
                );
              },
            },
          );

          if (
            result.exitCode !== 0 ||
            hasUnsafeTimestampWarnings(result.stderr)
          ) {
            throw new Error('SMART_RENDER_AUDIO_COPY_SEGMENT_FAILED');
          }

          await validateOutputFile(segmentPath);
          progressSec[index] = durationSec;
          segments[index] = { path: segmentPath, durationSec };
        },
      );

      await writeSmartRenderAudioConcatFile(concatPath, segments);
      const concatResult = await this.runFfmpeg(
        job,
        buildSmartRenderAudioConcatArgs(concatPath, audioPath),
        expectedDurationSec,
        'smart-render',
        onProgress,
        [0.05, 0.2],
      );
      if (
        concatResult.exitCode !== 0 ||
        hasUnsafeTimestampWarnings(concatResult.stderr)
      ) {
        await cleanupFastAudio();
        return false;
      }

      await validateOutputFile(audioPath);
      const actualDurationSec = await probeOutputDurationSec(
        audioPath,
        job.abortController.signal,
      );
      if (
        actualDurationSec === null ||
        Math.abs(actualDurationSec - expectedDurationSec) >
          SMART_RENDER_AUDIO_COPY_MAX_DRIFT_SEC
      ) {
        await cleanupFastAudio();
        return false;
      }

      return true;
    } catch (error) {
      if (
        job.abortController.signal.aborted ||
        (error instanceof Error && error.message === 'PROCESS_ABORTED')
      ) {
        throw error;
      }

      await cleanupFastAudio();
      return false;
    }
  }

  private async trySmartRender(
    job: ExportJob,
    request: ExportRequest,
    tempOutputPath: string,
    expectedDurationSec: number,
    keepRanges: ReturnType<typeof createExportPlan>['keepRanges'],
    onProgress: ProgressListener,
    boundaryProbes: readonly SmartCopyBoundaryProbe[] = [],
  ): Promise<boolean> {
    if (request.videoCodec.toLowerCase() !== 'h264') {
      return false;
    }

    const workspace = createSmartRenderWorkspace(tempOutputPath);
    const concatPath = path.join(workspace, 'smart-render.ffconcat');
    const audioPath = path.join(workspace, 'audio.m4a');

    try {
      await mkdir(workspace, { recursive: true });

      const params = await probeSmartRenderCodecParams(
        request.inputPath,
        job.abortController.signal,
      );
      if (!params) return false;
      if (params.hasBFrames > 0) return false;

      const plans = await planSmartRenderRanges(
        request.inputPath,
        keepRanges,
        params,
        job.abortController.signal,
        boundaryProbes,
      );
      const entryGroups = new Array<SmartRenderConcatEntry[]>(plans.length);
      await runWithConcurrency(
        plans,
        SMART_RENDER_VIDEO_ENCODE_CONCURRENCY,
        async (plan, index) => {
          if (plan.mode === 'copy') {
            entryGroups[index] = [
              {
                kind: 'source',
                path: request.inputPath,
                startSec: plan.range.startSec,
                endSec: plan.range.endSec,
                durationSec: getFrameAlignedCopyDurationSec(
                  plan.range.startSec,
                  plan.range.endSec,
                  params.nominalFps,
                ),
              },
            ];
            return;
          }

          const encodedPath = path.join(
            workspace,
            `${String(index).padStart(4, '0')}-encoded.mp4`,
          );
          const encodeEndSec =
            plan.mode === 'hybrid'
              ? plan.encodeEndSec
              : plan.range.endSec;
          const encodeFrameCount = plan.encodeFrameCount;
          if (encodeFrameCount <= 0) {
            throw new Error('SMART_RENDER_INVALID_FRAME_COUNT');
          }

          const encodeResult = await runProcess(
            resolveFfmpegPath(),
            buildSmartRenderEncodeArgs(
              request.inputPath,
              encodedPath,
              plan.range.startSec,
              encodeEndSec,
              params,
              false,
              encodeFrameCount,
            ),
            { signal: job.abortController.signal },
          );

          if (
            encodeResult.exitCode !== 0 ||
            hasUnsafeTimestampWarnings(encodeResult.stderr)
          ) {
            throw new Error('SMART_RENDER_VIDEO_SEGMENT_FAILED');
          }

          await validateOutputFile(encodedPath);
          const group: SmartRenderConcatEntry[] = [
            {
              kind: 'file',
              path: encodedPath,
              durationSec: encodeFrameCount / params.nominalFps,
            },
          ];

          if (plan.mode === 'hybrid') {
            group.push({
              kind: 'source',
              path: request.inputPath,
              startSec: plan.copyStartSec,
              endSec: plan.range.endSec,
              durationSec: getFrameAlignedCopyDurationSec(
                plan.copyStartSec,
                plan.range.endSec,
                params.nominalFps,
              ),
            });
          }

          entryGroups[index] = group;
        },
      );
      const entries = entryGroups.flat();
      await writeSmartRenderConcatFile(concatPath, entries);

      if (request.hasAudio) {
        const fastAudioSucceeded = await this.trySmartRenderAudioCopy(
          job,
          request,
          workspace,
          audioPath,
          expectedDurationSec,
          keepRanges,
          onProgress,
        );

        if (!fastAudioSucceeded) {
          const audioChunks = splitAudioKeepRanges(keepRanges);
          const audioSegments = new Array<SmartRenderAudioSegment>(
            audioChunks.length,
          );
          const audioProgressSec = new Array<number>(audioChunks.length).fill(0);

          await runWithConcurrency(
            audioChunks,
            SMART_RENDER_AUDIO_CONCURRENCY,
            async (range, index) => {
              const segmentPath = path.join(
                workspace,
                `audio-${String(index).padStart(4, '0')}.ts`,
              );
              const durationSec = range.endSec - range.startSec;
              const result = await runProcess(
                resolveFfmpegPath(),
                buildSmartRenderAudioSegmentArgs(
                  request.inputPath,
                  segmentPath,
                  range,
                ),
                {
                  signal: job.abortController.signal,
                  onStdoutLine: (line) => {
                    const outTimeSec = parseFfmpegOutTimeSec(line);
                    if (outTimeSec === null) return;
                    audioProgressSec[index] = Math.min(durationSec, outTimeSec);
                    const completedSec = audioProgressSec.reduce(
                      (sum, value) => sum + value,
                      0,
                    );
                    this.emitProgress(
                      job,
                      completedSec,
                      expectedDurationSec,
                      'smart-render',
                      onProgress,
                      [0.2, 0.82],
                    );
                  },
                },
              );

              if (
                result.exitCode !== 0 ||
                hasUnsafeTimestampWarnings(result.stderr)
              ) {
                throw new Error('SMART_RENDER_AUDIO_SEGMENT_FAILED');
              }

              await validateOutputFile(segmentPath);
              audioProgressSec[index] = durationSec;
              audioSegments[index] = { path: segmentPath, durationSec };
            },
          );

          const audioConcatPath = path.join(workspace, 'audio.ffconcat');
          await writeSmartRenderAudioConcatFile(
            audioConcatPath,
            audioSegments,
          );
          const audioResult = await this.runFfmpeg(
            job,
            buildSmartRenderAudioConcatArgs(audioConcatPath, audioPath),
            expectedDurationSec,
            'smart-render',
            onProgress,
            [0.82, 0.87],
          );
          if (
            audioResult.exitCode !== 0 ||
            hasUnsafeTimestampWarnings(audioResult.stderr)
          ) {
            return false;
          }
          await validateOutputFile(audioPath);
        }

        const muxResult = await this.runFfmpeg(
          job,
          buildSmartRenderConcatMuxArgs(
            concatPath,
            audioPath,
            tempOutputPath,
            params,
          ),
          expectedDurationSec,
          'smart-render',
          onProgress,
          fastAudioSucceeded ? [0.2, 0.99] : [0.87, 0.99],
        );
        if (
          muxResult.exitCode !== 0 ||
          hasUnsafeTimestampWarnings(muxResult.stderr)
        ) {
          return false;
        }
      } else {
        const videoResult = await this.runFfmpeg(
          job,
          buildSmartRenderConcatArgs(
            concatPath,
            tempOutputPath,
            params,
            false,
          ),
          expectedDurationSec,
          'smart-render',
          onProgress,
          [0, 0.99],
        );
        if (
          videoResult.exitCode !== 0 ||
          hasUnsafeTimestampWarnings(videoResult.stderr)
        ) {
          return false;
        }
      }
      await validateOutputFile(tempOutputPath);

      const actualDurationSec = await probeOutputDurationSec(
        tempOutputPath,
        job.abortController.signal,
      );
      if (actualDurationSec === null) {
        return false;
      }

      const allowedDriftSec = Math.max(0.5, keepRanges.length * 0.05);
      if (
        Math.abs(actualDurationSec - expectedDurationSec) >
        allowedDriftSec
      ) {
        await rm(tempOutputPath, { force: true }).catch(() => undefined);
        return false;
      }

      return true;
    } catch (error) {
      if (
        job.abortController.signal.aborted ||
        (error instanceof Error && error.message === 'PROCESS_ABORTED')
      ) {
        throw error;
      }

      await rm(tempOutputPath, { force: true }).catch(() => undefined);
      return false;
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  private async runPreciseReencode(
    job: ExportJob,
    request: ExportRequest,
    tempOutputPath: string,
    expectedDurationSec: number,
    keepRanges: ReturnType<typeof createExportPlan>['keepRanges'],
    onProgress: ProgressListener,
  ): Promise<void> {
    const graph = buildTrimConcatFilter(keepRanges, request.hasAudio);
    const args = buildExportArgs(
      request.inputPath,
      tempOutputPath,
      graph,
      request.hasAudio,
    );

    const result = await this.runFfmpeg(
      job,
      args,
      expectedDurationSec,
      'reencode',
      onProgress,
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'EXPORT_FAILED');
    }

    await validateOutputFile(tempOutputPath);
  }

  private async execute(
    job: ExportJob,
    request: ExportRequest,
    tempOutputPath: string,
    expectedDurationSec: number,
    keepRanges: ReturnType<typeof createExportPlan>['keepRanges'],
    removeRanges: ReturnType<typeof createExportPlan>['removeRanges'],
    onProgress: ProgressListener,
    onFinished: FinishedListener,
  ): Promise<void> {
    let strategy: ExportStrategy = 'reencode';

    try {
      const smartCopyAttempt = await this.trySmartCopy(
        job,
        request,
        tempOutputPath,
        expectedDurationSec,
        keepRanges,
        removeRanges,
        onProgress,
      );

      if (smartCopyAttempt.succeeded) {
        strategy = 'smart-copy';
      } else {
        await rm(tempOutputPath, { force: true }).catch(() => undefined);

        const smartRenderSucceeded = await this.trySmartRender(
          job,
          request,
          tempOutputPath,
          expectedDurationSec,
          keepRanges,
          onProgress,
          smartCopyAttempt.boundaryProbes,
        );

        if (smartRenderSucceeded) {
          strategy = 'smart-render';
        } else {
          await rm(tempOutputPath, { force: true }).catch(() => undefined);
          await this.runPreciseReencode(
            job,
            request,
            tempOutputPath,
            expectedDurationSec,
            keepRanges,
            onProgress,
          );
        }
      }

      if (await pathExists(request.outputPath)) {
        await rm(request.outputPath, { force: true });
      }

      await rename(tempOutputPath, request.outputPath);

      this.emitProgress(
        job,
        expectedDurationSec,
        expectedDurationSec,
        strategy,
        onProgress,
      );

      onFinished({
        jobId: job.id,
        status: 'completed',
        outputPath: request.outputPath,
        strategy,
      });
    } catch (error) {
      await rm(tempOutputPath, { force: true }).catch(() => undefined);
      await rm(createConcatPlanPath(tempOutputPath), { force: true }).catch(
        () => undefined,
      );
      await rm(createSmartRenderWorkspace(tempOutputPath), {
        recursive: true,
        force: true,
      }).catch(() => undefined);

      const cancelled =
        job.abortController.signal.aborted ||
        (error instanceof Error && error.message === 'PROCESS_ABORTED');

      onFinished({
        jobId: job.id,
        status: cancelled ? 'cancelled' : 'failed',
        strategy,
        error: cancelled
          ? undefined
          : error instanceof Error
            ? error.message
            : 'EXPORT_FAILED',
      });
    } finally {
      if (this.activeJob?.id === job.id) {
        this.activeJob = null;
      }
    }
  }
}
