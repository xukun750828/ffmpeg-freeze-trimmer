import { useMemo, useRef, useState } from 'react';
import type { MediaInfo, OpenVideoResult } from './types/media';

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }

  const wholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
  }

  return [minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selection, setSelection] = useState<OpenVideoResult | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [status, setStatus] = useState<'idle' | 'opening' | 'ready' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  const mediaSummary = useMemo(() => {
    if (!media) return null;
    return `${media.width}×${media.height} · ${media.fps.toFixed(2)} fps · ${media.videoCodec.toUpperCase()}`;
  }, [media]);

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
      setStatus('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '打开视频失败');
      setStatus('failed');
    }
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
                onTimeUpdate={(event) => setCurrentTimeSec(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setCurrentTimeSec(event.currentTarget.currentTime)}
              />
              <div className="player-status">
                <span>{formatTime(currentTimeSec)} / {formatTime(media.durationSec)}</span>
                <span>{mediaSummary}</span>
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
          <h2>媒体信息</h2>
          {media ? (
            <dl className="media-info">
              <div>
                <dt>时长</dt>
                <dd>{formatTime(media.durationSec)}</dd>
              </div>
              <div>
                <dt>分辨率</dt>
                <dd>{media.width} × {media.height}</dd>
              </div>
              <div>
                <dt>帧率</dt>
                <dd>{media.fps.toFixed(2)} fps</dd>
              </div>
              <div>
                <dt>视频编码</dt>
                <dd>{media.videoCodec}</dd>
              </div>
              <div>
                <dt>音频</dt>
                <dd>{media.hasAudio ? media.audioCodec ?? 'unknown' : '无音轨'}</dd>
              </div>
            </dl>
          ) : (
            <p>打开视频后，这里会显示 ffprobe 读取到的媒体信息。</p>
          )}

          <div className="next-step">
            <h2>静止区间</h2>
            <p>Iteration B 将在这里加入 FFmpeg 静止画面检测结果。</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
