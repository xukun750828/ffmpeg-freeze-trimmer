import { useEffect, useMemo, useRef, useState } from 'react';
import { FreezePanel } from './components/FreezePanel';
import { HoverPreviewProvider } from './components/HoverPreviewProvider';
import { Timeline } from './components/Timeline';
import type {
  AnalysisStatus,
  DetectionDirection,
  DetectionOptions,
  ExactFrameMatch,
  ExactMatchStatus,
  FreezeInterval,
  VisualChangeLevel,
} from './types/freeze';
import type { MediaInfo, OpenVideoResult } from './types/media';
import { getUserFriendlyError } from './utils/error-message';
import {
  measureTimeRangeUnion,
  mergeTimeRanges,
} from './utils/time-ranges';
import { formatPreciseTime, formatTime } from './utils/time';

const DEFAULT_DETECTION_OPTIONS: DetectionOptions = {
  noise: 0.003,
  minDurationSec: 2,
  hasBackgroundSound: true,
};

const PREVIEW_LEAD_SEC = 0.5;
const PREVIEW_TAIL_SEC = 0.5;
const SIMILARITY_RANGE_MATCH_EPSILON_SEC = 0.05;

function buildSimilarityIntervalId(match: ExactFrameMatch): string {
  return `similarity-${Math.round(match.startSec * 1000)}-${Math.round(
    match.endSec * 1000,
  )}`;
}

function buildManualIntervalId(startSec: number, endSec: number): string {
  return `manual-${Math.round(startSec * 1000)}-${Math.round(
    endSec * 1000,
  )}`;
}

function isSameSimilarityRange(
  interval: FreezeInterval,
  match: ExactFrameMatch,
): boolean {
  return (
    interval.source === 'similarity' &&
    Math.abs(interval.startSec - match.startSec) <=
      SIMILARITY_RANGE_MATCH_EPSILON_SEC &&
    Math.abs(interval.endSec - match.endSec) <=
      SIMILARITY_RANGE_MATCH_EPSILON_SEC
  );
}

