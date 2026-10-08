import type {
  ExportFinishedEvent,
  ExportProgressEvent,
  ExportRequest,
} from './types/export';
import type {
  DirectedDetectionRequest,
  ExactFrameMatch,
  ExactFrameMatchRequest,
  FreezeInterval,
} from './types/freeze';
import type { MediaInfo, OpenVideoResult } from './types/media';

export {};

declare global {
  interface Window {
    desktopApi?: {
      getAppVersion(): Promise<string>;
      openVideo(): Promise<OpenVideoResult | null>;
      probeMedia(path: string): Promise<MediaInfo>;
      detectFreezes(request: DirectedDetectionRequest): Promise<FreezeInterval[]>;
      locateExactFrameMatch(
        request: ExactFrameMatchRequest,
      ): Promise<ExactFrameMatch | null>;
      chooseOutputPath(defaultName: string): Promise<string | null>;
      startExport(request: ExportRequest): Promise<{ jobId: string }>;
      cancelExport(jobId: string): Promise<void>;
      onExportProgress(listener: (event: ExportProgressEvent) => void): () => void;
      onExportFinished(listener: (event: ExportFinishedEvent) => void): () => void;
      onMenuVideoSelected(listener: (selection: OpenVideoResult) => void): () => void;
    };
  }
}
