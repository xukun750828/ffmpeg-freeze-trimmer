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

export type AudioPresence = 'sound' | 'silence';

export interface AudioSubInterval {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  audioPresence: AudioPresence;
}

export type VisualChangeLevel =
  | 'exact'
  | 'very-low'
  | 'low'
  | 'standard'
  | 'relaxed'
  | 'very-relaxed';

export interface ExactFrameMatchRequest {
  path: string;
  durationSec: number;
  currentTimeSec: number;
  hasAudio: boolean;
  visualChangeLevel: VisualChangeLevel;
}

export interface ExactFrameMatch {
  anchorSec: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  visualChangeLevel: VisualChangeLevel;
  maxNormalizedDifference: number;
  audioSubIntervals: AudioSubInterval[];
}

export type AnalysisStatus = 'idle' | 'detecting' | 'ready' | 'failed';
export type ExactMatchStatus = 'idle' | 'locating' | 'ready' | 'failed';
