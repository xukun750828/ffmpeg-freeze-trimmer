import { contextBridge, ipcRenderer } from 'electron';
import type { MediaInfo, OpenVideoResult } from '../main/media/types';

export interface DesktopApi {
  getAppVersion(): Promise<string>;
  openVideo(): Promise<OpenVideoResult | null>;
  probeMedia(path: string): Promise<MediaInfo>;
}

const desktopApi: DesktopApi = {
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  openVideo: () => ipcRenderer.invoke('media:open'),
  probeMedia: (path) => ipcRenderer.invoke('media:probe', path),
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
