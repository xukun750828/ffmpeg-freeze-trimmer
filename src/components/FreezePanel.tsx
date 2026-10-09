import type {
  AnalysisStatus,
  DetectionDirection,
  DetectionOptions,
  ExactFrameMatch,
  ExactMatchStatus,
  FreezeInterval,
  FreezeIntervalSource,
  IntervalFilterState,
  SearchRun,
  VisualChangeLevel,
} from '../types/freeze';
import { formatPreciseTime } from '../utils/time';

interface FreezePanelProps {
  status: AnalysisStatus;
  intervals: FreezeInterval[];
  totalIntervalCount: number;
  sourceCounts: Record<FreezeIntervalSource, number>;
  searchRuns: SearchRun[];
  filters: IntervalFilterState;
  lastDetectionCount: number;
  activeIntervalId: string | null;
  options: DetectionOptions;
  currentTimeSec: number;
  direction: DetectionDirection;
  maxIntervals: number;
  exactMatchStatus: ExactMatchStatus;
  exactFrameMatch: ExactFrameMatch | null;
  exactMatchSelectedForRemoval: boolean;
  visualChangeLevel: VisualChangeLevel;
  disabled: boolean;
  selectionDisabled: boolean;
  onOptionsChange: (options: DetectionOptions) => void;
  onDirectionChange: (direction: DetectionDirection) => void;
  onMaxIntervalsChange: (count: number) => void;
  onStartDetection: () => void;
  onLocateExactFrameMatch: () => void;
  onToggleExactMatchRemoval: () => void;
  onVisualChangeLevelChange: (level: VisualChangeLevel) => void;
  onPreviewRange: (startSec: number, endSec: number) => void;
  onPreview: (interval: FreezeInterval) => void;
  onToggleRemoval: (intervalId: string) => void;
  onSelectAll: (selected: boolean) => void;
  onDeleteSelected: () => void;
  onClearVisibleRemoval: () => void;
  onDeleteInterval: (intervalId: string) => void;
  onFiltersChange: (filters: IntervalFilterState) => void;
  onResetFilters: () => void;
}

