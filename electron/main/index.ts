import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import path from 'node:path';
import { openVideoDialog } from './media/media-importer';
import { probeMedia } from './media/media-probe';
import { clearMediaRegistry, registerMediaProtocol } from './media/media-protocol';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  registerMediaProtocol();

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('media:open', () => openVideoDialog());
  ipcMain.handle('media:probe', (_event, mediaPath: string) => probeMedia(mediaPath));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  clearMediaRegistry();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
