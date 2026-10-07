import type { AnalysisStatus, DetectionOptions, FreezeInterval } from '../types/freeze';
import { formatPreciseTime } from '../utils/time';

interface FreezePanelProps {
  status: AnalysisStatus;
  intervals: FreezeInterval[];
  options: DetectionOptions;
  disabled: boolean;
  onOptionsChange: (options: DetectionOptions) => void;
  onRedetect: () => void;
}

export function FreezePanel({
  status,
  intervals,
  options,
  disabled,
  onOptionsChange,
  onRedetect,
}: FreezePanelProps) {
  const summary =
    status === 'detecting'
      ? '正在检测静止画面…'
      : status === 'ready'
        ? intervals.length > 0
          ? `发现 ${intervals.length} 个静止区间`
          : '未发现满足条件的静止区间'
        : status === 'failed'
          ? '检测失败'
          : '尚未检测';

  return (
    <section className="freeze-panel" aria-label="静止区间">
      <div className="panel-heading-row">
        <div>
          <h2>静止区间</h2>
          <p className="panel-summary">{summary}</p>
        </div>
        <button type="button" onClick={onRedetect} disabled={disabled || status === 'detecting'}>
          {status === 'detecting' ? '检测中…' : '重新检测'}
        </button>
      </div>

      <div className="detection-controls">
        <label>
          <span>最短静止时长</span>
          <div className="inline-input">
            <input
              aria-label="最短静止时长"
              type="number"
              min="0.5"
              max="60"
              step="0.5"
              value={options.minDurationSec}
              disabled={disabled || status === 'detecting'}
              onChange={(event) =>
                onOptionsChange({
                  ...options,
                  minDurationSec: Number(event.target.value),
                })
              }
            />
            <span>秒</span>
          </div>
        </label>

        <label>
          <span>允许画面变化</span>
          <select
            aria-label="允许画面变化"
            value={options.noise}
            disabled={disabled || status === 'detecting'}
            onChange={(event) =>
              onOptionsChange({
                ...options,
                noise: Number(event.target.value),
              })
            }
          >
            <option value={0.001}>严格 · 0.001</option>
            <option value={0.003}>标准 · 0.003</option>
            <option value={0.008}>宽松 · 0.008</option>
            <option value={0.015}>更宽松 · 0.015</option>
          </select>
        </label>
      </div>

      <div className="freeze-list" aria-live="polite">
        {intervals.map((interval, index) => (
          <article className="freeze-row" key={interval.id}>
            <div className="freeze-index">{String(index + 1).padStart(2, '0')}</div>
            <div className="freeze-times">
              <strong>
                {formatPreciseTime(interval.startSec)} → {formatPreciseTime(interval.endSec)}
              </strong>
              <span>持续 {interval.durationSec.toFixed(3)} 秒</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
