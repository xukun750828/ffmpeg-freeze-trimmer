import type { FreezeInterval } from '../types/freeze';
import { useHoverPreview } from './HoverPreviewProvider';

interface TimelineProps {
  durationSec: number;
  currentTimeSec: number;
  intervals: FreezeInterval[];
  activeIntervalId: string | null;
  onPreview: (interval: FreezeInterval) => void;
}

export function Timeline({
  durationSec,
  currentTimeSec,
  intervals,
  activeIntervalId,
  onPreview,
}: TimelineProps) {
  const { requestPreview, hidePreview } = useHoverPreview();

  if (durationSec <= 0) return null;

  const playheadPct = Math.min(
    100,
    Math.max(0, (currentTimeSec / durationSec) * 100),
  );

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

  return (
    <section className="timeline-panel" aria-label="视频时间轴">
      <div
        className="timeline-hover-zone"
        data-testid="timeline-hover-zone"
        onMouseMove={handleTimelineMouseMove}
        onMouseLeave={hidePreview}
      >
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