export function FreezePanel({
  status,
  intervals,
  totalIntervalCount,
  sourceCounts,
  searchRuns,
  filters,
  lastDetectionCount,
  activeIntervalId,
  options,
  currentTimeSec,
  direction,
  maxIntervals,
  exactMatchStatus,
  exactFrameMatch,
  exactMatchSelectedForRemoval,
  visualChangeLevel,
  disabled,
  selectionDisabled,
  onOptionsChange,
  onDirectionChange,
  onMaxIntervalsChange,
  onStartDetection,
  onLocateExactFrameMatch,
  onToggleExactMatchRemoval,
  onVisualChangeLevelChange,
  onPreviewRange,
  onPreview,
  onToggleRemoval,
  onSelectAll,
  onDeleteSelected,
  onClearVisibleRemoval,
  onDeleteInterval,
  onFiltersChange,
  onResetFilters,
}: FreezePanelProps) {
  const selectedCount = intervals.filter(
    (interval) => interval.selectedForRemoval,
  ).length;
  const allSelected =
    intervals.length > 0 && selectedCount === intervals.length;
  const summary =
    status === 'detecting'
      ? '正在从当前时间点检测…'
      : status === 'ready'
        ? lastDetectionCount > 0
          ? `本次发现 ${lastDetectionCount} 个静止区间，已追加到历史结果`
          : '本次查找未发现满足条件的静止区间'
        : status === 'failed'
          ? '检测失败'
          : '设置参数后点击“启动检测”';

  const exactSummary =
    exactMatchStatus === 'locating'
      ? '正在向当前时间点左右两侧精确定位…'
      : exactMatchStatus === 'ready'
        ? exactFrameMatch
          ? `当前画面相似区间持续 ${exactFrameMatch.durationSec.toFixed(3)} 秒`
          : '当前帧左右没有连续满足当前变化等级的画面'
        : exactMatchStatus === 'failed'
          ? '精确定位失败'
          : '以当前帧为锚点，按允许画面变化等级定位左右两侧连续相似区间';

  return (
    <section className="freeze-panel" aria-label="静止区间">
      <section className="exact-match-panel" aria-label="当前画面精确定位">
        <div className="panel-heading-row">
          <div>
            <h2>当前画面相似定位</h2>
            <p className="panel-summary">{exactSummary}</p>
          </div>
          <button
            type="button"
            onClick={onLocateExactFrameMatch}
            disabled={
              disabled ||
              exactMatchStatus === 'locating' ||
              status === 'detecting'
            }
          >
            {exactMatchStatus === 'locating' ? '定位中…' : '定位当前画面'}
          </button>
        </div>

        <p className="detection-note exact-anchor-note">
          当前锚点：{formatPreciseTime(currentTimeSec)}。以下等级表示标准化灰度画面相对当前帧允许的平均像素差。
        </p>

        <label className="exact-change-level">
          <span>允许画面变化等级</span>
          <select
            aria-label="当前画面允许变化等级"
            value={visualChangeLevel}
            disabled={disabled || exactMatchStatus === 'locating'}
            onChange={(event) =>
              onVisualChangeLevelChange(
                event.target.value as VisualChangeLevel,
              )
            }
          >
            <option value="exact">严格 · 0%</option>
            <option value="very-low">极低 · 0.005%</option>
            <option value="low">低 · 0.02%</option>
            <option value="standard">标准 · 0.05%</option>
            <option value="relaxed">宽松 · 0.08%</option>
            <option value="very-relaxed">很宽松 · 0.10%</option>
          </select>
        </label>

        {exactFrameMatch && (
          <div className="exact-match-result">
            <div
              className={`exact-parent-range-card${exactMatchSelectedForRemoval ? ' selected' : ''}`}
            >
              <button
                type="button"
                className="exact-parent-range"
                aria-label="预览当前画面相似区间"
                onClick={() =>
                  onPreviewRange(
                    exactFrameMatch.startSec,
                    exactFrameMatch.endSec,
                  )
                }
              >
                <span>
                  <strong>父区间 · 当前画面相似</strong>
                  <small>
                    {formatPreciseTime(exactFrameMatch.startSec)} →{' '}
                    {formatPreciseTime(exactFrameMatch.endSec)}
                  </small>
                </span>
                <span>{exactFrameMatch.durationSec.toFixed(3)} 秒</span>
              </button>
              <button
                type="button"
                className={`exact-removal-button${exactMatchSelectedForRemoval ? ' selected' : ''}`}
                aria-label={
                  exactMatchSelectedForRemoval
                    ? '取消删除当前相似区间'
                    : '加入当前相似区间待删除'
                }
                disabled={selectionDisabled}
                onClick={onToggleExactMatchRemoval}
              >
                {exactMatchSelectedForRemoval
                  ? '取消删除'
                  : '加入待删除'}
              </button>
            </div>

            <p className="audio-classification-note">
              音频子区间按音频能量区分“有 / 无背景声音”，不区分对白、音乐或环境声来源。
            </p>
            <div className="audio-subintervals">
              {exactFrameMatch.audioSubIntervals.map((segment, index) => (
                <button
                  type="button"
                  className={`audio-subinterval ${segment.audioPresence}`}
                  key={segment.id}
                  aria-label={`预览音频子区间 ${index + 1}`}
                  onClick={() =>
                    onPreviewRange(segment.startSec, segment.endSec)
                  }
                >
                  <span
                    className={`audio-badge ${segment.audioPresence}`}
                  >
                    {segment.audioPresence === 'silence'
                      ? '无背景声音'
                      : '有背景声音'}
                  </span>
                  <span className="audio-subinterval-times">
                    {formatPreciseTime(segment.startSec)} →{' '}
                    {formatPreciseTime(segment.endSec)}
                  </span>
                  <span>{segment.durationSec.toFixed(3)} 秒</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="freeze-section-divider" />

      <div className="panel-heading-row">
        <div>
          <h2>方向查找静止区间</h2>
          <p className="panel-summary">{summary}</p>
        </div>
        <button
          type="button"
          onClick={onStartDetection}
          disabled={
            disabled ||
            status === 'detecting' ||
            exactMatchStatus === 'locating'
          }
        >
          {status === 'detecting' ? '检测中…' : '启动检测'}
        </button>
      </div>

      <div className="detection-controls">
        <p className="detection-note">
          从播放器当前时间 {formatPreciseTime(currentTimeSec)} 开始，按指定方向查找静止区间；找到指定数量后自动停止。
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

        <label className="detection-checkbox">
          <input
            aria-label="有背景声音"
            type="checkbox"
            checked={options.hasBackgroundSound}
            disabled={disabled || status === 'detecting'}
            onChange={(event) =>
              onOptionsChange({
                ...options,
                hasBackgroundSound: event.target.checked,
              })
            }
          />
          <span>有背景声音</span>
        </label>

        <label>
          <span>检测方向</span>
          <select
            aria-label="检测方向"
            value={direction}
            disabled={disabled || status === 'detecting'}
            onChange={(event) =>
              onDirectionChange(event.target.value as DetectionDirection)
            }
          >
            <option value="forward">从当前时间向后检测</option>
            <option value="backward">从当前时间向前检测</option>
          </select>
        </label>

        <label>
          <span>检测几个静止区间</span>
          <select
            aria-label="检测静止区间数量"
            value={maxIntervals}
            disabled={disabled || status === 'detecting'}
            onChange={(event) => onMaxIntervalsChange(Number(event.target.value))}
          >
            <option value={1}>1 个</option>
            <option value={3}>3 个</option>
            <option value={5}>5 个</option>
            <option value={10}>10 个</option>
            <option value={20}>20 个</option>
          </select>
        </label>

        {!options.hasBackgroundSound && (
          <p className="detection-note">
            “无背景声音”模式：有音轨时只返回“画面静止 ∩ 音频静音”的连续重叠区间；无音轨视频只按画面检测。
          </p>
        )}
      </div>

      <div className="freeze-section-divider" />

      <section className="interval-management-panel" aria-label="区间管理与筛选">
        <div className="candidate-list-heading interval-management-heading">
          <div>
            <h3>区间管理</h3>
            <span>
              多次查找结果持续保留；筛选同时作用于列表、时间轴和批量操作
            </span>
          </div>
          <button
            type="button"
            className="filter-reset-button"
            onClick={onResetFilters}
            disabled={selectionDisabled}
          >
            重置筛选
          </button>
        </div>

        <div className="source-filter-tabs" role="tablist" aria-label="区间来源筛选">
          {([
            ['all', '全部区间', totalIntervalCount],
            ['detected', '方向检测', sourceCounts.detected],
            ['similarity', '相似定位', sourceCounts.similarity],
            ['manual', '人工指定', sourceCounts.manual],
          ] as const).map(([source, label, count]) => (
            <button
              key={source}
              type="button"
              role="tab"
              aria-selected={filters.source === source}
              className={filters.source === source ? 'active' : ''}
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  source,
                  runId: 'all',
                })
              }
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </div>

        <div className="interval-filter-grid">
          <label>
            <span>查找批次</span>
            <select
              aria-label="查找批次"
              value={filters.runId}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  runId: event.target.value,
                })
              }
            >
              <option value="all">全部批次</option>
              {searchRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.label} · {formatPreciseTime(run.anchorSec ?? 0)} ·{' '}
                  {run.source === 'detected'
                    ? run.direction === 'backward'
                      ? '向前'
                      : '向后'
                    : '当前帧'} ·{' '}
                  {run.resultCount} 段
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>最小时长</span>
            <div className="inline-input compact-filter-input">
              <input
                aria-label="筛选最小时长"
                type="number"
                min="0"
                step="0.5"
                value={filters.minDurationSec}
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    minDurationSec: Math.max(0, Number(event.target.value) || 0),
                  })
                }
              />
              <span>秒</span>
            </div>
          </label>

          <label>
            <span>最大时长</span>
            <div className="inline-input compact-filter-input">
              <input
                aria-label="筛选最大时长"
                type="number"
                min="0"
                step="0.5"
                placeholder="不限"
                value={filters.maxDurationSec ?? ''}
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    maxDurationSec:
                      event.target.value === ''
                        ? null
                        : Math.max(0, Number(event.target.value)),
                  })
                }
              />
              <span>秒</span>
            </div>
          </label>

          <label>
            <span>检测音频条件</span>
            <select
              aria-label="筛选检测音频条件"
              value={filters.audio}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  audio: event.target.value as IntervalFilterState['audio'],
                })
              }
            >
              <option value="all">全部</option>
              <option value="visual-only">允许背景声音</option>
              <option value="silence-required">要求无背景声音</option>
            </select>
          </label>

          <label>
            <span>时间范围起点</span>
            <div className="inline-input compact-filter-input">
              <input
                aria-label="筛选时间范围起点"
                type="number"
                min="0"
                step="1"
                value={filters.timeStartSec}
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    timeStartSec: Math.max(0, Number(event.target.value) || 0),
                  })
                }
              />
              <span>秒</span>
            </div>
          </label>

          <label>
            <span>时间范围终点</span>
            <div className="inline-input compact-filter-input">
              <input
                aria-label="筛选时间范围终点"
                type="number"
                min="0"
                step="1"
                placeholder="视频结尾"
                value={filters.timeEndSec ?? ''}
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    timeEndSec:
                      event.target.value === ''
                        ? null
                        : Math.max(0, Number(event.target.value)),
                  })
                }
              />
              <span>秒</span>
            </div>
          </label>

          <label className="filter-checkbox">
            <input
              aria-label="仅显示已勾选区间"
              type="checkbox"
              checked={filters.selectedOnly}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  selectedOnly: event.target.checked,
                })
              }
            />
            <span>仅显示已勾选</span>
          </label>
        </div>

        <div className="search-history-summary">
          <span>累计查找 {searchRuns.length} 次</span>
          <span>当前显示 {intervals.length} / {totalIntervalCount} 段</span>
        </div>

        <div className="selection-toolbar batch-toolbar">
          <label>
            <input
              aria-label="全选静止区间"
              type="checkbox"
              checked={allSelected}
              disabled={selectionDisabled || intervals.length === 0}
              onChange={(event) => onSelectAll(event.target.checked)}
            />
            <span>全选当前结果</span>
          </label>
          <button
            type="button"
            className="candidate-delete-button"
            onClick={onDeleteSelected}
            disabled={selectionDisabled || selectedCount === 0}
            title="只从当前筛选结果中移除已勾选区间，不会立即修改源视频"
          >
            删除所选区间
          </button>
          <button
            type="button"
            className="candidate-keep-button"
            onClick={onClearVisibleRemoval}
            disabled={selectionDisabled || selectedCount === 0}
          >
            设为不删除
          </button>
          <span>已选择 {selectedCount} / {intervals.length}</span>
        </div>

        <div className="freeze-list" aria-live="polite">
          {intervals.length === 0 ? (
            <div className="candidate-empty-state">
              当前筛选条件下没有区间。
            </div>
          ) : (
            intervals.map((interval, index) => {
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
                      <span className="candidate-source-row">
                        <span
                          className={`candidate-source-badge ${interval.source ?? 'detected'}`}
                        >
                          {interval.source === 'similarity'
                            ? '相似定位'
                            : interval.source === 'manual'
                              ? '人工指定'
                              : '方向检测'}
                        </span>
                        <strong>
                          {formatPreciseTime(interval.startSec)} →{' '}
                          {formatPreciseTime(interval.endSec)}
                        </strong>
                      </span>
                      <span className="candidate-meta-row">
                        <span>持续 {interval.durationSec.toFixed(3)} 秒</span>
                        {interval.searchRunLabel && (
                          <small>
                            {interval.searchRunLabel}
                            {interval.searchAnchorSec !== undefined
                              ? ` · 锚点 ${formatPreciseTime(interval.searchAnchorSec)}`
                              : ''}
                          </small>
                        )}
                      </span>
                    </span>
                    <span className="preview-label">▶</span>
                  </button>
                  <button
                    type="button"
                    className="freeze-row-delete"
                    aria-label={`删除候选区间 ${index + 1}`}
                    title="从候选列表移除此区间"
                    disabled={selectionDisabled}
                    onClick={() => onDeleteInterval(interval.id)}
                  >
                    ×
                  </button>
                </article>
              );
            })
          )}
        </div>
      </section>
    </section>
  );
}
