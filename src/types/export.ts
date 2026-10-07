export interface TimeRange {
  startSec: number;
  endSec: number;
}

export interface ExportRequest {
  inputPath: string;
  outputPath: string;
  durationSec: number;
  hasAudio: boolean;
  removeRanges: TimeRange[];
}

export interface ExportProgressEvent {
  jobId: string;
  progress: number;
  outTimeSec: number;
}

export interface ExportFinishedEvent {
  jobId: string;
  status: 'completed' | 'cancelled' | 'failed';
  outputPath?: string;
  error?: string;
}
