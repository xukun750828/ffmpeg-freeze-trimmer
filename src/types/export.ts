export interface TimeRange {
  startSec: number;
  endSec: number;
}

export interface ExportRequest {
  inputPath: string;
  outputPath: string;
  durationSec: number;
  fps: number;
  videoCodec: string;
  audioCodec?: string;
  hasAudio: boolean;
  removeRanges: TimeRange[];
}

export type ExportStrategy = 'smart-copy' | 'smart-render' | 'reencode';

export interface ExportProgressEvent {
  jobId: string;
  progress: number;
  outTimeSec: number;
  strategy?: ExportStrategy;
}

export interface ExportFinishedEvent {
  jobId: string;
  status: 'completed' | 'cancelled' | 'failed';
  outputPath?: string;
  strategy?: ExportStrategy;
  error?: string;
}
