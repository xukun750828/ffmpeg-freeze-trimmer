import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

afterEach(() => {
  delete window.desktopApi;
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
  };
}

describe('App media import and freeze detection flow', () => {
  it('opens a local video, probes media, and automatically detects freeze intervals', async () => {
    const desktopApi = createDesktopApi();
    window.desktopApi = desktopApi;

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '打开视频' }));

    await waitFor(() => {
      expect(screen.getByText('demo.mp4')).toBeInTheDocument();
      expect(screen.getByText('发现 2 个静止区间')).toBeInTheDocument();
    });

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
    fireEvent.click(screen.getByRole('button', { name: '打开视频' }));

    await waitFor(() => {
      expect(screen.getByText('发现 2 个静止区间')).toBeInTheDocument();
    });

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

  it('keeps the empty state when the file dialog is cancelled', async () => {
    const desktopApi = createDesktopApi();
    desktopApi.openVideo.mockResolvedValueOnce(null);
    window.desktopApi = desktopApi;

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '打开视频' }));

    await waitFor(() => {
      expect(desktopApi.openVideo).toHaveBeenCalledOnce();
    });

    expect(screen.getByText('打开一个本地 MP4')).toBeInTheDocument();
    expect(desktopApi.probeMedia).not.toHaveBeenCalled();
    expect(desktopApi.detectFreezes).not.toHaveBeenCalled();
  });
});
