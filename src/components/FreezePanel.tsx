import type { AnalysisStatus, DetectionOptions, FreezeInterval } from '../types/freeze';
import { formatPreciseTime } from '../utils/time';

interface FreezePanelProps {
  status: AnalysisStatus;
  intervals: FreezeInterval[];
  activeIntervalId: string | null;
  options: DetectionOptions;
  disabled: boolean;
  selectionDisabled: boolean;
  onOptionsChange: (options: DetectionOptions) => void;
  onRedetect: () => void;
  onPreview: (interval: FreezeInterval) => void;
  onToggleRemoval: (intervalId: string) => void;
  onSelectAll: (selected: boolean) => void;
}

export function FreezePanel({
  status,
  intervals,
  activeIntervalId,
  options,
  disabled,
  selectionDisabled,
  onOptionsChange,
  onRedetect,
  onPreview,
  onToggleRemoval,
  onSelectAll,
}: FreezePanelProps) {
  const selectedCount = intervals.filter((interval) => interval.selectedForRemoval).length;
  const allSelected = intervals.length > 0 && selectedCount === intervals.length;
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
        <p className="detection-note">
          30 秒以上视频会自动使用“快速粗扫 + 原分辨率边界精修”，长视频无需完整逐帧扫描。
        </p>
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

      {intervals.length > 0 && (
        <div className="selection-toolbar">
          <label>
            <input
              aria-label="全选静止区间"
              type="checkbox"
              checked={allSelected}
              disabled={selectionDisabled}
              onChange={(event) => onSelectAll(event.target.checked)}
            />
            <span>全选</span>
          </label>
          <span>已选择 {selectedCount} / {intervals.length}</span>
        </div>
      )}

      <div className="freeze-list" aria-live="polite">
        {intervals.map((interval, index) => {
          const active = interval.id === activeIntervalId;
          return (
            <article
              className={`freeze-row${active ? ' active' : ''}${interval.selectedForRemoval ? ' selected' : ''}`}
              key={interval.id}
              data-active={active ? 'true' : 'false'}
            >
              <label className="freeze-check">
                <input
                  aria-label={`选择删除静止区间 ${index + 1}`}
                  type="checkbox"
                  checked={interval.selectedForRemoval}
                  disabled={selectionDisabled}
                  onChange={() => onToggleRemoval(interval.id)}
                />
              </label>
              <button
                className="freeze-preview-button"
                type="button"
                aria-label={`预览静止区间 ${index + 1}`}
                onClick={() => onPreview(interval)}
              >
                <span className="freeze-times">
                  <strong>
                    {formatPreciseTime(interval.startSec)} → {formatPreciseTime(interval.endSec)}
                  </strong>
                  <span>持续 {interval.durationSec.toFixed(3)} 秒</span>
                </span>
                <span className="preview-label">▶</span>
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
