export interface MediaInfo {
  path: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec?: string;
  hasAudio: boolean;
}

export interface OpenVideoResult {
  path: string;
  name: string;
  sourceUrl: string;
}
