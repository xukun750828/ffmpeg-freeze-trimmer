import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

let playSpy: ReturnType<typeof vi.spyOn>;
let pauseSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  pauseSpy = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  delete window.desktopApi;
  vi.restoreAllMocks();
});

function createDesktopApi() {
  return {
    getAppVersion: vi.fn().mockResolvedValue('0.1.4'),
    openVideo: vi.fn().mockResolvedValue({
      path: 'C:\\Videos\\demo.mp4',
      name: 'demo.mp4',
      sourceUrl: 'app-media://video/token',
    }),
    probeMedia: vi.fn().mockResolvedValue({
      path: 'C:\\Videos\\demo.mp4',
      durationSec: 125.5,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasAudio: true,
    }),
    detectFreezes: vi.fn().mockResolvedValue([
      {
        id: 'freeze-0001',
        startSec: 12.4,
        endSec: 18.2,
        durationSec: 5.8,
        selectedForRemoval: false,
      },
      {
        id: 'freeze-0002',
        startSec: 31.1,
        endSec: 38.5,
        durationSec: 7.4,
        selectedForRemoval: false,
      },
    ]),
    locateExactFrameMatch: vi.fn().mockResolvedValue({
      anchorSec: 42.5,
      startSec: 40,
      endSec: 48,
      durationSec: 8,
      visualChangeLevel: 'standard',
      maxNormalizedDifference: 0.0005,
      audioSubIntervals: [
        {
          id: 'audio-0001',
          startSec: 40,
          endSec: 43,
          durationSec: 3,
          audioPresence: 'sound',
        },
        {
          id: 'audio-0002',
          startSec: 43,
          endSec: 46.5,
          durationSec: 3.5,
          audioPresence: 'silence',
        },
        {
          id: 'audio-0003',
          startSec: 46.5,
          endSec: 48,
          durationSec: 1.5,
          audioPresence: 'sound',
        },
      ],
    }),
    chooseOutputPath: vi
      .fn()
      .mockResolvedValue('C:\\Videos\\demo_trimmed.mp4'),
    startExport: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    cancelExport: vi.fn().mockResolvedValue(undefined),
    onExportProgress: vi.fn().mockImplementation(() => () => undefined),
    onExportFinished: vi.fn().mockImplementation(() => () => undefined),
    onMenuVideoSelected: vi.fn().mockImplementation(() => () => undefined),
  };
}

async function importVideoAndWait() {
  fireEvent.click(screen.getByRole('button', { name: '导入本地 MP4' }));
  await waitFor(() => {
    expect(screen.getByText('设置参数后点击“启动检测”')).toBeInTheDocument();
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
  });
}

async function startDetectionAndWait() {
  fireEvent.click(screen.getByRole('button', { name: '启动检测' }));
  await waitFor(() => {
    expect(screen.getByText('发现 2 个静止区间')).toBeInTheDocument();
  });
}

