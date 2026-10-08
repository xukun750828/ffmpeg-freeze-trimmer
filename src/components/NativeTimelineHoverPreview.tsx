import type { ReactNode } from 'react';
import { useHoverPreview } from './HoverPreviewProvider';

const NATIVE_PROGRESS_SIDE_PADDING_PX = 28;
const NATIVE_PROGRESS_MIN_BOTTOM_PX = 10;
const NATIVE_PROGRESS_MAX_BOTTOM_PX = 38;

interface NativeTimelineHoverPreviewProps {
  durationSec: number;
  children: ReactNode;
}

export function NativeTimelineHoverPreview({
  durationSec,
  children,
}: NativeTimelineHoverPreviewProps) {
  const { requestPreview, hidePreview } = useHoverPreview();

  function handleMouseMove(
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    if (durationSec <= 0) {
      hidePreview();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hidePreview();
      return;
    }

    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const distanceFromBottom = rect.height - localY;

    const inVerticalBand =
      distanceFromBottom >= NATIVE_PROGRESS_MIN_BOTTOM_PX &&
      distanceFromBottom <= NATIVE_PROGRESS_MAX_BOTTOM_PX;

    const progressStart = Math.min(
      NATIVE_PROGRESS_SIDE_PADDING_PX,
      rect.width / 4,
    );
    const progressEnd = Math.max(
      progressStart + 1,
      rect.width - progressStart,
    );
    const inHorizontalBand =
      localX >= progressStart && localX <= progressEnd;

    if (!inVerticalBand || !inHorizontalBand) {
      hidePreview();
      return;
    }

    const relativeX = Math.min(
      progressEnd,
      Math.max(progressStart, localX),
    );
    const ratio =
      (relativeX - progressStart) /
      Math.max(1, progressEnd - progressStart);
    const timeSec = ratio * durationSec;

    requestPreview({
      timeSec,
      clientX: event.clientX,
      boundsLeft: rect.left,
      boundsRight: rect.right,
      anchorY: rect.bottom - NATIVE_PROGRESS_MAX_BOTTOM_PX,
    });
  }

  return (
    <div
      className="video-stage"
      data-testid="native-timeline-hover-zone"
      onMouseMove={handleMouseMove}
      onMouseLeave={hidePreview}
    >
      {children}
    </div>
  );
}