type ExportUiStatus = 'idle' | 'exporting' | 'completed' | 'cancelled' | 'failed';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewSeekInProgressRef = useRef(false);
  const [selection, setSelection] = useState<OpenVideoResult | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState<'idle' | 'opening' | 'ready' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [intervals, setIntervals] = useState<FreezeInterval[]>([]);
  const [activeIntervalId, setActiveIntervalId] = useState<string | null>(null);
  const [previewEndSec, setPreviewEndSec] = useState<number | null>(null);
  const [detectionOptions, setDetectionOptions] = useState<DetectionOptions>(
    DEFAULT_DETECTION_OPTIONS,
  );
  const [detectionDirection, setDetectionDirection] =
    useState<DetectionDirection>('forward');
  const [maxDetectionIntervals, setMaxDetectionIntervals] = useState(5);
  const [exactMatchStatus, setExactMatchStatus] =
    useState<ExactMatchStatus>('idle');
  const [exactFrameMatch, setExactFrameMatch] =
    useState<ExactFrameMatch | null>(null);
  const [visualChangeLevel, setVisualChangeLevel] =
    useState<VisualChangeLevel>('standard');
  const [manualRangeStartSec, setManualRangeStartSec] = useState<number | null>(
    null,
  );

  const [exportStatus, setExportStatus] = useState<ExportUiStatus>('idle');
  const [exportProgress, setExportProgress] = useState(0);
  const [activeExportJobId, setActiveExportJobId] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  useEffect(() => {
    const api = window.desktopApi;
    if (!api) return;

    const stopProgress = api.onExportProgress((event) => {
      setExportProgress(event.progress);
    });

    const stopFinished = api.onExportFinished((event) => {
      setActiveExportJobId(null);
      setExportStatus(event.status);

      if (event.status === 'completed') {
        setExportProgress(1);
        setExportMessage(`导出完成：${event.outputPath ?? ''}`);
      } else if (event.status === 'cancelled') {
        setExportMessage('导出已取消。');
      } else {
        setExportMessage(null);
        setError(event.error ?? '导出失败');
      }
    });

    return () => {
      stopProgress();
      stopFinished();
    };
  }, []);

  useEffect(() => {
    const api = window.desktopApi;
    if (!api) return;

    return api.onMenuVideoSelected((selected) => {
      void handleSelectedVideo(selected);
    });
  }, [exportStatus, detectionOptions]);

  const mediaSummary = useMemo(() => {
    if (!media) return null;
    return `${media.width}×${media.height} · ${media.fps.toFixed(2)} fps · ${media.videoCodec.toUpperCase()}`;
  }, [media]);

  const selectedIntervals = useMemo(
    () => intervals.filter((interval) => interval.selectedForRemoval),
    [intervals],
  );

  const exactMatchRemovalInterval = useMemo(() => {
    if (!exactFrameMatch) return null;
    return (
      intervals.find((interval) =>
        isSameSimilarityRange(interval, exactFrameMatch),
      ) ?? null
    );
  }, [exactFrameMatch, intervals]);

  const exactMatchSelectedForRemoval =
    exactMatchRemovalInterval?.selectedForRemoval ?? false;

  const selectedDurationSec = useMemo(
    () => measureTimeRangeUnion(selectedIntervals),
    [selectedIntervals],
  );

  const estimatedOutputSec = media
    ? Math.max(0, media.durationSec - selectedDurationSec)
    : 0;

  async function runDetection() {
    if (
      !window.desktopApi ||
      !selection ||
      !media ||
      exportStatus === 'exporting' ||
      analysisStatus === 'detecting'
    ) {
      return;
    }

    const video = videoRef.current;
    const detectionStartSec = Math.max(
      0,
      Math.min(media.durationSec, video?.currentTime ?? currentTimeSec),
    );

    video?.pause();
    setCurrentTimeSec(detectionStartSec);
    setError(null);
    setAnalysisStatus('detecting');
    setIntervals((current) =>
      current.filter((interval) => interval.source !== 'detected'),
    );
    setActiveIntervalId(null);
    setPreviewEndSec(null);

    try {
      const detected = await window.desktopApi.detectFreezes({
        path: selection.path,
        durationSec: media.durationSec,
        currentTimeSec: detectionStartSec,
        direction: detectionDirection,
        maxIntervals: maxDetectionIntervals,
        hasAudio: media.hasAudio,
        options: detectionOptions,
      });
      setIntervals((current) => [
        ...current.filter((interval) => interval.source !== 'detected'),
        ...detected.map((interval) => ({
          ...interval,
          source: 'detected' as const,
          selectedForRemoval: false,
        })),
      ]);
      setAnalysisStatus('ready');
    } catch (caught) {
      setIntervals((current) =>
        current.filter((interval) => interval.source !== 'detected'),
      );
      setAnalysisStatus('failed');
      setError(getUserFriendlyError(caught, '静止画面检测失败'));
    }
  }

  async function handleSelectedVideo(selected: OpenVideoResult) {
    if (!window.desktopApi || exportStatus === 'exporting') return;

    setStatus('opening');
    setError(null);
    setExportMessage(null);

    try {
      const probed = await window.desktopApi.probeMedia(selected.path);
      setSelection(selected);
      setMedia(probed);
      setCurrentTimeSec(0);
      setIsPlaying(false);
      setIntervals([]);
      setActiveIntervalId(null);
      setPreviewEndSec(null);
      setExportStatus('idle');
      setExportProgress(0);
      setAnalysisStatus('idle');
      setExactMatchStatus('idle');
      setExactFrameMatch(null);
      setManualRangeStartSec(null);
      setStatus('ready');
    } catch (caught) {
      setError(getUserFriendlyError(caught, '打开视频失败'));
      setStatus('failed');
    }
  }

  async function handleOpenVideo() {
    if (!window.desktopApi || exportStatus === 'exporting') return;

    setStatus('opening');
    setError(null);
    setExportMessage(null);

    try {
      const selected = await window.desktopApi.openVideo();
      if (!selected) {
        setStatus(media ? 'ready' : 'idle');
        return;
      }

      await handleSelectedVideo(selected);
    } catch (caught) {
      setError(getUserFriendlyError(caught, '打开视频失败'));
      setStatus('failed');
    }
  }

  async function handleStartDetection() {
    await runDetection();
  }

  async function handleLocateExactFrameMatch() {
    if (
      !window.desktopApi ||
      !selection ||
      !media ||
      exportStatus === 'exporting' ||
      exactMatchStatus === 'locating'
    ) {
      return;
    }

    const video = videoRef.current;
    const anchorSec = Math.max(
      0,
      Math.min(media.durationSec, video?.currentTime ?? currentTimeSec),
    );

    video?.pause();
    setCurrentTimeSec(anchorSec);
    setError(null);
    setExactFrameMatch(null);
    setExactMatchStatus('locating');

    try {
      const match = await window.desktopApi.locateExactFrameMatch({
        path: selection.path,
        durationSec: media.durationSec,
        currentTimeSec: anchorSec,
        hasAudio: media.hasAudio,
        visualChangeLevel,
      });

      setExactFrameMatch(match);
      setExactMatchStatus('ready');
    } catch (caught) {
      setExactFrameMatch(null);
      setExactMatchStatus('failed');
      setError(getUserFriendlyError(caught, '当前画面精确定位失败'));
    }
  }

  function handlePreviewRange(
    startSec: number,
    endSec: number,
    activeId: string | null = null,
    leadSec: number = PREVIEW_LEAD_SEC,
  ) {
    const video = videoRef.current;
    if (!video || !media) return;

    const previewStart = Math.max(0, startSec - leadSec);
    const previewEnd = Math.min(media.durationSec, endSec + PREVIEW_TAIL_SEC);

    setError(null);
    setActiveIntervalId(activeId);
    setPreviewEndSec(previewEnd);
    setCurrentTimeSec(previewStart);

    previewSeekInProgressRef.current = true;
    video.currentTime = previewStart;

    const tryPlay = () => {
      void video.play().catch((caught) => {
        if (
          caught instanceof DOMException &&
          caught.name === 'AbortError' &&
          video.seeking
        ) {
          video.addEventListener(
            'seeked',
            () => {
              void video.play().catch(() => {
                setError('无法开始播放当前预览区间。');
              });
            },
            { once: true },
          );
          return;
        }

        setError('无法开始播放当前预览区间。');
      });
    };

    tryPlay();
  }

  function handlePreview(interval: FreezeInterval) {
    handlePreviewRange(interval.startSec, interval.endSec, interval.id, 0);
  }

  function handleVideoSeeking() {
    if (previewSeekInProgressRef.current) {
      return;
    }

    setPreviewEndSec(null);
    setActiveIntervalId(null);
    setExactFrameMatch(null);
    setExactMatchStatus('idle');
    setError((current) =>
      current === '无法开始播放当前预览区间。' ? null : current,
    );
  }

  function handleVideoSeeked(event: React.SyntheticEvent<HTMLVideoElement>) {
    previewSeekInProgressRef.current = false;
    setCurrentTimeSec(event.currentTarget.currentTime);
  }

  function handleVideoTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>) {
    const currentTime = event.currentTarget.currentTime;
    setCurrentTimeSec(currentTime);

    if (previewEndSec !== null && currentTime >= previewEndSec) {
      event.currentTarget.pause();
      setPreviewEndSec(null);
    }
  }

  function handleTogglePlayback() {
    const video = videoRef.current;
    if (!video || !media) return;

    setPreviewEndSec(null);
    if (video.paused) {
      void video.play().catch(() => {
        setError('无法开始播放当前视频。');
      });
    } else {
      video.pause();
    }
  }

  function handleSeek(timeSec: number) {
    const video = videoRef.current;
    if (!video || !media) return;

    const targetSec = Math.max(0, Math.min(media.durationSec, timeSec));
    setPreviewEndSec(null);
    setActiveIntervalId(null);
    setExactFrameMatch(null);
    setExactMatchStatus('idle');
    setCurrentTimeSec(targetSec);
    video.currentTime = targetSec;
  }

  function handleStepFrame(direction: -1 | 1) {
    const video = videoRef.current;
    if (!video || !media || media.fps <= 0) return;

    video.pause();
    setPreviewEndSec(null);

    const currentSec = Math.max(
      0,
      Math.min(media.durationSec, video.currentTime),
    );
    const currentFrame = Math.round(currentSec * media.fps);
    const maxFrame = Math.max(0, Math.floor(media.durationSec * media.fps));
    const targetFrame = Math.min(
      maxFrame,
      Math.max(0, currentFrame + direction),
    );
    const targetSec = Math.min(
      media.durationSec,
      targetFrame / media.fps,
    );

    setActiveIntervalId(null);
    setExactFrameMatch(null);
    setExactMatchStatus('idle');
    setCurrentTimeSec(targetSec);
    video.currentTime = targetSec;
  }

  function getCurrentPlaybackTimeSec(): number | null {
    if (!media) return null;

    const videoTime = videoRef.current?.currentTime;
    const value =
      videoTime !== undefined && Number.isFinite(videoTime)
        ? videoTime
        : currentTimeSec;

    return Math.max(0, Math.min(media.durationSec, value));
  }

  function handleSetManualRangeStart() {
    if (!media || exportStatus === 'exporting') return;

    const startSec = getCurrentPlaybackTimeSec();
    if (startSec === null) return;

    setManualRangeStartSec(startSec);
    setError(null);
    setActiveIntervalId(null);
  }

  function handleSetManualRangeEnd() {
    if (!media || exportStatus === 'exporting') return;

    const endSec = getCurrentPlaybackTimeSec();
    if (endSec === null) return;

    if (manualRangeStartSec === null) {
      setError('请先设置人工删除区间起点（I）。');
      return;
    }

    if (endSec <= manualRangeStartSec + 1e-6) {
      setError('人工删除区间终点必须晚于起点。');
      return;
    }

    const id = buildManualIntervalId(manualRangeStartSec, endSec);
    const interval: FreezeInterval = {
      id,
      startSec: manualRangeStartSec,
      endSec,
      durationSec: endSec - manualRangeStartSec,
      selectedForRemoval: true,
      source: 'manual',
    };

    setIntervals((current) => {
      const existingIndex = current.findIndex((item) => item.id === id);
      if (existingIndex < 0) return [...current, interval];

      return current.map((item, index) =>
        index === existingIndex
          ? { ...interval, selectedForRemoval: true }
          : item,
      );
    });
    setActiveIntervalId(id);
    setManualRangeStartSec(null);
    setError(null);
  }

  useEffect(() => {
    if (!media || exportStatus === 'exporting') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select') || target.isContentEditable)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'i') {
        event.preventDefault();
        handleSetManualRangeStart();
      } else if (key === 'o') {
        event.preventDefault();
        handleSetManualRangeEnd();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [media, exportStatus, manualRangeStartSec]);

  function handleToggleRemoval(intervalId: string) {
    if (exportStatus === 'exporting') return;

    setIntervals((current) =>
      current.map((interval) =>
        interval.id === intervalId
          ? { ...interval, selectedForRemoval: !interval.selectedForRemoval }
          : interval,
      ),
    );
  }

  function handleToggleExactMatchRemoval() {
    if (
      !exactFrameMatch ||
      exportStatus === 'exporting'
    ) {
      return;
    }

    setIntervals((current) => {
      const existing = current.find((interval) =>
        isSameSimilarityRange(interval, exactFrameMatch),
      );

      if (existing) {
        return current.map((interval) =>
          interval.id === existing.id
            ? {
                ...interval,
                selectedForRemoval: !interval.selectedForRemoval,
              }
            : interval,
        );
      }

      return [
        ...current,
        {
          id: buildSimilarityIntervalId(exactFrameMatch),
          startSec: exactFrameMatch.startSec,
          endSec: exactFrameMatch.endSec,
          durationSec: exactFrameMatch.durationSec,
          selectedForRemoval: true,
          source: 'similarity',
        },
      ];
    });
  }

  function handleSelectAll(selected: boolean) {
    if (exportStatus === 'exporting') return;

    setIntervals((current) =>
      current.map((interval) => ({
        ...interval,
        selectedForRemoval: selected,
      })),
    );
  }

  function handleDeleteSelectedIntervals() {
    if (exportStatus === 'exporting') return;

    const deletedIds = new Set(
      intervals
        .filter((interval) => interval.selectedForRemoval)
        .map((interval) => interval.id),
    );
    if (deletedIds.size === 0) return;

    setIntervals((current) =>
      current.filter((interval) => !deletedIds.has(interval.id)),
    );

    if (activeIntervalId && deletedIds.has(activeIntervalId)) {
      setActiveIntervalId(null);
      setPreviewEndSec(null);
    }
  }

  async function handleExport() {
    if (
      !window.desktopApi ||
      !selection ||
      !media ||
      selectedIntervals.length === 0 ||
      estimatedOutputSec <= 0 ||
      exportStatus === 'exporting'
    ) {
      return;
    }

    setError(null);
    setExportMessage(null);

    const defaultName = selection.name.replace(/\.mp4$/i, '') + '_trimmed.mp4';
    const outputPath = await window.desktopApi.chooseOutputPath(defaultName);
    if (!outputPath) return;

    try {
      setExportStatus('exporting');
      setExportProgress(0);

      const { jobId } = await window.desktopApi.startExport({
        inputPath: selection.path,
        outputPath,
        durationSec: media.durationSec,
        fps: media.fps,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        hasAudio: media.hasAudio,
        removeRanges: mergeTimeRanges(selectedIntervals),
      });

      setActiveExportJobId(jobId);
    } catch (caught) {
      setExportStatus('failed');
      setError(getUserFriendlyError(caught, '导出失败'));
    }
  }

  async function handleCancelExport() {
    if (!window.desktopApi || !activeExportJobId) return;
    await window.desktopApi.cancelExport(activeExportJobId);
  }

  const exportDisabled =
    !media ||
    !selection ||
    selectedIntervals.length === 0 ||
    estimatedOutputSec <= 0 ||
    exportStatus === 'exporting';

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">FFmpeg Visual Tool</p>
          <h1>静止画面剪切器</h1>
          {selection && <p className="file-name">{selection.name}</p>}
        </div>

        <div className="header-actions">
          <button
            type="button"
            onClick={handleOpenVideo}
            disabled={status === 'opening' || exportStatus === 'exporting'}
          >
            {status === 'opening' ? '正在导入…' : '导入本地 MP4'}
          </button>
          <button type="button" onClick={handleExport} disabled={exportDisabled}>
            {exportStatus === 'exporting'
              ? `导出中 ${Math.round(exportProgress * 100)}%`
              : '导出视频'}
          </button>
          {exportStatus === 'exporting' && (
            <button type="button" className="secondary-button" onClick={handleCancelExport}>
              取消导出
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {exportMessage && (
        <div className="success-banner" role="status">
          {exportMessage}
        </div>
      )}

      {exportStatus === 'exporting' && (
        <div className="export-progress" aria-label="导出进度">
          <div style={{ width: `${Math.round(exportProgress * 100)}%` }} />
        </div>
      )}

      <section className="workspace" aria-label="视频审核工作区">
        <div className="player-panel">
          {selection && media ? (
            <HoverPreviewProvider
              durationSec={media.durationSec}
              previewSourceUrl={selection.sourceUrl}
            >
              <div className="video-stage">
                <video
                  ref={videoRef}
                  className="video-player"
                  src={selection.sourceUrl}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onSeeking={handleVideoSeeking}
                  onSeeked={handleVideoSeeked}
                  onLoadedMetadata={(event) =>
                    setCurrentTimeSec(event.currentTarget.currentTime)
                  }
                  onPlay={() => {
                    setIsPlaying(true);
                    setError((current) =>
                      current === '无法开始播放当前预览区间。' ||
                      current === '无法开始播放当前视频。'
                        ? null
                        : current,
                    );
                  }}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onDoubleClick={handleTogglePlayback}
                />
              </div>

              <div
                className="manual-range-toolbar"
                aria-label="播放器控制与人工指定删除区间"
              >
                <div className="manual-range-actions playback-actions">
                  <button
                    type="button"
                    aria-label={isPlaying ? '暂停视频' : '播放视频'}
                    onClick={handleTogglePlayback}
                    disabled={exportStatus === 'exporting'}
                  >
                    {isPlaying ? '❚❚ 暂停' : '▶ 播放'}
                  </button>
                  <button
                    type="button"
                    aria-label="向左移动一帧"
                    onClick={() => handleStepFrame(-1)}
                    disabled={exportStatus === 'exporting'}
                    title="向前一帧"
                  >
                    ◀ 1帧
                  </button>
                  <button
                    type="button"
                    aria-label="向右移动一帧"
                    onClick={() => handleStepFrame(1)}
                    disabled={exportStatus === 'exporting'}
                    title="向后一帧"
                  >
                    1帧 ▶
                  </button>
                  <span className="control-divider" aria-hidden="true" />
                  <button
                    type="button"
                    aria-label="设置人工删除区间起点"
                    onClick={handleSetManualRangeStart}
                    disabled={exportStatus === 'exporting'}
                    title="快捷键 I"
                  >
                    设置起点 <kbd>I</kbd>
                  </button>
                  <button
                    type="button"
                    aria-label="设置人工删除区间终点"
                    onClick={handleSetManualRangeEnd}
                    disabled={exportStatus === 'exporting'}
                    title="快捷键 O"
                  >
                    设置终点 <kbd>O</kbd>
                  </button>
                </div>
                <div className="manual-range-status" aria-live="polite">
                  <span>
                    {formatPreciseTime(currentTimeSec)} / {formatPreciseTime(media.durationSec)}
                  </span>
                  {manualRangeStartSec === null ? (
                    <span>{mediaSummary}</span>
                  ) : (
                    <span>
                      起点：<strong>{formatPreciseTime(manualRangeStartSec)}</strong> · 按 O 设置终点
                    </span>
                  )}
                </div>
              </div>

              <Timeline
                durationSec={media.durationSec}
                currentTimeSec={currentTimeSec}
                intervals={intervals}
                activeIntervalId={activeIntervalId}
                onSeek={handleSeek}
              />

              <div className="selection-summary" aria-label="删除统计">
                <span>已选 {selectedIntervals.length} 段</span>
                <span>删除 {formatPreciseTime(selectedDurationSec)}</span>
                <span>输出约 {formatPreciseTime(estimatedOutputSec)}</span>
              </div>
            </HoverPreviewProvider>
          ) : (
            <div className="player-placeholder">
              <strong>导入一个本地 MP4</strong>
              <span>也可以使用“文件 → 导入本地 MP4…”或 Ctrl+O。</span>
            </div>
          )}
        </div>

        <aside className="side-panel">
          <section className="media-section">
            <h2>媒体信息</h2>
            {media ? (
              <dl className="media-info">
                <div><dt>时长</dt><dd>{formatTime(media.durationSec)}</dd></div>
                <div><dt>分辨率</dt><dd>{media.width} × {media.height}</dd></div>
                <div><dt>帧率</dt><dd>{media.fps.toFixed(2)} fps</dd></div>
                <div><dt>视频编码</dt><dd>{media.videoCodec}</dd></div>
                <div><dt>音频</dt><dd>{media.hasAudio ? media.audioCodec ?? 'unknown' : '无音轨'}</dd></div>
              </dl>
            ) : (
              <p>打开视频后，这里会显示 ffprobe 读取到的媒体信息。</p>
            )}
          </section>

          <FreezePanel
            status={analysisStatus}
            intervals={intervals}
            activeIntervalId={activeIntervalId}
            options={detectionOptions}
            currentTimeSec={currentTimeSec}
            direction={detectionDirection}
            maxIntervals={maxDetectionIntervals}
            exactMatchStatus={exactMatchStatus}
            exactFrameMatch={exactFrameMatch}
            exactMatchSelectedForRemoval={exactMatchSelectedForRemoval}
            visualChangeLevel={visualChangeLevel}
            disabled={!media || exportStatus === 'exporting'}
            selectionDisabled={exportStatus === 'exporting'}
            onOptionsChange={setDetectionOptions}
            onDirectionChange={setDetectionDirection}
            onMaxIntervalsChange={setMaxDetectionIntervals}
            onStartDetection={handleStartDetection}
            onLocateExactFrameMatch={handleLocateExactFrameMatch}
            onToggleExactMatchRemoval={handleToggleExactMatchRemoval}
            onVisualChangeLevelChange={(level) => {
              setVisualChangeLevel(level);
              setExactFrameMatch(null);
              setExactMatchStatus('idle');
            }}
            onPreviewRange={(startSec, endSec) =>
              handlePreviewRange(startSec, endSec)
            }
            onPreview={handlePreview}
            onToggleRemoval={handleToggleRemoval}
            onSelectAll={handleSelectAll}
            onDeleteSelected={handleDeleteSelectedIntervals}
          />
        </aside>
      </section>
    </main>
  );
}
