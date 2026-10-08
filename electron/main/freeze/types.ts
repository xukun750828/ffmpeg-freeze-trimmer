export interface FreezeInterval {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  selectedForRemoval: boolean;
}

export type DetectionDirection = 'forward' | 'backward';

export interface DetectionOptions {
  noise: number;
  minDurationSec: number;
  hasBackgroundSound: boolean;
}

export interface DirectedDetectionRequest {
  path: string;
  durationSec: number;
  currentTimeSec: number;
  direction: DetectionDirection;
  maxIntervals: number;
  hasAudio: boolean;
  options: DetectionOptions;
}
