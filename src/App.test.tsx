import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

afterEach(() => {
  delete window.desktopApi;
});

describe('App media import flow', () => {
  it('opens a local video and renders probed media information', async () => {
    const desktopApi = {
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
    };

    window.desktopApi = desktopApi;

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '打开视频' }));

    await waitFor(() => {
      expect(screen.getByText('demo.mp4')).toBeInTheDocument();
    });

    expect(desktopApi.openVideo).toHaveBeenCalledOnce();
    expect(desktopApi.probeMedia).toHaveBeenCalledWith('C:\\Videos\\demo.mp4');
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
    expect(screen.getByText('30.00 fps')).toBeInTheDocument();
    expect(screen.getByText('aac')).toBeInTheDocument();
    expect(screen.getByText('02:05')).toBeInTheDocument();
  });

  it('keeps the empty state when the file dialog is cancelled', async () => {
    const desktopApi = {
      getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
      openVideo: vi.fn().mockResolvedValue(null),
      probeMedia: vi.fn(),
    };

    window.desktopApi = desktopApi;

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '打开视频' }));

    await waitFor(() => {
      expect(desktopApi.openVideo).toHaveBeenCalledOnce();
    });

    expect(screen.getByText('打开一个本地 MP4')).toBeInTheDocument();
    expect(desktopApi.probeMedia).not.toHaveBeenCalled();
  });
});
