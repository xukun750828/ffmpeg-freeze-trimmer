import { useEffect, useMemo, useRef, useState } from 'react';
import { FreezePanel } from './components/FreezePanel';
import { Timeline } from './components/Timeline';
import type {
  AnalysisStatus,
  DetectionDirection,
  DetectionOptions,
  ExactFrameMatch,
  ExactMatchStatus,
  FreezeInterval,
} from './types/freeze';
import type { MediaInfo, OpenVideoResult } from './types/media';
import { getUserFriendlyError } from './utils/error-message';
import { formatPreciseTime, formatTime } from './utils/time';

const DEFAULT_DETECTION_OPTIONS: DetectionOptions = {
  noise: 0.003,
  minDurationSec: 2,
  hasBackgroundSound: true,
};

const PREVIEW_LEAD_SEC = 0.5;
const PREVIEW_TAIL_SEC = 0.5;

type ExportUiStatus = 'idle' | 'exporting' | 'completed' | 'cancelled' | 'failed';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewSeekInProgressRef = useRef(false);
  const [selection, setSelection] = useState<OpenVideoResult | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
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

  const selectedDurationSec = useMemo(
    () => selectedIntervals.reduce((sum, interval) => sum + interval.durationSec, 0),
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
    setIntervals([]);
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
      setIntervals(
        detected.map((interval) => ({
          ...interval,
          selectedForRemoval: false,
        })),
      );
      setAnalysisStatus('ready');
    } catch (caught) {
      setIntervals([]);
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
      setIntervals([]);
      setActiveIntervalId(null);
      setPreviewEndSec(null);
      setExportStatus('idle');
      setExportProgress(0);
      setAnalysisStatus('idle');
      setExactMatchStatus('idle');
      setExactFrameMatch(null);
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
  ) {
    const video = videoRef.current;
    if (!video || !media) return;

    const previewStart = Math.max(0, startSec - PREVIEW_LEAD_SEC);
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
    handlePreviewRange(interval.startSec, interval.endSec, interval.id);
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

  function handleSelectAll(selected: boolean) {
    if (exportStatus === 'exporting') return;

    setIntervals((current) =>
      current.map((interval) => ({
        ...interval,
        selectedForRemoval: selected,
      })),
    );
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
        hasAudio: media.hasAudio,
        removeRanges: selectedIntervals.map((interval) => ({
          startSec: interval.startSec,
          endSec: interval.endSec,
        })),
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
            <>
              <video
                ref={videoRef}
                className="video-player"
                src={selection.sourceUrl}
                controls
                onTimeUpdate={handleVideoTimeUpdate}
                onSeeking={handleVideoSeeking}
                onSeeked={handleVideoSeeked}
                onLoadedMetadata={(event) => setCurrentTimeSec(event.currentTarget.currentTime)}
                onPlay={() =>
                  setError((current) =>
                    current === '无法开始播放当前预览区间。' ? null : current,
                  )
                }
              />
              <div className="player-status">
                <span>{formatTime(currentTimeSec)} / {formatTime(media.durationSec)}</span>
                <span>{mediaSummary}</span>
              </div>

              <Timeline
                durationSec={media.durationSec}
                currentTimeSec={currentTimeSec}
                intervals={intervals}
                activeIntervalId={activeIntervalId}
                onPreview={handlePreview}
              />

              <div className="selection-summary" aria-label="删除统计">
                <span>已选 {selectedIntervals.length} 段</span>
                <span>删除 {formatPreciseTime(selectedDurationSec)}</span>
                <span>输出约 {formatPreciseTime(estimatedOutputSec)}</span>
              </div>
            </>
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
            disabled={!media || exportStatus === 'exporting'}
            selectionDisabled={exportStatus === 'exporting'}
            onOptionsChange={setDetectionOptions}
            onDirectionChange={setDetectionDirection}
            onMaxIntervalsChange={setMaxDetectionIntervals}
            onStartDetection={handleStartDetection}
            onLocateExactFrameMatch={handleLocateExactFrameMatch}
            onPreviewRange={(startSec, endSec) =>
              handlePreviewRange(startSec, endSec)
            }
            onPreview={handlePreview}
            onToggleRemoval={handleToggleRemoval}
            onSelectAll={handleSelectAll}
          />
        </aside>
      </section>
    </main>
  );
}
