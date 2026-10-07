import { contextBridge, ipcRenderer } from 'electron';
import type {
  ExportFinishedEvent,
  ExportProgressEvent,
  ExportRequest,
} from '../main/export/types';
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
  chooseOutputPath(defaultName: string): Promise<string | null>;
  startExport(request: ExportRequest): Promise<{ jobId: string }>;
  cancelExport(jobId: string): Promise<void>;
  onExportProgress(listener: (event: ExportProgressEvent) => void): () => void;
  onExportFinished(listener: (event: ExportFinishedEvent) => void): () => void;
  onMenuOpenVideo(listener: () => void): () => void;
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
  chooseOutputPath: (defaultName) =>
    ipcRenderer.invoke('export:choose-output', defaultName),
  startExport: (request) => ipcRenderer.invoke('export:start', request),
  cancelExport: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
  onExportProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ExportProgressEvent) =>
      listener(payload);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  },
  onExportFinished: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ExportFinishedEvent) =>
      listener(payload);
    ipcRenderer.on('export:finished', handler);
    return () => ipcRenderer.removeListener('export:finished', handler);
  },
  onMenuOpenVideo: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('menu:open-video', handler);
    return () => ipcRenderer.removeListener('menu:open-video', handler);
  },
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
