import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { formatPreciseTime } from '../utils/time';

const PREVIEW_WIDTH_PX = 224;
const PREVIEW_SEEK_DEBOUNCE_MS = 80;
const NATIVE_PROGRESS_SIDE_PADDING_PX = 28;
const NATIVE_PROGRESS_MIN_BOTTOM_PX = 10;
const NATIVE_PROGRESS_MAX_BOTTOM_PX = 38;

interface NativeTimelineHoverPreviewProps {
  durationSec: number;
  previewSourceUrl: string;
  children: ReactNode;
}

export function NativeTimelineHoverPreview({
  durationSec,
  previewSourceUrl,
  children,
}: NativeTimelineHoverPreviewProps) {
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [visible, setVisible] = useState(false);
  const [hoverTimeSec, setHoverTimeSec] = useState(0);
  const [hoverLeftPx, setHoverLeftPx] = useState(
    PREVIEW_WIDTH_PX / 2,
  );

  useEffect(() => {
    return () => {
      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setVisible(false);
    pendingSeekRef.current = null;

    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
  }, [previewSourceUrl]);

  function seekPreviewVideo(timeSec: number) {
    const video = previewVideoRef.current;
    if (!video || video.readyState < 1) {
      pendingSeekRef.current = timeSec;
      return;
    }

    pendingSeekRef.current = null;
    const target = Math.max(0, Math.min(durationSec, timeSec));

    if (Math.abs(video.currentTime - target) >= 0.03) {
      video.currentTime = target;
    }
  }

  function schedulePreviewSeek(timeSec: number) {
    pendingSeekRef.current = timeSec;

    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current);
    }

    seekTimerRef.current = setTimeout(() => {
      seekTimerRef.current = null;
      seekPreviewVideo(timeSec);
    }, PREVIEW_SEEK_DEBOUNCE_MS);
  }

  function handleMouseMove(
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    if (durationSec <= 0) {
      setVisible(false);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setVisible(false);
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
      setVisible(false);
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

    const halfPreview = PREVIEW_WIDTH_PX / 2;
    const clampedLeft = Math.min(
      Math.max(localX, halfPreview),
      Math.max(halfPreview, rect.width - halfPreview),
    );

    setVisible(true);
    setHoverTimeSec(timeSec);
    setHoverLeftPx(clampedLeft);
    schedulePreviewSeek(timeSec);
  }

  function handleMouseLeave() {
    setVisible(false);
    pendingSeekRef.current = null;

    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
  }

  function handlePreviewMetadataLoaded(
    event: React.SyntheticEvent<HTMLVideoElement>,
  ) {
    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek === null) return;

    const video = event.currentTarget;
    const target = Math.max(
      0,
      Math.min(durationSec, pendingSeek),
    );

    pendingSeekRef.current = null;
    video.currentTime = target;
  }

  return (
    <div
      className="video-stage"
      data-testid="native-timeline-hover-zone"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      <div
        className={`native-timeline-hover-preview${visible ? ' visible' : ''}`}
        data-testid="native-timeline-hover-preview"
        aria-hidden={visible ? 'false' : 'true'}
        style={{ left: `${hoverLeftPx}px` }}
      >
        <video
          ref={previewVideoRef}
          className="native-timeline-hover-video"
          src={previewSourceUrl}
          preload="metadata"
          muted
          playsInline
          aria-label="播放器时间轴画面预览"
          onLoadedMetadata={handlePreviewMetadataLoaded}
        />
        <div className="native-timeline-hover-time">
          {formatPreciseTime(hoverTimeSec)}
        </div>
      </div>
    </div>
  );
}
