import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

let playSpy: ReturnType<typeof vi.spyOn>;
let pauseSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  delete window.desktopApi;
  vi.restoreAllMocks();
});

function createDesktopApi() {
  return {
    getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
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
    chooseOutputPath: vi.fn().mockResolvedValue('C:\\Videos\\demo_trimmed.mp4'),
    startExport: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    cancelExport: vi.fn().mockResolvedValue(undefined),
    onExportProgress: vi.fn().mockImplementation(() => () => undefined),
    onExportFinished: vi.fn().mockImplementation(() => () => undefined),
    onMenuOpenVideo: vi.fn().mockImplementation(() => () => undefined),
  };
}

async function openVideoAndWait() {
  fireEvent.click(screen.getByRole('button', { name: '导入本地 MP4' }));
  await waitFor(() => {
    expect(screen.getByText('发现 2 个静止区间')).toBeInTheDocument();
  });
}

describe('App media import and freeze review flow', () => {
  it('opens a local video, probes media, and automatically detects freeze intervals', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await openVideoAndWait();

    expect(desktopApi.probeMedia).toHaveBeenCalledWith('C:\\Videos\\demo.mp4');
    expect(desktopApi.detectFreezes).toHaveBeenCalledWith(
      'C:\\Videos\\demo.mp4',
      125.5,
      {
        noise: 0.003,
        minDurationSec: 2,
      },
    );
    expect(screen.getByText('00:12.400 → 00:18.200')).toBeInTheDocument();
    expect(screen.getByText('00:31.100 → 00:38.500')).toBeInTheDocument();
  });

  it('uses edited detection parameters when re-running detection', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await openVideoAndWait();

    fireEvent.change(screen.getByLabelText('最短静止时长'), {
      target: { value: '3.5' },
    });
    fireEvent.change(screen.getByLabelText('允许画面变化'), {
      target: { value: '0.008' },
    });
    fireEvent.click(screen.getByRole('button', { name: '重新检测' }));

    await waitFor(() => {
      expect(desktopApi.detectFreezes).toHaveBeenLastCalledWith(
        'C:\\Videos\\demo.mp4',
        125.5,
        {
          noise: 0.008,
          minDurationSec: 3.5,
        },
      );
    });
  });

  it('previews an interval with lead and tail context', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await openVideoAndWait();

    fireEvent.click(screen.getByRole('button', { name: '预览静止区间 1' }));

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.currentTime).toBeCloseTo(11.9, 3);
    expect(playSpy).toHaveBeenCalledOnce();

    const activeRow = screen.getByRole('button', { name: '预览静止区间 1' }).closest('article');
    expect(activeRow).toHaveAttribute('data-active', 'true');

    video!.currentTime = 18.7;
    fireEvent.timeUpdate(video!);
    expect(pauseSpy).toHaveBeenCalledOnce();
  });

  it('imports a local MP4 from the native File menu event', async () => {
    const desktopApi = createDesktopApi();
    let menuOpenListener: (() => void) | null = null;
    desktopApi.onMenuOpenVideo.mockImplementation((listener: () => void) => {
      menuOpenListener = listener;
      return () => undefined;
    });
    window.desktopApi = desktopApi;

    render(<App />);

    expect(desktopApi.onMenuOpenVideo).toHaveBeenCalledOnce();
    expect(menuOpenListener).not.toBeNull();

    menuOpenListener!();

    await waitFor(() => {
      expect(desktopApi.openVideo).toHaveBeenCalledOnce();
      expect(screen.getByText('发现 2 个静止区间')).toBeInTheDocument();
    });
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
    await openVideoAndWait();

    fireEvent.click(screen.getByLabelText('选择删除静止区间 1'));

    expect(screen.getByText('已选 1 段')).toBeInTheDocument();
    expect(screen.getByText('删除 00:05.800')).toBeInTheDocument();
    expect(screen.getByText('输出约 01:59.700')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('全选静止区间'));

    expect(screen.getByText('已选择 2 / 2')).toBeInTheDocument();
    expect(screen.getByText('已选 2 段')).toBeInTheDocument();
  });

  it('previews intervals from the timeline', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await openVideoAndWait();

    fireEvent.click(screen.getByRole('button', { name: '时间轴静止区间 2' }));

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.currentTime).toBeCloseTo(30.6, 3);
    expect(playSpy).toHaveBeenCalledOnce();
  });

  it('starts an MP4 export with the selected removal ranges and supports cancellation', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    await openVideoAndWait();

    fireEvent.click(screen.getByLabelText('选择删除静止区间 1'));
    fireEvent.click(screen.getByRole('button', { name: '导出视频' }));

    await waitFor(() => {
      expect(desktopApi.startExport).toHaveBeenCalledWith({
        inputPath: 'C:\\Videos\\demo.mp4',
        outputPath: 'C:\\Videos\\demo_trimmed.mp4',
        durationSec: 125.5,
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
