import { randomUUID } from 'node:crypto';
import { access, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../process/process-runner';
import { buildTrimConcatFilter } from './filter-builder';
import { buildExportArgs, parseFfmpegOutTimeSec } from './ffmpeg-export';
import { createExportPlan } from './range-planner';
import type {
  ExportFinishedEvent,
  ExportProgressEvent,
  ExportRequest,
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

    const graph = buildTrimConcatFilter(plan.keepRanges, request.hasAudio);
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
      graph,
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

  private async execute(
    job: ExportJob,
    request: ExportRequest,
    tempOutputPath: string,
    expectedDurationSec: number,
    graph: ReturnType<typeof buildTrimConcatFilter>,
    onProgress: ProgressListener,
    onFinished: FinishedListener,
  ): Promise<void> {
    try {
      const executable = process.env.FFMPEG_PATH || 'ffmpeg';
      const args = buildExportArgs(
        request.inputPath,
        tempOutputPath,
        graph,
        request.hasAudio,
      );

      const result = await runProcess(executable, args, {
        signal: job.abortController.signal,
        onStdoutLine: (line) => {
          const outTimeSec = parseFfmpegOutTimeSec(line);
          if (outTimeSec === null) return;

          onProgress({
            jobId: job.id,
            outTimeSec,
            progress: Math.min(1, Math.max(0, outTimeSec / expectedDurationSec)),
          });
        },
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || 'EXPORT_FAILED');
      }

      const outputStat = await stat(tempOutputPath);
      if (!outputStat.isFile() || outputStat.size <= 0) {
        throw new Error('EXPORT_EMPTY_OUTPUT');
      }

      if (await pathExists(request.outputPath)) {
        await rm(request.outputPath, { force: true });
      }

      await rename(tempOutputPath, request.outputPath);

      onProgress({
        jobId: job.id,
        outTimeSec: expectedDurationSec,
        progress: 1,
      });

      onFinished({
        jobId: job.id,
        status: 'completed',
        outputPath: request.outputPath,
      });
    } catch (error) {
      await rm(tempOutputPath, { force: true }).catch(() => undefined);

      const cancelled =
        job.abortController.signal.aborted ||
        (error instanceof Error && error.message === 'PROCESS_ABORTED');

      onFinished({
        jobId: job.id,
        status: cancelled ? 'cancelled' : 'failed',
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
