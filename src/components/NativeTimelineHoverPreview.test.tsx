import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NativeTimelineHoverPreview } from './NativeTimelineHoverPreview';

describe('NativeTimelineHoverPreview', () => {
  it('shows a preview only over the native progress-bar band without moving the main video', () => {
    render(
      <NativeTimelineHoverPreview
        durationSec={100}
        previewSourceUrl="app-media://video/native-preview"
      >
        <video aria-label="主播放器" />
      </NativeTimelineHoverPreview>,
    );

    const zone = screen.getByTestId('native-timeline-hover-zone');
    vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 500,
      width: 1000,
      height: 500,
      toJSON: () => ({}),
    });

    const preview = screen.getByTestId(
      'native-timeline-hover-preview',
    );
    const mainVideo = screen.getByLabelText(
      '主播放器',
    ) as HTMLVideoElement;
    mainVideo.currentTime = 12;

    fireEvent.mouseMove(zone, {
      clientX: 500,
      clientY: 430,
    });
    expect(preview).toHaveAttribute('aria-hidden', 'true');

    fireEvent.mouseMove(zone, {
      clientX: 500,
      clientY: 478,
    });

    expect(preview).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByText('00:50.000')).toBeInTheDocument();
    expect(mainVideo.currentTime).toBe(12);

    const previewVideo = screen.getByLabelText(
      '播放器时间轴画面预览',
    ) as HTMLVideoElement;
    fireEvent.loadedMetadata(previewVideo);

    expect(previewVideo.currentTime).toBeCloseTo(50, 3);
    expect(mainVideo.currentTime).toBe(12);

    fireEvent.mouseLeave(zone);
    expect(preview).toHaveAttribute('aria-hidden', 'true');
  });

  it('clamps the preview card near the native progress-bar edges', () => {
    render(
      <NativeTimelineHoverPreview
        durationSec={200}
        previewSourceUrl="app-media://video/native-preview"
      >
        <video aria-label="主播放器" />
      </NativeTimelineHoverPreview>,
    );

    const zone = screen.getByTestId('native-timeline-hover-zone');
    vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 1100,
      bottom: 600,
      width: 1000,
      height: 500,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(zone, {
      clientX: 130,
      clientY: 578,
    });
    expect(
      screen.getByTestId('native-timeline-hover-preview'),
    ).toHaveStyle({ left: '112px' });

    fireEvent.mouseMove(zone, {
      clientX: 1070,
      clientY: 578,
    });
    expect(
      screen.getByTestId('native-timeline-hover-preview'),
    ).toHaveStyle({ left: '888px' });
  });
});
