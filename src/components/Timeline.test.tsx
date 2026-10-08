import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from './Timeline';

describe('Timeline hover preview', () => {
  it('shows a following video preview at the hovered timeline time', () => {
    render(
      <Timeline
        durationSec={100}
        currentTimeSec={10}
        intervals={[]}
        activeIntervalId={null}
        previewSourceUrl="app-media://video/preview-token"
        onPreview={vi.fn()}
      />,
    );

    const hoverZone = screen.getByTestId('timeline-hover-zone');
    vi.spyOn(hoverZone, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 22,
      width: 1000,
      height: 22,
      toJSON: () => ({}),
    });

    const preview = screen.getByTestId('timeline-hover-preview');
    expect(preview).toHaveAttribute('aria-hidden', 'true');

    fireEvent.mouseMove(hoverZone, { clientX: 500 });

    expect(preview).toHaveAttribute('aria-hidden', 'false');
    expect(preview).toHaveStyle({ left: '500px' });
    expect(screen.getByText('00:50.000')).toBeInTheDocument();

    const previewVideo = screen.getByLabelText(
      '时间轴画面预览',
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

  it('keeps the preview card inside the timeline near both edges', () => {
    render(
      <Timeline
        durationSec={200}
        currentTimeSec={0}
        intervals={[]}
        activeIntervalId={null}
        previewSourceUrl="app-media://video/preview-token"
        onPreview={vi.fn()}
      />,
    );

    const hoverZone = screen.getByTestId('timeline-hover-zone');
    vi.spyOn(hoverZone, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      left: 100,
      top: 0,
      right: 1100,
      bottom: 22,
      width: 1000,
      height: 22,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(hoverZone, { clientX: 105 });
    expect(screen.getByTestId('timeline-hover-preview')).toHaveStyle({
      left: '112px',
    });
    expect(screen.getByText('00:01.000')).toBeInTheDocument();

    fireEvent.mouseMove(hoverZone, { clientX: 1095 });
    expect(screen.getByTestId('timeline-hover-preview')).toHaveStyle({
      left: '888px',
    });
    expect(screen.getByText('03:19.000')).toBeInTheDocument();
  });
});
