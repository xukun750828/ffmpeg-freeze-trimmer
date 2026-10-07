import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopApi {
  getAppVersion(): Promise<string>;
}

const desktopApi: DesktopApi = {
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