describe('App media import and manual directed freeze detection', () => {
  it('imports a local video without automatically starting freeze detection', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    expect(desktopApi.probeMedia).toHaveBeenCalledWith('C:\\Videos\\demo.mp4');
    expect(desktopApi.detectFreezes).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '启动检测' })).toBeEnabled();
    expect(screen.getByLabelText('检测方向')).toHaveValue('forward');
    expect(screen.getByLabelText('检测静止区间数量')).toHaveValue('5');
    expect(screen.getByLabelText('有背景声音')).toBeChecked();
  });

  it('starts detection from the current playback time with the default direction and count', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    const video = document.querySelector('video')!;
    video.currentTime = 42.5;
    fireEvent.timeUpdate(video);

    await startDetectionAndWait();

    expect(pauseSpy).toHaveBeenCalled();
    expect(desktopApi.detectFreezes).toHaveBeenCalledWith({
      path: 'C:\\Videos\\demo.mp4',
      durationSec: 125.5,
      currentTimeSec: 42.5,
      direction: 'forward',
      maxIntervals: 5,
      hasAudio: true,
      options: {
        noise: 0.003,
        minDurationSec: 2,
        hasBackgroundSound: true,
      },
    });
  });

  it('locates a configurable current-frame similarity interval with sound and silence child intervals', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    const video = document.querySelector('video')!;
    video.currentTime = 42.5;
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByRole('button', { name: '定位当前画面' }));

    await waitFor(() => {
      expect(
        screen.getByText('当前画面相似区间持续 8.000 秒'),
      ).toBeInTheDocument();
    });

    expect(desktopApi.locateExactFrameMatch).toHaveBeenCalledWith({
      path: 'C:\\Videos\\demo.mp4',
      durationSec: 125.5,
      currentTimeSec: 42.5,
      hasAudio: true,
      visualChangeLevel: 'standard',
    });

    const exactPanel = screen.getByLabelText('当前画面精确定位');
    expect(screen.getByLabelText('当前画面允许变化等级')).toHaveValue(
      'standard',
    );
    expect(within(exactPanel).getAllByText('有背景声音')).toHaveLength(2);
    expect(within(exactPanel).getByText('无背景声音')).toBeInTheDocument();
    expect(screen.getByText('00:40.000 → 00:48.000')).toBeInTheDocument();

    pauseSpy.mockClear();
    playSpy.mockClear();
    fireEvent.click(
      screen.getByRole('button', { name: '预览音频子区间 2' }),
    );

    expect(video.currentTime).toBeCloseTo(42.5, 3);
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it('uses the selected current-frame visual change level', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    fireEvent.change(screen.getByLabelText('当前画面允许变化等级'), {
      target: { value: 'relaxed' },
    });

    const video = document.querySelector('video')!;
    video.currentTime = 50;
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByRole('button', { name: '定位当前画面' }));

    await waitFor(() => {
      expect(desktopApi.locateExactFrameMatch).toHaveBeenCalledWith({
        path: 'C:\\Videos\\demo.mp4',
        durationSec: 125.5,
        currentTimeSec: 50,
        hasAudio: true,
        visualChangeLevel: 'relaxed',
      });
    });
  });

  it('uses edited visual, audio, direction, and interval-count settings', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    fireEvent.change(screen.getByLabelText('最短静止时长'), {
      target: { value: '3.5' },
    });
    fireEvent.change(screen.getByLabelText('允许画面变化'), {
      target: { value: '0.008' },
    });
    fireEvent.click(screen.getByLabelText('有背景声音'));
    fireEvent.change(screen.getByLabelText('检测方向'), {
      target: { value: 'backward' },
    });
    fireEvent.change(screen.getByLabelText('检测静止区间数量'), {
      target: { value: '3' },
    });

    const video = document.querySelector('video')!;
    video.currentTime = 90;
    fireEvent.timeUpdate(video);

    await startDetectionAndWait();

    expect(desktopApi.detectFreezes).toHaveBeenCalledWith({
      path: 'C:\\Videos\\demo.mp4',
      durationSec: 125.5,
      currentTimeSec: 90,
      direction: 'backward',
      maxIntervals: 3,
      hasAudio: true,
      options: {
        noise: 0.008,
        minDurationSec: 3.5,
        hasBackgroundSound: false,
      },
    });
    expect(
      screen.getByText(/无背景声音.*静音条件/),
    ).toBeInTheDocument();
  });

  it('previews a detected interval with lead and tail context', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();
    await startDetectionAndWait();

    pauseSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '预览静止区间 1' }));

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.currentTime).toBeCloseTo(11.9, 3);
    expect(playSpy).toHaveBeenCalledOnce();

    const activeRow = screen
      .getByRole('button', { name: '预览静止区间 1' })
      .closest('article');
    expect(activeRow).toHaveAttribute('data-active', 'true');

    video!.currentTime = 18.7;
    fireEvent.timeUpdate(video!);
    expect(pauseSpy).toHaveBeenCalledOnce();
  });

  it('exits interval preview mode when the user manually seeks the video', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();
    await startDetectionAndWait();

    fireEvent.click(screen.getByRole('button', { name: '预览静止区间 1' }));

    const video = document.querySelector('video');
    expect(video).not.toBeNull();

    fireEvent.seeked(video!);
    fireEvent.seeking(video!);

    const activeRow = screen
      .getByRole('button', { name: '预览静止区间 1' })
      .closest('article');
    expect(activeRow).toHaveAttribute('data-active', 'false');

    pauseSpy.mockClear();
    video!.currentTime = 18.7;
    fireEvent.timeUpdate(video!);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('loads a native-menu selected MP4 without automatically detecting', async () => {
    const desktopApi = createDesktopApi();
    let menuSelectionListener:
      | ((selection: { path: string; name: string; sourceUrl: string }) => void)
      | null = null;

    desktopApi.onMenuVideoSelected.mockImplementation(
      (
        listener: (selection: {
          path: string;
          name: string;
          sourceUrl: string;
        }) => void,
      ) => {
        menuSelectionListener = listener;
        return () => undefined;
      },
    );
    window.desktopApi = desktopApi;

    render(<App />);

    expect(menuSelectionListener).not.toBeNull();
    menuSelectionListener!({
      path: 'C:\\Videos\\menu-demo.mp4',
      name: 'menu-demo.mp4',
      sourceUrl: 'app-media://video/menu-token',
    });

    await waitFor(() => {
      expect(desktopApi.probeMedia).toHaveBeenCalledWith(
        'C:\\Videos\\menu-demo.mp4',
      );
      expect(screen.getByText('设置参数后点击“启动检测”')).toBeInTheDocument();
    });

    expect(desktopApi.openVideo).not.toHaveBeenCalled();
    expect(desktopApi.detectFreezes).not.toHaveBeenCalled();
  });

  it('keeps the empty state when the file dialog is cancelled', async () => {
    const desktopApi = createDesktopApi();
    desktopApi.openVideo.mockResolvedValueOnce(null);
    window.desktopApi = desktopApi;

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '导入本地 MP4' }));

    await waitFor(() => {
      expect(desktopApi.openVideo).toHaveBeenCalledOnce();
    });

    expect(screen.getByText('导入一个本地 MP4')).toBeInTheDocument();
    expect(desktopApi.probeMedia).not.toHaveBeenCalled();
    expect(desktopApi.detectFreezes).not.toHaveBeenCalled();
  });
});

