import { useMemo, useRef, useState } from 'react';
import { FreezePanel } from './components/FreezePanel';
import { Timeline } from './components/Timeline';
import type { AnalysisStatus, DetectionOptions, FreezeInterval } from './types/freeze';
import type { MediaInfo, OpenVideoResult } from './types/media';
import { formatPreciseTime, formatTime } from './utils/time';

const DEFAULT_DETECTION_OPTIONS: DetectionOptions = {
  noise: 0.003,
  minDurationSec: 2,
};

const PREVIEW_LEAD_SEC = 0.5;
const PREVIEW_TAIL_SEC = 0.5;

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
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

  async function runDetection(
    selected: OpenVideoResult,
    probed: MediaInfo,
    options = detectionOptions,
  ) {
    if (!window.desktopApi) return;

    setAnalysisStatus('detecting');
    setActiveIntervalId(null);
    setPreviewEndSec(null);

    try {
      const detected = await window.desktopApi.detectFreezes(
        selected.path,
        probed.durationSec,
        options,
      );
      setIntervals(detected.map((interval) => ({ ...interval, selectedForRemoval: false })));
      setAnalysisStatus('ready');
    } catch (caught) {
      setIntervals([]);
      setAnalysisStatus('failed');
      setError(caught instanceof Error ? caught.message : '静止画面检测失败');
    }
  }

  async function handleOpenVideo() {
    if (!window.desktopApi) {
      setError('当前环境没有桌面 API。');
      setStatus('failed');
      return;
    }

    setStatus('opening');
    setError(null);

    try {
      const selected = await window.desktopApi.openVideo();
      if (!selected) {
        setStatus(media ? 'ready' : 'idle');
        return;
      }

      const probed = await window.desktopApi.probeMedia(selected.path);
      setSelection(selected);
      setMedia(probed);
      setCurrentTimeSec(0);
      setIntervals([]);
      setActiveIntervalId(null);
      setPreviewEndSec(null);
      setStatus('ready');

      await runDetection(selected, probed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '打开视频失败');
      setStatus('failed');
    }
  }

  async function handleRedetect() {
    if (!selection || !media) return;
    setError(null);
    await runDetection(selection, media, detectionOptions);
  }

  function handlePreview(interval: FreezeInterval) {
    const video = videoRef.current;
    if (!video || !media) return;

    const previewStart = Math.max(0, interval.startSec - PREVIEW_LEAD_SEC);
    const previewEnd = Math.min(media.durationSec, interval.endSec + PREVIEW_TAIL_SEC);

    setActiveIntervalId(interval.id);
    setPreviewEndSec(previewEnd);
    setCurrentTimeSec(previewStart);
    video.currentTime = previewStart;

    void video.play().catch(() => {
      setError('无法开始播放当前预览区间。');
    });
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
    setIntervals((current) =>
      current.map((interval) =>
        interval.id === intervalId
          ? { ...interval, selectedForRemoval: !interval.selectedForRemoval }
          : interval,
      ),
    );
  }

  function handleSelectAll(selected: boolean) {
    setIntervals((current) =>
      current.map((interval) => ({
        ...interval,
        selectedForRemoval: selected,
      })),
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">FFmpeg Visual Tool</p>
          <h1>静止画面剪切器</h1>
          {selection && <p className="file-name">{selection.name}</p>}
        </div>

        <button type="button" onClick={handleOpenVideo} disabled={status === 'opening'}>
          {status === 'opening' ? '正在打开…' : '打开视频'}
        </button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
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
                onLoadedMetadata={(event) => setCurrentTimeSec(event.currentTarget.currentTime)}
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
              <strong>打开一个本地 MP4</strong>
              <span>播放器将在这里显示视频。</span>
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
            disabled={!media}
            onOptionsChange={setDetectionOptions}
            onRedetect={handleRedetect}
            onPreview={handlePreview}
            onToggleRemoval={handleToggleRemoval}
            onSelectAll={handleSelectAll}
          />
        </aside>
      </section>
    </main>
  );
}
