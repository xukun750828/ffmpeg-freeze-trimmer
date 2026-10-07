export interface FreezeInterval {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  selectedForRemoval: boolean;
}

export interface DetectionOptions {
  noise: number;
  minDurationSec: number;
}