describe('selection, timeline, and export workflow', () => {
  it('selects removal intervals and updates output duration statistics', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();
    await startDetectionAndWait();

    fireEvent.click(screen.getByLabelText('选择删除静止区间 1'));

    expect(screen.getByText('已选 1 段')).toBeInTheDocument();
    expect(screen.getByText('删除 00:05.800')).toBeInTheDocument();
    expect(screen.getByText('输出约 01:59.700')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('全选静止区间'));

    expect(screen.getByText('已选择 2 / 2')).toBeInTheDocument();
    expect(screen.getByText('已选 2 段')).toBeInTheDocument();
  });

  it('adds and removes the current similarity parent interval from deletion candidates', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    const video = document.querySelector('video')!;
    video.currentTime = 42.5;
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByRole('button', { name: '定位当前画面' }));

    await waitFor(() => {
      expect(
        screen.getByText('当前画面相似区间持续 8.000 秒'),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: '加入当前相似区间待删除',
      }),
    );

    expect(screen.getByText('相似定位')).toBeInTheDocument();
    expect(screen.getByText('已选 1 段')).toBeInTheDocument();
    expect(screen.getByText('删除 00:08.000')).toBeInTheDocument();
    expect(screen.getByText('输出约 01:57.500')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: '取消删除当前相似区间',
      }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole('button', {
        name: '取消删除当前相似区间',
      }),
    );

    expect(screen.getByText('已选 0 段')).toBeInTheDocument();
    expect(screen.getByText('删除 00:00.000')).toBeInTheDocument();
    expect(screen.getByText('输出约 02:05.500')).toBeInTheDocument();
  });

  it('preserves selected similarity candidates when direction detection is rerun', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    const video = document.querySelector('video')!;
    video.currentTime = 42.5;
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByRole('button', { name: '定位当前画面' }));
    await waitFor(() => {
      expect(
        screen.getByText('当前画面相似区间持续 8.000 秒'),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: '加入当前相似区间待删除',
      }),
    );

    await startDetectionAndWait();

    expect(screen.getByText('发现 2 个静止区间')).toBeInTheDocument();
    expect(screen.getByText('已选择 1 / 3')).toBeInTheDocument();
    expect(screen.getAllByText('方向检测')).toHaveLength(2);
    expect(screen.getAllByText('相似定位')).toHaveLength(1);
    expect(screen.getByText('已选 1 段')).toBeInTheDocument();
  });

  it('merges overlapping similarity and detected ranges for statistics and export', async () => {
    const desktopApi = createDesktopApi();
    desktopApi.locateExactFrameMatch.mockResolvedValueOnce({
      anchorSec: 16,
      startSec: 14,
      endSec: 20,
      durationSec: 6,
      visualChangeLevel: 'standard',
      maxNormalizedDifference: 0.0005,
      audioSubIntervals: [
        {
          id: 'audio-overlap',
          startSec: 14,
          endSec: 20,
          durationSec: 6,
          audioPresence: 'sound',
        },
      ],
    });
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    const video = document.querySelector('video')!;
    video.currentTime = 16;
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByRole('button', { name: '定位当前画面' }));
    await waitFor(() => {
      expect(
        screen.getByText('当前画面相似区间持续 6.000 秒'),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: '加入当前相似区间待删除',
      }),
    );

    await startDetectionAndWait();
    fireEvent.click(screen.getByLabelText('选择删除静止区间 2'));

    expect(screen.getByText('已选 2 段')).toBeInTheDocument();
    expect(screen.getByText('删除 00:07.600')).toBeInTheDocument();
    expect(screen.getByText('输出约 01:57.900')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '导出视频' }));

    await waitFor(() => {
      expect(desktopApi.startExport).toHaveBeenCalledWith({
        inputPath: 'C:\\Videos\\demo.mp4',
        outputPath: 'C:\\Videos\\demo_trimmed.mp4',
        durationSec: 125.5,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasAudio: true,
        removeRanges: [
          {
            startSec: 12.4,
            endSec: 20,
          },
        ],
      });
    });
  });

  it('previews intervals from the timeline', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();
    await startDetectionAndWait();

    fireEvent.click(screen.getByRole('button', { name: '时间轴候选区间 2' }));

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.currentTime).toBeCloseTo(30.6, 3);
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it('uses the unified custom controls and steps exactly one frame in either direction', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    const video = document.querySelector('video')!;
    expect(video).not.toHaveAttribute('controls');

    video.currentTime = 10;
    fireEvent.timeUpdate(video);

    fireEvent.click(
      screen.getByRole('button', { name: '向右移动一帧' }),
    );
    expect(video.currentTime).toBeCloseTo(10 + 1 / 30, 5);
    expect(pauseSpy).toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: '向左移动一帧' }),
    );
    expect(video.currentTime).toBeCloseTo(10, 5);
  });

  it('creates a selected manual removal interval with the In/Out buttons and exports it', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    const video = document.querySelector('video')!;
    video.currentTime = 10;
    fireEvent.timeUpdate(video);
    fireEvent.click(
      screen.getByRole('button', { name: '设置人工删除区间起点' }),
    );

    expect(screen.getByText(/起点：/)).toBeInTheDocument();
    expect(screen.getByText('00:10.000')).toBeInTheDocument();

    video.currentTime = 15.5;
    fireEvent.timeUpdate(video);
    fireEvent.click(
      screen.getByRole('button', { name: '设置人工删除区间终点' }),
    );

    expect(screen.getByText('人工指定')).toBeInTheDocument();
    expect(screen.getByText('00:10.000 → 00:15.500')).toBeInTheDocument();
    expect(screen.getByText('已选 1 段')).toBeInTheDocument();
    expect(screen.getByText('删除 00:05.500')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '导出视频' }));

    await waitFor(() => {
      expect(desktopApi.startExport).toHaveBeenCalledWith({
        inputPath: 'C:\\Videos\\demo.mp4',
        outputPath: 'C:\\Videos\\demo_trimmed.mp4',
        durationSec: 125.5,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasAudio: true,
        removeRanges: [{ startSec: 10, endSec: 15.5 }],
      });
    });
  });

  it('supports I/O shortcuts and preserves manual ranges when direction detection reruns', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();

    const video = document.querySelector('video')!;
    video.currentTime = 22.25;
    fireEvent.timeUpdate(video);
    fireEvent.keyDown(window, { key: 'i' });

    video.currentTime = 27.75;
    fireEvent.timeUpdate(video);
    fireEvent.keyDown(window, { key: 'o' });

    expect(screen.getByText('人工指定')).toBeInTheDocument();
    expect(screen.getByText('00:22.250 → 00:27.750')).toBeInTheDocument();
    expect(screen.getByText('已选 1 段')).toBeInTheDocument();

    await startDetectionAndWait();

    expect(screen.getByText('已选择 1 / 3')).toBeInTheDocument();
    expect(screen.getByText('人工指定')).toBeInTheDocument();
    expect(screen.getAllByText('方向检测')).toHaveLength(2);
  });

  it('starts an MP4 export with the selected removal ranges and supports cancellation', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await importVideoAndWait();
    await startDetectionAndWait();

    fireEvent.click(screen.getByLabelText('选择删除静止区间 1'));
    fireEvent.click(screen.getByRole('button', { name: '导出视频' }));

    await waitFor(() => {
      expect(desktopApi.startExport).toHaveBeenCalledWith({
        inputPath: 'C:\\Videos\\demo.mp4',
        outputPath: 'C:\\Videos\\demo_trimmed.mp4',
        durationSec: 125.5,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: 'aac',
        hasAudio: true,
        removeRanges: [
          {
            startSec: 12.4,
            endSec: 18.2,
          },
        ],
      });
    });

    expect(screen.getByRole('button', { name: '导出中 0%' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '取消导出' }));

    await waitFor(() => {
      expect(desktopApi.cancelExport).toHaveBeenCalledWith('job-1');
    });
  });
});
