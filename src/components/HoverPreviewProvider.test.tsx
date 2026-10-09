import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HoverPreviewProvider } from './HoverPreviewProvider';
import { Timeline } from './Timeline';

describe('HoverPreviewProvider', () => {
  it('keeps one preview video for the unified seekable timeline', () => {
    render(
      <HoverPreviewProvider
        durationSec={100}
        previewSourceUrl="app-media://video/shared-preview"
      >
        <Timeline
          durationSec={100}
          currentTimeSec={0}
          intervals={[]}
          activeIntervalId={null}
          onPreview={vi.fn()}
          onSeek={vi.fn()}
        />
      </HoverPreviewProvider>,
    );

    expect(
      screen.getAllByLabelText('共享时间轴画面预览'),
    ).toHaveLength(1);

    const sharedVideo = screen.getByLabelText(
      '共享时间轴画面预览',
    ) as HTMLVideoElement;
    fireEvent.loadedMetadata(sharedVideo);

    const timeline = screen.getByTestId('timeline-hover-zone');
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 550,
      left: 0,
      top: 550,
      right: 1000,
      bottom: 574,
      width: 1000,
      height: 24,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(timeline, { clientX: 800 });

    expect(
      screen.getAllByLabelText('共享时间轴画面预览'),
    ).toHaveLength(1);
    expect(screen.getByText('01:20.000')).toBeInTheDocument();
  });
});
