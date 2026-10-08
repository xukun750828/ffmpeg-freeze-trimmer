// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTrimConcatFilter } from '../../electron/main/export/filter-builder';
import { buildExportArgs } from '../../electron/main/export/ffmpeg-export';
import { createExportPlan } from '../../electron/main/export/range-planner';
import {
  detectFreezes,
  detectFreezesDirected,
} from '../../electron/main/freeze/freeze-detector';
import { locateExactFrameMatch } from '../../electron/main/freeze/exact-frame-locator';
import { probeMedia } from '../../electron/main/media/media-probe';
import { runProcess } from '../../electron/main/process/process-runner';

let tempDir = '';

async function ensureFfmpegAvailable(): Promise<void> {
  const [ffmpeg, ffprobe] = await Promise.all([
    runProcess(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']),
    runProcess(process.env.FFPROBE_PATH || 'ffprobe', ['-version']),
  ]);

  if (ffmpeg.exitCode !== 0 || ffprobe.exitCode !== 0) {
    throw new Error('FFMPEG_NOT_AVAILABLE_FOR_INTEGRATION_TESTS');
  }
}

async function createLongSyntheticInput(outputPath: string): Promise<void> {
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30:duration=15',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:size=320x240:rate=30:duration=5',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30:duration=20',
    '-filter_complex',
    '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    outputPath,
  ];

  const result = await runProcess(process.env.FFMPEG_PATH || 'ffmpeg', args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'LONG_SYNTHETIC_VIDEO_GENERATION_FAILED');
  }
}

async function createNearbyFreezeInput(outputPath: string): Promise<void> {
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30:duration=12',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:size=320x240:rate=30:duration=3',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30:duration=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:size=320x240:rate=30:duration=3',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30:duration=20',
    '-filter_complex',
    '[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0[v]',
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    outputPath,
  ];

  const result = await runProcess(process.env.FFMPEG_PATH || 'ffmpeg', args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'NEARBY_FREEZE_VIDEO_GENERATION_FAILED');
  }
}

async function createExactMatchAudioFixture(outputPath: string): Promise<void> {
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30:duration=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:size=320x240:rate=30:duration=6',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=4',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=mono:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=660:sample_rate=48000:duration=4',
    '-filter_complex',
    '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a][5:a]concat=n=3:v=0:a=1[a]',
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-qp',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    outputPath,
  ];

  const result = await runProcess(process.env.FFMPEG_PATH || 'ffmpeg', args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'EXACT_MATCH_FIXTURE_GENERATION_FAILED');
  }
}

