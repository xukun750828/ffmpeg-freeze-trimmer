import { useRef } from 'react';
import type { FreezeInterval } from '../types/freeze';
import { useHoverPreview } from './HoverPreviewProvider';

interface TimelineProps {
  durationSec: number;
  currentTimeSec: number;
  intervals: FreezeInterval[];
  activeIntervalId: string | null;
  onSeek: (timeSec: number) => void;
}

export function Timeline({
  durationSec,
  currentTimeSec,
  intervals,
  activeIntervalId,
  onSeek,
}: TimelineProps) {
  const { requestPreview, hidePreview } = useHoverPreview();
  const draggingRef = useRef(false);

  if (durationSec <= 0) return null;

  const playheadPct = Math.min(
    100,
    Math.max(0, (currentTimeSec / durationSec) * 100),
  );

  function timeFromPointer(
    event: React.PointerEvent<HTMLDivElement>,
  ): number | null {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return null;

    const relativeX = Math.min(
      rect.width,
      Math.max(0, event.clientX - rect.left),
    );
    return (relativeX / rect.width) * durationSec;
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

    requestPreview({
      timeSec,
      clientX: event.clientX,
      boundsLeft: rect.left,
      boundsRight: rect.right,
      anchorY: rect.top,
    });
  }

  function handlePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;
    const timeSec = timeFromPointer(event);
    if (timeSec === null) return;

    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSeek(timeSec);
  }

  function handlePointerMove(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (!draggingRef.current) return;
    const timeSec = timeFromPointer(event);
    if (timeSec !== null) onSeek(timeSec);
  }

  function stopDragging() {
    draggingRef.current = false;
  }

  return (
    <section className="timeline-panel" aria-label="视频时间轴">
      <div
        className="timeline-hover-zone"
        data-testid="timeline-hover-zone"
        role="slider"
        aria-label="视频进度"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-valuenow={Math.min(durationSec, Math.max(0, currentTimeSec))}
        tabIndex={0}
        onMouseMove={handleTimelineMouseMove}
        onMouseLeave={hidePreview}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div className="timeline-track">
          <div
            className="timeline-played"
            style={{ width: `${playheadPct}%` }}
          />
          {intervals.map((interval) => {
            const left = (interval.startSec / durationSec) * 100;
            const width =
              ((interval.endSec - interval.startSec) / durationSec) *
              100;
            const source = interval.source ?? 'detected';
            const classNames = [
              'timeline-interval',
              `source-${source}`,
              interval.selectedForRemoval ? 'selected' : '',
              interval.id === activeIntervalId ? 'active' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={interval.id}
                className={classNames}
                aria-hidden="true"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.35)}%`,
                }}
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
        <span><i className="legend-swatch detected" /> 检测候选</span>
        <span><i className="legend-swatch similarity" /> 相似候选</span>
        <span><i className="legend-swatch manual" /> 人工候选</span>
        <span><i className="legend-swatch removal" /> 待删除</span>
      </div>
    </section>
  );
}
