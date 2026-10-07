import type { DetectionOptions, FreezeInterval } from './types/freeze';
import type { MediaInfo, OpenVideoResult } from './types/media';

export {};

declare global {
  interface Window {
    desktopApi?: {
      getAppVersion(): Promise<string>;
      openVideo(): Promise<OpenVideoResult | null>;
      probeMedia(path: string): Promise<MediaInfo>;
      detectFreezes(
        path: string,
        durationSec: number,
        options: DetectionOptions,
      ): Promise<FreezeInterval[]>;
    };
  }
}
