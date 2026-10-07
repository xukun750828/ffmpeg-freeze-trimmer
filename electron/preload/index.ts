import { contextBridge, ipcRenderer } from 'electron';
import type { DetectionOptions, FreezeInterval } from '../main/freeze/types';
import type { MediaInfo, OpenVideoResult } from '../main/media/types';

export interface DesktopApi {
  getAppVersion(): Promise<string>;
  openVideo(): Promise<OpenVideoResult | null>;
  probeMedia(path: string): Promise<MediaInfo>;
  detectFreezes(
    path: string,
    durationSec: number,
    options: DetectionOptions,
  ): Promise<FreezeInterval[]>;
}

const desktopApi: DesktopApi = {
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  openVideo: () => ipcRenderer.invoke('media:open'),
  probeMedia: (path) => ipcRenderer.invoke('media:probe', path),
  detectFreezes: (path, durationSec, options) =>
    ipcRenderer.invoke('freeze:detect', {
      path,
      durationSec,
      options,
    }),
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