async function createSyntheticInput(outputPath: string, withAudio: boolean): Promise<void> {
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30:duration=1',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:size=320x240:rate=30:duration=3',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x240:rate=30:duration=1',
  ];

  if (withAudio) {
    args.push(
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=5',
    );
  }

  args.push(
    '-filter_complex',
    '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map',
    '[v]',
  );

  if (withAudio) {
    args.push('-map', '3:a:0', '-c:a', 'aac', '-b:a', '128k', '-shortest');
  }

  args.push(
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    outputPath,
  );

  const result = await runProcess(process.env.FFMPEG_PATH || 'ffmpeg', args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'SYNTHETIC_VIDEO_GENERATION_FAILED');
  }
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'freeze-trimmer-e1-'));
  await ensureFfmpegAvailable();
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe('real FFmpeg pipeline', () => {
  it(
    'locates the exact current-frame parent interval and splits audio child intervals',
    async () => {
      const inputPath = path.join(tempDir, 'exact-match-audio.mp4');
      await createExactMatchAudioFixture(inputPath);
      const source = await probeMedia(inputPath);

      const match = await locateExactFrameMatch({
        path: inputPath,
        durationSec: source.durationSec,
        currentTimeSec: 5,
        hasAudio: true,
        visualChangeLevel: 'standard',
      });

      expect(match).not.toBeNull();
      expect(match!.visualChangeLevel).toBe('standard');
      expect(match!.maxNormalizedDifference).toBe(0.0005);
      expect(match!.startSec).toBeGreaterThanOrEqual(1.8);
      expect(match!.startSec).toBeLessThan(2.2);
      expect(match!.endSec).toBeGreaterThan(7.8);
      expect(match!.endSec).toBeLessThan(8.2);

      const silence = match!.audioSubIntervals.find(
        (segment) => segment.audioPresence === 'silence',
      );
      expect(silence).toBeDefined();
      expect(silence!.startSec).toBeGreaterThanOrEqual(3.8);
      expect(silence!.startSec).toBeLessThan(4.3);
      expect(silence!.endSec).toBeGreaterThan(5.7);
      expect(silence!.endSec).toBeLessThan(6.3);

      expect(
        match!.audioSubIntervals.filter(
          (segment) => segment.audioPresence === 'sound',
        ).length,
      ).toBeGreaterThanOrEqual(2);
    },
    30_000,
  );

  it(
    'finds the nearest freeze before or after the current time on demand',
    async () => {
      const inputPath = path.join(tempDir, 'directed-nearby-freezes.mp4');
      await createNearbyFreezeInput(inputPath);
      const source = await probeMedia(inputPath);

      const baseRequest = {
        path: inputPath,
        durationSec: source.durationSec,
        currentTimeSec: 16,
        maxIntervals: 1,
        hasAudio: false,
        options: {
          noise: 0.003,
          minDurationSec: 2,
          hasBackgroundSound: true,
        },
      } as const;

      const forward = await detectFreezesDirected({
        ...baseRequest,
        direction: 'forward',
      });
      const backward = await detectFreezesDirected({
        ...baseRequest,
        direction: 'backward',
      });

      expect(forward).toHaveLength(1);
      expect(forward[0].startSec).toBeGreaterThanOrEqual(16.5);
      expect(forward[0].startSec).toBeLessThan(17.5);

      expect(backward).toHaveLength(1);
      expect(backward[0].startSec).toBeGreaterThanOrEqual(11.5);
      expect(backward[0].startSec).toBeLessThan(12.5);
    },
    30_000,
  );

  it(
    'uses background-sound setting to decide whether silence must confirm a freeze',
    async () => {
      const inputPath = path.join(tempDir, 'freeze-with-tone.mp4');
      await createSyntheticInput(inputPath, true);
      const source = await probeMedia(inputPath);

      const baseRequest = {
        path: inputPath,
        durationSec: source.durationSec,
        currentTimeSec: 0,
        direction: 'forward' as const,
        maxIntervals: 1,
        hasAudio: true,
        options: {
          noise: 0.003,
          minDurationSec: 1.5,
          hasBackgroundSound: true,
        },
      };

      const visualOnly = await detectFreezesDirected(baseRequest);
      const requireSilence = await detectFreezesDirected({
        ...baseRequest,
        options: {
          ...baseRequest.options,
          hasBackgroundSound: false,
        },
      });

      expect(visualOnly.length).toBeGreaterThanOrEqual(1);
      expect(requireSilence).toEqual([]);
    },
    30_000,
  );

  it(
    'uses the fast scan path on long media and refines freeze boundaries',
    async () => {
      const inputPath = path.join(tempDir, 'long-fast-scan.mp4');
      await createLongSyntheticInput(inputPath);

      const source = await probeMedia(inputPath);
      expect(source.durationSec).toBeGreaterThan(39);
      expect(source.durationSec).toBeLessThan(41);

      const freezes = await detectFreezes(
        inputPath,
        source.durationSec,
        { noise: 0.003, minDurationSec: 2 },
      );

      expect(freezes.length).toBeGreaterThanOrEqual(1);
      const longest = [...freezes].sort((a, b) => b.durationSec - a.durationSec)[0];

      expect(longest.startSec).toBeGreaterThanOrEqual(14.8);
      expect(longest.startSec).toBeLessThan(15.3);
      expect(longest.endSec).toBeGreaterThan(19.7);
      expect(longest.endSec).toBeLessThan(20.3);
    },
    30_000,
  );

  it(
    'keeps nearby freeze intervals distinct after merged-window refinement',
    async () => {
      const inputPath = path.join(tempDir, 'nearby-freezes.mp4');
      await createNearbyFreezeInput(inputPath);

      const source = await probeMedia(inputPath);
      const freezes = await detectFreezes(
        inputPath,
        source.durationSec,
        { noise: 0.003, minDurationSec: 2 },
      );

      const nearFirst = freezes.find(
        (interval) => interval.startSec >= 11.5 && interval.startSec <= 12.5,
      );
      const nearSecond = freezes.find(
        (interval) => interval.startSec >= 16.5 && interval.startSec <= 17.5,
      );

      expect(nearFirst).toBeDefined();
      expect(nearSecond).toBeDefined();
      expect(nearFirst!.endSec).toBeGreaterThan(14.5);
      expect(nearFirst!.endSec).toBeLessThan(15.5);
      expect(nearSecond!.endSec).toBeGreaterThan(19.5);
      expect(nearSecond!.endSec).toBeLessThan(20.5);
    },
    30_000,
  );

  it(
    'detects a synthetic static section and exports a shorter A/V MP4',
    async () => {
      const inputPath = path.join(tempDir, 'with-audio.mp4');
      const outputPath = path.join(tempDir, 'trimmed-with-audio.mp4');
      await createSyntheticInput(inputPath, true);

      const source = await probeMedia(inputPath);
      expect(source.hasAudio).toBe(true);
      expect(source.durationSec).toBeGreaterThan(4.8);
      expect(source.durationSec).toBeLessThan(5.2);

      const freezes = await detectFreezes(
        inputPath,
        source.durationSec,
        { noise: 0.003, minDurationSec: 1.5 },
      );

      expect(freezes.length).toBeGreaterThanOrEqual(1);
      const longest = [...freezes].sort((a, b) => b.durationSec - a.durationSec)[0];
      expect(longest.startSec).toBeGreaterThanOrEqual(0.8);
      expect(longest.startSec).toBeLessThan(1.3);
      expect(longest.endSec).toBeGreaterThan(3.7);
      expect(longest.endSec).toBeLessThan(4.3);

      const plan = createExportPlan(
        [{ startSec: 1, endSec: 4 }],
        source.durationSec,
      );
      const graph = buildTrimConcatFilter(plan.keepRanges, source.hasAudio);
      const args = buildExportArgs(inputPath, outputPath, graph, source.hasAudio);
      const exportResult = await runProcess(process.env.FFMPEG_PATH || 'ffmpeg', args);

      expect(exportResult.exitCode).toBe(0);

      const exported = await probeMedia(outputPath);
      expect(exported.hasAudio).toBe(true);
      expect(exported.durationSec).toBeGreaterThan(1.8);
      expect(exported.durationSec).toBeLessThan(2.3);
    },
    30_000,
  );

  it(
    'exports video-only MP4 without inventing an audio stream',
    async () => {
      const inputPath = path.join(tempDir, 'video-only.mp4');
      const outputPath = path.join(tempDir, 'trimmed-video-only.mp4');
      await createSyntheticInput(inputPath, false);

      const source = await probeMedia(inputPath);
      expect(source.hasAudio).toBe(false);

      const plan = createExportPlan(
        [{ startSec: 1, endSec: 4 }],
        source.durationSec,
      );
      const graph = buildTrimConcatFilter(plan.keepRanges, false);
      const args = buildExportArgs(inputPath, outputPath, graph, false);
      const exportResult = await runProcess(process.env.FFMPEG_PATH || 'ffmpeg', args);

      expect(exportResult.exitCode).toBe(0);

      const exported = await probeMedia(outputPath);
      expect(exported.hasAudio).toBe(false);
      expect(exported.durationSec).toBeGreaterThan(1.8);
      expect(exported.durationSec).toBeLessThan(2.3);
    },
    30_000,
  );
});
