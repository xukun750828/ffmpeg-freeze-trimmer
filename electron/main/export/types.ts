export interface TimeRange {
  startSec: number;
  endSec: number;
}

export interface ExportPlan {
  removeRanges: TimeRange[];
  keepRanges: TimeRange[];
  outputDurationSec: number;
}
