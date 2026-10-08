import { useEffect, useRef, useState } from 'react';
import type { FreezeInterval } from '../types/freeze';
import { formatPreciseTime } from '../utils/time';

const HOVER_PREVIEW_WIDTH_PX = 224;
const HOVER_SEEK_DEBOUNCE_MS = 80;

interface TimelineProps {
  durationSec: number;
  currentTimeSec: number;
  intervals: FreezeInterval[];
  activeIntervalId: string | null;
  previewSourceUrl: string;
  onPreview: (interval: FreezeInterval) => void;
}

export function Timeline({
  durationSec,
  currentTimeSec,
  intervals,
  activeIntervalId,
  previewSourceUrl,
  onPreview,
}: TimelineProps) {
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hoverVisible, setHoverVisible] = useState(false);
  const [hoverTimeSec, setHoverTimeSec] = useState(0);
  const [hoverLeftPx, setHoverLeftPx] = useState(
    HOVER_PREVIEW_WIDTH_PX / 2,
  );

  useEffect(() => {
    return () => {
      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setHoverVisible(false);
    pendingSeekRef.current = null;
    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
  }, [previewSourceUrl]);

  if (durationSec <= 0) return null;

  const playheadPct = Math.min(
    100,
    Math.max(0, (currentTimeSec / durationSec) * 100),
  );

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
    }, HOVER_SEEK_DEBOUNCE_MS);
  }

  function handleTimelineMouseMove(
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    const relativeX = Math.min(
      rect.width,
      Math.max(0, event.clientX - rect.left),
    );
    const timeSec = (relativeX / rect.width) * durationSec;
    const halfPreview = HOVER_PREVIEW_WIDTH_PX / 2;
    const clampedLeft = Math.min(
      Math.max(relativeX, halfPreview),
      Math.max(halfPreview, rect.width - halfPreview),
    );

    setHoverVisible(true);
    setHoverTimeSec(timeSec);
    setHoverLeftPx(clampedLeft);
    schedulePreviewSeek(timeSec);
  }

  function handleTimelineMouseLeave() {
    setHoverVisible(false);
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
    <section className="timeline-panel" aria-label="视频时间轴">
      <div
        className="timeline-hover-zone"
        data-testid="timeline-hover-zone"
        onMouseMove={handleTimelineMouseMove}
        onMouseLeave={handleTimelineMouseLeave}
      >
        <div
          className={`timeline-hover-preview${hoverVisible ? ' visible' : ''}`}
          data-testid="timeline-hover-preview"
          aria-hidden={hoverVisible ? 'false' : 'true'}
          style={{ left: `${hoverLeftPx}px` }}
        >
          <video
            ref={previewVideoRef}
            className="timeline-hover-video"
            src={previewSourceUrl}
            preload="metadata"
            muted
            playsInline
            aria-label="时间轴画面预览"
            onLoadedMetadata={handlePreviewMetadataLoaded}
          />
          <div className="timeline-hover-time">
            {formatPreciseTime(hoverTimeSec)}
          </div>
        </div>

        <div className="timeline-track">
          {intervals.map((interval, index) => {
            const left = (interval.startSec / durationSec) * 100;
            const width =
              ((interval.endSec - interval.startSec) / durationSec) *
              100;
            const classNames = [
              'timeline-interval',
              interval.selectedForRemoval ? 'selected' : '',
              interval.id === activeIntervalId ? 'active' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={interval.id}
                type="button"
                className={classNames}
                aria-label={`时间轴静止区间 ${index + 1}`}
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.35)}%`,
                }}
                onClick={() => onPreview(interval)}
              />
            );
          })}
          <div
            className="timeline-playhead"
            style={{ left: `${playheadPct}%` }}
          />
        </div>
      </div>

      <div className="timeline-legend">
        <span><i className="legend-swatch candidate" /> 静止候选</span>
        <span><i className="legend-swatch removal" /> 待删除</span>
      </div>
    </section>
  );
}
