import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { formatPreciseTime } from '../utils/time';

const PREVIEW_WIDTH_PX = 224;
const PREVIEW_HEIGHT_PX = 126;
const PREVIEW_CARD_HEIGHT_PX = 158;
const SEEK_THROTTLE_MS = 45;
const FINAL_SETTLE_MS = 110;
const SEEK_EPSILON_SEC = 0.03;

interface HoverPreviewRequest {
  timeSec: number;
  clientX: number;
  boundsLeft: number;
  boundsRight: number;
  anchorY: number;
}

interface HoverPreviewContextValue {
  requestPreview: (request: HoverPreviewRequest) => void;
  hidePreview: () => void;
}

interface HoverPreviewProviderProps {
  durationSec: number;
  previewSourceUrl: string;
  children: ReactNode;
}

const HoverPreviewContext =
  createContext<HoverPreviewContextValue | null>(null);

export function useHoverPreview(): HoverPreviewContextValue {
  const value = useContext(HoverPreviewContext);
  if (!value) {
    throw new Error(
      'useHoverPreview must be used within HoverPreviewProvider',
    );
  }
  return value;
}

export function HoverPreviewProvider({
  durationSec,
  previewSourceUrl,
  children,
}: HoverPreviewProviderProps) {
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const metadataReadyRef = useRef(false);
  const desiredTargetRef = useRef<number | null>(null);
  const activeSeekTargetRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const lastIssuedAtRef = useRef(0);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const finalSettleTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);

  const [visible, setVisible] = useState(false);
  const [hoverTimeSec, setHoverTimeSec] = useState(0);
  const [leftPx, setLeftPx] = useState(PREVIEW_WIDTH_PX / 2);
  const [topPx, setTopPx] = useState(8);

  function clearThrottleTimer() {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
  }

  function clearFinalSettleTimer() {
    if (finalSettleTimerRef.current) {
      clearTimeout(finalSettleTimerRef.current);
      finalSettleTimerRef.current = null;
    }
  }

  function clampTarget(timeSec: number) {
    return Math.max(0, Math.min(durationSec, timeSec));
  }

  function issueSeek(target: number) {
    const video = previewVideoRef.current;
    if (!video || !metadataReadyRef.current || seekingRef.current) {
      return false;
    }

    const nextTarget = clampTarget(target);

    if (Math.abs(video.currentTime - nextTarget) < SEEK_EPSILON_SEC) {
      activeSeekTargetRef.current = nextTarget;
      return true;
    }

    clearThrottleTimer();
    activeSeekTargetRef.current = nextTarget;
    seekingRef.current = true;
    lastIssuedAtRef.current = performance.now();
    video.currentTime = nextTarget;
    return true;
  }

  function pumpLatestTarget(forceImmediate = false) {
    const target = desiredTargetRef.current;
    if (target === null || seekingRef.current) {
      return;
    }

    const elapsed = performance.now() - lastIssuedAtRef.current;
    const delay = forceImmediate
      ? 0
      : Math.max(0, SEEK_THROTTLE_MS - elapsed);

    if (delay <= 0) {
      issueSeek(target);
      return;
    }

    if (throttleTimerRef.current) {
      return;
    }

    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;

      const latest = desiredTargetRef.current;
      if (latest !== null && !seekingRef.current) {
        issueSeek(latest);
      }
    }, delay);
  }

  function scheduleFinalSettle() {
    clearFinalSettleTimer();

    finalSettleTimerRef.current = setTimeout(() => {
      finalSettleTimerRef.current = null;

      const latest = desiredTargetRef.current;
      if (latest === null) {
        return;
      }

      if (seekingRef.current) {
        return;
      }

      issueSeek(latest);
    }, FINAL_SETTLE_MS);
  }

  function requestPreview(request: HoverPreviewRequest) {
    const target = clampTarget(request.timeSec);
    desiredTargetRef.current = target;

    const halfPreview = PREVIEW_WIDTH_PX / 2;
    const safeLeft = Math.min(
      Math.max(
        request.clientX,
        request.boundsLeft + halfPreview,
      ),
      Math.max(
        request.boundsLeft + halfPreview,
        request.boundsRight - halfPreview,
      ),
    );

    const safeTop = Math.max(
      8,
      request.anchorY - PREVIEW_CARD_HEIGHT_PX - 8,
    );

    setVisible(true);
    setHoverTimeSec(target);
    setLeftPx(safeLeft);
    setTopPx(safeTop);

    pumpLatestTarget();
    scheduleFinalSettle();
  }

  function hidePreview() {
    setVisible(false);
    desiredTargetRef.current = null;
    clearThrottleTimer();
    clearFinalSettleTimer();
  }

  function handleSeeked(
    event: React.SyntheticEvent<HTMLVideoElement>,
  ) {
    seekingRef.current = false;

    const completedTarget =
      activeSeekTargetRef.current ?? event.currentTarget.currentTime;
    activeSeekTargetRef.current = null;

    const latest = desiredTargetRef.current;
    if (
      latest !== null &&
      Math.abs(latest - completedTarget) >= SEEK_EPSILON_SEC
    ) {
      pumpLatestTarget(true);
    }
  }

  function handleLoadedMetadata() {
    metadataReadyRef.current = true;
    pumpLatestTarget(true);
  }

  function handleMediaError() {
    seekingRef.current = false;
    activeSeekTargetRef.current = null;
  }

  useEffect(() => {
    metadataReadyRef.current = false;
    seekingRef.current = false;
    desiredTargetRef.current = null;
    activeSeekTargetRef.current = null;
    lastIssuedAtRef.current = 0;
    setVisible(false);
    clearThrottleTimer();
    clearFinalSettleTimer();
  }, [previewSourceUrl]);

  useEffect(() => {
    return () => {
      clearThrottleTimer();
      clearFinalSettleTimer();
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      requestPreview,
      hidePreview,
    }),
    [durationSec],
  );

  const overlay =
    typeof document === 'undefined'
      ? null
      : createPortal(
          <div
            className={`shared-hover-preview${visible ? ' visible' : ''}`}
            data-testid="shared-hover-preview"
            aria-hidden={visible ? 'false' : 'true'}
            style={{
              left: `${leftPx}px`,
              top: `${topPx}px`,
            }}
          >
            <video
              ref={previewVideoRef}
              className="shared-hover-preview-video"
              src={previewSourceUrl}
              preload="metadata"
              muted
              playsInline
              aria-label="共享时间轴画面预览"
              onLoadedMetadata={handleLoadedMetadata}
              onSeeked={handleSeeked}
              onError={handleMediaError}
            />
            <div className="shared-hover-preview-time">
              {formatPreciseTime(hoverTimeSec)}
            </div>
          </div>,
          document.body,
        );

  return (
    <HoverPreviewContext.Provider value={contextValue}>
      {children}
      {overlay}
    </HoverPreviewContext.Provider>
  );
}

export const hoverPreviewTuning = {
  previewWidthPx: PREVIEW_WIDTH_PX,
  previewHeightPx: PREVIEW_HEIGHT_PX,
  seekThrottleMs: SEEK_THROTTLE_MS,
  finalSettleMs: FINAL_SETTLE_MS,
};
