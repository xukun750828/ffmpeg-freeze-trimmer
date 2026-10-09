import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HoverPreviewProvider } from './HoverPreviewProvider';
import { Timeline } from './Timeline';

function renderTimeline(
  durationSec = 100,
  onSeek = vi.fn(),
) {
  return {
    onSeek,
    ...render(
      <HoverPreviewProvider
        durationSec={durationSec}
        previewSourceUrl="app-media://video/preview-token"
      >
        <Timeline
          durationSec={durationSec}
          currentTimeSec={10}
          intervals={[]}
          activeIntervalId={null}
          onSeek={onSeek}
        />
      </HoverPreviewProvider>,
    ),
  };
}

describe('Timeline hover preview', () => {
  it('shows the shared preview at the hovered timeline time', () => {
    renderTimeline(100);

    const hoverZone = screen.getByTestId('timeline-hover-zone');
    vi.spyOn(hoverZone, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 200,
      left: 0,
      top: 200,
      right: 1000,
      bottom: 222,
      width: 1000,
      height: 22,
      toJSON: () => ({}),
    });

    const preview = screen.getByTestId('shared-hover-preview');
    expect(preview).toHaveAttribute('aria-hidden', 'true');

    fireEvent.mouseMove(hoverZone, { clientX: 500 });

    expect(preview).toHaveAttribute('aria-hidden', 'false');
    expect(preview).toHaveStyle({
      left: '500px',
      top: '34px',
    });
    expect(screen.getByText('00:50.000')).toBeInTheDocument();

    const previewVideo = screen.getByLabelText(
      '共享时间轴画面预览',
    ) as HTMLVideoElement;
    expect(previewVideo).toHaveAttribute(
      'src',
      'app-media://video/preview-token',
    );

    fireEvent.loadedMetadata(previewVideo);
    expect(previewVideo.currentTime).toBeCloseTo(50, 3);

    fireEvent.mouseLeave(hoverZone);
    expect(preview).toHaveAttribute('aria-hidden', 'true');
  });

  it('clamps the shared preview card near both timeline edges', () => {
    renderTimeline(200);

    const hoverZone = screen.getByTestId('timeline-hover-zone');
    vi.spyOn(hoverZone, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 200,
      left: 100,
      top: 200,
      right: 1100,
      bottom: 222,
      width: 1000,
      height: 22,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(hoverZone, { clientX: 105 });
    expect(screen.getByTestId('shared-hover-preview')).toHaveStyle({
      left: '212px',
    });
    expect(screen.getByText('00:01.000')).toBeInTheDocument();

    fireEvent.mouseMove(hoverZone, { clientX: 1095 });
    expect(screen.getByTestId('shared-hover-preview')).toHaveStyle({
      left: '988px',
    });
    expect(screen.getByText('03:19.000')).toBeInTheDocument();
  });

  it('uses latest-wins seeking while a previous preview seek is still in flight', () => {
    renderTimeline(100);

    const hoverZone = screen.getByTestId('timeline-hover-zone');
    vi.spyOn(hoverZone, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 200,
      left: 0,
      top: 200,
      right: 1000,
      bottom: 222,
      width: 1000,
      height: 22,
      toJSON: () => ({}),
    });

    const previewVideo = screen.getByLabelText(
      '共享时间轴画面预览',
    ) as HTMLVideoElement;
    fireEvent.loadedMetadata(previewVideo);

    fireEvent.mouseMove(hoverZone, { clientX: 100 });
    expect(previewVideo.currentTime).toBeCloseTo(10, 3);

    fireEvent.mouseMove(hoverZone, { clientX: 300 });
    fireEvent.mouseMove(hoverZone, { clientX: 700 });

    // The in-flight seek is not interrupted by intermediate mouse targets.
    expect(previewVideo.currentTime).toBeCloseTo(10, 3);
    expect(screen.getByText('01:10.000')).toBeInTheDocument();

    // Once the previous seek completes, jump straight to the latest target.
    fireEvent.seeked(previewVideo);
    expect(previewVideo.currentTime).toBeCloseTo(70, 3);
  });

  it('seeks the main video position by clicking or dragging the unified timeline', () => {
    const onSeek = vi.fn();
    renderTimeline(100, onSeek);

    const hoverZone = screen.getByTestId('timeline-hover-zone');
    vi.spyOn(hoverZone, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 200,
      left: 0,
      top: 200,
      right: 1000,
      bottom: 224,
      width: 1000,
      height: 24,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(hoverZone, {
      pointerId: 1,
      button: 0,
      clientX: 250,
    });
    expect(onSeek).toHaveBeenLastCalledWith(25);

    fireEvent.pointerMove(hoverZone, {
      pointerId: 1,
      clientX: 760,
    });
    expect(onSeek).toHaveBeenLastCalledWith(76);

    fireEvent.pointerUp(hoverZone, { pointerId: 1 });
  });
});
