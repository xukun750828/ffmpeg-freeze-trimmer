import { randomUUID } from 'node:crypto';
import { access, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveFfmpegPath } from '../ffmpeg-paths';
import { runProcess } from '../process/process-runner';
import { buildTrimConcatFilter } from './filter-builder';
import { buildExportArgs, parseFfmpegOutTimeSec } from './ffmpeg-export';
import { createExportPlan } from './range-planner';
import {
  canUseSmartCopy,
  writeSmartCopyConcatFile,
} from './smart-copy';
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

async function validateOutputFile(filePath: string): Promise<void> {
  const outputStat = await stat(filePath);
  if (!outputStat.isFile() || outputStat.size <= 0) {
    throw new Error('EXPORT_EMPTY_OUTPUT');
  }
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
  ): void {
    onProgress({
      jobId: job.id,
      outTimeSec,
      progress: Math.min(
        1,
        Math.max(0, outTimeSec / expectedDurationSec),
      ),
      strategy,
    });
  }

  private async runFfmpeg(
    job: ExportJob,
    args: string[],
    expectedDurationSec: number,
    strategy: ExportStrategy,
    onProgress: ProgressListener,
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
  ): Promise<boolean> {
    if (request.videoCodec.toLowerCase() !== 'h264') {
      return false;
    }

    let eligible = false;

    try {
      eligible = await canUseSmartCopy(
        request.inputPath,
        removeRanges,
        request.durationSec,
        request.fps,
        job.abortController.signal,
      );
    } catch (error) {
      if (
        job.abortController.signal.aborted ||
        (error instanceof Error && error.message === 'PROCESS_ABORTED')
      ) {
        throw error;
      }
      return false;
    }

    if (!eligible) return false;

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

      if (result.exitCode !== 0) {
        await rm(tempOutputPath, { force: true }).catch(() => undefined);
        return false;
      }

      await validateOutputFile(tempOutputPath);
      return true;
    } finally {
      await rm(concatPath, { force: true }).catch(() => undefined);
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
      const smartCopySucceeded = await this.trySmartCopy(
        job,
        request,
        tempOutputPath,
        expectedDurationSec,
        keepRanges,
        removeRanges,
        onProgress,
      );

      if (smartCopySucceeded) {
        strategy = 'smart-copy';
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
