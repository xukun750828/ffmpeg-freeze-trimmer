import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HoverPreviewProvider } from './HoverPreviewProvider';
import { NativeTimelineHoverPreview } from './NativeTimelineHoverPreview';
import { Timeline } from './Timeline';

describe('HoverPreviewProvider', () => {
  it('shares one preview video between the native and custom timelines', () => {
    render(
      <HoverPreviewProvider
        durationSec={100}
        previewSourceUrl="app-media://video/shared-preview"
      >
        <NativeTimelineHoverPreview durationSec={100}>
          <video aria-label="主播放器" />
        </NativeTimelineHoverPreview>
        <Timeline
          durationSec={100}
          currentTimeSec={0}
          intervals={[]}
          activeIntervalId={null}
          onPreview={vi.fn()}
        />
      </HoverPreviewProvider>,
    );

    expect(
      screen.getAllByLabelText('共享时间轴画面预览'),
    ).toHaveLength(1);

    const nativeZone = screen.getByTestId(
      'native-timeline-hover-zone',
    );
    vi.spyOn(nativeZone, 'getBoundingClientRect').mockReturnValue({
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

    fireEvent.mouseMove(nativeZone, {
      clientX: 300,
      clientY: 478,
    });
    expect(screen.getByText('00:28.814')).toBeInTheDocument();

    const sharedVideo = screen.getByLabelText(
      '共享时间轴画面预览',
    ) as HTMLVideoElement;
    fireEvent.loadedMetadata(sharedVideo);

    const customZone = screen.getByTestId('timeline-hover-zone');
    vi.spyOn(customZone, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 550,
      left: 0,
      top: 550,
      right: 1000,
      bottom: 572,
      width: 1000,
      height: 22,
      toJSON: () => ({}),
    });

    fireEvent.mouseMove(customZone, { clientX: 800 });

    expect(
      screen.getAllByLabelText('共享时间轴画面预览'),
    ).toHaveLength(1);
    expect(screen.getByText('01:20.000')).toBeInTheDocument();
  });
});
